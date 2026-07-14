// Cliente mínimo de la API de Mercado Pago (Checkout Pro).
// Solo necesita MP_ACCESS_TOKEN: con token TEST-... opera en sandbox y con
// APP_USR-... cobra de verdad. Sin SDK: son dos endpoints REST.

const API = "https://api.mercadopago.com";

function token() {
  const t = process.env.MP_ACCESS_TOKEN;
  if (!t) throw new Error("Falta MP_ACCESS_TOKEN (Access Token de Mercado Pago; ver README)");
  return t;
}

// "test" si el token pertenece a una cuenta de prueba de MP, "produccion" si
// es una cuenta real. No alcanza con mirar el prefijo (los tokens de las
// cuentas de prueba también empiezan con APP_USR-): consultamos /users/me una
// sola vez y cacheamos el resultado.
let _ambiente = null;
async function ambienteMp() {
  if (!process.env.MP_ACCESS_TOKEN) return "test";
  if (_ambiente) return _ambiente;
  try {
    const yo = await mp("/users/me");
    _ambiente = (yo.tags || []).includes("test_user") ? "test" : "produccion";
  } catch {
    _ambiente = "test"; // ante la duda, avisamos que es prueba
  }
  return _ambiente;
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
