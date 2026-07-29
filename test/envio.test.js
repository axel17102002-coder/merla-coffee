// Tests de la lógica de envío que se puede verificar sin red: el ruteo de
// grupos entre proveedores y la lectura de la tarifa de Andreani.
//
// Lo que NO se prueba acá (hace falta credenciales y un destino real): que
// Andreani conteste. Eso se valida contra su ambiente QA cuando estén las
// credenciales — ver README.
//
//   node --test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { proveedorDe } = require("../backend/lib/envio-costo.js");
const andreani = require("../backend/lib/andreani.js");
const { permitido } = require("../backend/lib/transportistas.js");

// ===== A qué proveedor se le vuelve a preguntar el precio =====

test("un grupo de Andreani se re-cotiza contra Andreani", () => {
  assert.equal(proveedorDe("andreani:domicilio").id, "andreani");
  assert.equal(proveedorDe("andreani:sucursal").id, "andreani");
});

test("los grupos viejos de Zipnova (sin prefijo) siguen yendo a Zipnova", () => {
  // Un carrito abierto antes del cambio manda "123:standard_delivery"
  assert.equal(proveedorDe("123:standard_delivery").id, "zipnova");
  assert.equal(proveedorDe("456:pickup_point").id, "zipnova");
});

test("un grupo desconocido o vacío no rompe: cae en Zipnova", () => {
  assert.equal(proveedorDe("").id, "zipnova");
  assert.equal(proveedorDe(null).id, "zipnova");
  assert.equal(proveedorDe("proveedor-que-no-existe:x").id, "zipnova");
});

// ===== Tarifa de Andreani =====

test("se cobra la tarifa CON IVA, que es lo que paga el cliente", () => {
  assert.equal(andreani.precioDeTarifa({ tarifaConIva: { total: 12100 }, tarifaSinIva: { total: 10000 } }), 12100);
});

test("si solo viene la tarifa sin IVA, se usa esa antes que quedarse sin precio", () => {
  assert.equal(andreani.precioDeTarifa({ tarifaSinIva: { total: 10000 } }), 10000);
});

test("una respuesta sin tarifa devuelve null y esa opción no se ofrece", () => {
  assert.equal(andreani.precioDeTarifa({}), null);
  assert.equal(andreani.precioDeTarifa({ tarifaConIva: { total: 0 } }), null);
  assert.equal(andreani.precioDeTarifa(null), null);
});

test("la tarifa que llega como string igual se interpreta", () => {
  assert.equal(andreani.precioDeTarifa({ tarifaConIva: { total: "9500.40" } }), 9500);
});

// ===== Query de cotización =====

test("la query lleva el contrato, el destino y el bulto con su peso en kilos", () => {
  const cred = { cliente: "0012007490", sucursalOrigen: "PRC" };
  const q = andreani.queryTarifa({ cred, contrato: "400015877", cp: "5000", pesoGramos: 900, valorDeclarado: 11600 });
  assert.match(q, /^\/v1\/tarifas\?/);
  assert.match(q, /cpDestino=5000/);
  assert.match(q, /contrato=400015877/);
  assert.match(q, /cliente=0012007490/);
  assert.match(q, /sucursalOrigen=PRC/);
  assert.match(q, /valorDeclarado%5D=11600/);
  assert.match(q, /kilos%5D=0\.9/); // 900 g → 0,9 kg
});

test("un carrito liviano no cotiza con peso 0: Andreani rechazaría el bulto", () => {
  const cred = { cliente: "1", sucursalOrigen: "PRC" };
  const q = andreani.queryTarifa({ cred, contrato: "1", cp: "1425", pesoGramos: 0, valorDeclarado: 1000 });
  assert.match(q, /kilos%5D=0\.1/);
});

// ===== Interruptor de transportistas (compartido entre proveedores) =====

test("el interruptor del panel aplica igual venga de Zipnova o de Andreani", () => {
  const activos = ["oca", "correo argentino"];
  assert.equal(permitido("OCA", activos), true);
  assert.equal(permitido("Correo Argentino S.A.", activos), true); // tolera variantes
  assert.equal(permitido("Andreani", activos), false);
});

test("sin transportistas prendidos no pasa ninguno", () => {
  assert.equal(permitido("Andreani", []), false);
  assert.equal(permitido("Andreani", undefined), false);
});

// ===== paq.ar (MiCorreo) =====

const paqar = require("../backend/lib/paqar.js");

test("cada servicio de paq.ar es una opción propia, con su plazo", () => {
  const o = paqar.normalizarTarifa({
    deliveredType: "D", productType: "CP", productName: "PAQ.AR Clásico",
    price: 7025.6, deliveryTimeMin: 2, deliveryTimeMax: 5,
  });
  assert.equal(o.tipo, "domicilio");
  assert.equal(o.transportista, "Correo Argentino"); // respeta el interruptor del panel
  assert.equal(o.servicio, "PAQ.AR Clásico");
  assert.equal(o.precio, 7026);
  assert.equal(o.plazo, "2 a 5 días hábiles");
  assert.equal(o.grupo, "paqar:D:CP");
});

test("la entrega en sucursal se marca como tal", () => {
  const o = paqar.normalizarTarifa({ deliveredType: "S", productType: "CS", price: 6100 });
  assert.equal(o.tipo, "sucursal");
  assert.equal(o.grupo, "paqar:S:CS");
});

test("una tarifa sin precio no se ofrece", () => {
  assert.equal(paqar.normalizarTarifa({ deliveredType: "D", price: 0 }), null);
  assert.equal(paqar.normalizarTarifa({ deliveredType: "D", price: "no es un número" }), null);
});

test("el grupo de paq.ar se re-cotiza contra paq.ar", () => {
  assert.equal(proveedorDe("paqar:D:CP").id, "paqar");
});

test("el cuerpo de la cotización lleva origen, destino y el bulto en gramos", () => {
  const cred = { customerId: "123", cpOrigen: "1900" };
  const b = paqar.cuerpoTarifa({ cred, cpDestino: "5000", pesoGramos: 900 });
  assert.equal(b.customerId, "123");
  assert.equal(b.postalCodeOrigin, "1900");
  assert.equal(b.postalCodeDestination, "5000");
  assert.equal(b.dimensions[0].weight, 900);
  assert.equal(b.dimensions[0].quantity, 1);
  // Sin deliveredType: pide domicilio y sucursal en una sola llamada
  assert.equal(b.deliveredType, undefined);
});

test("las provincias se traducen al código que pide la API, con o sin tildes", () => {
  assert.equal(paqar.codigoProvincia("Córdoba"), "X");
  assert.equal(paqar.codigoProvincia("cordoba"), "X");
  assert.equal(paqar.codigoProvincia("CABA"), "C");
  assert.equal(paqar.codigoProvincia("Ciudad Autónoma de Buenos Aires"), "C");
  assert.equal(paqar.codigoProvincia("Tierra del Fuego"), "V");
  assert.equal(paqar.codigoProvincia("No existe"), null); // sin código no se piden sucursales
});
