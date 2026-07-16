// ===== Motor de precios de Merla Coffee =====
// Reglas de negocio puras, compartidas entre el navegador (app.js, admin.js) y
// el backend. Los DATOS (productos, stock, precios, cupones) viven en Supabase;
// este motor solo calcula.
//
// OJO: este archivo se descarga al navegador. Acá van FÓRMULAS, nunca números
// sensibles (costos, márgenes): esos viajan en `cfg` desde la base y solo los
// recibe el panel de administración.

const CONFIG = {
  // Pasarelas de pago habilitadas. MODO queda implementado pero apagado:
  // para reactivarlo poné `modo: true` (y cargá las credenciales productivas).
  pagos: {
    mercadopago: true,
    modo: false,
  },
  descuentoCantidad: 5, // unidades sueltas mínimas para el descuento
  descuentoPorcentaje: 5, // % de descuento sobre las unidades sueltas
  transferencia: {
    descuento: 10, // % OFF pagando por transferencia o depósito (se coordina por WhatsApp)
  },
  drip: {
    gramosPorUnidad: 12, // gramos de café por drip bag (confirmado con el packaging)
  },
  pack: {
    unidades: 5, // drip bags que trae el pack
    descuento: 10, // % OFF del pack respecto de comprar las unidades sueltas
  },
  // OJO: los costos y el margen NO van acá. Este archivo se descarga al
  // navegador: cualquiera vería la estructura de costos. Viven en la base
  // (tablas `insumos` y `configuracion`) y los lee solo el panel de admin.
  fidelidad: {
    puntosPorCien: 1, // 1 punto por cada $100 pagando con MODO
    canjePuntos: 350, // puntos necesarios para canjear
    canjeDescuento: 1500, // $ de descuento al canjear
  },
};

// Precio pagando por transferencia/depósito (solo informativo: el cobro se
// coordina por WhatsApp; MODO cobra el precio de lista)
function precioTransferencia(monto) {
  return Math.round((monto * (100 - CONFIG.transferencia.descuento)) / 100);
}

// Número de pedido legible: 7 → "#0007"
function numeroPedido(n) {
  return "#" + String(n || 0).padStart(4, "0");
}

// ===== Cadena de precios desde el costo del café =====
// costo del kilo → costo del café por drip bag → + insumos → precio de venta.
//
// Todas reciben `cfg`, que trae los números sensibles desde la base:
//   { fijoUnidad, fijoPack, margenUnidad, gramosPorBag, packUnidades, packDescuento }
// Nunca se hardcodean acá: este archivo lo descarga el navegador.

const GRAMOS_KILO = 1000;

// Precio del pack a partir del precio de la unidad (el pack tiene su % OFF)
function precioPack(precioUnidad, cfg) {
  const unidades = (cfg && cfg.packUnidades) || CONFIG.pack.unidades;
  const off = cfg && cfg.packDescuento != null ? cfg.packDescuento : CONFIG.pack.descuento;
  return Math.round((precioUnidad * unidades * (100 - off)) / 100);
}

// Lo que cuesta el café que entra en una drip bag
function costoCafePorUnidad(costoKilo, cfg) {
  const gramos = (cfg && cfg.gramosPorBag) || CONFIG.drip.gramosPorUnidad;
  return ((Number(costoKilo) || 0) / GRAMOS_KILO) * gramos;
}

// Costo total de una drip bag (café + insumos)
function costoUnidad(costoKilo, cfg) {
  return costoCafePorUnidad(costoKilo, cfg) + ((cfg && cfg.fijoUnidad) || 0);
}

// Costo total de un pack (el café de todas sus bags + los insumos del pack)
function costoPack(costoKilo, cfg) {
  const unidades = (cfg && cfg.packUnidades) || CONFIG.pack.unidades;
  return costoCafePorUnidad(costoKilo, cfg) * unidades + ((cfg && cfg.fijoPack) || 0);
}

// Precio de venta de la unidad, aplicando el margen objetivo
function precioUnidadDesdeCosto(costoKilo, cfg) {
  const margen = (cfg && cfg.margenUnidad) || 0;
  return Math.round(costoUnidad(costoKilo, cfg) / (1 - margen / 100));
}

// Operación inversa: qué costo del kilo explica un precio de venta dado
function costoKiloDesdePrecio(precioUnidad, cfg) {
  const margen = (cfg && cfg.margenUnidad) || 0;
  const gramos = (cfg && cfg.gramosPorBag) || CONFIG.drip.gramosPorUnidad;
  const cafe = Number(precioUnidad) * (1 - margen / 100) - ((cfg && cfg.fijoUnidad) || 0);
  return Math.max(0, Math.round((cafe / gramos) * GRAMOS_KILO));
}

// % de margen real que queda en el pack con el precio calculado
function margenPack(costoKilo, precioDelPack, cfg) {
  if (!precioDelPack) return 0;
  return Math.round((1 - costoPack(costoKilo, cfg) / precioDelPack) * 100);
}

// % de margen real de la unidad con el precio que se fijó a mano (1 decimal).
// Sirve para ver el costo de "redondear" un precio feo ($2.202 → $2.200).
function margenUnidadReal(costoKilo, precioUnidad, cfg) {
  if (!precioUnidad) return 0;
  return Math.round((1 - costoUnidad(costoKilo, cfg) / precioUnidad) * 1000) / 10;
}

// Redondea a un múltiplo lindo (por defecto, de a $50): 2202 → 2200
function redondearPrecio(precio, multiplo = 50) {
  const m = Number(multiplo) > 0 ? Number(multiplo) : 50;
  return Math.round(Number(precio) / m) * m;
}

// Presentaciones activas de un producto (vienen embebidas desde la base)
function presentacionesDe(producto) {
  return (producto.presentaciones || [])
    .filter((x) => x.activo)
    .sort((a, b) => a.unidades_stock - b.unidades_stock);
}

// % de ahorro de una presentación multiunidad vs. comprar sueltas (para mostrar)
function ahorroDe(producto, pres) {
  if (pres.unidades_stock <= 1) return 0;
  const unidad = presentacionesDe(producto).find((x) => x.unidades_stock === 1);
  if (!unidad) return 0;
  return Math.round((1 - pres.precio / (unidad.precio * pres.unidades_stock)) * 100);
}

// Calcula un pedido completo.
//   items:    [{ presentacion: <id de presentación>, qty }]
//   opciones: { cupon: <objeto cupón o null>, canjePuntos: bool, puntosDisponibles: int|null }
//   datos:    { productos: [<producto con presentaciones>] }
// Devuelve { ok: true, ...desglose } o { ok: false, error }
function calcularPedido(items, opciones, datos) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "El carrito está vacío" };
  }

  const lineas = [];
  const unidadesPorProducto = {};

  for (const it of items) {
    let producto = null;
    let pres = null;
    for (const p of datos.productos) {
      const encontrada = (p.presentaciones || []).find((x) => x.id === it.presentacion);
      if (encontrada) {
        producto = p;
        pres = encontrada;
        break;
      }
    }
    if (!producto || !pres || !pres.activo || !producto.activo) {
      return { ok: false, error: `Producto no disponible: ${it.presentacion}` };
    }

    const qty = Number.parseInt(it.qty, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      return { ok: false, error: `Cantidad inválida (${producto.nombre})` };
    }

    const unidades = pres.unidades_stock * qty;
    unidadesPorProducto[producto.id] = (unidadesPorProducto[producto.id] || 0) + unidades;
    if (unidadesPorProducto[producto.id] > producto.stock) {
      return {
        ok: false,
        error:
          producto.stock === 0
            ? `${producto.nombre} está agotado`
            : `Stock insuficiente de ${producto.nombre} (quedan ${producto.stock} drip bags)`,
      };
    }

    lineas.push({
      producto_id: producto.id,
      presentacion_id: pres.id,
      nombre: producto.nombre,
      presentacionNombre: pres.nombre,
      esPack: pres.unidades_stock > 1,
      precioUnitario: pres.precio,
      qty,
      unidades,
      subtotal: pres.precio * qty,
    });
  }

  const subtotal = lineas.reduce((a, l) => a + l.subtotal, 0);
  const unidades = lineas.reduce((a, l) => a + l.unidades, 0);

  // Descuento por cantidad: solo unidades sueltas (los packs ya tienen su descuento)
  const sueltas = lineas.filter((l) => !l.esPack);
  const unidadesSueltas = sueltas.reduce((a, l) => a + l.unidades, 0);
  const subtotalSueltas = sueltas.reduce((a, l) => a + l.subtotal, 0);
  const descuentoCantidad =
    unidadesSueltas >= CONFIG.descuentoCantidad
      ? Math.round((subtotalSueltas * CONFIG.descuentoPorcentaje) / 100)
      : 0;

  // Cupón (objeto ya traído de la base; acá se validan mínimo y monto)
  let descuentoCupon = 0;
  let cupon = null;
  if (opciones.cupon) {
    const c = opciones.cupon;
    if (!c.activo) return { ok: false, error: "Cupón inválido" };
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
  let puntosCanjeados = 0;
  if (opciones.canjePuntos) {
    if (
      opciones.puntosDisponibles != null &&
      opciones.puntosDisponibles < CONFIG.fidelidad.canjePuntos
    ) {
      return { ok: false, error: "No tenés puntos suficientes para canjear" };
    }
    const restante = subtotal - descuentoCantidad - descuentoCupon;
    if (restante < CONFIG.fidelidad.canjeDescuento * 2) {
      return {
        ok: false,
        error: `Para canjear puntos el pedido debe superar $${(CONFIG.fidelidad.canjeDescuento * 2).toLocaleString("es-AR")}`,
      };
    }
    descuentoPuntos = CONFIG.fidelidad.canjeDescuento;
    puntosCanjeados = CONFIG.fidelidad.canjePuntos;
  }

  const total = subtotal - descuentoCantidad - descuentoCupon - descuentoPuntos;
  const puntosGanados = Math.floor(total / 100) * CONFIG.fidelidad.puntosPorCien;

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
    puntosCanjeados,
    total,
    puntosGanados,
  };
}

// Export para Node (funciones de Netlify); en el browser quedan como globales.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CONFIG, presentacionesDe, ahorroDe, precioTransferencia, numeroPedido, calcularPedido,
    precioPack, costoCafePorUnidad, costoUnidad, costoPack,
    precioUnidadDesdeCosto, costoKiloDesdePrecio, margenPack,
    margenUnidadReal, redondearPrecio,
  };
}
