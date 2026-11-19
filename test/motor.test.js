// Tests de motor.js — las reglas que deciden la plata (precios, packs,
// descuentos, puntos, comisiones). Es el único archivo que corre en los dos
// lados y se toca seguido, así que conviene tenerlo cubierto.
//
// Se corren con Node, sin dependencias ni instalar nada:
//
//   node --test
//
// Convención: cada test dice QUÉ regla protege, no cómo está escrita.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  CONFIG,
  precioPack,
  precioTransferencia,
  numeroPedido,
  redondearPrecio,
  costoCafePorUnidad,
  costoUnidad,
  costoPack,
  precioUnidadDesdeCosto,
  costoKiloDesdePrecio,
  margenUnidadReal,
  margenSimple,
  calcularPedido,
  calcularDescuentosManual,
  comisionMpPorcentaje,
  comisionMpDe,
} = require("../public/motor.js");

// Configuración de costos de referencia (la que vive en la base, no acá)
const CFG = {
  fijoUnidad: 462.62,
  fijoPack: 828.65,
  margenUnidad: 40,
  gramosPorBag: 12,
  packUnidades: 5,
  packDescuento: 10,
};

// Catálogo mínimo para calcularPedido
function catalogo({ stock = 100, activo = true } = {}) {
  return [
    {
      id: "cafe1", nombre: "Andino", tipo: "cafe", activo, stock,
      presentaciones: [
        { id: "u", nombre: "Unidad", unidades_stock: 1, precio: 2000, activo: true },
        { id: "p", nombre: "Pack x5", unidades_stock: 5, precio: 9000, activo: true },
      ],
    },
    {
      id: "taza", nombre: "Taza", tipo: "simple", activo, stock,
      presentaciones: [{ id: "t", nombre: "Taza", unidades_stock: 1, precio: 12000, activo: true }],
    },
  ];
}

// ===== Precios y redondeo =====

test("el pack aplica su % OFF sobre las unidades sueltas y redondea a $50", () => {
  // 5 × 2320 = 11.600 → -10% = 10.440 → redondeado a múltiplo de 50
  assert.equal(precioPack(2320, CFG), 10450);
  assert.equal(precioPack(2320, CFG) % 50, 0);
});

test("redondearPrecio va al múltiplo más cercano, para arriba o para abajo", () => {
  assert.equal(redondearPrecio(10423, 50), 10400);
  assert.equal(redondearPrecio(10440, 50), 10450);
  assert.equal(redondearPrecio(10400, 50), 10400);
});

test("el precio por transferencia aplica el descuento de CONFIG y redondea al múltiplo elegido", () => {
  assert.equal(precioTransferencia(10000), 10000 * (100 - CONFIG.transferencia.descuento) / 100);
  // $1.979 × 0,90 = $1.781,10 → por defecto (de a $10) queda en $1.780
  assert.equal(precioTransferencia(1979), 1780);
  assert.equal(precioTransferencia(1979, 10), 1780);
  assert.equal(precioTransferencia(1979, 50), 1800);
  assert.equal(precioTransferencia(1979, 100), 1800);
  assert.equal(precioTransferencia(1979, 1), 1781);
});

test("el número de pedido se muestra con cuatro dígitos", () => {
  assert.equal(numeroPedido(7), "#0007");
  assert.equal(numeroPedido(1234), "#1234");
});

// ===== Cadena de costos =====

test("el costo de una unidad es el café que lleva más los insumos", () => {
  // 68.000/kg → 12 g = 816, + 462,62 de insumos
  assert.equal(Math.round(costoCafePorUnidad(68000, CFG)), 816);
  assert.equal(Math.round(costoUnidad(68000, CFG)), 1279);
});

test("el pack cuesta el café de sus 5 bags más los insumos DEL PACK, no 5 veces los de unidad", () => {
  const pack = costoPack(68000, CFG);
  assert.equal(Math.round(pack), 4909); // 60 g = 4080 + 828,65
  assert.ok(pack < costoUnidad(68000, CFG) * 5, "el pack no puede costar 5 unidades sueltas");
});

test("precio desde costo y costo desde precio son la misma cuenta al revés", () => {
  const precio = precioUnidadDesdeCosto(68000, CFG);
  assert.ok(Math.abs(costoKiloDesdePrecio(precio, CFG) - 68000) < 50);
});

test("el margen real de la unidad refleja el margen objetivo", () => {
  const precio = precioUnidadDesdeCosto(68000, CFG);
  assert.ok(Math.abs(margenUnidadReal(68000, precio, CFG) - CFG.margenUnidad) < 1);
});

test("el margen de un producto simple sale de costo y precio", () => {
  assert.equal(margenSimple(5000, 10000), 50);
});

// ===== calcularPedido: descuentos =====

test("el descuento por cantidad aplica solo a las unidades sueltas", () => {
  const items = [{ presentacion: "u", qty: CONFIG.descuentoCantidad }];
  const r = calcularPedido(items, {}, { productos: catalogo() });
  assert.equal(r.ok, true);
  assert.equal(r.subtotal, 2000 * CONFIG.descuentoCantidad);
  assert.equal(r.descuentoCantidad, Math.round(r.subtotal * CONFIG.descuentoPorcentaje / 100));
});

test("un pack no dispara el descuento por cantidad (ya trae el suyo)", () => {
  const r = calcularPedido([{ presentacion: "p", qty: 2 }], {}, { productos: catalogo() });
  assert.equal(r.descuentoCantidad, 0);
  assert.equal(r.unidades, 10);
  assert.equal(r.unidadesSueltas, 0);
});

test("por debajo del mínimo de unidades sueltas no hay descuento", () => {
  const r = calcularPedido([{ presentacion: "u", qty: CONFIG.descuentoCantidad - 1 }], {}, { productos: catalogo() });
  assert.equal(r.descuentoCantidad, 0);
});

test("el cupón de porcentaje se calcula después del descuento por cantidad", () => {
  const cupon = { codigo: "MERLA10", tipo: "porcentaje", valor: 10, minimo: 0, activo: true };
  const r = calcularPedido([{ presentacion: "u", qty: 5 }], { cupon }, { productos: catalogo() });
  const base = r.subtotal - r.descuentoCantidad;
  assert.equal(r.descuentoCupon, Math.round(base * 10 / 100));
  assert.equal(r.cupon, "MERLA10");
});

test("un cupón de monto fijo nunca descuenta más que el pedido", () => {
  const cupon = { codigo: "GRANDE", tipo: "monto", valor: 999999, minimo: 0, activo: true };
  const r = calcularPedido([{ presentacion: "u", qty: 1 }], { cupon }, { productos: catalogo() });
  assert.equal(r.descuentoCupon, r.subtotal - r.descuentoCantidad);
  assert.ok(r.total >= 0);
});

test("el cupón con mínimo rechaza el pedido que no llega", () => {
  const cupon = { codigo: "MIN", tipo: "porcentaje", valor: 10, minimo: 50000, activo: true };
  const r = calcularPedido([{ presentacion: "u", qty: 1 }], { cupon }, { productos: catalogo() });
  assert.equal(r.ok, false);
  assert.match(r.error, /desde \$/);
});

test("un cupón desactivado no se aplica", () => {
  const cupon = { codigo: "VIEJO", tipo: "porcentaje", valor: 50, minimo: 0, activo: false };
  const r = calcularPedido([{ presentacion: "u", qty: 1 }], { cupon }, { productos: catalogo() });
  assert.equal(r.ok, false);
});

test("el cupón 2x1 en drip bag exige al menos 2 drip bags sueltas y descuenta la más barata", () => {
  const productos = [
    ...catalogo(),
    {
      id: "cafe2", nombre: "Oldfashion", tipo: "cafe", activo: true, stock: 50,
      presentaciones: [{ id: "u2", nombre: "Unidad", unidades_stock: 1, precio: 2500, activo: true }],
    },
  ];
  const cupon = { codigo: "DRIP2X1", tipo: "2x1_drip", valor: 1, minimo: 0, activo: true };

  // 1 drip ($2.000) + 1 drip ($2.500) → descuenta la más barata ($2.000)
  const dos = calcularPedido([{ presentacion: "u", qty: 1 }, { presentacion: "u2", qty: 1 }], { cupon }, { productos });
  assert.equal(dos.ok, true);
  assert.equal(dos.descuentoCupon, 2000);
  assert.equal(dos.total, 2500);

  // Aunque lleve 4 drip bags, con valor=1 bonifica UNA sola (la más barata)
  const cuatro = calcularPedido([{ presentacion: "u", qty: 2 }, { presentacion: "u2", qty: 2 }], { cupon }, { productos });
  assert.equal(cuatro.ok, true);
  assert.equal(cuatro.descuentoCupon, 2000);

  // Con valor=2 y 4 drip bags, bonifica las 2 más baratas
  const tope2 = calcularPedido(
    [{ presentacion: "u", qty: 2 }, { presentacion: "u2", qty: 2 }],
    { cupon: { ...cupon, valor: 2 } },
    { productos }
  );
  assert.equal(tope2.ok, true);
  assert.equal(tope2.descuentoCupon, 4000);

  // 1 drip + 1 taza (producto simple) → no alcanza, faltan drip bags
  const conTaza = calcularPedido([{ presentacion: "u", qty: 1 }, { presentacion: "t", qty: 1 }], { cupon }, { productos });
  assert.equal(conTaza.ok, false);
  assert.match(conTaza.error, /2 drip bags/i);

  // 1 pack x5 + 1 drip suelta → el pack no entra en el 2x1 de individuales
  const conPack = calcularPedido([{ presentacion: "p", qty: 1 }, { presentacion: "u", qty: 1 }], { cupon }, { productos });
  assert.equal(conPack.ok, false);

  // En pedidos manuales también funciona igual
  const manual = calcularDescuentosManual(
    [
      { precioUnitario: 2000, qty: 1, unidades: 1, esPack: false, esDrip: true },
      { precioUnitario: 2500, qty: 1, unidades: 1, esPack: false, esDrip: true },
    ],
    { cupon }
  );
  assert.equal(manual.ok, true);
  assert.equal(manual.descuentoCupon, 2000);
  assert.equal(manual.total, 2500);
});

// ===== calcularPedido: puntos, envío y validaciones =====

test("el canje de puntos exige tener los puntos y un pedido que lo justifique", () => {
  const productos = catalogo();
  const sinPuntos = calcularPedido([{ presentacion: "t", qty: 1 }], { canjePuntos: true, puntosDisponibles: 0 }, { productos });
  assert.equal(sinPuntos.ok, false);

  const pedidoChico = calcularPedido([{ presentacion: "u", qty: 1 }], { canjePuntos: true, puntosDisponibles: 9999 }, { productos });
  assert.equal(pedidoChico.ok, false);

  const ok = calcularPedido([{ presentacion: "t", qty: 1 }], { canjePuntos: true, puntosDisponibles: 9999 }, { productos });
  assert.equal(ok.ok, true);
  assert.equal(ok.descuentoPuntos, CONFIG.fidelidad.canjeDescuento);
  assert.equal(ok.puntosCanjeados, CONFIG.fidelidad.canjePuntos);
});

test("los puntos se ganan sobre los productos, no sobre el envío", () => {
  const productos = catalogo();
  const sinEnvio = calcularPedido([{ presentacion: "t", qty: 1 }], {}, { productos });
  const conEnvio = calcularPedido([{ presentacion: "t", qty: 1 }], { envioCosto: 8000 }, { productos });
  assert.equal(conEnvio.total, sinEnvio.total + 8000);
  assert.equal(conEnvio.puntosGanados, sinEnvio.puntosGanados);
});

test("no se puede comprar más stock del que hay", () => {
  const r = calcularPedido([{ presentacion: "p", qty: 3 }], {}, { productos: catalogo({ stock: 10 }) });
  assert.equal(r.ok, false); // 3 packs = 15 unidades > 10 de stock
  assert.match(r.error, /[Ss]tock/);
});

test("un carrito vacío, sin cantidad o con una presentación inexistente no calcula", () => {
  assert.equal(calcularPedido([], {}, { productos: catalogo() }).ok, false);
  assert.equal(calcularPedido([{ presentacion: "u", qty: 0 }], {}, { productos: catalogo() }).ok, false);
  assert.equal(calcularPedido([{ presentacion: "u", qty: 100 }], {}, { productos: catalogo() }).ok, false);
  assert.equal(calcularPedido([{ presentacion: "noexiste", qty: 1 }], {}, { productos: catalogo() }).ok, false);
});

test("la cantidad se interpreta como entero: '3' vale 3 y 1,5 se trunca a 1", () => {
  const productos = catalogo();
  assert.equal(calcularPedido([{ presentacion: "u", qty: "3" }], {}, { productos }).lineas[0].qty, 3);
  // Truncar en vez de rechazar es inofensivo: se cobra la cantidad entera
  assert.equal(calcularPedido([{ presentacion: "u", qty: 1.5 }], {}, { productos }).lineas[0].qty, 1);
});

test("un producto inactivo no se puede comprar", () => {
  const r = calcularPedido([{ presentacion: "u", qty: 1 }], {}, { productos: catalogo({ activo: false }) });
  assert.equal(r.ok, false);
});

test("un carrito armado a mano con basura devuelve un error, no una excepción", () => {
  const productos = catalogo();
  // Lo que llega del navegador no es confiable: null, un texto, un número
  for (const basura of [[null], ["u"], [42], [{ qty: 1 }]]) {
    const r = calcularPedido(basura, {}, { productos });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  }
  const enorme = Array.from({ length: 500 }, () => ({ presentacion: "u", qty: 1 }));
  assert.equal(calcularPedido(enorme, {}, { productos: catalogo({ stock: 9999 }) }).ok, false);
});

test("ningún cupón descuenta más que el pedido, aunque esté mal cargado", () => {
  const pasado = { codigo: "ROTO", tipo: "porcentaje", valor: 150, minimo: 0, activo: true };
  const r = calcularPedido([{ presentacion: "u", qty: 1 }], { cupon: pasado }, { productos: catalogo() });
  assert.equal(r.descuentoCupon, r.subtotal);
  assert.equal(r.total, 0);

  const negativo = { codigo: "ROTO2", tipo: "monto", valor: -500, minimo: 0, activo: true };
  const r2 = calcularPedido([{ presentacion: "u", qty: 1 }], { cupon: negativo }, { productos: catalogo() });
  assert.equal(r2.descuentoCupon, 0); // un cupón nunca puede encarecer el pedido
});

test("los descuentos se aplican en orden: cantidad, cupón, puntos; el envío no se descuenta", () => {
  const cupon = { codigo: "MERLA10", tipo: "porcentaje", valor: 10, minimo: 0, activo: true };
  const r = calcularPedido(
    [{ presentacion: "u", qty: 5 }],
    { cupon, canjePuntos: true, puntosDisponibles: 9999, envioCosto: 3000 },
    { productos: catalogo() }
  );
  assert.equal(r.subtotal, 10000);
  assert.equal(r.descuentoCantidad, 500); // 5% de 10.000
  assert.equal(r.descuentoCupon, 950); // 10% de 9.500
  assert.equal(r.descuentoPuntos, CONFIG.fidelidad.canjeDescuento);
  assert.equal(r.total, 10000 - 500 - 950 - CONFIG.fidelidad.canjeDescuento + 3000);
  // los puntos se ganan sobre lo que efectivamente pagó por los productos
  assert.equal(r.puntosGanados, Math.floor((r.total - 3000) / 100));
});

test("unidad y pack del mismo café comparten stock", () => {
  // 1 pack (5) + 6 sueltas = 11 > 10 de stock
  const items = [{ presentacion: "p", qty: 1 }, { presentacion: "u", qty: 6 }];
  assert.equal(calcularPedido(items, {}, { productos: catalogo({ stock: 10 }) }).ok, false);
  assert.equal(calcularPedido(items, {}, { productos: catalogo({ stock: 11 }) }).ok, true);
});

// ===== Pedidos cargados a mano =====

const LINEAS_MANUAL = [{ precioUnitario: 2000, qty: 5, unidades: 5, esPack: false }];

test("en un pedido manual no se descuenta nada si el admin no lo pide", () => {
  const r = calcularDescuentosManual(LINEAS_MANUAL);
  assert.equal(r.total, 10000);
  assert.equal(r.descuentoCantidad + r.descuentoCupon + r.descuentoPago, 0);
});

test("en un pedido manual los descuentos van en orden: cantidad, cupón y transferencia", () => {
  const cupon = { codigo: "MERLA10", tipo: "porcentaje", valor: 10, minimo: 0 };
  const r = calcularDescuentosManual(LINEAS_MANUAL, { cupon, aplicarCantidad: true, aplicarTransferencia: true });
  assert.equal(r.descuentoCantidad, 500);
  assert.equal(r.descuentoCupon, 950);
  assert.equal(r.descuentoPago, 8550 - precioTransferencia(8550));
  assert.equal(r.total, precioTransferencia(8550));
});

test("un precio acordado con centavos da totales en pesos enteros", () => {
  // 83 × $1.166,67 = $96.833,61 → la línea vale $96.834
  const r = calcularDescuentosManual([{ precioUnitario: 1166.67, qty: 83, unidades: 83, esPack: false }], { aplicarCantidad: true });
  assert.equal(r.subtotal, 96834);
  assert.equal(r.descuentoCantidad, Math.round(96834 * CONFIG.descuentoPorcentaje / 100));
  assert.ok(Number.isInteger(r.total), "el total se guarda en una columna entera");
  // dos líneas: el subtotal es la suma de lo que se muestra por línea
  const dos = calcularDescuentosManual([
    { precioUnitario: 10.5, qty: 1, unidades: 1, esPack: false },
    { precioUnitario: 20.5, qty: 1, unidades: 1, esPack: false },
  ]);
  assert.equal(dos.subtotal, Math.round(10.5) + Math.round(20.5));
});

// ===== Comisión de Mercado Pago =====

const CFG_COMISION = {
  comisionMp: 5,
  comisionMpMetodos: { dinero: 0.97, debito: 1.08, credito: 5.32, prepaga: 0, cuotas_sin_tarjeta: 1.71 },
};

test("cada método paga su propia comisión", () => {
  assert.equal(comisionMpPorcentaje("credito", CFG_COMISION), 5.32);
  assert.equal(comisionMpDe({ origen: "mercadopago", total: 30000, mp_metodo: "credito" }, CFG_COMISION), 30000 * 5.32 / 100);
});

test("sin método, o con un método sin % cargado, se usa el promedio general", () => {
  assert.equal(comisionMpPorcentaje(null, CFG_COMISION), 5);
  assert.equal(comisionMpPorcentaje("otros", CFG_COMISION), 5);
  assert.equal(comisionMpPorcentaje("prepaga", CFG_COMISION), 5); // cargado en 0
});

test("los pedidos que no son de Mercado Pago no pagan comisión", () => {
  assert.equal(comisionMpDe({ origen: "whatsapp", total: 30000, mp_metodo: "credito" }, CFG_COMISION), 0);
});

test("sin comisiones configuradas no se descuenta nada", () => {
  assert.equal(comisionMpDe({ origen: "mercadopago", total: 30000, mp_metodo: "credito" }, {}), 0);
});
