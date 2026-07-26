// Mantenimiento de la base: tareas que corren solas por cron (no las llama el
// navegador). Ver el handler `scheduled` en src/worker.js.

const { sb } = require("./supabase.js");
const { enviarMail, config } = require("./brevo.js");
const { mailCarritoAbandonado } = require("./mails.js");

// Horas que un pedido puede quedar "pendiente" antes de considerarse un
// carrito abandonado y borrarse. Solo afecta pendientes: los aprobados y
// rechazados quedan siempre para poder analizar los canales de venta.
const HORAS_PENDIENTE = 48;

// A las cuántas horas se le recuerda al cliente que dejó el pedido a medias.
// Tiene que ser menor que HORAS_PENDIENTE: después el pedido ya no existe.
const HORAS_RECORDATORIO = 24;

// Borra los pedidos pendientes más viejos que HORAS_PENDIENTE.
// Devuelve cuántos borró.
async function limpiarPedidosPendientes() {
  const limite = new Date(Date.now() - HORAS_PENDIENTE * 3600 * 1000).toISOString();
  const borrados = await sb(
    `pedidos?estado=eq.pendiente&creado=lt.${encodeURIComponent(limite)}`,
    { method: "DELETE", headers: { Prefer: "return=representation" } }
  );
  return Array.isArray(borrados) ? borrados.length : 0;
}

// Recordatorio de carrito abandonado: pendientes con email, de entre
// HORAS_RECORDATORIO y HORAS_PENDIENTE de antigüedad, a los que todavía no se
// les avisó. `recordatorio_enviado` evita repetir en la corrida siguiente del
// cron (corre cada 6 h, así que un mismo pedido entra en la ventana varias
// veces). Devuelve cuántos mails salieron.
async function recordarCarritosAbandonados() {
  if (!config().apiKey) return 0; // sin Brevo no se rompe nada: no se manda y listo

  const ahora = Date.now();
  const desde = new Date(ahora - HORAS_PENDIENTE * 3600 * 1000).toISOString();
  const hasta = new Date(ahora - HORAS_RECORDATORIO * 3600 * 1000).toISOString();

  let pendientes;
  try {
    pendientes = await sb(
      `pedidos?estado=eq.pendiente&cliente_email=not.is.null&recordatorio_enviado=is.null` +
      `&creado=gt.${encodeURIComponent(desde)}&creado=lt.${encodeURIComponent(hasta)}&order=creado.asc&limit=50`
    );
  } catch (err) {
    console.warn("mantenimiento: falta recordatorio_enviado (correr migracion-carrito-abandonado.sql):", err.message);
    return 0;
  }

  let enviados = 0;
  for (const pedido of pendientes) {
    try {
      const mail = mailCarritoAbandonado(pedido);
      await enviarMail({ para: pedido.cliente_email, asunto: mail.asunto, html: mail.html });
      // Se marca aunque el pedido se borre después: mientras exista, no repite
      await sb(`pedidos?id=eq.${encodeURIComponent(pedido.id)}`, {
        method: "PATCH",
        body: { recordatorio_enviado: new Date().toISOString() },
      });
      enviados++;
    } catch (err) {
      console.error("mantenimiento: no pude recordar el pedido", pedido.id, err.message);
    }
  }
  return enviados;
}

module.exports = {
  limpiarPedidosPendientes,
  recordarCarritosAbandonados,
  HORAS_PENDIENTE,
  HORAS_RECORDATORIO,
};
