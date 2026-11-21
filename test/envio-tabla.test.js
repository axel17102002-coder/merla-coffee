// Tests de Andreani con tarifa propia (despacho a mano, sin API): zona según
// la provincia, precio según la caja, y que el checkout cobre lo mismo que se
// mostró.
//
//   node --test
//
// Convención: cada test dice QUÉ regla protege, no cómo está escrita.

const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://base.test";
process.env.SUPABASE_SECRET_KEY = "clave-de-prueba";

const tabla = require("../backend/lib/envio-tabla.js");
const { listarOpcionesEnvio, resolverEnvioCosto, proveedorActivo } = require("../backend/lib/envio-costo.js");
const { sanitizarEnvio, validarEnvio } = require("../backend/lib/entrega.js");

function simularRed(reglas) {
  globalThis.fetch = async (url, opciones = {}) => {
    const clave = `${opciones.method || "GET"} ${url}`;
    for (const [patron, json] of reglas) {
      if (patron.test(clave)) return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
    }
    throw new Error(`llamada no prevista: ${clave}`);
  };
}

// La base: solo la tarifa propia prendida, Zipnova apagado, una celda editada
function baseConTabla(extra = []) {
  simularRed([
    [/GET .*insumos\?/, []],
    [/GET .*configuracion\?/, [
      { clave: "envio_tabla", valor: 1 },
      { clave: "envio_zipnova", valor: 0 },
      { clave: "envio_local", valor: 1 },
      { clave: "tarifa_z2_chica_sucursal", valor: 11000 },
      ...extra,
    ]],
    [/GET .*transportistas\?/, [{ nombre: "Andreani", activo: true }]],
    [/POST .*transportistas/, null],
  ]);
}

const PRODUCTOS = [{ id: "p", tipo: "cafe", presentaciones: [{ id: "u", unidades_stock: 1 }] }];
const items = (qty) => [{ presentacion: "u", qty }];

// ===== Zonas =====

test("la zona sale de la provincia, como cobra Andreani", () => {
  assert.equal(tabla.zonaDe({ provincia: "Ciudad Autónoma de Buenos Aires", cp: "1425" }), "z1");
  assert.equal(tabla.zonaDe({ provincia: "Córdoba", cp: "5000" }), "z2");
  assert.equal(tabla.zonaDe({ provincia: "Mendoza", cp: "5500" }), "z3");
  assert.equal(tabla.zonaDe({ provincia: "Salta", cp: "4400" }), "z4");
  assert.equal(tabla.zonaDe({ provincia: "Tierra del Fuego", cp: "9410" }), "z4");
});

test("en Buenos Aires el conurbano (CP 1000-1999) es AMBA y el resto, zona Centro", () => {
  assert.equal(tabla.zonaDe({ provincia: "Buenos Aires", cp: "1708" }), "z1");
  assert.equal(tabla.zonaDe({ provincia: "Buenos Aires", cp: "B1980ABC" }), "z1"); // Brandsen
  assert.equal(tabla.zonaDe({ provincia: "Buenos Aires", cp: "2800" }), "z2"); // Zárate
  assert.equal(tabla.zonaDe({ provincia: "Buenos Aires", cp: "7600" }), "z2"); // Mar del Plata
});

test("una provincia desconocida no inventa precio", () => {
  assert.equal(tabla.zonaDe({ provincia: "Narnia", cp: "1234" }), null);
  assert.equal(tabla.zonaDe({ provincia: "", cp: "5000" }), null);
});

// ===== Opciones y precio =====

test("ofrece Andreani a sucursal y a domicilio con el precio de la tabla", async () => {
  baseConTabla();
  const r = await listarOpcionesEnvio(items(10), PRODUCTOS, { cp: "5000", ciudad: "Córdoba", provincia: "Córdoba" }, 20000);
  assert.equal(r.ok, true);
  const porTipo = Object.fromEntries(r.opciones.map((o) => [o.tipo, o]));
  assert.equal(porTipo.sucursal.precio, 11000); // la celda editada en el panel manda
  assert.equal(porTipo.domicilio.precio, tabla.TARIFAS_RESPALDO.z2.chica.domicilio);
  assert.equal(porTipo.sucursal.transportista, "Andreani");
  assert.equal(porTipo.sucursal.sucursalLibre, true);
  assert.ok(r.opciones.every((o) => o.cotizacionToken === undefined || typeof o.cotizacionToken === "string"));
});

test("un pedido grande va en caja mediana y cuesta más", async () => {
  baseConTabla();
  const r = await listarOpcionesEnvio(items(40), PRODUCTOS, { cp: "5000", ciudad: "Córdoba", provincia: "Córdoba" }, 20000);
  const dom = r.opciones.find((o) => o.tipo === "domicilio");
  assert.equal(dom.precio, tabla.TARIFAS_RESPALDO.z2.mediana.domicilio);
});

test("el envío gratis también bonifica la tarifa propia", async () => {
  baseConTabla([{ clave: "envio_gratis_desde", valor: 70000 }]);
  const r = await listarOpcionesEnvio(items(10), PRODUCTOS, { cp: "1425", ciudad: "CABA", provincia: "Ciudad Autónoma de Buenos Aires" }, 80000);
  assert.ok(r.opciones.every((o) => o.precio === 0 && o.gratis));
});

test("al cobrar se recotiza con la misma tabla (sin token)", async () => {
  baseConTabla();
  const envio = { metodo: "envio", cp: "5500", ciudad: "Mendoza", provincia: "Mendoza", opcionGrupo: "tabla:andreani:domicilio" };
  const r = await resolverEnvioCosto(items(10), PRODUCTOS, envio, 20000);
  assert.equal(r.ok, true);
  assert.equal(r.costo, tabla.TARIFAS_RESPALDO.z3.chica.domicilio);
  assert.equal(r.proveedor, "tabla");
});

test("si la tarifa propia se apaga, un carrito viejo no puede cobrarla", async () => {
  baseConTabla([{ clave: "envio_tabla", valor: 0 }]);
  const envio = { metodo: "envio", cp: "5500", ciudad: "Mendoza", provincia: "Mendoza", opcionGrupo: "tabla:andreani:domicilio" };
  const r = await resolverEnvioCosto(items(10), PRODUCTOS, envio, 20000);
  assert.equal(r.ok, false);
});

test("la tarifa propia arranca apagada si nunca se la prendió", () => {
  assert.equal(proveedorActivo("tabla", {}), false);
  assert.equal(proveedorActivo("tabla", { proveedoresEnvio: { tabla: true } }), true);
});

// ===== Sucursal escrita a mano =====

test("a sucursal sin lista oficial, exige que el cliente escriba cuál", () => {
  const base = { metodo: "envio", nombre: "Ana", cp: "5000", ciudad: "Córdoba", provincia: "Córdoba", telefono: "351", opcionGrupo: "tabla:andreani:sucursal", opcionTipo: "sucursal" };
  assert.match(validarEnvio(sanitizarEnvio({ ...base, sucursal: { id: "a-eleccion", descripcion: "" } })), /sucursal/i);
  assert.equal(validarEnvio(sanitizarEnvio({ ...base, sucursal: { id: "a-eleccion", descripcion: "Andreani Córdoba Centro" } })), null);
});
