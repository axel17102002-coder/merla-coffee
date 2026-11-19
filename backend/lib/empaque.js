// Empaque y peso estimado de un pedido.
// Única fuente de verdad para las dimensiones y el peso que se mandan a los
// correos (Zipnova, Andreani, paq.ar). Antes cada proveedor repetía su propia
// caja fija y no sumaba el peso del embalaje.

// Cajas disponibles ordenadas de menor a mayor según peso total del pedido.
// Medidas en centímetros.
const CAJAS = [
  { nombre: "chica", hastaGramos: 600, alto: 10, ancho: 20, largo: 25 },
  { nombre: "mediana", hastaGramos: 1800, alto: 15, ancho: 25, largo: 30 },
  { nombre: "grande", hastaGramos: Infinity, alto: 20, ancho: 30, largo: 35 },
];

// Peso estimado de una línea del pedido según tipo/categoría de producto.
function pesoDeLinea(producto, presentacion, qty, cfg) {
  const pesoUnidad = producto.tipo === "simple"
    ? (producto.categoria === "cafe_bolsa" ? cfg.pesoCafeBolsaG : cfg.pesoMerchG)
    : cfg.pesoDripBagG;
  return pesoUnidad * presentacion.unidades_stock * qty;
}

// Peso total del contenido (solo productos, sin la caja).
function pesoProductosGramos(items, productos, cfg) {
  let total = 0;
  for (const it of items || []) {
    for (const p of productos) {
      const pres = (p.presentaciones || []).find((x) => x.id === it.presentacion);
      if (pres) {
        total += pesoDeLinea(p, pres, Number(it.qty) || 0, cfg);
        break;
      }
    }
  }
  return total;
}

// Calcula peso total (productos + tara de embalaje) y elige la caja acorde.
function calcularPaquete(items, productos, cfg) {
  const contenido = pesoProductosGramos(items, productos, cfg);
  const tara = contenido > 0 ? Math.max(0, Number(cfg && cfg.pesoCajaG) || 0) : 0;
  const pesoGramos = Math.max(1, Math.round(contenido + tara));
  const caja = CAJAS.find((c) => pesoGramos <= c.hastaGramos) || CAJAS[CAJAS.length - 1];
  return {
    pesoGramos,
    alto: caja.alto,
    ancho: caja.ancho,
    largo: caja.largo,
    caja: caja.nombre,
  };
}

module.exports = { CAJAS, pesoDeLinea, pesoProductosGramos, calcularPaquete };
