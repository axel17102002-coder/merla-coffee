// POST /api/mercadopago-webhook
// Mercado Pago notifica acá los eventos de pago (llegan como body JSON
// {type:"payment", data:{id}} y/o query params ?topic=payment&id=...).
// Nunca confiamos en el cuerpo de la notificación: consultamos el estado REAL
// del pago en la API de MP y recién si está aprobado aprobamos el pedido
// (descuenta stock + acredita puntos, idempotente dentro de Postgres).
//
// No verificamos la firma x-signature porque la aprobación ya exige que el
// pago exista y esté aprobado en la API de MP consultada con nuestro token.

const { sbRpc } = require("../lib/supabase.js");
const { obtenerPagoMp } = require("../lib/mercadopago.js");

exports.handler = async (event) => {
  // MP espera un 200 rápido; cualquier problema interno se loguea y listo.
  try {
    const q = event.queryStringParameters || {};
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {}

    const tipo = String(body.type || body.topic || q.type || q.topic || "");
    const id = (body.data && body.data.id) || q["data.id"] || body.id || q.id || null;

    if (tipo.includes("payment") && id) {
      const pago = await obtenerPagoMp(id);
      const ref = pago ? pago.external_reference : null;

      if (ref && pago.status === "approved") {
        const r = await sbRpc("aprobar_pedido", { p_modo_id: String(ref) });
        console.log("mp-webhook aprobado:", id, ref, JSON.stringify(r));
      } else {
        // rejected/pending/etc: no rechazamos el pedido — en Checkout Pro el
        // cliente puede reintentar con otra tarjeta sobre la misma preferencia.
        console.log("mp-webhook estado no final:", id, pago && pago.status);
      }
    }
  } catch (err) {
    console.error("mp-webhook:", err);
  }
  return { statusCode: 200, body: "ok" };
};
