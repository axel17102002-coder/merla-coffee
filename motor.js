// ===== Motor de precios de Merla Coffee =====
// Reglas de negocio puras, compartidas entre el navegador (app.js) y las
// funciones de Netlify. Los DATOS (productos, stock, precios, cupones) ahora
// viven en Supabase; este motor solo calcula.

const CONFIG = {
  descuentoCantidad: 5, // unidades sueltas mínimas para el descuento
  descuentoPorcentaje: 5, // % de descuento sobre las unidades sueltas
  fidelidad: {
    puntosPorCien: 1, // 1 punto por cada $100 pagando con MODO
    canjePuntos: 300, // puntos necesarios para canjear
    canjeDescuento: 1500, // $ de descuento al canjear
  },
};

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
  module.exports = { CONFIG, presentacionesDe, ahorroDe, calcularPedido };
}
