// POST /.netlify/functions/confirmar-pedido  { id }
// Respaldo del webhook: la web lo llama cuando MODO avisa "pago exitoso" en el
// navegador. Verifica el estado real contra la API de MODO antes de aprobar,
// así nadie puede confirmar un pedido que no pagó. Es idempotente: si el
// webhook ya lo procesó, no pasa nada.

const { sbRpc } = require("../lib/supabase.js");
const { obtenerPago } = require("../lib/modo.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }
  try {
    const { id } = JSON.parse(event.body || "{}");
    const info = await obtenerPago(id);
    const estado = info ? String(info.status || "").toUpperCase() : null;

    if (estado !== "ACCEPTED") {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ error: "El pago todavía no figura aprobado en MODO" }),
      };
    }

    const r = await sbRpc("aprobar_pedido", { p_modo_id: String(id) });
    return { statusCode: 200, headers, body: JSON.stringify(r) };
  } catch (err) {
    console.error("confirmar-pedido:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Error confirmando el pedido" }) };
  }
};
