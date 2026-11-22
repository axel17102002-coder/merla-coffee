// Tests de presupuestos (cálculo, panel, link del cliente) y de los textos de
// las notificaciones del panel.
//
//   node --test
//
// Convención: cada test dice QUÉ regla protege, no cómo está escrita.

const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://base.test";
process.env.SUPABASE_SECRET_KEY = "clave-de-prueba";
process.env.ADMIN_TOKEN = "token-admin-de-prueba";

// En JavaScriptCore no hay crypto ni btoa: lo mínimo para generar tokens
if (!globalThis.crypto) globalThis.crypto = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } };
if (!globalThis.btoa) {
  const T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  globalThis.btoa = (s) => { let o = ""; for (let i = 0; i < s.length; i += 3) { const n = (s.charCodeAt(i) << 16) | ((s.charCodeAt(i + 1) || 0) << 8) | (s.charCodeAt(i + 2) || 0); o += T[(n >> 18) & 63] + T[(n >> 12) & 63] + (i + 1 < s.length ? T[(n >> 6) & 63] : "=") + (i + 2 < s.length ? T[n & 63] : "="); } return o; };
}

const { calcularPresupuesto, estadoPublico, paginaPresupuesto } = require("../backend/lib/presupuestos.js");
const adminPresupuestos = require("../backend/functions/admin-presupuestos.js").handler;
const presupuesto = require("../backend/functions/presupuesto.js").handler;
const { avisoPedido, enviarPush } = require("../backend/lib/push.js");

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
const admin = (metodo, cuerpo, query = {}) => adminPresupuestos({
  httpMethod: metodo, headers: { "x-admin-token": "token-admin-de-prueba" }, queryStringParameters: query,
  body: cuerpo ? JSON.stringify(cuerpo) : "",
});
const publico = (cuerpo, ip = "9.9.9.9") => presupuesto({ httpMethod: "POST", headers: { "cf-connecting-ip": ip }, queryStringParameters: {}, body: JSON.stringify(cuerpo) });

const LINEAS = [
  { descripcion: "Armado de drip bags con su café", qty: 200, precio_unitario: 957.5 },
  { descripcion: "Andino · Pack x5", qty: 3, precio_unitario: 9900, presentacion: "andino-pack" },
];
const TOKEN = "abcdefghijklmnopqrstuvwx";
const ABIERTO = { id: "p1", numero: 3, token: TOKEN, cliente_nombre: "Hostel 555", items: LINEAS, subtotal: 221200, descuento: 0, total: 221200, descuento_porcentaje: 0, validez_dias: 15, estado: "enviado", creado: new Date().toISOString() };

// ===== Cálculo =====

test("el total sale de las líneas (con centavos) y el descuento se aplica sobre el subtotal", () => {
  const r = calcularPresupuesto(LINEAS, 10);
  assert.equal(r.ok, true);
  assert.equal(r.subtotal, 191500 + 29700);
  assert.equal(r.descuento, 22120);
  assert.equal(r.total, 221200 - 22120);
  assert.equal(r.items[1].presentacion, "andino-pack");
});

test("un presupuesto sin líneas, con cantidades o descuentos imposibles, no se guarda", () => {
  assert.equal(calcularPresupuesto([]).ok, false);
  assert.equal(calcularPresupuesto([{ descripcion: "x", qty: 0, precio_unitario: 1 }]).ok, false);
  assert.equal(calcularPresupuesto([{ descripcion: "", qty: 1, precio_unitario: 1 }]).ok, false);
  assert.equal(calcularPresupuesto([{ descripcion: "x", qty: 1, precio_unitario: -5 }]).ok, false);
  assert.equal(calcularPresupuesto(LINEAS, 120).ok, false);
});

test("vence pasados los días de validez; aceptado o rechazado ya no se puede aceptar", () => {
  const viejo = { ...ABIERTO, creado: new Date(Date.now() - 20 * 86400000).toISOString() };
  assert.equal(estadoPublico(ABIERTO), "abierto");
  assert.equal(estadoPublico(viejo), "vencido");
  assert.equal(estadoPublico({ ...ABIERTO, estado: "aceptado" }), "aceptado");
  assert.equal(estadoPublico({ ...ABIERTO, estado: "rechazado" }), "rechazado");
});

test("la página del cliente escapa lo que se cargó y solo ofrece aceptar si está abierto", () => {
  const html = paginaPresupuesto({ ...ABIERTO, cliente_nombre: "<script>x</script>" });
  assert.ok(!html.includes("<script>x</script>"));
  assert.ok(html.includes("&lt;script&gt;x&lt;/script&gt;"));
  assert.ok(html.includes("Aceptar presupuesto"));
  assert.ok(html.includes("Presupuesto #0003"));
  assert.ok(!paginaPresupuesto({ ...ABIERTO, estado: "aceptado" }).includes('id="aceptar"'));
});

// ===== Panel =====

test("el panel de presupuestos exige ser admin", async () => {
  const llamadas = simularRed([]);
  const r = await adminPresupuestos({ httpMethod: "GET", headers: { "x-admin-token": "otro-token-de-prueba!" }, queryStringParameters: {} });
  assert.equal(r.statusCode, 401);
  assert.equal(llamadas.length, 0);
});

test("al guardar, los totales los calcula el servidor (no se confía en los del navegador)", async () => {
  let guardado = null;
  simularRed([[/POST .*presupuestos$/, (l) => { guardado = l.body; return { status: 201, json: [{ ...l.body, id: "n1", numero: 4 }] }; }]]);
  const r = await admin("POST", { cliente_nombre: "Café Plaza", items: LINEAS, descuento_porcentaje: 5, total: 1 });
  assert.equal(r.statusCode, 201);
  assert.equal(guardado.total, 221200 - 11060);
  assert.equal(guardado.cliente_nombre, "Café Plaza");
  assert.match(guardado.token, /^[A-Za-z0-9_-]{20,}$/);
});

test("sin la migración, el panel dice qué falta", async () => {
  simularRed([[/GET .*presupuestos\?/, { status: 404, json: { code: "PGRST205", message: "Could not find the table 'public.presupuestos'" } }]]);
  const r = await admin("GET");
  assert.equal(r.statusCode, 409);
  assert.equal(JSON.parse(r.body).falta, "migracion-push-presupuestos.sql");
});

// ===== Link del cliente =====

test("el cliente acepta un presupuesto abierto y te llega el aviso", async () => {
  let cambio = null;
  const llamadas = simularRed([
    [/GET .*presupuestos\?token=eq\./, { json: [ABIERTO] }],
    [/PATCH .*presupuestos\?id=eq\.p1/, (l) => { cambio = l.body; return { status: 204 }; }],
    [/GET .*push_suscripciones/, { json: [] }],
  ]);
  const r = await publico({ token: TOKEN, accion: "aceptar" });
  assert.equal(r.statusCode, 200);
  assert.equal(cambio.estado, "aceptado");
  assert.ok(cambio.aceptado_en);
  assert.ok(llamadas.some((l) => l.url.includes("push_suscripciones")));
});

test("un presupuesto vencido no se puede aceptar desde el link", async () => {
  simularRed([[/GET .*presupuestos\?token=eq\./, { json: [{ ...ABIERTO, creado: new Date(Date.now() - 30 * 86400000).toISOString() }] }]]);
  const r = await publico({ token: TOKEN, accion: "aceptar" }, "9.9.9.8");
  assert.equal(r.statusCode, 409);
  assert.match(JSON.parse(r.body).error, /venció/);
});

test("un link con token inválido ni consulta la base", async () => {
  const llamadas = simularRed([]);
  const r = await publico({ token: "corto", accion: "aceptar" }, "9.9.9.7");
  assert.equal(r.statusCode, 400);
  assert.equal(llamadas.length, 0);
});

// ===== Notificaciones del panel =====

test("la notificación de una venta dice qué, cuánto, quién y cómo se entrega", () => {
  const a = avisoPedido({ id: "x", numero: 32, origen: "mercadopago", estado: "aprobado", total: 8400, items: [{ qty: 3, nombre: "Andino" }, { qty: 1, nombre: "Pack" }], envio: { metodo: "envio", nombre: "Sofía", transportista: "Andreani" } });
  assert.match(a.titulo, /Venta cobrada #0032 · \$ 8\.400/);
  assert.equal(a.cuerpo, "Sofía · 3× Andino +1 más · Andreani");
  assert.equal(a.url, "/admin#pedidos");
  assert.match(avisoPedido({ id: "y", numero: 33, origen: "whatsapp", estado: "pendiente", total: 1, items: [] }).titulo, /Pedido nuevo \(WhatsApp\)/);
});

test("sin dispositivos o sin la tabla, mandar una notificación no rompe nada", async () => {
  simularRed([[/GET .*push_suscripciones/, { json: [] }]]);
  assert.equal(await enviarPush({ titulo: "x" }), 0);
  simularRed([[/GET .*push_suscripciones/, { status: 404, json: { code: "PGRST205" } }]]);
  assert.equal(await enviarPush({ titulo: "x" }), 0);
});
