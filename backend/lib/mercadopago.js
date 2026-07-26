// Cliente mínimo de la API de Mercado Pago (Checkout Pro).
// Solo necesita MP_ACCESS_TOKEN: con token TEST-... opera en sandbox y con
// APP_USR-... cobra de verdad. Sin SDK: son dos endpoints REST.

const { sb } = require("./supabase.js");

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
    throw new Error(`Mercado Pago ${ruta}: HTTP ${res.status} ${JSON.stringify(data).slice(0, 350)}`);
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

// Con qué medio pagó el cliente, normalizado a las claves de METODOS_MP
// (motor.js) para poder aplicarle su comisión. La API de MP lo devuelve en
// `payment_type_id` (y en `payment_method_id` para Mercado Crédito, que viaja
// como consumer_credits). Lo que no reconocemos cae en "otros" → comisión
// promedio.
const TIPOS_MP = {
  account_money: "dinero",
  digital_wallet: "dinero",
  debit_card: "debito",
  credit_card: "credito",
  prepaid_card: "prepaga",
  voucher_card: "prepaga",
};

function metodoDePagoMp(pago) {
  if (!pago) return null;
  const metodo = String(pago.payment_method_id || "");
  const tipo = String(pago.payment_type_id || "");
  if (metodo === "consumer_credits" || tipo === "digital_currency") return "cuotas_sin_tarjeta";
  return TIPOS_MP[tipo] || "otros";
}

// Deja registrado en el pedido con qué método pagó el cliente (para restarle en
// Insights la comisión correcta) y el id del pago en MP (para poder cruzar el
// pedido con el panel de Mercado Pago: auditar un cobro, seguir un contracargo
// o rehacer el método si quedó mal). Es "best effort": si falla, el pedido se
// aprueba igual.
async function registrarPagoMp(ref, pago) {
  if (!ref || !pago) return;
  const cambios = {};
  const metodo = metodoDePagoMp(pago);
  if (metodo) cambios.mp_metodo = metodo;
  if (pago.id != null) cambios.mp_pago_id = String(pago.id);
  if (!Object.keys(cambios).length) return;

  try {
    await sb(`pedidos?modo_id=eq.${encodeURIComponent(ref)}`, { method: "PATCH", body: cambios });
  } catch (err) {
    // Si falta la migración de mp_pago_id, al menos guardamos el método
    console.warn("mercadopago: no pude guardar los datos del pago:", err.message);
    if (cambios.mp_pago_id && cambios.mp_metodo) {
      try {
        await sb(`pedidos?modo_id=eq.${encodeURIComponent(ref)}`, {
          method: "PATCH",
          body: { mp_metodo: cambios.mp_metodo },
        });
      } catch (err2) {
        console.warn("mercadopago: tampoco pude guardar el método:", err2.message);
      }
    }
  }
}

module.exports = { ambienteMp, crearPreferencia, obtenerPagoMp, metodoDePagoMp, registrarPagoMp };
