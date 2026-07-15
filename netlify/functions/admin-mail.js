// Envío manual de la confirmación al cliente, desde el botón del panel.
//
//   POST { pedido_id } → { ok: true }

const { sb } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");
const { enviarMail } = require("../lib/brevo.js");
const { mailConfirmacionCliente } = require("../lib/mails.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  try {
    const { pedido_id } = JSON.parse(event.body || "{}");
    if (!pedido_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Falta el pedido" }) };
    }

    const [pedido] = await sb(`pedidos?id=eq.${encodeURIComponent(pedido_id)}&select=*&limit=1`);
    if (!pedido) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Pedido inexistente" }) };
    }
    if (!pedido.cliente_email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "El pedido no tiene email del cliente" }) };
    }

    const { asunto, html } = mailConfirmacionCliente(pedido);
    const enviado = await enviarMail({ para: pedido.cliente_email, asunto, html });
    if (!enviado) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "No se pudo enviar el mail (revisá BREVO_API_KEY y el remitente verificado)" }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, para: pedido.cliente_email }) };
  } catch (err) {
    console.error("admin-mail:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No se pudo enviar el mail" }) };
  }
};
