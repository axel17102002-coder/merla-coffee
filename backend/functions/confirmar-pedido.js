// POST /.netlify/functions/confirmar-pedido  { id }
// Respaldo del webhook: la web lo llama cuando MODO avisa "pago exitoso" en el
// navegador. Verifica el estado real contra la API de MODO antes de aprobar,
// así nadie puede confirmar un pedido que no pagó. Es idempotente: si el
// webhook ya lo procesó, no pasa nada.

const { sb, sbRpc } = require("../lib/supabase.js");
const { obtenerPago } = require("../lib/modo.js");
const { obtenerPagoMp } = require("../lib/mercadopago.js");
const { acreditarPagoMp } = require("../lib/cobro.js");

async function resumenPedido(ref) {
  try {
    const [fila] = await sb(
      `pedidos?modo_id=eq.${encodeURIComponent(ref)}&select=numero,total,envio_costo,envio&limit=1`
    );
    if (!fila) return null;
    const e = fila.envio || {};
    return {
      numero: fila.numero,
      total: fila.total,
      envio_costo: fila.envio_costo || 0,
      metodo: e.metodo || "retiro",
      opcionTipo: e.opcionTipo || null,
      transportista: e.transportista || "",
      servicio: e.servicio || "",
      proveedor: e.proveedor || "",
      sucursal: e.sucursal ? e.sucursal.descripcion || e.sucursal.direccion || "" : "",
    };
  } catch {
    return null;
  }
}

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
      // Mismo camino que el webhook (idempotente: si ya lo procesó, no repite)
      const r = await acreditarPagoMp(pago);
      const pedido = r && r.ok ? await resumenPedido(String(pago.external_reference)) : null;
      return { statusCode: 200, headers, body: JSON.stringify(pedido ? { ...r, pedido } : r) };
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
    const pedido = r && r.ok ? await resumenPedido(String(id)) : null;
    return { statusCode: 200, headers, body: JSON.stringify(pedido ? { ...r, pedido } : r) };
  } catch (err) {
    console.error("confirmar-pedido:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Error confirmando el pedido" }) };
  }
};
