// Cliente de la API de Andreani (cotización a domicilio y a sucursal).
//
// A diferencia de Zipnova, que es un agregador, acá vamos directo al
// transportista: la tarifa sale del contrato que Andreani te asigna, sin el
// margen del intermediario. Las opciones que devuelve se mezclan con las de
// Zipnova en el carrito (ver envio-costo.js), ordenadas por precio.
//
// Credenciales (todas hacen falta; sin ellas el proveedor queda apagado y el
// resto del envío sigue funcionando igual):
//   ANDREANI_USUARIO / ANDREANI_PASSWORD  → login (Basic) que devuelve el token
//   ANDREANI_CLIENTE                      → número de cliente del contrato
//   ANDREANI_CONTRATO_DOMICILIO           → contrato de entrega a domicilio
//   ANDREANI_CONTRATO_SUCURSAL            → contrato de entrega en sucursal
//   ANDREANI_SUCURSAL_ORIGEN              → sucursal desde donde se despacha
//   ANDREANI_AMBIENTE=qa                  → apunta a apisqa (por defecto, producción)
//
// Andreani usa UN CONTRATO DISTINTO por modalidad, así que cada uno se cotiza
// por separado: se puede tener solo domicilio, solo sucursal, o los dos.

const { filtrarOpciones } = require("./transportistas.js");

const NOMBRE = "Andreani";
const ESPERA_MAX_MS = 12000;

function ambiente() {
  return String(process.env.ANDREANI_AMBIENTE || "").toLowerCase() === "qa"
    ? "https://apisqa.andreani.com"
    : "https://apis.andreani.com";
}

function credenciales() {
  const usuario = process.env.ANDREANI_USUARIO;
  const password = process.env.ANDREANI_PASSWORD;
  const cliente = process.env.ANDREANI_CLIENTE;
  const sucursalOrigen = process.env.ANDREANI_SUCURSAL_ORIGEN;
  const contratos = {
    domicilio: process.env.ANDREANI_CONTRATO_DOMICILIO || "",
    sucursal: process.env.ANDREANI_CONTRATO_SUCURSAL || "",
  };
  if (!usuario || !password || !cliente || !sucursalOrigen) return null;
  if (!contratos.domicilio && !contratos.sucursal) return null;
  return { usuario, password, cliente, sucursalOrigen, contratos };
}

function disponible() {
  return credenciales() !== null;
}

// El token del login se reusa mientras dure: pedir uno por cotización sería
// duplicar la latencia de cada búsqueda de envío.
const TOKEN_MS = 50 * 60 * 1000;
let cacheToken = { valor: null, hasta: 0 };

async function token(cred, { forzar = false } = {}) {
  if (!forzar && cacheToken.valor && cacheToken.hasta > Date.now()) return cacheToken.valor;
  const auth = Buffer.from(`${cred.usuario}:${cred.password}`).toString("base64");
  const res = await fetch(`${ambiente()}/login`, {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout ? AbortSignal.timeout(ESPERA_MAX_MS) : undefined,
  });
  // El token viaja en el header de la respuesta, no en el cuerpo
  const nuevo = res.headers.get("x-authorization-token");
  if (!res.ok || !nuevo) {
    throw new Error(`login HTTP ${res.status}${nuevo ? "" : " (sin x-authorization-token)"}`);
  }
  cacheToken = { valor: nuevo, hasta: Date.now() + TOKEN_MS };
  return nuevo;
}

// Llama a la API reintentando UNA vez si el token venció (401/403): entre dos
// cotizaciones pueden pasar horas y el cacheado deja de servir.
async function pedir(cred, ruta) {
  let jwt = await token(cred);
  let res = await fetch(`${ambiente()}${ruta}`, {
    headers: { "x-authorization-token": jwt },
    signal: AbortSignal.timeout ? AbortSignal.timeout(ESPERA_MAX_MS) : undefined,
  });
  if (res.status === 401 || res.status === 403) {
    jwt = await token(cred, { forzar: true });
    res = await fetch(`${ambiente()}${ruta}`, {
      headers: { "x-authorization-token": jwt },
      signal: AbortSignal.timeout ? AbortSignal.timeout(ESPERA_MAX_MS) : undefined,
    });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const err = new Error("cotizacion_fallida");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Caja genérica, la misma que usamos con Zipnova: liviano y chico, entra
// cualquier combinación de drip bags, bolsas de 1/4 y alguna taza.
const PAQUETE_CM = { alto: 10, ancho: 20, largo: 25 };

function queryTarifa({ cred, contrato, cp, pesoGramos, valorDeclarado }) {
  const kilos = Math.max(0.1, (Number(pesoGramos) || 0) / 1000);
  const volumen = PAQUETE_CM.alto * PAQUETE_CM.ancho * PAQUETE_CM.largo; // cm³
  const p = new URLSearchParams({
    cpDestino: String(cp || "").trim(),
    contrato: String(contrato),
    cliente: String(cred.cliente),
    sucursalOrigen: String(cred.sucursalOrigen),
    "bultos[0][valorDeclarado]": String(Math.max(1, Math.round(Number(valorDeclarado) || 0))),
    "bultos[0][volumen]": String(volumen),
    "bultos[0][kilos]": String(kilos),
    "bultos[0][altoCm]": String(PAQUETE_CM.alto),
    "bultos[0][anchoCm]": String(PAQUETE_CM.ancho),
    "bultos[0][largoCm]": String(PAQUETE_CM.largo),
  });
  return `/v1/tarifas?${p.toString()}`;
}

// El precio que se le cobra al cliente es el que incluye IVA. Andreani lo
// devuelve como número o como string según el caso, de ahí el Number().
function precioDeTarifa(data) {
  const conIva = data && data.tarifaConIva && data.tarifaConIva.total;
  const sinIva = data && data.tarifaSinIva && data.tarifaSinIva.total;
  const valor = Number(conIva != null ? conIva : sinIva);
  return Number.isFinite(valor) && valor > 0 ? Math.round(valor) : null;
}

// Sucursales de Andreani cerca del destino, con la forma que espera el carrito.
// Si falla, la opción a sucursal igual se ofrece sin lista y el checkout la
// rechaza pidiendo elegir una: nunca se manda un paquete a una sucursal que el
// cliente no vio.
async function sucursalesDe(cred, ciudad) {
  try {
    const data = await pedir(cred, `/v2/sucursales?localidad=${encodeURIComponent(ciudad)}`);
    const lista = Array.isArray(data) ? data : data.sucursales || data.data || [];
    return lista.slice(0, 8).map((s) => {
      const dir = s.direccion || {};
      return {
        id: String(s.codigo || s.id || dir.codigoPostal || ""),
        descripcion: s.descripcion || s.nombre || "",
        direccion: [dir.calle, dir.numero].filter(Boolean).join(" "),
        localidad: [dir.localidad, dir.provincia].filter(Boolean).join(", "),
        cp: dir.codigoPostal || "",
      };
    }).filter((s) => s.id);
  } catch (err) {
    console.warn("andreani: no pude traer sucursales:", err.message);
    return [];
  }
}

// Una opción por contrato configurado (domicilio y/o sucursal), con la misma
// forma que las de Zipnova para que el carrito no distinga de dónde vienen.
// `grupo` lleva el prefijo del proveedor: es lo que usa el checkout para saber
// a quién volver a preguntarle el precio antes de cobrar.
async function cotizarOpciones({ cp, ciudad, provincia, pesoGramos, valorDeclarado }) {
  const cred = credenciales();
  if (!cred) return { ok: false, error: "Andreani no está configurado." };

  const pedidos = Object.entries(cred.contratos)
    .filter(([, contrato]) => contrato)
    .map(async ([tipo, contrato]) => {
      const data = await pedir(cred, queryTarifa({ cred, contrato, cp, pesoGramos, valorDeclarado }));
      const precio = precioDeTarifa(data);
      if (precio == null) return null;
      return {
        clave: `andreani:${tipo}`,
        grupo: `andreani:${tipo}`,
        tipo,
        transportista: NOMBRE,
        precio,
        sucursales: tipo === "sucursal" ? await sucursalesDe(cred, ciudad) : null,
      };
    });

  const resultados = await Promise.allSettled(pedidos);
  const opciones = [];
  for (const r of resultados) {
    if (r.status === "fulfilled" && r.value) opciones.push(r.value);
    else if (r.status === "rejected") {
      console.warn("andreani: cotización fallida:", r.reason && (r.reason.status || r.reason.message));
    }
  }
  if (!opciones.length) return { ok: false, error: "Andreani no cotizó para esa dirección." };

  const habilitadas = await filtrarOpciones(opciones);
  if (!habilitadas.length) return { ok: false, error: "Andreani está apagado en el panel." };
  return { ok: true, opciones: habilitadas.sort((a, b) => a.precio - b.precio) };
}

// Vuelve a cotizar y busca el grupo que eligió el cliente: nunca se confía en
// el precio que mandó el navegador.
async function precioDeOpcion({ grupo, cp, ciudad, provincia, pesoGramos, valorDeclarado }) {
  const resultado = await cotizarOpciones({ cp, ciudad, provincia, pesoGramos, valorDeclarado });
  if (!resultado.ok) return resultado;
  const opcion = resultado.opciones.find((o) => o.grupo === grupo);
  if (!opcion) {
    return { ok: false, error: "Esa opción de envío ya no está disponible. Volvé a elegir en el carrito." };
  }
  return { ok: true, opcion };
}

module.exports = { disponible, cotizarOpciones, precioDeOpcion, precioDeTarifa, queryTarifa, NOMBRE };
