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

test("el precio por transferencia aplica el descuento de CONFIG", () => {
  assert.equal(precioTransferencia(10000), 10000 * (100 - CONFIG.transferencia.descuento) / 100);
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
