// Tests de las reseñas de clientes que se muestran en la tienda.
//
//   node --test
//
// Convención: cada test dice QUÉ regla protege, no cómo está escrita.

const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://base.test";
process.env.SUPABASE_SECRET_KEY = "clave-de-prueba";
process.env.ADMIN_TOKEN = "token-admin-de-prueba";

const tienda = require("../backend/functions/tienda.js").handler;
const adminResenas = require("../backend/functions/admin-resenas.js").handler;

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

const catalogo = [
  [/GET .*productos\?/, { json: [{ id: "andino", nombre: "Andino", stock: 3, activo: true, tipo: "cafe", costo_kg: 45000 }] }],
  [/GET .*presentaciones\?/, { json: [{ id: "andino-unidad", producto_id: "andino", nombre: "Unidad", precio: 2300, unidades_stock: 1, activo: true }] }],
  [/GET .*users\/me/, { json: { tags: [] } }],
];

test("la tienda manda solo las reseñas publicadas, sin datos internos", async () => {
  const llamadas = simularRed([
    ...catalogo,
    [/GET .*resenas\?/, { json: [{ nombre: "Sofía", texto: "Riquísimo", detalle: "La Plata", estrellas: 5 }] }],
  ]);
  const r = await tienda({ httpMethod: "GET", headers: {} });
  assert.equal(r.statusCode, 200);
  const cuerpo = JSON.parse(r.body);
  assert.deepEqual(cuerpo.resenas, [{ nombre: "Sofía", texto: "Riquísimo", detalle: "La Plata", estrellas: 5 }]);
  const pedido = decodeURIComponent(llamadas.find((l) => l.url.includes("/resenas?")).url);
  assert.match(pedido, /activo=is\.true/);
  assert.match(pedido, /select=nombre,texto,detalle,estrellas&/); // ni id, ni fecha, ni ocultas
  // y los costos siguen sin salir
  assert.equal(cuerpo.productos[0].costo_kg, undefined);
});

test("si la tabla de reseñas no existe todavía, la tienda carga igual", async () => {
  simularRed([
    ...catalogo,
    [/GET .*resenas\?/, { status: 404, json: { code: "PGRST205", message: "Could not find the table 'public.resenas'" } }],
  ]);
  const r = await tienda({ httpMethod: "GET", headers: {} });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body).resenas, []);
  assert.equal(JSON.parse(r.body).productos.length, 1);
});

const admin = (metodo, cuerpo, extra = {}) =>
  adminResenas({
    httpMethod: metodo,
    headers: { "x-admin-token": extra.token || "token-admin-de-prueba" },
    queryStringParameters: extra.query || {},
    body: cuerpo ? JSON.stringify(cuerpo) : null,
  });

test("cargar reseñas exige ser admin", async () => {
  const llamadas = simularRed([]);
  assert.equal((await admin("POST", { nombre: "X", texto: "Y" }, { token: "otro-token-de-prueba!" })).statusCode, 401);
  assert.equal(llamadas.length, 0);
});

test("una reseña se guarda limpia: sin espacios de más, recortada y con estrellas entre 1 y 5", async () => {
  const llamadas = simularRed([[/POST .*\/resenas$/, (l) => ({ json: [{ id: "x", ...l.body }] })]]);
  const r = await admin("POST", { nombre: "  Sofía  ", texto: "Muy   rico\n\n el Sertão", detalle: "", estrellas: 9 });
  assert.equal(r.statusCode, 201);
  const fila = llamadas[0].body;
  assert.equal(fila.nombre, "Sofía");
  assert.equal(fila.texto, "Muy rico el Sertão");
  assert.equal(fila.detalle, null);
  assert.equal(fila.estrellas, 5);
  // texto larguísimo: se corta al máximo de la columna (400)
  await admin("POST", { nombre: "Ana", texto: "a".repeat(900) });
  assert.equal(llamadas[1].body.texto.length, 400);
});

test("sin nombre o sin texto no se guarda nada", async () => {
  const llamadas = simularRed([]);
  assert.equal((await admin("POST", { nombre: "", texto: "Rico" })).statusCode, 400);
  assert.equal((await admin("POST", { nombre: "Ana", texto: "   " })).statusCode, 400);
  assert.equal(llamadas.length, 0);
});

test("ocultar, editar y borrar actúan sobre una sola reseña, identificada por su id", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const llamadas = simularRed([
    [/PATCH .*resenas\?id=eq\./, (l) => ({ json: [{ id, ...l.body }] })],
    [/DELETE .*resenas\?id=eq\./, { json: null }],
  ]);
  assert.equal((await admin("PATCH", { id, activo: false })).statusCode, 200);
  assert.equal((await admin("POST", { id, nombre: "Ana", texto: "Corregido" })).statusCode, 200);
  assert.equal((await admin("DELETE", null, { query: { id } })).statusCode, 200);
  assert.deepEqual(llamadas.map((l) => l.metodo), ["PATCH", "PATCH", "DELETE"]);
  for (const l of llamadas) assert.ok(l.url.endsWith(`resenas?id=eq.${id}`));
  // un id que no es un uuid ni siquiera llega a la base (no puede armar un filtro raro)
  const antes = llamadas.length;
  assert.equal((await admin("DELETE", null, { query: { id: "x&activo=is.true" } })).statusCode, 400);
  assert.equal((await admin("PATCH", { id: "*", activo: true })).statusCode, 400);
  assert.equal(llamadas.length, antes);
});
