// POST /.netlify/functions/modo-webhook
// MODO nos notifica acá los cambios de estado del pago (CREATED, SCANNED,
// PROCESSING, ACCEPTED, REJECTED). Nunca confiamos en el cuerpo del webhook:
// ante un estado final, consultamos el estado REAL en la API de MODO y recién
// ahí aprobamos el pedido (descuenta stock + acredita puntos, en una
// transacción idempotente dentro de Postgres).

const { sbRpc } = require("../lib/supabase.js");
const { obtenerPago } = require("../lib/modo.js");

exports.handler = async (event) => {
  // MODO espera un 200 rápido; cualquier problema interno se loguea y listo.
  try {
    const body = JSON.parse(event.body || "{}");
    const id = body.payment_request_id || body.id || null;
    const estado = String(body.status || "").toUpperCase();

    if (id && (estado === "ACCEPTED" || estado === "APPROVED" || estado === "REJECTED")) {
      const info = await obtenerPago(id);
      const estadoReal = info ? String(info.status || "").toUpperCase() : null;

      if (estadoReal === "ACCEPTED") {
        const r = await sbRpc("aprobar_pedido", { p_modo_id: String(id) });
        console.log("modo-webhook aprobado:", id, JSON.stringify(r));
      } else if (estadoReal === "REJECTED") {
        await sbRpc("rechazar_pedido", { p_modo_id: String(id) });
        console.log("modo-webhook rechazado:", id);
      } else {
        console.log("modo-webhook sin estado final verificable:", id, estado, estadoReal);
      }
    }
  } catch (err) {
    console.error("modo-webhook:", err);
  }
  return { statusCode: 200, body: "ok" };
};
