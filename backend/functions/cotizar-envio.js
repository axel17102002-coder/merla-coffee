// POST /api/cotizar-envio
//   { items: [{presentacion, qty}], cp: string, ciudad: string, provincia: string }
//
// Lista en vivo las opciones de envío (a domicilio y a sucursal, de todos
// los transportistas) con Zipnova a partir del carrito. Es público (lo llama
// el carrito antes de pagar) y no expone nada sensible: el monto que se
// cobra de verdad se vuelve a calcular en el checkout (mercadopago-checkout /
// whatsapp-pedido), que vuelve a cotizar y busca la opción elegida — esto es
// puramente informativo para mostrar las opciones en el carrito.

const { obtenerCatalogo } = require("../lib/supabase.js");
const { listarOpcionesEnvio } = require("../lib/envio-costo.js");
const { calcularPedido } = require("../../public/motor.js");
const { permitir, claveDe } = require("../lib/limite.js");

// Protege las cuotas de las APIs de envío (Zipnova, Andreani, paq.ar) contra
// abuso automático sin molestar a un cliente real que prueba 2 o 3 direcciones.
const MAX_POR_VENTANA = 30;
const VENTANA_MS = 10 * 60 * 1000;

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  const tope = permitir(claveDe("cotizar-envio", event), { max: MAX_POR_VENTANA, ventanaMs: VENTANA_MS });
  if (!tope.ok) {
    return {
      statusCode: 429,
      headers: { ...headers, "Retry-After": String(tope.esperaSegundos) },
      body: JSON.stringify({ error: "Demasiadas consultas de envío seguidas. Esperá unos minutos y probá de nuevo." }),
    };
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

    const resultado = await listarOpcionesEnvio(body.items, productos, { cp, ciudad, provincia }, pedido.subtotal);
    if (!resultado.ok) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: resultado.error }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ opciones: resultado.opciones }) };
  } catch (err) {
    console.error("cotizar-envio:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No pudimos calcular el envío. Probá de nuevo." }) };
  }
};
