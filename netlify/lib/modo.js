// Cliente de la API de MODO para las funciones de Netlify.
// Docs: https://merchants.modo.com.ar/docs (Botón de Pago SDK v2)
//
// Sin variables configuradas usa las credenciales GENÉRICAS DE TEST publicadas
// en la documentación de MODO (no cobran de verdad). Ver README para pasar a
// producción.

const ENV = process.env.MODO_ENV || "test";

const BASE_URL =
  ENV === "produccion"
    ? "https://merchants.playdigital.com.ar" // confirmar con el mail de alta de MODO
    : "https://merchants.preprod.playdigital.com.ar";

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
    headers: { "Content-Type": "application/json", "User-Agent": MERCHANT_NAME },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`MODO token: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    vence: Date.now() + (data.expires_in || 604800) * 1000,
  };
  return tokenCache.token;
}

// Crea una payment request. Devuelve { id, qr, deeplink, ... }
async function crearPago(payload) {
  const token = await obtenerToken();
  const res = await fetch(`${BASE_URL}/v2/payment-requests/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": MERCHANT_NAME,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      currency: "ARS",
      cc_code: CC_CODE,
      processor_code: PROCESSOR_CODE,
      ...payload,
    }),
  });
  if (!res.ok) throw new Error(`MODO payment-request: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// Consulta el estado real de un pago (solo responde para pagos ya
// aprobados/rechazados/devueltos). Devuelve null si todavía no hay resultado.
async function obtenerPago(paymentRequestId) {
  const id = String(paymentRequestId || "").trim();
  if (!/^[a-zA-Z0-9-]{10,64}$/.test(id)) return null;
  const token = await obtenerToken();
  const res = await fetch(`${BASE_URL}/v2/payment-requests/${id}/data`, {
    headers: { "User-Agent": MERCHANT_NAME, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

module.exports = { ENV, crearPago, obtenerPago };
