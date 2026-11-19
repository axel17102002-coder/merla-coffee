// Resuelve las opciones de envío (local en La Plata, a domicilio y a sucursal)
// para un pedido.
//
// Cotiza en PARALELO contra todos los proveedores activos (local + correos con
// credenciales y prendidos en /admin), deduplica transportistas repetidos entre
// agregador y APIs directas, aplica envío gratis si corresponde y firma cada
// opción con un token HMAC (`cotizacionToken`, 20 min) para que el checkout no
// tenga que volver a consultar correos ni sufra sorpresas de precio.

const envioLocal = require("./envio-local.js");
const zipnova = require("./zipnova.js");
const andreani = require("./andreani.js");
const paqar = require("./paqar.js");
const { obtenerCostos } = require("./costos.js");
const { calcularPaquete, pesoProductosGramos } = require("./empaque.js");
const { firmarOpcion, verificarOpcion } = require("./cotizacion-firma.js");

// Cada proveedor expone la misma interfaz: disponible(), cotizarOpciones() y
// precioDeOpcion(). El `grupo` de cada opción arranca con el id del proveedor
// ("local:…", "andreani:…", "paqar:…"), que es como el checkout sabe a quién
// volver a preguntarle.
const PROVEEDORES = {
  local: envioLocal,
  zipnova,
  andreani,
  paqar,
};

// Prioridad al deduplicar el mismo transportista y modalidad entre proveedores:
// lo propio > API directa del correo > agregador.
const PRIORIDAD_PROVEEDOR = {
  local: 0,
  paqar: 1,
  andreani: 1,
  zipnova: 2,
};

// Zipnova es el proveedor histórico y sus grupos no llevan prefijo: un carrito
// abierto antes de este cambio manda un grupo viejo, y tiene que seguir
// funcionando.
function proveedorDe(grupo) {
  const id = String(grupo || "").split(":")[0];
  return PROVEEDORES[id] ? { id, mod: PROVEEDORES[id] } : { id: "zipnova", mod: zipnova };
}

// Un proveedor cotiza solo si tiene credenciales (o es local) Y está prendido
// en /admin → Gestión → Envío (`configuracion.envio_<proveedor>`).
function proveedorActivo(id, cfg) {
  const mod = PROVEEDORES[id];
  return !!mod && mod.disponible() && ((cfg && cfg.proveedoresEnvio) || {})[id] !== false;
}

function proveedoresActivos(cfg) {
  return Object.keys(PROVEEDORES).filter((id) => proveedorActivo(id, cfg));
}

// Normaliza el nombre del transportista para detectar duplicados entre un
// proveedor directo y el agregador ("Correo Argentino" vs "Correo Argentino S.A.").
function claveTransportista(nombre) {
  const n = String(nombre || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (n.includes("correo argentino")) return "correo argentino";
  if (n.includes("andreani")) return "andreani";
  if (n.includes("oca")) return "oca";
  return n;
}

// Si un correo directo (ej. paq.ar o Andreani) cotizó una modalidad para un
// transportista, descarta las opciones del agregador (Zipnova) para ese mismo
// transportista + modalidad. Así el cliente no ve Correo Argentino repetido al
// doble de precio, y si el directo se cae, Zipnova queda como respaldo.
function deduplicarOpciones(opciones) {
  const mejorPrioridad = new Map();
  for (const o of opciones || []) {
    const clave = `${claveTransportista(o.transportista)}|${o.tipo}`;
    const prio = PRIORIDAD_PROVEEDOR[o.proveedor] ?? 2;
    if (!mejorPrioridad.has(clave) || prio < mejorPrioridad.get(clave)) {
      mejorPrioridad.set(clave, prio);
    }
  }
  return (opciones || []).filter((o) => {
    const clave = `${claveTransportista(o.transportista)}|${o.tipo}`;
    const prio = PRIORIDAD_PROVEEDOR[o.proveedor] ?? 2;
    return prio === mejorPrioridad.get(clave);
  });
}

// Orden de presentación: envío local de La Plata primero (si aplica), y después
// de más barato a más caro.
function ordenarOpciones(opciones) {
  return [...(opciones || [])].sort((a, b) => {
    const al = a.local ? 0 : 1;
    const bl = b.local ? 0 : 1;
    if (al !== bl) return al - bl;
    return a.precio - b.precio;
  });
}

// Envío gratis cuando el subtotal del pedido supera el umbral configurado en
// /admin (`envio_gratis_desde`, 0 = apagado). Bonifica a $0 el envío local y la
// opción estándar más económica de cada modalidad (domicilio / sucursal).
function aplicarEnvioGratis(opciones, valorDeclarado, cfg) {
  const minimo = Number(cfg && cfg.envioGratisDesde) || 0;
  if (!(minimo > 0) || !(Number(valorDeclarado) >= minimo)) return opciones;

  const ordenadas = ordenarOpciones(opciones);
  const gratisPorTipo = new Set();
  return ordenadas.map((o) => {
    if (o.local || !gratisPorTipo.has(o.tipo)) {
      if (!o.local) gratisPorTipo.add(o.tipo);
      return { ...o, precioOriginal: o.precio, precio: 0, gratis: true };
    }
    return o;
  });
}

// Compatibilidad con tests / callers previos
function pesoTotalGramos(items, productos, cfg) {
  return pesoProductosGramos(items, productos, cfg);
}

// Todas las opciones de envío disponibles (local + correos a domicilio y a
// sucursal) para mostrar en el carrito antes de elegir.
//   destino: { cp, ciudad, provincia }
async function listarOpcionesEnvio(items, productos, destino, valorDeclarado) {
  if (!destino || !destino.cp || !destino.ciudad || !destino.provincia) {
    return { ok: false, error: "Ingresá tu código postal, ciudad y provincia" };
  }
  const { cfg } = await obtenerCostos();
  const paquete = calcularPaquete(items, productos, cfg);
  const activos = proveedoresActivos(cfg);
  if (!activos.length) {
    return { ok: false, error: "El envío no está disponible en este momento. Probá con retiro o escribinos por WhatsApp." };
  }

  const consulta = {
    cp: destino.cp,
    ciudad: destino.ciudad,
    provincia: destino.provincia,
    pesoGramos: paquete.pesoGramos,
    paquete,
    valorDeclarado,
    cfg,
  };
  const resultados = await Promise.allSettled(activos.map((id) => PROVEEDORES[id].cotizarOpciones(consulta)));

  // Un proveedor caído no puede dejar sin envío al cliente si otro contestó
  const crudas = [];
  const errores = [];
  resultados.forEach((r, i) => {
    const nombre = activos[i];
    if (r.status === "fulfilled" && r.value.ok) {
      for (const op of r.value.opciones || []) {
        crudas.push({ ...op, proveedor: op.proveedor || nombre });
      }
    } else {
      const motivo = r.status === "fulfilled" ? r.value.error : r.reason && r.reason.message;
      console.warn(`envio: ${nombre} no cotizó:`, motivo);
      errores.push(motivo);
    }
  });

  if (!crudas.length) {
    return { ok: false, error: errores[0] || "No hay opciones de envío disponibles para esa dirección." };
  }

  const opciones = aplicarEnvioGratis(deduplicarOpciones(crudas), valorDeclarado, cfg)
    .map((op) => {
      const cotizacionToken = firmarOpcion(op, { items, destino, pesoGramos: paquete.pesoGramos });
      return cotizacionToken ? { ...op, cotizacionToken } : op;
    });

  return { ok: true, opciones };
}

// envio: el objeto ya sanitizado por sanitizarEnvio() — { metodo:'envio', cp,
// ciudad, provincia, opcionGrupo, cotizacionToken?, ... }.
// Si trae un `cotizacionToken` vigente firmado por este servidor para el mismo
// carrito y destino, evita volver a llamar al correo al pagar (checkout rápido
// y precio exacto al que vio el cliente). Si venció o falta, recotiza en vivo.
async function resolverEnvioCosto(items, productos, envio, valorDeclarado) {
  if (!envio || envio.metodo !== "envio") return { ok: true, costo: 0 };
  if (!envio.cp || !envio.ciudad || !envio.provincia) {
    return { ok: false, error: "Ingresá tu ciudad, provincia y código postal para calcular el envío" };
  }
  if (!envio.opcionGrupo) {
    return { ok: false, error: "Elegí una opción de envío" };
  }

  const { cfg } = await obtenerCostos();
  const { id, mod } = proveedorDe(envio.opcionGrupo);
  // El carrito pudo quedar abierto desde antes de apagar ese proveedor
  if (!proveedorActivo(id, cfg)) {
    return { ok: false, error: "Esa opción de envío ya no está disponible. Volvé a elegir en el carrito." };
  }

  // Camino rápido: token firmado vigente (20 min) y sin cambios en carrito/destino
  if (envio.cotizacionToken) {
    const firmada = verificarOpcion(envio.cotizacionToken, {
      grupo: envio.opcionGrupo,
      items,
      destino: { cp: envio.cp, ciudad: envio.ciudad, provincia: envio.provincia },
    });
    if (firmada && firmada.proveedor === id) {
      return {
        ok: true,
        costo: firmada.opcion.precio,
        opcion: firmada.opcion,
        proveedor: id,
        pesoGramos: firmada.pesoGramos,
      };
    }
  }

  // Respaldo (token ausente o vencido): recotizamos contra el proveedor
  const paquete = calcularPaquete(items, productos, cfg);
  const resultado = await mod.precioDeOpcion({
    grupo: envio.opcionGrupo,
    cp: envio.cp,
    ciudad: envio.ciudad,
    provincia: envio.provincia,
    pesoGramos: paquete.pesoGramos,
    paquete,
    valorDeclarado,
    cfg,
  });
  if (!resultado.ok) return { ok: false, error: resultado.error };

  const opcionBase = { ...resultado.opcion, proveedor: resultado.opcion.proveedor || id };
  // Si hay envío gratis por monto y esta opción califica (local o la más barata),
  // respetamos la bonificación también al recotizar.
  const minimo = Number(cfg && cfg.envioGratisDesde) || 0;
  const opcion = minimo > 0 && Number(valorDeclarado) >= minimo && opcionBase.local
    ? { ...opcionBase, precioOriginal: opcionBase.precio, precio: 0, gratis: true }
    : opcionBase;

  return { ok: true, costo: opcion.precio, opcion, proveedor: id, pesoGramos: paquete.pesoGramos };
}

module.exports = {
  listarOpcionesEnvio,
  resolverEnvioCosto,
  pesoTotalGramos,
  proveedorDe,
  proveedorActivo,
  proveedoresActivos,
  deduplicarOpciones,
  aplicarEnvioGratis,
  ordenarOpciones,
};
