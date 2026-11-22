// Mails automáticos cuando entra o se cobra un pedido.
// Todo acá es "best effort": si un mail falla, se loguea y la venta sigue su
// curso. Nunca lanza.

const { sb, obtenerPuntos } = require("./supabase.js");
const { enviarMail, config } = require("./brevo.js");
const { mailAvisoAdmin, mailConfirmacionCliente, mailDespachoCliente, mailPagoRaro } = require("./mails.js");
const { enviarTelegram, textoPedido, textoPagoRaro } = require("./telegram.js");
const { enviarPush, avisoPedido } = require("./push.js");

// Confirmación con el saldo de puntos al momento de enviarla (por eso va después
// de aprobar el pedido). Si no se puede leer el saldo, el mail sale igual sin él.
async function confirmacionConSaldo(pedido) {
  let saldo = null;
  if (pedido.estado === "aprobado") {
    try {
      saldo = await obtenerPuntos(pedido.cliente_email);
    } catch (err) {
      console.warn("avisos: mail sin saldo de puntos:", err.message);
    }
  }
  return mailConfirmacionCliente(pedido, saldo);
}

// Envía la confirmación y deja registrado cuándo salió, solo si Brevo la aceptó.
// Si falta la migración de la columna, el mail sale igual. Devuelve si se envió.
async function enviarConfirmacion(pedido) {
  const { asunto, html } = await confirmacionConSaldo(pedido);
  const enviado = await enviarMail({ para: pedido.cliente_email, asunto, html });
  if (!enviado) return false;
  try {
    await sb(`pedidos?id=eq.${encodeURIComponent(pedido.id)}`, {
      method: "PATCH",
      body: { confirmacion_enviada: new Date().toISOString() },
    });
  } catch (err) {
    console.warn("avisos: falta confirmacion_enviada (correr migracion-confirmacion-enviada.sql):", err.message);
  }
  return true;
}

// Busca el pedido, avisa al admin y —si se pide— le manda la confirmación al
// cliente. Los que llaman ya se aseguran de hacerlo una sola vez por pedido
// (la RPC de aprobación avisa si ya estaba procesado).
async function avisar(filtro, { confirmarCliente = false } = {}) {
  try {
    const filas = await sb(`pedidos?${filtro}&select=*&limit=1`);
    const pedido = filas && filas[0];
    if (!pedido) return false;

    // Mail y Telegram a la vez (Telegram nunca lanza; sin bot, no hace nada)
    const admin = mailAvisoAdmin(pedido);
    await Promise.all([
      enviarMail({ para: config().admin, asunto: admin.asunto, html: admin.html }),
      enviarTelegram(textoPedido(pedido)),
      enviarPush(avisoPedido(pedido)),
    ]);

    if (confirmarCliente && pedido.cliente_email) {
      await enviarConfirmacion(pedido);
    }
    return true;
  } catch (err) {
    console.error("avisos:", err.message);
    return false;
  }
}

// Pedido de WhatsApp recién creado: solo se avisa al admin (todavía no se cobró)
function avisarAdminPorId(id) {
  return avisar(`id=eq.${encodeURIComponent(id)}`);
}

// Venta cobrada por Mercado Pago: avisa al admin y confirma al cliente
function avisarVentaPorRef(ref) {
  return avisar(`modo_id=eq.${encodeURIComponent(ref)}`, { confirmarCliente: true });
}

// Pagos que necesitan que alguien los mire: uno aprobado cuyo pedido ya no
// existe ("sin-pedido"), o un segundo pago sobre un pedido ya cobrado
// ("duplicado"). Mercado Pago repite sus avisos, así que se recuerda (en la
// memoria del Worker, alcanza para no repetir enseguida) cuáles ya salieron.
const pagosAvisados = new Set();
async function avisarPagoRaro(motivo, pago, pedido) {
  const clave = `${motivo}:${pago && pago.id}`;
  if (pagosAvisados.has(clave)) return false;
  if (pagosAvisados.size > 500) pagosAvisados.clear();
  pagosAvisados.add(clave);
  console.error(`avisos: pago ${motivo}`, pago && pago.id, pago && pago.external_reference);
  const telegram = Promise.all([ // no lanzan; corren junto con el mail
    enviarTelegram(textoPagoRaro(motivo, pago, pedido)),
    enviarPush({ titulo: `⚠️ Pago para revisar · $ ${Number((pago && pago.transaction_amount) || 0).toLocaleString("es-AR")}`, cuerpo: motivo === "duplicado" ? "Pagaron dos veces el mismo pedido. Revisá el mail." : "Entró un pago sin pedido. Revisá el mail.", url: "/admin#pedidos", etiqueta: `pago-${pago && pago.id}` }),
  ]);
  try {
    const mail = mailPagoRaro(motivo, pago, pedido);
    return await enviarMail({ para: config().admin, asunto: mail.asunto, html: mail.html });
  } catch (err) {
    console.error("avisos (pago raro):", err.message);
    return false;
  } finally {
    await telegram; // que el Worker no corte el envío al responder
  }
}

// Envía el mail de despacho / listo para retirar al cliente.
async function enviarAvisoDespacho(pedido) {
  const { asunto, html } = mailDespachoCliente(pedido);
  return enviarMail({ para: pedido.cliente_email, asunto, html });
}

module.exports = { avisarAdminPorId, avisarVentaPorRef, avisarPagoRaro, enviarConfirmacion, enviarAvisoDespacho };
