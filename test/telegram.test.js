// Tests de los avisos por Telegram (ventas, pedidos de WhatsApp, panel).
//
//   node --test
//
// Convención: cada test dice QUÉ regla protege, no cómo está escrita.

const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://base.test";
process.env.SUPABASE_SECRET_KEY = "clave-de-prueba";
process.env.ADMIN_TOKEN = "token-admin-de-prueba";

const { textoPedido, enviarTelegram } = require("../backend/lib/telegram.js");
const { avisarAdminPorId } = require("../backend/lib/avisos.js");
const adminTelegram = require("../backend/functions/admin-telegram.js").handler;

function simularRed(reglas) {
  const llamadas = [];
  globalThis.fetch = async (url, opciones = {}) => {
    const llamada = { metodo: opciones.method || "GET", url: String(url), body: opciones.body ? JSON.parse(opciones.body) : undefined };
    llamadas.push(llamada);
    for (const [patron, respuesta] of reglas) {
      if (!patron.test(`${llamada.metodo} ${llamada.url}`)) continue;
      const { status = 200, json = null } = (typeof respuesta === "function" ? respuesta(llamada) : respuesta) || {};
      return { ok: status < 400, status, json: async () => json, text: async () => (json === null ? "" : JSON.stringify(json)) };
    }
    throw new Error(`llamada no prevista: ${llamada.metodo} ${llamada.url}`);
  };
  return llamadas;
}
const mensajes = (llamadas) => llamadas.filter((l) => /\/sendMessage$/.test(l.url)).map((l) => l.body);
const conBot = (fn) => async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:abc";
  try { await fn(); } finally { delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID; }
};
const admin = (metodo, cuerpo) => adminTelegram({
  httpMethod: metodo, headers: { "x-admin-token": "token-admin-de-prueba" }, queryStringParameters: {},
  body: cuerpo ? JSON.stringify(cuerpo) : "",
});

const PEDIDO = {
  id: "p1", numero: 14, origen: "mercadopago", estado: "aprobado", total: 12500, cupon: "BIENVENIDA10",
  items: [{ qty: 2, nombre: "Brasil Sertão", precio_unitario: 3000 }, { qty: 1, nombre: "Pack <Andino>", precio_unitario: 7000 }],
  envio: { metodo: "envio", nombre: "Sofía", transportista: "Andreani", servicio: "Estándar", ciudad: "Rosario", provincia: "Santa Fe" },
};

// ===== El mensaje =====

test("el aviso de una venta dice número, total, canal, cliente, productos y entrega", () => {
  const t = textoPedido(PEDIDO);
  assert.match(t, /💰 <b>Venta cobrada #0014<\/b> · \$ 12\.500/);
  assert.match(t, /Mercado Pago · Sofía/);
  assert.match(t, /• 2× Brasil Sertão/);
  assert.match(t, /Cupón BIENVENIDA10/);
  assert.match(t, /📦 Envío a domicilio \(Andreani · Estándar\) · Rosario, Santa Fe/);
  assert.match(t, /merlacoffee\.com\.ar\/admin/);
});

test("un pedido de WhatsApp sin cobrar se distingue de una venta, y el retiro se indica", () => {
  const t = textoPedido({ ...PEDIDO, origen: "whatsapp", estado: "pendiente", cupon: null, envio: { metodo: "retiro", nombre: "Juan" } });
  assert.match(t, /🧾 <b>Pedido nuevo #0014<\/b>/);
  assert.match(t, /WhatsApp · sin cobrar todavía · Juan/);
  assert.match(t, /🏪 Retira en La Plata/);
});

test("los datos del cliente no rompen el formato del mensaje (se escapan)", () => {
  assert.match(textoPedido(PEDIDO), /Pack &lt;Andino&gt;/);
});

// ===== Envío =====

test("sin token de bot no se llama a Telegram ni a la base", async () => {
  const llamadas = simularRed([]);
  assert.equal(await enviarTelegram("hola"), false);
  assert.equal(llamadas.length, 0);
});

test("con bot y chat guardado, la venta llega por Telegram además del mail", conBot(async () => {
  const llamadas = simularRed([
    [/GET .*pedidos\?id=eq\.p1/, { json: [PEDIDO] }],
    [/GET .*configuracion\?clave=eq\.telegram_chat_id/, { json: [{ valor: 555 }] }],
    [/sendMessage$/, { json: { ok: true, result: {} } }],
  ]);
  assert.equal(await avisarAdminPorId("p1"), true);
  const [m] = mensajes(llamadas);
  assert.equal(m.chat_id, "555");
  assert.equal(m.parse_mode, "HTML");
  assert.match(m.text, /Venta cobrada #0014/);
}));

test("si Telegram falla, el aviso no se cae", conBot(async () => {
  simularRed([
    [/GET .*pedidos\?id=eq\.p1/, { json: [PEDIDO] }],
    [/GET .*configuracion\?clave=eq\.telegram_chat_id/, { json: [{ valor: 555 }] }],
    [/sendMessage$/, { status: 403, json: { ok: false, description: "Forbidden: bot was blocked by the user" } }],
  ]);
  assert.equal(await avisarAdminPorId("p1"), true);
}));

// ===== Panel =====

test("el panel de Telegram exige ser admin", async () => {
  const llamadas = simularRed([]);
  const r = await adminTelegram({ httpMethod: "GET", headers: { "x-admin-token": "otro-token-de-prueba!" }, queryStringParameters: {} });
  assert.equal(r.statusCode, 401);
  assert.equal(llamadas.length, 0);
});

test("Conectar guarda el último chat que le escribió al bot y manda una prueba", conBot(async () => {
  let guardado = null;
  const llamadas = simularRed([
    [/getUpdates$/, { json: { ok: true, result: [
      { update_id: 1, message: { chat: { id: 111, type: "private", first_name: "Viejo" } } },
      { update_id: 2, message: { chat: { id: -4002, type: "group", title: "Ventas Merla" } } },
    ] } }],
    [/POST .*configuracion$/, (l) => { guardado = l.body; return { status: 201 }; }],
    [/GET .*configuracion\?clave=eq\.telegram_chat_id/, () => ({ json: guardado ? [{ valor: guardado.valor }] : [] })],
    [/sendMessage$/, { json: { ok: true, result: {} } }],
  ]);
  const r = await admin("POST", { accion: "conectar" });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body), { ok: true, nombre: "Ventas Merla", grupo: true, enviado: true });
  assert.equal(guardado.clave, "telegram_chat_id");
  assert.equal(guardado.valor, -4002);
  assert.equal(mensajes(llamadas)[0].chat_id, "-4002");
}));

test("Conectar sin que nadie le haya escrito al bot explica qué hacer", conBot(async () => {
  simularRed([[/getUpdates$/, { json: { ok: true, result: [] } }]]);
  const r = await admin("POST", { accion: "conectar" });
  assert.equal(r.statusCode, 404);
  assert.match(JSON.parse(r.body).error, /mandale «hola»/);
}));

test("sin el secreto del bot, el panel lo dice en vez de fallar", async () => {
  simularRed([[/GET .*configuracion/, { json: [] }]]);
  assert.deepEqual(JSON.parse((await admin("GET")).body), { token: false, chat: false });
  const r = await admin("POST", { accion: "conectar" });
  assert.equal(r.statusCode, 409);
  assert.match(JSON.parse(r.body).error, /TELEGRAM_BOT_TOKEN/);
});
