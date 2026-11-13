// POST /api/mercadopago-webhook
// Mercado Pago notifica acá los eventos de pago (llegan como body JSON
// {type:"payment", data:{id}} y/o query params ?topic=payment&id=...).
// Nunca confiamos en el cuerpo de la notificación: consultamos el estado REAL
// del pago en la API de MP y recién si está aprobado aprobamos el pedido
// (descuenta stock + acredita puntos, idempotente dentro de Postgres).
//
// No verificamos la firma x-signature porque la aprobación ya exige que el
// pago exista y esté aprobado en la API de MP consultada con nuestro token.

const { obtenerPagoMp } = require("../lib/mercadopago.js");
const { acreditarPagoMp } = require("../lib/cobro.js");

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {}

    const tipo = String(body.type || body.topic || q.type || q.topic || "");
    const id = (body.data && body.data.id) || q["data.id"] || body.id || q.id || null;

    if (tipo.includes("payment") && id) {
      let pago;
      try {
        pago = await obtenerPagoMp(id);
      } catch (err) {
        // Un id que MP no reconoce (las pruebas de su panel, basura mandada por
        // un tercero) no se arregla reintentando: se responde 200 y listo.
        if (err.status === 404 || err.status === 400) {
          console.log("mp-webhook: pago inexistente, se ignora:", id);
          return { statusCode: 200, body: "ok" };
        }
        throw err;
      }
      const ref = pago ? pago.external_reference : null;

      if (ref && pago.status === "approved") {
        const r = await acreditarPagoMp(pago);
        console.log("mp-webhook aprobado:", id, ref, JSON.stringify(r));
      } else {
        // rejected/pending/etc: no rechazamos el pedido — en Checkout Pro el
        // cliente puede reintentar con otra tarjeta sobre la misma preferencia.
        console.log("mp-webhook estado no final:", id, pago && pago.status);
      }
    }
  } catch (err) {
    // Algo nuestro falló (Supabase caído, MP sin responder) con un pago que
    // puede ser real. Sin un 200, Mercado Pago reintenta más tarde: mejor eso
    // que dar el aviso por recibido y perder la venta. Y si igual se pierde,
    // la conciliación del cron (mantenimiento.js) lo levanta.
    console.error("mp-webhook:", err);
    return { statusCode: 500, body: "error" };
  }
  return { statusCode: 200, body: "ok" };
};
