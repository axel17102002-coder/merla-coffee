// POST /api/cotizar-envio
//   { items: [{presentacion, qty}], cp: string, ciudad: string, provincia: string }
//
// Cotiza en vivo el envío a domicilio con Zipnova a partir del carrito.
// Es público (lo llama el carrito antes de pagar) y no expone nada sensible,
// solo un precio: el monto que se cobra de verdad se vuelve a calcular en el
// checkout (mercadopago-checkout / whatsapp-pedido), así que esto es
// puramente informativo para mostrar el total en el carrito.

const { obtenerCatalogo } = require("../lib/supabase.js");
const { resolverEnvioCosto } = require("../lib/envio-costo.js");
const { calcularPedido } = require("../../public/motor.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const cp = String(body.cp || "").trim();
    const ciudad = String(body.ciudad || "").trim();
    const provincia = String(body.provincia || "").trim();
    if (!cp) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Ingresá tu código postal" }) };
    }
    if (!ciudad || !provincia) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Ingresá tu ciudad y provincia" }) };
    }

    const productos = await obtenerCatalogo();
    const pedido = calcularPedido(body.items, {}, { productos });
    if (!pedido.ok) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: pedido.error }) };
    }

    const resultado = await resolverEnvioCosto(
      body.items, productos, { metodo: "envio", cp, ciudad, provincia }, pedido.subtotal
    );
    if (!resultado.ok) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: resultado.error }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ costo: resultado.costo }) };
  } catch (err) {
    console.error("cotizar-envio:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No pudimos calcular el envío. Probá de nuevo." }) };
  }
};
