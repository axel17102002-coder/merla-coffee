// ===== Función serverless: crear pago con MODO =====
// Recibe el carrito desde la web, recalcula el total con los precios reales
// (productos.js) y crea una Payment Request contra la API de MODO.
// Docs: https://merchants.modo.com.ar/docs (Botón de Pago SDK v2)
//
// Configuración por variables de entorno (en Netlify: Site settings → Environment variables):
//   MODO_ENV            "test" (default) o "produccion"
//   MODO_USERNAME       usuario de las credenciales MODO
//   MODO_PASSWORD       contraseña de las credenciales MODO
//   MODO_PROCESSOR_CODE código del gateway (ej. P1019 Decidir test; el productivo llega por mail con el alta)
//   MODO_CC_CODE        condición comercial (ej. "1CSI" = 1 cuota sin interés)
//   MODO_MERCHANT_NAME  nombre del comercio para el header User-Agent
//
// Sin variables configuradas usa las credenciales GENÉRICAS DE TEST publicadas
// en la documentación de MODO: sirven para probar, pero el dinero NO llega a
// ninguna cuenta. Para cobrar de verdad hay que pedir credenciales productivas
// (ver README).

const { PRODUCTOS, DESCUENTO_CANTIDAD, DESCUENTO_PORCENTAJE } = require("../../productos.js");

const ENV = process.env.MODO_ENV || "test";

const BASE_URL =
  ENV === "produccion"
    ? "https://merchants.playdigital.com.ar" // confirmar con el mail de alta de MODO
    : "https://merchants.preprod.playdigital.com.ar";

// Credenciales genéricas de test publicadas en https://merchants.modo.com.ar/docs
const USERNAME = process.env.MODO_USERNAME || "PLAYDIGITAL SA-318979-preprod";
const PASSWORD = process.env.MODO_PASSWORD || "318979-P75V/QLKfVKX";
const PROCESSOR_CODE = process.env.MODO_PROCESSOR_CODE || "P1019"; // Decidir 2.0 (test)
const CC_CODE = process.env.MODO_CC_CODE || "1CSI"; // 1 cuota sin interés
const MERCHANT_NAME = process.env.MODO_MERCHANT_NAME || "Merla Coffee";

// El token dura 7 días y el endpoint tiene rate limit (10 req/10 min):
// lo cacheamos mientras la función siga "caliente".
let tokenCache = { token: null, vence: 0 };

async function obtenerToken() {
  if (tokenCache.token && Date.now() < tokenCache.vence - 60_000) {
    return tokenCache.token;
  }
  const res = await fetch(`${BASE_URL}/v2/stores/companies/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": MERCHANT_NAME,
    },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`MODO token: HTTP ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    vence: Date.now() + (data.expires_in || 604800) * 1000,
  };
  return tokenCache.token;
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  let items;
  try {
    items = JSON.parse(event.body || "{}").items;
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Cuerpo inválido" }) };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Carrito vacío" }) };
  }

  // Recalcular el total en el servidor: nunca confiar en precios del navegador.
  let subtotal = 0;
  let unidades = 0;
  const itemsModo = [];
  for (const { id, qty } of items) {
    const p = PRODUCTOS.find((p) => p.id === id);
    const cantidad = Number.parseInt(qty, 10);
    if (!p || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Ítem inválido: ${id}` }) };
    }
    subtotal += p.precio * cantidad;
    unidades += cantidad;
    itemsModo.push({
      description: `${p.nombre} - Drip Bag`,
      quantity: cantidad,
      unit_price: p.precio,
      sku: p.id,
      category_name: "Drip Bags",
    });
  }

  const descuento =
    unidades >= DESCUENTO_CANTIDAD ? Math.round((subtotal * DESCUENTO_PORCENTAJE) / 100) : 0;
  const total = subtotal - descuento;

  try {
    const token = await obtenerToken();
    const res = await fetch(`${BASE_URL}/v2/payment-requests/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": MERCHANT_NAME,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        description: `Pedido Merla Coffee (${unidades} drip bags)`.slice(0, 100),
        amount: total,
        currency: "ARS",
        cc_code: CC_CODE,
        processor_code: PROCESSOR_CODE,
        external_intention_id: `merla-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        message: descuento ? `Incluye ${DESCUENTO_PORCENTAJE}% off por ${unidades} unidades` : "",
        items: itemsModo,
      }),
    });

    if (!res.ok) {
      const detalle = await res.text();
      console.error("MODO payment-request falló:", res.status, detalle);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "MODO rechazó la solicitud de pago" }),
      };
    }

    const data = await res.json();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        id: data.id,
        qr: data.qr,
        deeplink: data.deeplink,
        total,
        ambiente: ENV,
      }),
    };
  } catch (err) {
    console.error("Error creando pago MODO:", err);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "No se pudo generar el pago. Probá de nuevo en unos minutos." }),
    };
  }
};
