// Tests de las métricas de Insights: visitas por fuente y carritos vencidos.
//
//   node --test
//
// Convención: cada test dice QUÉ regla protege, no cómo está escrita.

const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://base.test";
process.env.SUPABASE_SECRET_KEY = "clave-de-prueba";
process.env.ADMIN_TOKEN = "token-admin-de-prueba";

const { fuenteDeVisita } = require("../backend/lib/metricas.js");
const visita = require("../backend/functions/visita.js").handler;
const adminMetricas = require("../backend/functions/admin-metricas.js").handler;
const { limpiarPedidosPendientes } = require("../backend/lib/mantenimiento.js");

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
const sumas = (llamadas) => llamadas.filter((l) => l.url.includes("rpc/sumar_metrica")).map((l) => [l.body.p_clave, l.body.p_valor]);

// ===== De dónde viene cada visita =====

test("la fuente sale del referrer: Instagram, Facebook, Google, WhatsApp", () => {
  assert.equal(fuenteDeVisita({ ref: "https://l.instagram.com/?u=x" }), "instagram");
  assert.equal(fuenteDeVisita({ ref: "https://m.facebook.com/" }), "facebook");
  assert.equal(fuenteDeVisita({ ref: "https://www.google.com.ar/" }), "google");
  assert.equal(fuenteDeVisita({ ref: "https://wa.me/" }), "whatsapp");
  assert.equal(fuenteDeVisita({ ref: "https://unblog.com/nota" }), "otros");
});

test("sin referrer, o desde la propia tienda, es directo", () => {
  assert.equal(fuenteDeVisita({ ref: "" }), "directo");
  assert.equal(fuenteDeVisita({ ref: "https://merlacoffee.com.ar/politicas" }), "directo");
});

test("utm_source manda sobre el referrer (los links de las campañas)", () => {
  assert.equal(fuenteDeVisita({ ref: "https://www.google.com/", utm: "instagram" }), "instagram");
  assert.equal(fuenteDeVisita({ utm: "fb" }), "facebook");
  assert.equal(fuenteDeVisita({ utm: "newsletter" }), "mail");
});

test("los links de nuestros mails (retomar carrito, dejar reseña) cuentan como mail", () => {
  assert.equal(fuenteDeVisita({ params: "?retomar=andino-unidad%3A2" }), "mail");
  assert.equal(fuenteDeVisita({ params: "?resena=abc&estrellas=5" }), "mail");
});

// ===== Contar la visita =====

const NAVEGADOR = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const avisar = (cuerpo, ua = NAVEGADOR, ip = "1.2.3.4") =>
  visita({ httpMethod: "POST", headers: { "user-agent": ua, "cf-connecting-ip": ip }, queryStringParameters: {}, body: JSON.stringify(cuerpo) });

test("una visita suma al total del día y al de su fuente", async () => {
  const llamadas = simularRed([[/rpc\/sumar_metrica/, { json: null }]]);
  const r = await avisar({ ref: "https://l.instagram.com/" }, NAVEGADOR, "10.0.0.1");
  assert.equal(r.statusCode, 204);
  assert.deepEqual(sumas(llamadas).sort(), [["visitas", 1], ["visitas:instagram", 1]]);
});

test("los robots no cuentan como visitas", async () => {
  const llamadas = simularRed([[/rpc\/sumar_metrica/, { json: null }]]);
  for (const ua of ["Googlebot/2.1", "facebookexternalhit/1.1", "Mozilla/5.0 HeadlessChrome/120", ""]) {
    assert.equal((await avisar({}, ua, "10.0.0.2")).statusCode, 204);
  }
  assert.equal(llamadas.length, 0);
});

test("recargar sin parar no infla las visitas", async () => {
  const llamadas = simularRed([[/rpc\/sumar_metrica/, { json: null }]]);
  for (let n = 0; n < 30; n++) await avisar({}, NAVEGADOR, "10.0.0.3");
  assert.equal(sumas(llamadas).filter(([c]) => c === "visitas").length, 20);
});

test("si falta la tabla de métricas, la tienda no se entera (siempre 204)", async () => {
  simularRed([[/rpc\/sumar_metrica/, { status: 404, json: { code: "PGRST202" } }]]);
  assert.equal((await avisar({}, NAVEGADOR, "10.0.0.4")).statusCode, 204);
});

// ===== Carritos vencidos =====

test("al vencer los carritos se anota cuántos, por cuánto y cuántos igual compraron", async () => {
  const llamadas = simularRed([
    [/DELETE .*pedidos\?/, { json: [
      { id: "a", total: 4000, cliente_email: "ana@test.com", creado: "2026-11-17T10:00:00Z" },
      { id: "b", total: 6000, cliente_email: "beto@test.com", creado: "2026-11-17T11:00:00Z" },
      { id: "c", total: 2000, cliente_email: null, creado: "2026-11-17T12:00:00Z" },
    ] }],
    // Ana compró después de abandonar; Beto no
    [/GET .*pedidos\?select=cliente_email,creado&estado=eq\.aprobado/, { json: [{ cliente_email: "ana@test.com", creado: "2026-11-17T15:00:00Z" }] }],
    [/rpc\/sumar_metrica/, { json: null }],
  ]);
  const borrados = await limpiarPedidosPendientes(null);
  assert.equal(borrados, 3);
  assert.deepEqual(sumas(llamadas).sort(), [["carritos_recuperados", 1], ["carritos_vencidos", 3], ["carritos_vencidos_monto", 12000]]);
});

test("si no venció ningún carrito no se anota nada", async () => {
  const llamadas = simularRed([[/DELETE .*pedidos\?/, { json: [] }]]);
  assert.equal(await limpiarPedidosPendientes(null), 0);
  assert.equal(sumas(llamadas).length, 0);
});

// ===== Panel =====

test("las métricas del panel exigen ser admin y, sin la migración, avisan qué falta", async () => {
  let llamadas = simularRed([]);
  const sinToken = await adminMetricas({ httpMethod: "GET", headers: { "x-admin-token": "otro-token-de-prueba!" }, queryStringParameters: {} });
  assert.equal(sinToken.statusCode, 401);
  assert.equal(llamadas.length, 0);

  simularRed([[/GET .*metricas_dia\?/, { status: 404, json: { code: "PGRST205" } }]]);
  const r = await adminMetricas({ httpMethod: "GET", headers: { "x-admin-token": "token-admin-de-prueba" }, queryStringParameters: {} });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body), { metricas: [], falta: "migracion-metricas.sql" });
});
