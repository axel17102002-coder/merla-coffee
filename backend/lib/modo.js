// Cliente de la API de MODO para las funciones del backend.
// Docs: https://merchants.modo.com.ar/docs (Botón de Pago SDK v2)
//
// Sin variables configuradas usa las credenciales GENÉRICAS DE TEST publicadas
// en la documentación de MODO (no cobran de verdad). Ver README para pasar a
// producción.
//
// La configuración se lee en cada llamada (no al cargar el módulo): en
// Cloudflare Workers las variables de entorno recién existen con el request.

function config() {
  const ambiente = process.env.MODO_ENV || "test";
  return {
    ambiente,
    baseUrl:
      ambiente === "produccion"
        ? "https://merchants.playdigital.com.ar" // confirmar con el mail de alta de MODO
        : "https://merchants.preprod.playdigital.com.ar",
    // Credenciales genéricas de test publicadas en https://merchants.modo.com.ar/docs
    username: process.env.MODO_USERNAME || "PLAYDIGITAL SA-318979-preprod",
    password: process.env.MODO_PASSWORD || "318979-P75V/QLKfVKX",
    processorCode: process.env.MODO_PROCESSOR_CODE || "P1019", // Decidir 2.0 (test)
    ccCode: process.env.MODO_CC_CODE || "1CSI", // 1 cuota sin interés
    merchantName: process.env.MODO_MERCHANT_NAME || "Merla Coffee",
  };
}

const ambiente = () => config().ambiente;

// El token dura 7 días y el endpoint tiene rate limit (10 req/10 min):
// lo cacheamos mientras la función siga "caliente".
let tokenCache = { token: null, vence: 0 };

async function obtenerToken() {
  if (tokenCache.token && Date.now() < tokenCache.vence - 60_000) {
    return tokenCache.token;
  }
  const cfg = config();
  const res = await fetch(`${cfg.baseUrl}/v2/stores/companies/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": cfg.merchantName },
    body: JSON.stringify({ username: cfg.username, password: cfg.password }),
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
  const cfg = config();
  const token = await obtenerToken();
  const res = await fetch(`${cfg.baseUrl}/v2/payment-requests/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": cfg.merchantName,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      currency: "ARS",
      cc_code: cfg.ccCode,
      processor_code: cfg.processorCode,
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
  const cfg = config();
  const token = await obtenerToken();
  const res = await fetch(`${cfg.baseUrl}/v2/payment-requests/${id}/data`, {
    headers: { "User-Agent": cfg.merchantName, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

module.exports = { ambiente, crearPago, obtenerPago };
