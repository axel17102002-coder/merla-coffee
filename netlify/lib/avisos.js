// Avisos por mail al administrador cuando entra o se cobra un pedido.
// Todo acá es "best effort": si el mail falla, se loguea y la venta sigue su
// curso. Nunca lanza.

const { sb } = require("./supabase.js");
const { enviarMail, config } = require("./brevo.js");
const { mailAvisoAdmin } = require("./mails.js");

async function avisar(filtro) {
  try {
    const filas = await sb(`pedidos?${filtro}&select=*&limit=1`);
    const pedido = filas && filas[0];
    if (!pedido) return false;
    const { asunto, html } = mailAvisoAdmin(pedido);
    return await enviarMail({ para: config().admin, asunto, html });
  } catch (err) {
    console.error("avisarAdmin:", err.message);
    return false;
  }
}

// Avisa por id de pedido (pedidos por WhatsApp recién creados)
function avisarAdminPorId(id) {
  return avisar(`id=eq.${encodeURIComponent(id)}`);
}

// Avisa por la referencia externa del pago (pedidos de Mercado Pago aprobados)
function avisarAdminPorRef(ref) {
  return avisar(`modo_id=eq.${encodeURIComponent(ref)}`);
}

module.exports = { avisarAdminPorId, avisarAdminPorRef };
