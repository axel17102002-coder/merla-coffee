// Acreditación de un pago aprobado de Mercado Pago.
//
// Hay tres caminos por los que nos enteramos de un pago: el webhook de MP, la
// vuelta del cliente a la web (confirmar-pedido) y la conciliación del cron
// (mantenimiento.js). Los tres pasan por acá para hacer exactamente lo mismo, y
// la operación es idempotente: el mismo pago puede llegar varias veces.

const { sb, sbRpc } = require("./supabase.js");
const { registrarPagoMp } = require("./mercadopago.js");
const { avisarVentaPorRef, avisarPagoRaro } = require("./avisos.js");

// Pedido al que apunta la referencia del pago. `undefined` si no se pudo leer
// (por ejemplo, falta la migración de mp_pago_id): ahí seguimos sin el chequeo.
async function pedidoDeRef(ref) {
  try {
    const filas = await sb(
      `pedidos?modo_id=eq.${encodeURIComponent(ref)}&select=id,numero,estado,mp_pago_id&limit=1`
    );
    return filas[0] || null;
  } catch (err) {
    console.warn("cobro: no pude leer el pedido antes de acreditar:", err.message);
    return undefined;
  }
}

// `pago` es el objeto de la API de MP, ya verificado como `approved`.
// Devuelve lo que responde la RPC: { ok, ya_procesado?, puntos?, error? }.
async function acreditarPagoMp(pago) {
  const ref = String(pago.external_reference);
  const pedido = await pedidoDeRef(ref);

  // Segundo pago sobre un pedido que ya estaba cobrado con otro pago: el
  // cliente pagó dos veces el mismo link. No se toca el pedido; se avisa para
  // devolver la plata.
  if (pedido && pedido.estado !== "pendiente" && pedido.mp_pago_id && pedido.mp_pago_id !== String(pago.id)) {
    await avisarPagoRaro("duplicado", pago, pedido);
    return { ok: true, ya_procesado: true, estado: pedido.estado, duplicado: true };
  }

  await registrarPagoMp(ref, pago);
  const r = await sbRpc("aprobar_pedido", { p_modo_id: ref });

  // Solo avisamos la primera vez (la RPC dice si ya estaba procesado)
  if (r && r.ok && !r.ya_procesado) await avisarVentaPorRef(ref);

  // Cobramos y el pedido no existe (por ejemplo, se pagó un link viejo cuyo
  // pedido ya se había borrado): que no pase desapercibido.
  if (r && !r.ok) await avisarPagoRaro("sin-pedido", pago, null);

  return r;
}

module.exports = { acreditarPagoMp };
