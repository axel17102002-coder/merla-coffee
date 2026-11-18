// Mantenimiento de la base: tareas que corren solas por cron (no las llama el
// navegador). Ver el handler `scheduled` en src/worker.js, que las corre en
// este orden: conciliar pagos → recordar carritos → limpiar pendientes.

const { sb, obtenerCupon } = require("./supabase.js");
const { enviarMail, config } = require("./brevo.js");
const { mailCarritoAbandonado, mailPedidoResena } = require("./mails.js");
const { enlaceResena, elegirPedidosParaResena, DIAS_DESDE, DIAS_HASTA, DIAS_ENTRE_PEDIDOS } = require("./resenas.js");
const { buscarPagosMp } = require("./mercadopago.js");
const { acreditarPagoMp } = require("./cobro.js");
const { ORIGENES_MANUALES } = require("../../public/motor.js");

// Los pedidos cargados a mano se cobran por fuera de la web: no son carritos
// abandonados, así que ni se borran ni reciben el recordatorio.
const SIN_MANUALES = `&origen=not.in.(${ORIGENES_MANUALES.join(",")})`;

// Horas que un pedido puede quedar "pendiente" antes de considerarse un
// carrito abandonado y borrarse. Solo afecta pendientes: los aprobados y
// rechazados quedan siempre para poder analizar los canales de venta.
// El link de pago de Mercado Pago vence una hora antes (mercadopago-checkout).
const HORAS_PENDIENTE = 48;

// A las cuántas horas se le recuerda al cliente que dejó el pedido a medias.
// Mercado Pago: a las 2 h, cuando todavía se acuerda de lo que estaba
// comprando. El resto (WhatsApp): a las 24 h, porque esos pedidos se cobran
// conversando y pueden estar pendientes sin estar abandonados.
const HORAS_RECORDATORIO = { mercadopago: 2, otros: 24 };
const horasRecordatorio = (origen) => HORAS_RECORDATORIO[origen] || HORAS_RECORDATORIO.otros;

// Topes por corrida. El cron corre cada hora y un Worker tiene un máximo de
// llamadas salientes por ejecución: lo que no entra hoy, entra en la próxima.
const MAX_CONCILIAR = 25;
const MAX_RECORDATORIOS = 8;

// Un pedido recién creado todavía está pagándose: el aviso normal de MP llega
// en segundos, no hace falta salir a buscarlo.
const MINUTOS_GRACIA = 20;

// Estados de un pago de MP que todavía pueden terminar aprobados (por ejemplo,
// una tarjeta en revisión): mientras haya uno, el pedido no se da por abandonado.
const PAGO_EN_CURSO = ["in_process", "pending", "authorized", "in_mediation"];

const haceHoras = (horas) => new Date(Date.now() - horas * 3600 * 1000).toISOString();

// Conciliación con Mercado Pago: por cada pedido pendiente pregunta a MP si en
// realidad ya se pagó. Cubre el caso en que el aviso de MP no llegó (o falló
// algo al procesarlo) y el cliente no volvió a la web: sin esto, ese pedido
// pagado recibiría el mail de carrito abandonado y se borraría a las 48 h.
//
// Devuelve { aprobados, sinPago } donde `sinPago` son los ids que MP confirmó
// que NO tienen pago: solo esos se pueden recordar o borrar. Los que no se
// pudieron verificar (MP caído, tope de la corrida) no se tocan.
// Devuelve null si no hay Mercado Pago configurado (nada que proteger).
async function conciliarPagosMp() {
  if (!process.env.MP_ACCESS_TOKEN) return null;

  const hasta = new Date(Date.now() - MINUTOS_GRACIA * 60 * 1000).toISOString();
  const pendientes = await sb(
    `pedidos?select=id,numero,modo_id&estado=eq.pendiente&origen=eq.mercadopago&modo_id=not.is.null` +
    `&creado=lt.${encodeURIComponent(hasta)}&order=creado.asc&limit=${MAX_CONCILIAR}`
  );

  const resultado = { aprobados: 0, sinPago: new Set() };
  for (const pedido of pendientes) {
    try {
      const pagos = await buscarPagosMp(pedido.modo_id);
      const aprobado = pagos.find((p) => p.status === "approved");
      if (aprobado) {
        const r = await acreditarPagoMp(aprobado);
        console.log("mantenimiento: pedido pagado que seguía pendiente:", pedido.numero, JSON.stringify(r));
        if (r && r.ok) resultado.aprobados++;
      } else if (!pagos.some((p) => PAGO_EN_CURSO.includes(p.status))) {
        resultado.sinPago.add(pedido.id);
      }
    } catch (err) {
      // Sin verificar: no entra en `sinPago`, así que no se recuerda ni se borra
      console.error("mantenimiento: no pude conciliar el pedido", pedido.numero, err.message);
    }
  }
  return resultado;
}

// ¿Se puede dar por abandonado este pedido? Los de Mercado Pago, solo si la
// conciliación confirmó que no tienen pago.
function sinPagoConfirmado(pedido, conciliacion) {
  if (pedido.origen !== "mercadopago" || !conciliacion) return true;
  return conciliacion.sinPago.has(pedido.id);
}

// Borra los pedidos pendientes más viejos que HORAS_PENDIENTE.
// Devuelve cuántos borró.
async function limpiarPedidosPendientes(conciliacion = null) {
  const vencidos = `pedidos?estado=eq.pendiente&creado=lt.${encodeURIComponent(haceHoras(HORAS_PENDIENTE))}`;
  const borrar = async (filtro) => {
    const borrados = await sb(`${vencidos}${filtro}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
    return Array.isArray(borrados) ? borrados.length : 0;
  };

  // Sin Mercado Pago configurado no hay pagos que proteger: se borra todo junto
  if (!conciliacion) return borrar(SIN_MANUALES);

  // Los que no son de Mercado Pago (WhatsApp) no tienen pago online que perder
  let total = await borrar(`&origen=not.in.(${[...ORIGENES_MANUALES, "mercadopago"].join(",")})`);
  // Los de Mercado Pago, solo los que MP confirmó sin pago (los ids son uuid)
  const ids = [...conciliacion.sinPago];
  if (ids.length) total += await borrar(`&origen=eq.mercadopago&id=in.(${ids.join(",")})`);
  return total;
}

// Cupón de regalo para el recordatorio (opcional). Se activa cargando el código
// en la variable CUPON_CARRITO; tiene que existir y estar activo en /admin →
// Cupones. Devuelve { cupon, usadoPor } o null si no hay nada que ofrecer.
async function cuponDeRegalo() {
  const codigo = String(process.env.CUPON_CARRITO || "").trim();
  if (!codigo) return null;
  try {
    const cupon = await obtenerCupon(codigo);
    if (!cupon) return null;
    const usos = await sb(`cupones_usados?select=email&codigo=eq.${encodeURIComponent(cupon.codigo)}&limit=5000`);
    return { cupon, usadoPor: new Set(usos.map((u) => String(u.email).toLowerCase())) };
  } catch (err) {
    console.warn("mantenimiento: recordatorio sin cupón de regalo:", err.message);
    return null;
  }
}

// De los pedidos de las últimas 48 h, elige a cuáles mandarles el recordatorio.
// Función pura (sin red) para poder probarla. Reglas, por email:
//   - solo cuenta su pedido MÁS NUEVO: si después compró, o está reintentando
//     ahora mismo, no se lo molesta por un intento anterior;
//   - ese pedido tiene que estar pendiente, sin recordatorio, y haber pasado
//     las horas de su canal;
//   - un solo recordatorio por email mientras duren sus pedidos (48 h);
//   - los de Mercado Pago, solo si la conciliación confirmó que no hay pago.
function elegirRecordatorios(pedidos, conciliacion, ahora = Date.now()) {
  const porEmail = new Map();
  for (const p of pedidos) {
    const email = String(p.cliente_email || "").trim().toLowerCase();
    if (!email) continue;
    if (!porEmail.has(email)) porEmail.set(email, []);
    porEmail.get(email).push(p);
  }

  const elegidos = [];
  for (const lista of porEmail.values()) {
    if (lista.some((p) => p.recordatorio_enviado)) continue;
    const ultimo = lista.reduce((a, b) => (new Date(b.creado) > new Date(a.creado) ? b : a));
    if (ultimo.estado !== "pendiente" || ORIGENES_MANUALES.includes(ultimo.origen)) continue;
    const horas = (ahora - new Date(ultimo.creado).getTime()) / 3600000;
    if (horas < horasRecordatorio(ultimo.origen) || horas >= HORAS_PENDIENTE) continue;
    if (!sinPagoConfirmado(ultimo, conciliacion)) continue;
    elegidos.push(ultimo);
  }
  // Primero los que llevan más tiempo esperando
  return elegidos.sort((a, b) => new Date(a.creado) - new Date(b.creado));
}

// Recordatorio de carrito abandonado. `recordatorio_enviado` evita repetir en
// la corrida siguiente del cron. Devuelve cuántos mails salieron.
async function recordarCarritosAbandonados(conciliacion = null) {
  if (!config().apiKey) return 0; // sin Brevo no se rompe nada: no se manda y listo

  let recientes;
  try {
    recientes = await sb(
      `pedidos?select=id,numero,origen,estado,creado,cliente_email,recordatorio_enviado,items,subtotal,total,cupon,` +
      `descuento_cantidad,descuento_cupon,descuento_puntos&cliente_email=not.is.null` +
      `&creado=gt.${encodeURIComponent(haceHoras(HORAS_PENDIENTE))}&order=creado.desc&limit=1000`
    );
  } catch (err) {
    console.warn("mantenimiento: falta recordatorio_enviado (correr migracion-carrito-abandonado.sql):", err.message);
    return 0;
  }

  const elegidos = elegirRecordatorios(recientes, conciliacion).slice(0, MAX_RECORDATORIOS);
  if (!elegidos.length) return 0;
  const regalo = await cuponDeRegalo();

  let enviados = 0;
  for (const pedido of elegidos) {
    try {
      // El regalo no pisa un cupón que el cliente ya había puesto, ni se
      // ofrece si ya lo usó o si el pedido no llega a su mínimo.
      const base = (Number(pedido.subtotal) || 0) - (Number(pedido.descuento_cantidad) || 0);
      const conRegalo = regalo && !pedido.cupon
        && !regalo.usadoPor.has(String(pedido.cliente_email).toLowerCase())
        && base >= (regalo.cupon.minimo || 0);
      const mail = mailCarritoAbandonado(pedido, conRegalo ? regalo.cupon : null);
      const salio = await enviarMail({ para: pedido.cliente_email, asunto: mail.asunto, html: mail.html });
      // Se marca aunque Brevo lo haya rechazado: una dirección mala no puede
      // quedar reintentando cada hora y sacándole el lugar a los demás.
      await sb(`pedidos?id=eq.${encodeURIComponent(pedido.id)}`, {
        method: "PATCH",
        body: { recordatorio_enviado: new Date().toISOString() },
      });
      if (salio) enviados++;
    } catch (err) {
      console.error("mantenimiento: no pude recordar el pedido", pedido.id, err.message);
    }
  }
  return enviados;
}

// Pedido de reseña: a los clientes que compraron hace entre 5 y 14 días les
// llega un mail con un link personal para opinar (ver backend/lib/resenas.js).
// `resena_pedida` evita pedirla dos veces. Devuelve cuántos mails salieron.
const MAX_PEDIDOS_RESENA = 8;
async function pedirResenas() {
  if (!config().apiKey) return 0;

  let candidatos, recientes;
  try {
    candidatos = await sb(
      `pedidos?select=id,numero,origen,cliente_email,items,envio,actualizado&estado=eq.aprobado` +
      `&cliente_email=not.is.null&resena_pedida=is.null` +
      `&actualizado=lt.${encodeURIComponent(haceHoras(DIAS_DESDE * 24))}` +
      `&actualizado=gt.${encodeURIComponent(haceHoras(DIAS_HASTA * 24))}&order=actualizado.asc&limit=100`
    );
    recientes = await sb(
      `pedidos?select=cliente_email&resena_pedida=gt.${encodeURIComponent(haceHoras(DIAS_ENTRE_PEDIDOS * 24))}&limit=5000`
    );
  } catch (err) {
    console.warn("mantenimiento: falta resena_pedida (correr migracion-resenas-clientes.sql):", err.message);
    return 0;
  }

  const yaPedidas = new Set(recientes.map((p) => String(p.cliente_email || "").trim().toLowerCase()));
  const elegidos = elegirPedidosParaResena(candidatos, yaPedidas).slice(0, MAX_PEDIDOS_RESENA);

  let enviados = 0;
  for (const pedido of elegidos) {
    try {
      const mail = mailPedidoResena(pedido, (n) => enlaceResena(pedido.id, n));
      const salio = await enviarMail({ para: pedido.cliente_email, asunto: mail.asunto, html: mail.html });
      // Se marca aunque Brevo lo rechace: una dirección mala no puede quedar
      // reintentando cada hora
      await sb(`pedidos?id=eq.${encodeURIComponent(pedido.id)}`, {
        method: "PATCH",
        body: { resena_pedida: new Date().toISOString() },
      });
      if (salio) enviados++;
    } catch (err) {
      console.error("mantenimiento: no pude pedir la reseña del pedido", pedido.id, err.message);
    }
  }
  return enviados;
}

module.exports = {
  conciliarPagosMp,
  pedirResenas,
  limpiarPedidosPendientes,
  recordarCarritosAbandonados,
  elegirRecordatorios,
  HORAS_PENDIENTE,
  HORAS_RECORDATORIO,
};
