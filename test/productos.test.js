// Tests del perfil de sabor de los productos (dulzor, acidez, cuerpo de 1 a 5).
//
//   node --test
//
// Convención: cada test dice QUÉ regla protege, no cómo está escrita.

const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://base.test";
process.env.SUPABASE_SECRET_KEY = "clave-de-prueba";
process.env.ADMIN_TOKEN = "token-admin-de-prueba";

const adminProductos = require("../backend/functions/admin-productos.js").handler;

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
const admin = (metodo, cuerpo) =>
  adminProductos({ httpMethod: metodo, headers: { "x-admin-token": "token-admin-de-prueba" }, queryStringParameters: {}, body: cuerpo ? JSON.stringify(cuerpo) : null });

test("el perfil de sabor se guarda de 1 a 5, y vacío o fuera de rango queda sin dato", async () => {
  const llamadas = simularRed([[/PATCH .*productos\?id=eq\./, (l) => ({ json: [{ id: "andino", ...l.body }] })]]);
  const r = await admin("PATCH", { id: "andino", perfil_dulzor: "4", perfil_acidez: "", perfil_cuerpo: 9 });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(llamadas[0].body, { perfil_dulzor: 4, perfil_acidez: null, perfil_cuerpo: null });
});

test("editar un producto sin tocar el perfil no lo borra", async () => {
  const llamadas = simularRed([[/PATCH .*productos\?id=eq\./, (l) => ({ json: [{ id: "andino", ...l.body }] })]]);
  await admin("PATCH", { id: "andino", nombre: "Andino" });
  assert.deepEqual(llamadas[0].body, { nombre: "Andino" });
});

test("el panel trae el perfil, y sin la migración igual lista los productos", async () => {
  let llamadas = simularRed([[/GET .*productos\?select=.*perfil_dulzor/, { json: [{ id: "andino", perfil_dulzor: 4 }] }]]);
  let r = await admin("GET");
  assert.equal(JSON.parse(r.body).productos[0].perfil_dulzor, 4);

  llamadas = simularRed([
    [/GET .*productos\?select=.*perfil_dulzor/, { status: 400, json: { code: "42703", message: "column productos.perfil_dulzor does not exist" } }],
    [/GET .*productos\?select=.*descontinuado&/, { json: [{ id: "andino", nombre: "Andino" }] }],
  ]);
  r = await admin("GET");
  assert.equal(r.statusCode, 200);
  const producto = JSON.parse(r.body).productos[0];
  assert.equal(producto.nombre, "Andino");
  // sin la columna, el panel no muestra los selectores (y no manda el campo al guardar)
  assert.equal("perfil_dulzor" in producto, false);
});
