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

const { proveedorDe, proveedorActivo } = require("../backend/lib/envio-costo.js");
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

// ===== Interruptor de cada API de envío (/admin → Precios → Envío) =====
// Una API cotiza solo si tiene credenciales Y está prendida en el panel.
// `disponible()` lee process.env en cada llamada, así que alcanza con simular
// las credenciales de Zipnova para probar las dos condiciones.

function conCredencialesDeZipnova(fn) {
  const previo = { ...process.env };
  Object.assign(process.env, { ZIPNOVA_TOKEN: "t", ZIPNOVA_SECRET: "s", ZIPNOVA_ACCOUNT_ID: "1" });
  try { fn(); } finally { process.env = previo; }
}

test("con credenciales y prendida, la API cotiza", () => {
  conCredencialesDeZipnova(() => {
    assert.equal(proveedorActivo("zipnova", { proveedoresEnvio: { zipnova: true } }), true);
  });
});

test("apagarla desde el panel manda, aunque tenga credenciales", () => {
  conCredencialesDeZipnova(() => {
    assert.equal(proveedorActivo("zipnova", { proveedoresEnvio: { zipnova: false } }), false);
  });
});

test("prenderla no alcanza si no hay credenciales cargadas", () => {
  assert.equal(proveedorActivo("zipnova", { proveedoresEnvio: { zipnova: true } }), false);
});

test("sin la migración corrida se asume prendida: no cambia lo que ya andaba", () => {
  conCredencialesDeZipnova(() => {
    assert.equal(proveedorActivo("zipnova", {}), true);
    assert.equal(proveedorActivo("zipnova", null), true);
  });
});

test("un proveedor que no existe nunca cotiza", () => {
  assert.equal(proveedorActivo("inventado", { proveedoresEnvio: { inventado: true } }), false);
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

// ===== Validación y enriquecimiento de datos de entrega =====

const { sanitizarEnvio, validarEnvio, enriquecerEnvio } = require("../backend/lib/entrega.js");

test("un retiro no exige dirección ni sucursal", () => {
  assert.equal(validarEnvio(sanitizarEnvio({ metodo: "retiro" })), null);
  assert.equal(validarEnvio(sanitizarEnvio({ metodo: "retiro", nombre: "Ana" })), null);
});

test("un envío a domicilio exige dirección, destino, nombre y teléfono", () => {
  const base = {
    metodo: "envio", opcionTipo: "domicilio", opcionGrupo: "paqar:D:CP",
    nombre: "Ana Pérez", ciudad: "Córdoba", provincia: "Córdoba", cp: "5000",
    telefono: "3511234567", direccion: "Av. Colón 500",
  };
  assert.equal(validarEnvio(sanitizarEnvio(base)), null);
  assert.match(validarEnvio(sanitizarEnvio({ ...base, direccion: "" })), /dirección/i);
  assert.match(validarEnvio(sanitizarEnvio({ ...base, nombre: "" })), /nombre/i);
  assert.match(validarEnvio(sanitizarEnvio({ ...base, telefono: "" })), /teléfono/i);
  assert.match(validarEnvio(sanitizarEnvio({ ...base, opcionGrupo: "" })), /opción de envío/i);
});

test("un envío a sucursal exige una sucursal elegida y no pide dirección del cliente", () => {
  const base = {
    metodo: "envio", opcionTipo: "sucursal", opcionGrupo: "paqar:S:CP",
    nombre: "Ana Pérez", ciudad: "Córdoba", provincia: "Córdoba", cp: "5000",
    telefono: "3511234567",
    sucursal: { id: "X5000", descripcion: "Correo Córdoba Centro", direccion: "Av. Gral. Paz 201" },
  };
  assert.equal(validarEnvio(sanitizarEnvio(base)), null);
  assert.match(validarEnvio(sanitizarEnvio({ ...base, sucursal: null })), /sucursal/i);
  assert.match(validarEnvio(sanitizarEnvio({ ...base, sucursal: { id: "" } })), /sucursal/i);
});

test("al enriquecer el envío se guardan proveedor, servicio, plazo y transportista del servidor", () => {
  const envio = sanitizarEnvio({
    metodo: "envio", opcionTipo: "sucursal", opcionGrupo: "paqar:S:CP",
    nombre: "Ana", ciudad: "Córdoba", provincia: "Córdoba", cp: "5000", telefono: "351000",
    transportista: "falso",
    sucursal: { id: "X5000", descripcion: "Centro", direccion: "Av. Gral. Paz 201" },
  });
  const completo = enriquecerEnvio(envio, {
    proveedor: "paqar",
    opcion: {
      tipo: "sucursal",
      transportista: "Correo Argentino",
      servicio: "PAQ.AR Clásico",
      plazo: "2 a 5 días hábiles",
    },
  });
  assert.equal(completo.proveedor, "paqar");
  assert.equal(completo.transportista, "Correo Argentino");
  assert.equal(completo.servicio, "PAQ.AR Clásico");
  assert.equal(completo.plazo, "2 a 5 días hábiles");
  assert.equal(completo.opcionTipo, "sucursal");
  assert.equal(completo.direccion, "");
  assert.equal(completo.sucursal.id, "X5000");
});

// ===== Empaque centralizado (tara + tamaño de caja) =====

const { calcularPaquete } = require("../backend/lib/empaque.js");

test("el paquete suma el peso de los productos más la tara de la caja y elige tamaño acorde", () => {
  const productos = [
    { id: "andino", tipo: "cafe", presentaciones: [{ id: "andino-pack5", unidades_stock: 5 }] },
    { id: "taza", tipo: "simple", categoria: "merch", presentaciones: [{ id: "taza-u", unidades_stock: 1 }] },
  ];
  const cfg = { pesoDripBagG: 18, pesoCafeBolsaG: 270, pesoMerchG: 350, pesoCajaG: 80 };

  const chico = calcularPaquete([{ presentacion: "andino-pack5", qty: 2 }], productos, cfg);
  assert.equal(chico.pesoGramos, 18 * 10 + 80); // 260 g
  assert.equal(chico.caja, "chica");

  const mediano = calcularPaquete([{ presentacion: "taza-u", qty: 2 }], productos, cfg);
  assert.equal(mediano.pesoGramos, 350 * 2 + 80); // 780 g
  assert.equal(mediano.caja, "mediana");

  const grande = calcularPaquete([{ presentacion: "taza-u", qty: 6 }], productos, cfg);
  assert.equal(grande.pesoGramos, 350 * 6 + 80); // 2180 g
  assert.equal(grande.caja, "grande");
});

// ===== Envío local en La Plata =====

const envioLocal = require("../backend/lib/envio-local.js");

test("el envío local cubre los CPs de La Plata (incluso en formato CPA) y no otras provincias", async () => {
  assert.equal(envioLocal.cubreDestino({ cp: "1900", provincia: "Buenos Aires" }), true);
  assert.equal(envioLocal.cubreDestino({ cp: "B1900ABC", provincia: "Buenos Aires" }), true);
  assert.equal(envioLocal.cubreDestino({ cp: "1904", provincia: "Buenos Aires" }), true);
  assert.equal(envioLocal.cubreDestino({ cp: "5000", provincia: "Córdoba" }), false);
  assert.equal(envioLocal.cubreDestino({ cp: "1425", provincia: "Ciudad Autónoma de Buenos Aires" }), false);

  const r = await envioLocal.cotizarOpciones({ cp: "1900", provincia: "Buenos Aires", cfg: { envioLocalPrecio: 1500 } });
  assert.equal(r.ok, true);
  assert.equal(r.opciones.length, 1);
  assert.equal(r.opciones[0].precio, 1500);
  assert.equal(r.opciones[0].local, true);
  assert.equal(proveedorDe(r.opciones[0].grupo).id, "local");
});

// ===== Deduplicación entre APIs directas y agregador =====

const { deduplicarOpciones, aplicarEnvioGratis } = require("../backend/lib/envio-costo.js");

test("si paq.ar y Zipnova cotizan Correo Argentino, se prioriza paq.ar directo sin duplicar", () => {
  const mezcladas = [
    { proveedor: "zipnova", tipo: "domicilio", transportista: "Correo Argentino S.A.", precio: 14000 },
    { proveedor: "paqar", tipo: "domicilio", transportista: "Correo Argentino", servicio: "Clásico", precio: 7000 },
    { proveedor: "paqar", tipo: "domicilio", transportista: "Correo Argentino", servicio: "Expreso", precio: 9500 },
    { proveedor: "zipnova", tipo: "domicilio", transportista: "OCA", precio: 11000 },
  ];
  const limpias = deduplicarOpciones(mezcladas);
  assert.equal(limpias.length, 3);
  assert.ok(!limpias.some((o) => o.proveedor === "zipnova" && o.transportista.includes("Correo")));
  assert.ok(limpias.some((o) => o.transportista === "OCA"));
});

test("si el proveedor directo no respondió, el agregador queda como respaldo", () => {
  const soloZipnova = [
    { proveedor: "zipnova", tipo: "sucursal", transportista: "Correo Argentino", precio: 12000 },
  ];
  assert.equal(deduplicarOpciones(soloZipnova).length, 1);
});

// ===== Envío gratis por monto =====

test("el envío gratis bonifica el envío local y la opción más barata de cada modalidad", () => {
  const opciones = [
    { proveedor: "local", tipo: "domicilio", local: true, precio: 1500 },
    { proveedor: "paqar", tipo: "domicilio", precio: 7000 },
    { proveedor: "paqar", tipo: "domicilio", precio: 9500 },
    { proveedor: "paqar", tipo: "sucursal", precio: 5500 },
  ];
  // Debajo del mínimo: no cambia nada
  const sinGratis = aplicarEnvioGratis(opciones, 20000, { envioGratisDesde: 30000 });
  assert.deepEqual(sinGratis.map((o) => o.precio), [1500, 7000, 9500, 5500]);

  // Superando el mínimo: local + domicilio más barato + sucursal más barata pasan a $0
  const conGratis = aplicarEnvioGratis(opciones, 35000, { envioGratisDesde: 30000 });
  const local = conGratis.find((o) => o.local);
  const domBarato = conGratis.find((o) => !o.local && o.tipo === "domicilio" && o.gratis);
  const domCaro = conGratis.find((o) => !o.local && o.tipo === "domicilio" && !o.gratis);
  const sucBarata = conGratis.find((o) => o.tipo === "sucursal");
  assert.equal(local.precio, 0);
  assert.equal(local.precioOriginal, 1500);
  assert.equal(domBarato.precio, 0);
  assert.equal(domBarato.precioOriginal, 7000);
  assert.equal(domCaro.precio, 9500);
  assert.equal(sucBarata.precio, 0);
});

// ===== Orden de sucursales por cercanía de CP =====

test("las sucursales de paq.ar se ordenan por CP exacto, misma ciudad y luego CP más cercano", () => {
  const lista = [
    { code: "BAHIA", name: "Bahía Blanca", location: "Bahía Blanca", postalCode: "8000" },
    { code: "LAPLATA", name: "La Plata Centro", location: "La Plata", postalCode: "1900" },
    { code: "QUILMES", name: "Quilmes", location: "Quilmes", postalCode: "1878" },
  ];
  // Destino Berisso (1923): no tiene sucursal exacta, pero La Plata (1900) está a 23 de CP vs Bahía Blanca a 6077
  const ordenadas = paqar.ordenarSucursales(lista, "1923", "Berisso");
  assert.equal(ordenadas[0].code, "LAPLATA");
  assert.equal(ordenadas[1].code, "QUILMES");
  assert.equal(ordenadas[2].code, "BAHIA");
});

// ===== Firma HMAC de cotizaciones =====

const { firmarOpcion, verificarOpcion, TTL_MS } = require("../backend/lib/cotizacion-firma.js");

test("una cotización firmada se verifica en el checkout y rechaza manipulaciones o vencimiento", () => {
  const previo = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = "secreto-prueba-envio";
  try {
    const items = [{ presentacion: "andino-pack5", qty: 2 }];
    const destino = { cp: "5000", ciudad: "Córdoba", provincia: "Córdoba" };
    const opcion = { proveedor: "paqar", grupo: "paqar:D:CP", tipo: "domicilio", transportista: "Correo Argentino", servicio: "Clásico", plazo: "2 a 5 días hábiles", precio: 7025 };
    const ahora = 1700000000000;

    const token = firmarOpcion(opcion, { items, destino, pesoGramos: 260, ahora });
    assert.ok(token.includes("."));

    // Válido dentro de los 20 min con mismo carrito y destino
    const ok = verificarOpcion(token, { grupo: "paqar:D:CP", items, destino, ahora: ahora + 60000 });
    assert.equal(ok.opcion.precio, 7025);
    assert.equal(ok.proveedor, "paqar");
    assert.equal(ok.pesoGramos, 260);

    // Rechaza si cambió el carrito
    assert.equal(verificarOpcion(token, { grupo: "paqar:D:CP", items: [{ presentacion: "andino-pack5", qty: 3 }], destino, ahora }), null);
    // Rechaza si cambió el destino
    assert.equal(verificarOpcion(token, { grupo: "paqar:D:CP", items, destino: { ...destino, cp: "1900" }, ahora }), null);
    // Rechaza si venció
    assert.equal(verificarOpcion(token, { grupo: "paqar:D:CP", items, destino, ahora: ahora + TTL_MS + 1 }), null);
    // Rechaza si se alteró la firma
    assert.equal(verificarOpcion(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"), { grupo: "paqar:D:CP", items, destino, ahora }), null);
  } finally {
    if (previo === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previo;
  }
});
