// Plantillas de los mails de Merla Coffee (HTML inline: los clientes de correo
// no cargan hojas de estilo externas).

const { numeroPedido } = require("../../public/motor.js");

const VERDE = "#2f4a36";
const CREMA = "#f2ead8";
const CARAMELO = "#b07a42";
const GRIS = "#66705f";

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

function bloqueEntrega(envio) {
  if (!envio || !envio.metodo) return "";
  if (envio.metodo === "retiro") {
    return `<p style="margin:14px 0 0;color:${GRIS};">🏪 <strong style="color:${VERDE};">Retiro en el local</strong> — te avisamos cuando esté listo.</p>`;
  }
  const dir = [envio.direccion, envio.ciudad, envio.provincia, envio.cp && `CP ${envio.cp}`]
    .filter(Boolean).map(escapar).join(", ");
  return `<p style="margin:14px 0 0;color:${GRIS};">📦 <strong style="color:${VERDE};">Envío a domicilio</strong><br>
    ${escapar(envio.nombre)} — ${dir}${envio.telefono ? `<br>Tel: ${escapar(envio.telefono)}` : ""}${envio.notas ? `<br>${escapar(envio.notas)}` : ""}</p>`;
}

// Documento completo: el <meta charset> es imprescindible para que los acentos
// y emojis lleguen bien a los clientes de correo.
function envoltorio(titulo, cuerpo) {
  return `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo}</title>
</head>
<body style="margin:0;padding:24px;background:${CREMA};font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#fffdf8;border:1px solid #ded2b5;border-radius:16px;padding:28px;">
    <p style="margin:0 0 4px;color:${VERDE};font-size:12px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;">Merla Coffee</p>
    <h1 style="margin:0 0 16px;color:${VERDE};font-size:24px;">${titulo}</h1>
    ${cuerpo}
  </div>
  <p style="max-width:520px;margin:14px auto 0;color:${GRIS};font-size:12px;text-align:center;">
    Merla Coffee · Café de especialidad en drip bags · La Plata, Argentina
  </p>
</body>
</html>`;
}

function resumen(pedido) {
  const desc = [];
  if (pedido.descuento_cantidad) desc.push(`<tr><td style="padding:4px 0;color:${CARAMELO};">Descuento por cantidad</td><td style="padding:4px 0;text-align:right;color:${CARAMELO};">-${pesos(pedido.descuento_cantidad)}</td></tr>`);
  if (pedido.descuento_cupon) desc.push(`<tr><td style="padding:4px 0;color:${CARAMELO};">Cupón ${escapar(pedido.cupon)}</td><td style="padding:4px 0;text-align:right;color:${CARAMELO};">-${pesos(pedido.descuento_cupon)}</td></tr>`);
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
  const canal = { mercadopago: "Mercado Pago", whatsapp: "WhatsApp", modo: "MODO" }[pedido.origen] || pedido.origen;
  const cobrado = pedido.estado === "aprobado";
  return {
    asunto: `${cobrado ? "💰 Venta cobrada" : "🧾 Pedido nuevo"} ${numeroPedido(pedido.numero)} · ${pesos(pedido.total)}`,
    html: envoltorio(
      `${cobrado ? "¡Venta cobrada!" : "Pedido nuevo"} ${numeroPedido(pedido.numero)}`,
      `<p style="margin:0 0 14px;color:${GRIS};">Canal: <strong style="color:${VERDE};">${escapar(canal)}</strong> · Estado: <strong style="color:${VERDE};">${escapar(pedido.estado)}</strong></p>
       ${resumen(pedido)}
       <p style="margin:14px 0 0;color:${GRIS};">Cliente: ${escapar(pedido.cliente_email || "sin email")}</p>
       ${bloqueEntrega(pedido.envio)}
       <p style="margin:20px 0 0;"><a href="https://merla-coffee.merlacoffee.workers.dev/admin" style="background:${VERDE};color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;font-weight:bold;display:inline-block;">Ver en el panel</a></p>`
    ),
  };
}

// Confirmación para el cliente
function mailConfirmacionCliente(pedido) {
  const puntos = pedido.puntos_ganados
    ? `<p style="margin:14px 0 0;color:${GRIS};">⭐ Sumaste <strong style="color:${VERDE};">${pedido.puntos_ganados} puntos</strong> del Club Merla con esta compra.</p>`
    : "";
  return {
    asunto: `Tu pedido ${numeroPedido(pedido.numero)} en Merla Coffee ☕`,
    html: envoltorio(
      "¡Gracias por tu compra!",
      `<p style="margin:0 0 14px;color:${GRIS};">Confirmamos tu pedido <strong style="color:${VERDE};">${numeroPedido(pedido.numero)}</strong>. Acá va el detalle:</p>
       ${resumen(pedido)}
       ${bloqueEntrega(pedido.envio)}
       ${puntos}
       <p style="margin:18px 0 0;color:${GRIS};">Cualquier duda respondé este mail o escribinos por WhatsApp. ¡Que lo disfrutes! ☕</p>`
    ),
  };
}

module.exports = { mailAvisoAdmin, mailConfirmacionCliente };
