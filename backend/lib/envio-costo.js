// Resuelve las opciones de envío (a domicilio y a sucursal) para un pedido.
// Cotiza en PARALELO contra todos los proveedores configurados y devuelve una
// sola lista ordenada por precio: al cliente le da igual de dónde salga la
// tarifa. Nunca se confía en un monto mandado por el navegador: el checkout
// vuelve a cotizar y busca la opción elegida antes de cobrar.

const zipnova = require("./zipnova.js");
const andreani = require("./andreani.js");
const { obtenerCostos } = require("./costos.js");

// Cada proveedor expone la misma interfaz: disponible(), cotizarOpciones() y
// precioDeOpcion(). El `grupo` de cada opción arranca con el id del proveedor
// ("andreani:…"), que es como el checkout sabe a quién volver a preguntarle.
const PROVEEDORES = {
  zipnova,
  andreani,
};

// Zipnova es el proveedor histórico y sus grupos no llevan prefijo: un carrito
// abierto antes de este cambio manda un grupo viejo, y tiene que seguir
// funcionando.
function proveedorDe(grupo) {
  const id = String(grupo || "").split(":")[0];
  return PROVEEDORES[id] ? { id, mod: PROVEEDORES[id] } : { id: "zipnova", mod: zipnova };
}

function proveedoresActivos() {
  return Object.entries(PROVEEDORES).filter(([, mod]) => mod.disponible());
}

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
  const activos = proveedoresActivos();
  if (!activos.length) {
    return { ok: false, error: "El envío no está disponible en este momento. Probá con retiro o escribinos por WhatsApp." };
  }

  const consulta = { cp: destino.cp, ciudad: destino.ciudad, provincia: destino.provincia, pesoGramos: peso, valorDeclarado };
  const resultados = await Promise.allSettled(activos.map(([, mod]) => mod.cotizarOpciones(consulta)));

  // Un proveedor caído no puede dejar sin envío al cliente si el otro contestó
  const opciones = [];
  const errores = [];
  resultados.forEach((r, i) => {
    const nombre = activos[i][0];
    if (r.status === "fulfilled" && r.value.ok) opciones.push(...r.value.opciones);
    else {
      const motivo = r.status === "fulfilled" ? r.value.error : r.reason && r.reason.message;
      console.warn(`envio: ${nombre} no cotizó:`, motivo);
      errores.push(motivo);
    }
  });

  if (!opciones.length) {
    return { ok: false, error: errores[0] || "No hay opciones de envío disponibles para esa dirección." };
  }
  return { ok: true, opciones: opciones.sort((a, b) => a.precio - b.precio) };
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
  // Se le vuelve a preguntar al MISMO proveedor que dio la opción elegida
  const { mod } = proveedorDe(envio.opcionGrupo);
  const resultado = await mod.precioDeOpcion({
    grupo: envio.opcionGrupo,
    cp: envio.cp, ciudad: envio.ciudad, provincia: envio.provincia,
    pesoGramos: peso, valorDeclarado,
  });
  if (!resultado.ok) return { ok: false, error: resultado.error };
  return { ok: true, costo: resultado.opcion.precio, opcion: resultado.opcion };
}

module.exports = { listarOpcionesEnvio, resolverEnvioCosto, pesoTotalGramos, proveedorDe };
