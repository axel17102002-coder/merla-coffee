// Resuelve las opciones de envío (a domicilio y a sucursal) para un pedido,
// cotizando con Zipnova. Nunca se confía en un monto mandado por el
// navegador: el checkout vuelve a cotizar y busca la opción elegida antes
// de cobrar.

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

// Todas las opciones de envío (a domicilio y a sucursal, de todos los
// transportistas) para mostrar en el carrito antes de elegir.
//   destino: { cp, ciudad, provincia }
async function listarOpcionesEnvio(items, productos, destino, valorDeclarado) {
  if (!destino || !destino.cp || !destino.ciudad || !destino.provincia) {
    return { ok: false, error: "Ingresá tu código postal, ciudad y provincia" };
  }
  const { cfg } = await obtenerCostos();
  const peso = pesoTotalGramos(items, productos, cfg);
  return zipnova.cotizarOpciones({
    cp: destino.cp, ciudad: destino.ciudad, provincia: destino.provincia,
    pesoGramos: peso, valorDeclarado,
  });
}

// envio: el objeto ya sanitizado por sanitizarEnvio() — { metodo:'envio', cp,
// ciudad, provincia, opcionGrupo, ... }. Si es retiro, no hay nada que cotizar.
// Vuelve a cotizar y busca, dentro de ese grupo (carrier+servicio), la
// opción más barata disponible ahora: nunca se confía en el precio que
// mandó el navegador.
async function resolverEnvioCosto(items, productos, envio, valorDeclarado) {
  if (!envio || envio.metodo !== "envio") return { ok: true, costo: 0 };
  if (!envio.cp || !envio.ciudad || !envio.provincia) {
    return { ok: false, error: "Ingresá tu ciudad, provincia y código postal para calcular el envío" };
  }
  if (!envio.opcionGrupo) {
    return { ok: false, error: "Elegí una opción de envío" };
  }

  const { cfg } = await obtenerCostos();
  const peso = pesoTotalGramos(items, productos, cfg);
  const resultado = await zipnova.precioDeOpcion({
    grupo: envio.opcionGrupo,
    cp: envio.cp, ciudad: envio.ciudad, provincia: envio.provincia,
    pesoGramos: peso, valorDeclarado,
  });
  if (!resultado.ok) return { ok: false, error: resultado.error };
  return { ok: true, costo: resultado.opcion.precio, opcion: resultado.opcion };
}

module.exports = { listarOpcionesEnvio, resolverEnvioCosto, pesoTotalGramos };
