// Plantillas de los mails de Merla Coffee (HTML inline: los clientes de correo
// no cargan hojas de estilo externas).

const { CONFIG, METODOS_PAGO_MANUAL, numeroPedido } = require("../../public/motor.js");

const VERDE = "#2f4a36";
const CREMA = "#f2ead8";
const CARAMELO = "#b07a42";
const GRIS = "#66705f";
const SITIO = "https://merla-coffee.merlacoffee.workers.dev";
const WHATSAPP = "5492216803376"; // mismo número que public/app.js

const pesos = (n) =>
  "$ " + Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });

function filasItems(items) {
  return (items || [])
    .map(
      (i) => `<tr>
        <td style="padding:6px 0;color:#22301f;">${i.qty}× ${escapar(i.nombre)}</td>
        <td style="padding:6px 0;text-align:right;color:#22301f;">${pesos(i.precio_unitario * i.qty)}</td>
      </tr>`
    )
    .join("");
}

function escapar(v) {
  return String(v || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

const nombreCliente = (pedido) => String((pedido.envio && pedido.envio.nombre) || "").trim();

function bloqueEntrega(envio) {
  if (!envio || !envio.metodo) return "";
  if (envio.metodo === "retiro") {
    return `<p style="margin:14px 0 0;color:${GRIS};">🏪 <strong style="color:${VERDE};">Retiro en el local</strong> — te avisamos cuando esté listo.</p>`;
  }
  const dir = [envio.direccion, envio.ciudad, envio.provincia, envio.cp && `CP ${envio.cp}`]
    .filter(Boolean).map(escapar).join(", ");
  return `<p style="margin:14px 0 0;color:${GRIS};">📦 <strong style="color:${VERDE};">Envío a domicilio</strong><br>
    ${escapar(envio.nombre)}${dir ? ` — ${dir}` : ""}${envio.telefono ? `<br>Tel: ${escapar(envio.telefono)}` : ""}${envio.notas ? `<br>${escapar(envio.notas)}` : ""}</p>`;
}

// Documento completo: el <meta charset> es imprescindible para que los acentos
// y emojis lleguen bien, y `color-scheme` le pide a Apple Mail que no oscurezca el
// mail en modo oscuro. Maquetado con tablas porque es lo que respetan todos los
// clientes de correo. `titulo` tiene que venir ya escapado.
function envoltorio(titulo, cuerpo) {
  return `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<style>:root { color-scheme: light only; }</style>
<title>${titulo}</title>
</head>
<body style="margin:0;padding:0;background:${CREMA};font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREMA};">
    <tr><td align="center" style="padding:28px 16px;">
      <a href="${SITIO}"><img src="${SITIO}/img/logo_green.png" width="140" height="56" alt="Merla Coffee" style="display:block;border:0;margin:0 auto 20px;"></a>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdf8;border:1px solid #ded2b5;border-radius:16px;">
        <tr><td style="padding:28px;text-align:left;">
          <h1 style="margin:0 0 16px;color:${VERDE};font-size:24px;line-height:1.25;">${titulo}</h1>
          ${cuerpo}
        </td></tr>
      </table>
      <p style="max-width:520px;margin:16px auto 0;color:${GRIS};font-size:12px;line-height:1.5;">
        Merla Coffee · Café de especialidad en drip bags · La Plata, Argentina<br>
        <a href="${SITIO}" style="color:${VERDE};">Visitá la tienda</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function resumen(pedido) {
  const desc = [];
  if (pedido.descuento_cantidad) desc.push(`<tr><td style="padding:4px 0;color:${CARAMELO};">Descuento por cantidad</td><td style="padding:4px 0;text-align:right;color:${CARAMELO};">-${pesos(pedido.descuento_cantidad)}</td></tr>`);
  if (pedido.descuento_cupon) desc.push(`<tr><td style="padding:4px 0;color:${CARAMELO};">Cupón ${escapar(pedido.cupon)}</td><td style="padding:4px 0;text-align:right;color:${CARAMELO};">-${pesos(pedido.descuento_cupon)}</td></tr>`);
  if (pedido.descuento_pago) desc.push(`<tr><td style="padding:4px 0;color:${CARAMELO};">Descuento por transferencia</td><td style="padding:4px 0;text-align:right;color:${CARAMELO};">-${pesos(pedido.descuento_pago)}</td></tr>`);
  if (pedido.descuento_puntos) desc.push(`<tr><td style="padding:4px 0;color:${CARAMELO};">Canje de puntos</td><td style="padding:4px 0;text-align:right;color:${CARAMELO};">-${pesos(pedido.descuento_puntos)}</td></tr>`);
  return `<table style="width:100%;border-collapse:collapse;">
    ${filasItems(pedido.items)}
    ${desc.join("")}
    <tr><td colspan="2" style="border-top:1px solid #ded2b5;padding-top:8px;"></td></tr>
    <tr>
      <td style="padding:4px 0;font-weight:bold;color:${VERDE};font-size:18px;">Total</td>
      <td style="padding:4px 0;text-align:right;font-weight:bold;color:${VERDE};font-size:18px;">${pesos(pedido.total)}</td>
    </tr>
  </table>`;
}

// Aviso para el administrador: entró un pedido
function mailAvisoAdmin(pedido) {
  const canal = { mercadopago: "Mercado Pago", whatsapp: "WhatsApp", modo: "MODO", mayorista: "Mayorista", directa: "Venta directa" }[pedido.origen] || pedido.origen;
  const cobrado = pedido.estado === "aprobado";
  const metodoPago = METODOS_PAGO_MANUAL.find((m) => m.clave === pedido.metodo_pago);
  return {
    asunto: `${cobrado ? "💰 Venta cobrada" : "🧾 Pedido nuevo"} ${numeroPedido(pedido.numero)} · ${pesos(pedido.total)}`,
    html: envoltorio(
      `${cobrado ? "¡Venta cobrada!" : "Pedido nuevo"} ${numeroPedido(pedido.numero)}`,
      `<p style="margin:0 0 14px;color:${GRIS};">Canal: <strong style="color:${VERDE};">${escapar(canal)}</strong> · Estado: <strong style="color:${VERDE};">${escapar(pedido.estado)}</strong>${metodoPago ? ` · Pago: <strong style="color:${VERDE};">${escapar(metodoPago.etiqueta)}</strong>` : ""}</p>
       ${resumen(pedido)}
       <p style="margin:14px 0 0;color:${GRIS};">Cliente: ${nombreCliente(pedido) ? `${escapar(nombreCliente(pedido))} · ` : ""}${escapar(pedido.cliente_email || "sin email")}</p>
       ${bloqueEntrega(pedido.envio)}
       <p style="margin:20px 0 0;"><a href="https://merla-coffee.merlacoffee.workers.dev/admin" style="background:${VERDE};color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;font-weight:bold;display:inline-block;">Ver en el panel</a></p>`
    ),
  };
}

// Bloque Club Merla. Los puntos se acreditan al cobrar: en un pedido pendiente
// todavía no están en el saldo. `saldo` = null si no se pudo leer o no aplica.
function bloquePuntos(pedido, saldo) {
  const ganados = Number(pedido.puntos_ganados) || 0;
  const n = (v) => Number(v).toLocaleString("es-AR");
  const fuerte = (t) => `<strong style="color:${VERDE};">${t}</strong>`;
  const { canjePuntos, canjeDescuento } = CONFIG.fidelidad;

  const lineas = [];
  if (pedido.estado === "pendiente") {
    if (ganados) lineas.push(`⭐ Vas a sumar ${fuerte(`${n(ganados)} puntos`)} al confirmarse el pago.`);
  } else {
    if (ganados) lineas.push(`⭐ Sumaste ${fuerte(`${n(ganados)} puntos`)}.`);
    if (saldo != null && (ganados || saldo > 0)) {
      lineas.push(`Tu saldo: ${fuerte(`${n(saldo)} puntos`)}.`);
      lineas.push(saldo >= canjePuntos
        ? `¡Ya podés canjear ${fuerte(pesos(canjeDescuento))} de descuento en tu próxima compra!`
        : `Sumá más ${n(canjePuntos - saldo)} para canjear ${pesos(canjeDescuento)} de descuento.`);
    }
  }
  return lineas.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;background:#f6f0e2;border-radius:12px;">
        <tr><td style="padding:14px 16px;color:${GRIS};line-height:1.5;">${lineas.join("<br>")}</td></tr>
      </table>`
    : "";
}

// Confirmación para el cliente
function mailConfirmacionCliente(pedido, saldo = null) {
  const puntos = bloquePuntos(pedido, saldo);
  const nombre = nombreCliente(pedido);
  const numero = numeroPedido(pedido.numero);
  return {
    asunto: `Tu pedido ${numero} en Merla Coffee ☕`,
    html: envoltorio(
      nombre ? `¡Gracias por tu compra, ${escapar(nombre)}!` : "¡Gracias por tu compra!",
      `<p style="margin:0 0 14px;color:${GRIS};">Confirmamos tu pedido <strong style="color:${VERDE};">${numero}</strong>. Acá va el detalle:</p>
       ${resumen(pedido)}
       ${bloqueEntrega(pedido.envio)}
       ${puntos}
       <p style="margin:20px 0 12px;color:${GRIS};">¿Alguna duda? Escribinos o respondé este mail. ¡Que lo disfrutes! ☕</p>
       <a href="https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`¡Hola Merla Coffee! Te escribo por mi pedido ${numero}`)}" style="display:block;background:#25d366;color:#0b3d20;font-weight:bold;text-align:center;text-decoration:none;padding:13px 18px;border-radius:10px;">Escribinos por WhatsApp</a>`
    ),
  };
}

// Recordatorio de carrito abandonado: el pedido quedó pendiente y el cron lo
// va a borrar. Sin precios de más ni urgencias falsas: el detalle de lo que
// eligió y un botón para volver.
function mailCarritoAbandonado(pedido) {
  return {
    asunto: `¿Seguimos con tu pedido? ☕`,
    html: envoltorio(
      "Te quedó un café a medio camino",
      `<p style="margin:0 0 14px;color:${GRIS};">Empezaste un pedido en Merla Coffee y quedó sin confirmar. Te dejamos lo que habías elegido, por si querés retomarlo:</p>
       ${resumen(pedido)}
       <p style="margin:18px 0 0;color:${GRIS};">Si ya no te interesa, ignorá este mail: el pedido se cancela solo.</p>
       <p style="margin:18px 0 0;"><a href="https://merla-coffee.merlacoffee.workers.dev/#cafes" style="background:${VERDE};color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;font-weight:bold;display:inline-block;">Volver a la tienda</a></p>`
    ),
  };
}

module.exports = { mailAvisoAdmin, mailConfirmacionCliente, mailCarritoAbandonado };
