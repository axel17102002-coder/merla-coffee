// Mails automáticos cuando entra o se cobra un pedido.
// Todo acá es "best effort": si un mail falla, se loguea y la venta sigue su
// curso. Nunca lanza.

const { sb, obtenerPuntos } = require("./supabase.js");
const { enviarMail, config } = require("./brevo.js");
const { mailAvisoAdmin, mailConfirmacionCliente } = require("./mails.js");

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

// Busca el pedido, avisa al admin y —si se pide— le manda la confirmación al
// cliente. Los que llaman ya se aseguran de hacerlo una sola vez por pedido
// (la RPC de aprobación avisa si ya estaba procesado).
async function avisar(filtro, { confirmarCliente = false } = {}) {
  try {
    const filas = await sb(`pedidos?${filtro}&select=*&limit=1`);
    const pedido = filas && filas[0];
    if (!pedido) return false;

    const admin = mailAvisoAdmin(pedido);
    await enviarMail({ para: config().admin, asunto: admin.asunto, html: admin.html });

    if (confirmarCliente && pedido.cliente_email) {
      const cliente = await confirmacionConSaldo(pedido);
      await enviarMail({ para: pedido.cliente_email, asunto: cliente.asunto, html: cliente.html });
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

module.exports = { avisarAdminPorId, avisarVentaPorRef, confirmacionConSaldo };
