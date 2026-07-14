// Cliente mínimo de la API de Mercado Pago (Checkout Pro).
// Solo necesita MP_ACCESS_TOKEN: con token TEST-... opera en sandbox y con
// APP_USR-... cobra de verdad. Sin SDK: son dos endpoints REST.

const API = "https://api.mercadopago.com";

function token() {
  const t = process.env.MP_ACCESS_TOKEN;
  if (!t) throw new Error("Falta MP_ACCESS_TOKEN (Access Token de Mercado Pago; ver README)");
  return t;
}

// "produccion" si el token es productivo (APP_USR-...), "test" en cualquier otro caso
function ambienteMp() {
  return (process.env.MP_ACCESS_TOKEN || "").startsWith("APP_USR-") ? "produccion" : "test";
}

async function mp(ruta, opciones = {}) {
  const res = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(opciones.headers || {}),
    },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Mercado Pago ${ruta}: HTTP ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

// Crea la preferencia de Checkout Pro; devuelve { id, init_point, ... }
function crearPreferencia(preferencia) {
  return mp("/checkout/preferences", { method: "POST", body: preferencia });
}

// Estado real de un pago (nunca confiamos en lo que dice el navegador/webhook)
function obtenerPagoMp(id) {
  return mp(`/v1/payments/${id}`);
}

module.exports = { ambienteMp, crearPreferencia, obtenerPagoMp };
