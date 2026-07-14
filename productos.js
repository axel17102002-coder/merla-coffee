// ===== Datos de la tienda — ÚNICA fuente de verdad =====
// Este archivo lo usan tanto la web (app.js) como la función de pago de MODO
// (netlify/functions/modo-checkout.js). Editá TODO acá: precios, stock,
// packs, cupones y el programa de puntos.

// --- Descuento por cantidad (unidades sueltas) ---
const DESCUENTO_CANTIDAD = 5; // unidades sueltas mínimas para el descuento
const DESCUENTO_PORCENTAJE = 5; // % de descuento sobre las unidades sueltas

// --- Pack x5: se genera automáticamente para cada café ---
const PACK_X5 = {
  unidades: 5,
  descuento: 10, // % de descuento vs. comprar 5 unidades sueltas
};

// --- Cupones ---
// tipo: "porcentaje" (valor = %) o "monto" (valor = $ fijos)
// minimo: monto mínimo del pedido (después del descuento por cantidad)
// publico: true → se muestra en la sección "Cupones" de la web
const CUPONES = [
  {
    codigo: "BIENVENIDA10",
    tipo: "porcentaje",
    valor: 10,
    minimo: 0,
    publico: true,
    descripcion: "10% OFF en tu primer pedido",
  },
  {
    codigo: "CAFETERO",
    tipo: "monto",
    valor: 2000,
    minimo: 15000,
    publico: true,
    descripcion: "$2.000 OFF en pedidos desde $15.000",
  },
];

// --- Club Merla (fidelidad) ---
// Se suman puntos pagando online con MODO: puntosPorCien puntos por cada $100.
// Juntando canjePuntos puntos se canjean por canjeDescuento pesos de descuento
// (el pedido debe ser de al menos el doble del descuento).
const FIDELIDAD = {
  puntosPorCien: 1, // 1 punto por cada $100
  canjePuntos: 300, // puntos necesarios para canjear
  canjeDescuento: 1500, // $ de descuento al canjear
};

// --- Productos ---
// stock: drip bags disponibles (0 = agotado; un pack x5 descuenta 5)
const PRODUCTOS = [
  {
    id: "brasil-honey",
    nombre: "Brasil Honey Cup",
    precio: 1720,
    stock: 18,
    origen: "Brasil",
    region: "Alta Mogiana, Brasil",
    variedad: "Caturra",
    proceso: "Semi lavado",
    sca: "83,5",
    tostador: "Rito Tostadores",
    notas: ["Azúcar morena", "Almendras", "Frambuesas"],
    desc: "Un café brasileño de la región Alta Mogiana, cultivado entre 1000 y 1200 m y procesado mediante método semi lavado, que realza su dulzura natural. Proveniente de cooperativas locales, destaca por su cuerpo equilibrado. Una taza suave, dulce y persistente, perfecta para disfrutar en cualquier momento.",
    img: "img/brasil-honey.webp",
  },
  {
    id: "oldfashion",
    nombre: "Oldfashion",
    precio: 2360,
    stock: 24,
    origen: "Colombia",
    region: "Huila, Pitalito (Colombia)",
    variedad: "Bourbon y Caturra",
    proceso: "Lavado",
    sca: "84,5",
    tostador: "La Motofeca",
    notas: ["Especias", "Chocolate", "Pasas de uva"],
    desc: "Cultivado entre 1650 y 2100 m de altitud, destaca por su cuerpo medio, acidez equilibrada y una complejidad aromática que recuerda al clásico cóctel que le da nombre. Con una dulzura sutil y persistente, es un café redondo y aromático, ideal para quienes disfrutan de perfiles intensos y elegantes.",
    img: "img/oldfashion.webp",
  },
  {
    id: "peru",
    nombre: "Perú",
    precio: 2270,
    stock: 4,
    origen: "Perú",
    region: "Rodríguez de Mendoza, Perú",
    variedad: "Blend de variedades",
    proceso: "Lavado, secado en camas africanas",
    sca: null,
    tostador: "Jack Flash",
    notas: ["Naranja", "Toffee", "Avellanas"],
    desc: "Crece entre 1650 y 2100 m de altitud, donde el clima templado favorece una maduración lenta del grano. Ofrece una taza limpia y balanceada con acidez media melosa y un final dulce y persistente. Un café elegante y complejo, ideal para quienes disfrutan de matices cítricos y dulces.",
    img: "img/peru.webp",
  },
  {
    id: "volcanico",
    nombre: "Volcánico",
    precio: 2100,
    stock: 20,
    origen: "Colombia",
    region: "Tolima, Chaparral (Colombia)",
    variedad: "Caturra, Colombia y Castillo",
    proceso: "Lavado",
    sca: null,
    tostador: "Momo Tostadores",
    notas: ["Miel", "Toffee", "Frutas amarillas"],
    desc: "Cultivado entre 1500 y 2000 m de altitud, destaca por su buen cuerpo, una acidez media vibrante y un perfil que evoca el clásico café colombiano. Con un dulzor equilibrado y toques cítricos, es un café amable y balanceado, dulce, fresco y reconfortante.",
    img: "img/volcanico.webp",
  },
  {
    id: "brasil",
    nombre: "Brasil",
    precio: 2100,
    stock: 12,
    origen: "Brasil",
    region: "Espíritu Santo, Brasil",
    variedad: "Catuaí Amarillo y Rojo",
    proceso: "Natural",
    sca: "87",
    tostador: "Familia Cabrales",
    notas: ["Caramelo", "Frutos rojos", "Cítricos dulces"],
    desc: "Microlote cultivado entre 750 y 900 m de altitud por Wallace Junior Schneider. Su proceso natural potencia la dulzura y una acidez brillante y jugosa. Cuerpo medio y aroma intenso: ideal para quienes disfrutan de perfiles frutales y balanceados.",
    img: "img/brasil.webp",
  },
  {
    id: "silverio-nina",
    nombre: "Silverio Nina",
    precio: 2100,
    stock: 16,
    origen: "Bolivia",
    region: "Los Yungas, Bolivia",
    variedad: "Caturra",
    proceso: "Lavado",
    sca: null,
    tostador: "Momo Tostadores",
    notas: ["Caramelo", "Cítricos", "Ciruela"],
    desc: "Cultivado a más de 1550 m de altitud, destaca por su cuerpo agradable, una acidez refrescante y un perfil notablemente limpio, con un dulzor llamativo y persistente. Un café elegante y fresco, ideal para una taza frutal a cualquier hora del día.",
    img: "img/silverio-nina.webp",
  },
  {
    id: "andino",
    nombre: "Andino",
    precio: 2100,
    stock: 30,
    origen: "Colombia",
    region: "Quindío, Colombia",
    variedad: "Caturra, Colombia, Catimor y Castillo",
    proceso: "Lavado",
    sca: null,
    tostador: "Momo Tostadores",
    notas: ["Caramelo", "Frutos rojos", "Cítrico"],
    desc: "Cultivado entre 1500 y 2000 m de altitud, destaca por su buen cuerpo, acidez media vibrante y un perfil clásico irresistible, con una dulzura fresca y balanceada. Un café amable, ideal para quienes disfrutan de la elegancia de un tradicional café colombiano.",
    img: "img/andino.webp",
  },
];

// ===== Motor de precios =====
// Las mismas reglas corren en el navegador (para mostrar) y en el servidor
// (para cobrar): así nunca quedan desincronizadas.

function presentacionesDe(p) {
  const precioPack = Math.round((p.precio * PACK_X5.unidades * (100 - PACK_X5.descuento)) / 100);
  return [
    { id: "unidad", nombre: "Unidad", unidades: 1, precio: p.precio },
    { id: "pack5", nombre: `Pack x${PACK_X5.unidades}`, unidades: PACK_X5.unidades, precio: precioPack },
  ];
}

function buscarCupon(codigo) {
  if (!codigo) return null;
  return CUPONES.find((c) => c.codigo.toUpperCase() === String(codigo).trim().toUpperCase()) || null;
}

// items: [{ id, presentacion, qty }] — opciones: { cupon, canjePuntos }
// Devuelve { ok: true, lineas, subtotal, descuentos..., total, unidades, puntosGanados }
// o { ok: false, error }
function calcularPedido(items, opciones = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "El carrito está vacío" };
  }

  const lineas = [];
  const unidadesPorProducto = {};

  for (const it of items) {
    const p = PRODUCTOS.find((x) => x.id === it.id);
    const qty = Number.parseInt(it.qty, 10);
    if (!p) return { ok: false, error: `Producto inválido: ${it.id}` };
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      return { ok: false, error: `Cantidad inválida (${p.nombre})` };
    }
    const pres = presentacionesDe(p).find((x) => x.id === (it.presentacion || "unidad"));
    if (!pres) return { ok: false, error: `Presentación inválida (${p.nombre})` };

    unidadesPorProducto[p.id] = (unidadesPorProducto[p.id] || 0) + pres.unidades * qty;
    if (unidadesPorProducto[p.id] > p.stock) {
      return {
        ok: false,
        error:
          p.stock === 0
            ? `${p.nombre} está agotado`
            : `Stock insuficiente de ${p.nombre} (quedan ${p.stock} drip bags)`,
      };
    }

    lineas.push({
      id: p.id,
      nombre: p.nombre,
      presentacion: pres.id,
      presentacionNombre: pres.nombre,
      esPack: pres.unidades > 1,
      precioUnitario: pres.precio,
      qty,
      unidades: pres.unidades * qty,
      subtotal: pres.precio * qty,
    });
  }

  const subtotal = lineas.reduce((a, l) => a + l.subtotal, 0);
  const unidades = lineas.reduce((a, l) => a + l.unidades, 0);

  // Descuento por cantidad: solo sobre unidades sueltas (los packs ya tienen su descuento)
  const sueltas = lineas.filter((l) => !l.esPack);
  const unidadesSueltas = sueltas.reduce((a, l) => a + l.unidades, 0);
  const subtotalSueltas = sueltas.reduce((a, l) => a + l.subtotal, 0);
  const descuentoCantidad =
    unidadesSueltas >= DESCUENTO_CANTIDAD
      ? Math.round((subtotalSueltas * DESCUENTO_PORCENTAJE) / 100)
      : 0;

  // Cupón (sobre el subtotal ya descontado por cantidad)
  let descuentoCupon = 0;
  let cupon = null;
  if (opciones.cupon) {
    const c = buscarCupon(opciones.cupon);
    if (!c) return { ok: false, error: "Cupón inválido" };
    const base = subtotal - descuentoCantidad;
    if (base < (c.minimo || 0)) {
      return {
        ok: false,
        error: `El cupón ${c.codigo} es para pedidos desde $${c.minimo.toLocaleString("es-AR")}`,
      };
    }
    descuentoCupon =
      c.tipo === "porcentaje" ? Math.round((base * c.valor) / 100) : Math.min(c.valor, base);
    cupon = c.codigo;
  }

  // Canje de puntos Club Merla
  let descuentoPuntos = 0;
  if (opciones.canjePuntos) {
    const restante = subtotal - descuentoCantidad - descuentoCupon;
    if (restante < FIDELIDAD.canjeDescuento * 2) {
      return {
        ok: false,
        error: `Para canjear puntos el pedido debe superar $${(FIDELIDAD.canjeDescuento * 2).toLocaleString("es-AR")}`,
      };
    }
    descuentoPuntos = FIDELIDAD.canjeDescuento;
  }

  const total = subtotal - descuentoCantidad - descuentoCupon - descuentoPuntos;
  const puntosGanados = Math.floor(total / 100) * FIDELIDAD.puntosPorCien;

  return {
    ok: true,
    lineas,
    subtotal,
    unidades,
    unidadesSueltas,
    descuentoCantidad,
    descuentoCupon,
    cupon,
    descuentoPuntos,
    total,
    puntosGanados,
  };
}

// Export para Node (función serverless); en el browser quedan como globales.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PRODUCTOS,
    DESCUENTO_CANTIDAD,
    DESCUENTO_PORCENTAJE,
    PACK_X5,
    CUPONES,
    FIDELIDAD,
    presentacionesDe,
    buscarCupon,
    calcularPedido,
  };
}
