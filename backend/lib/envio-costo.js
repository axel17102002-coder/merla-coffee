// Resuelve el costo real de envío a domicilio para un pedido, cotizando con
// Zipnova. Nunca se confía en un monto mandado por el navegador: esto lo
// llaman tanto el cotizador del carrito (informativo) como el checkout
// (donde el resultado se usa para el monto que se cobra de verdad).

const zipnova = require("./zipnova.js");
const { obtenerCostos } = require("./costos.js");

// Peso estimado de una línea del pedido, según qué tipo de producto es esa
// presentación: drip bag, café en bolsa de 1/4, o tazas/otros.
function pesoDeLinea(producto, presentacion, qty, cfg) {
  const pesoUnidad = producto.tipo === "simple"
    ? (producto.categoria === "cafe_bolsa" ? cfg.pesoCafeBolsaG : cfg.pesoMerchG)
    : cfg.pesoDripBagG;
  return pesoUnidad * presentacion.unidades_stock * qty;
}

// items: [{presentacion, qty}] del carrito · productos: catálogo con presentaciones embebidas
function pesoTotalGramos(items, productos, cfg) {
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

// envio: el objeto ya sanitizado por sanitizarEnvio() (o { metodo:'envio', cp }
// desde el cotizador). Si es retiro, no hay nada que cotizar.
async function resolverEnvioCosto(items, productos, envio, valorDeclarado) {
  if (!envio || envio.metodo !== "envio") return { ok: true, costo: 0 };
  if (!envio.cp) return { ok: false, error: "Ingresá tu código postal para calcular el envío" };

  const { cfg } = await obtenerCostos();
  const peso = pesoTotalGramos(items, productos, cfg);
  const resultado = await zipnova.cotizar({ cp: envio.cp, pesoGramos: peso, valorDeclarado });
  if (!resultado.ok) return { ok: false, error: resultado.error };
  return { ok: true, costo: resultado.precio };
}

module.exports = { resolverEnvioCosto, pesoTotalGramos };
