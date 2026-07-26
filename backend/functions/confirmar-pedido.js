// POST /.netlify/functions/confirmar-pedido  { id }
// Respaldo del webhook: la web lo llama cuando MODO avisa "pago exitoso" en el
// navegador. Verifica el estado real contra la API de MODO antes de aprobar,
// así nadie puede confirmar un pedido que no pagó. Es idempotente: si el
// webhook ya lo procesó, no pasa nada.

const { sbRpc } = require("../lib/supabase.js");
const { obtenerPago } = require("../lib/modo.js");
const { obtenerPagoMp, registrarPagoMp } = require("../lib/mercadopago.js");
const { avisarVentaPorRef } = require("../lib/avisos.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }
  try {
    const { id, mpPaymentId } = JSON.parse(event.body || "{}");

    // Pago con Mercado Pago: verificamos el estado real contra la API de MP
    if (mpPaymentId) {
      const pago = await obtenerPagoMp(mpPaymentId);
      if (!pago || pago.status !== "approved" || !pago.external_reference) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: "El pago todavía no figura aprobado en Mercado Pago" }),
        };
      }
      await registrarPagoMp(String(pago.external_reference), pago);
      const r = await sbRpc("aprobar_pedido", { p_modo_id: String(pago.external_reference) });
      // Solo avisamos la primera vez (si el webhook ya lo procesó, no repetimos)
      if (r && r.ok && !r.ya_procesado) await avisarVentaPorRef(String(pago.external_reference));
      return { statusCode: 200, headers, body: JSON.stringify(r) };
    }

    // Pago con MODO
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
