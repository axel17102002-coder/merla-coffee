// Cliente de la API MiCorreo (paq.ar) de Correo Argentino.
//
// Es el tercer proveedor de tarifas, y el que más barato viene dando: en la
// prueba que hicimos (La Plata → Córdoba, 4 kg) cotizó $7.025 contra $14.091
// de la opción más barata del agregador. Va directo al correo, sin margen de
// intermediario.
//
// Credenciales (sin ellas el proveedor queda apagado y el resto sigue igual):
//   PAQAR_USER_TOKEN / PAQAR_PASSWORD_TOKEN → Basic para pedir el JWT
//   PAQAR_CUSTOMER_ID                        → id de cliente del contrato
//   PAQAR_CP_ORIGEN                          → CP desde donde se despacha
//   PAQAR_AMBIENTE=test                      → apitest.correoargentino.com.ar
//
// OJO: las credenciales de TEST y las de PRODUCCIÓN son distintas y se piden
// por separado a Correo Argentino.

const { filtrarOpciones } = require("./transportistas.js");

const NOMBRE = "Correo Argentino";
const ESPERA_MAX_MS = 12000;

// D = a domicilio, S = a sucursal (así los llama la API)
const TIPO_POR_ENTREGA = { D: "domicilio", S: "sucursal" };

function base() {
  return String(process.env.PAQAR_AMBIENTE || "").toLowerCase() === "test"
    ? "https://apitest.correoargentino.com.ar/micorreo/v1"
    : "https://api.correoargentino.com.ar/micorreo/v1";
}

function credenciales() {
  const usuario = process.env.PAQAR_USER_TOKEN;
  const password = process.env.PAQAR_PASSWORD_TOKEN;
  const customerId = process.env.PAQAR_CUSTOMER_ID;
  const cpOrigen = process.env.PAQAR_CP_ORIGEN;
  if (!usuario || !password || !customerId || !cpOrigen) return null;
  return { usuario, password, customerId, cpOrigen };
}

function disponible() {
  return credenciales() !== null;
}

// El JWT se reusa mientras dure: pedir uno por cotización duplicaría la
// latencia de cada búsqueda de envío.
const TOKEN_MS = 50 * 60 * 1000;
let cacheToken = { valor: null, hasta: 0 };

async function token(cred, { forzar = false } = {}) {
  if (!forzar && cacheToken.valor && cacheToken.hasta > Date.now()) return cacheToken.valor;
  const auth = Buffer.from(`${cred.usuario}:${cred.password}`).toString("base64");
  const res = await fetch(`${base()}/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    signal: AbortSignal.timeout ? AbortSignal.timeout(ESPERA_MAX_MS) : undefined,
  });
  const data = await res.json().catch(() => null);
  const jwt = data && (data.token || data.access_token || data.jwt);
  if (!res.ok || !jwt) throw new Error(`token HTTP ${res.status}${jwt ? "" : " (sin token en la respuesta)"}`);
  cacheToken = { valor: jwt, hasta: Date.now() + TOKEN_MS };
  return jwt;
}

// Reintenta UNA vez si el JWT venció (401/403): entre dos cotizaciones pueden
// pasar horas y el cacheado deja de servir.
async function pedir(cred, ruta, opciones = {}) {
  const llamar = async (jwt) =>
    fetch(`${base()}${ruta}`, {
      ...opciones,
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(opciones.headers || {}),
      },
      body: opciones.body ? JSON.stringify(opciones.body) : undefined,
      signal: AbortSignal.timeout ? AbortSignal.timeout(ESPERA_MAX_MS) : undefined,
    });

  let res = await llamar(await token(cred));
  if (res.status === 401 || res.status === 403) res = await llamar(await token(cred, { forzar: true }));

  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const err = new Error("cotizacion_fallida");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Caja genérica, la misma que se usa con los otros proveedores.
const PAQUETE_CM = { height: 10, width: 20, length: 25 };

function cuerpoTarifa({ cred, cpDestino, pesoGramos }) {
  return {
    customerId: String(cred.customerId),
    postalCodeOrigin: String(cred.cpOrigen),
    postalCodeDestination: String(cpDestino || "").trim(),
    // Sin deliveredType pide las dos modalidades de una: una sola llamada
    dimensions: [{
      ...PAQUETE_CM,
      weight: Math.max(1, Math.round(Number(pesoGramos) || 0)), // en gramos
      quantity: 1,
    }],
  };
}

// Una tarifa de la respuesta → la forma que usa el carrito. Cada servicio
// (Clásico, Expreso, Hoy) es una opción propia: cambian precio y plazo.
function normalizarTarifa(r) {
  const precio = Math.round(Number(r.price));
  if (!Number.isFinite(precio) || precio <= 0) return null;
  const tipo = TIPO_POR_ENTREGA[r.deliveredType] || "domicilio";
  const producto = r.productType || r.productName || "estandar";
  const dias = [r.deliveryTimeMin, r.deliveryTimeMax].filter((d) => Number(d) > 0);
  return {
    clave: `paqar:${r.deliveredType}:${producto}`,
    grupo: `paqar:${r.deliveredType}:${producto}`,
    tipo,
    transportista: NOMBRE,
    // El nombre del servicio distingue dos filas del mismo correo que solo se
    // diferencian en precio y plazo ("PAQ.AR Clásico" vs "PAQ.AR Expreso")
    servicio: r.productName || producto,
    plazo: dias.length ? `${dias.join(" a ")} día${dias[dias.length - 1] > 1 ? "s" : ""} hábiles` : "",
    precio,
    sucursales: null, // se completan abajo solo para las de sucursal
  };
}

// Sucursales de Correo Argentino en la provincia del destino. La API las pide
// por código de provincia, no por nombre.
const CODIGOS_PROVINCIA = {
  "buenos aires": "B", "ciudad autonoma de buenos aires": "C", caba: "C", "capital federal": "C",
  catamarca: "K", chaco: "H", chubut: "U", cordoba: "X", corrientes: "W", "entre rios": "E",
  formosa: "P", jujuy: "Y", "la pampa": "L", "la rioja": "F", mendoza: "M", misiones: "N",
  neuquen: "Q", "rio negro": "R", salta: "A", "san juan": "J", "san luis": "D", "santa cruz": "Z",
  "santa fe": "S", "santiago del estero": "G", "tierra del fuego": "V", tucuman: "T",
};

function codigoProvincia(nombre) {
  const limpio = String(nombre || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // saca tildes
  return CODIGOS_PROVINCIA[limpio] || null;
}

async function sucursalesDe(cred, provincia, cpDestino) {
  const codigo = codigoProvincia(provincia);
  if (!codigo) return [];
  try {
    const data = await pedir(cred, `/agencies?provinceCode=${encodeURIComponent(codigo)}`);
    const lista = Array.isArray(data) ? data : data.agencies || data.data || [];
    // Primero las del mismo CP que el destino: son las que le quedan cerca
    const cp = String(cpDestino || "").trim();
    const cerca = lista.filter((a) => String(a.postalCode || "").trim() === cp);
    return (cerca.length ? cerca : lista).slice(0, 8).map((a) => ({
      id: String(a.code || a.id || ""),
      descripcion: a.name || a.description || "",
      direccion: [a.streetName || a.street, a.streetNumber].filter(Boolean).join(" "),
      localidad: [a.location || a.city, a.province].filter(Boolean).join(", "),
      cp: a.postalCode || "",
      horarios: a.hours || a.schedule || "",
    })).filter((s) => s.id);
  } catch (err) {
    console.warn("paqar: no pude traer sucursales:", err.message);
    return [];
  }
}

async function cotizarOpciones({ cp, ciudad, provincia, pesoGramos, valorDeclarado }) {
  const cred = credenciales();
  if (!cred) return { ok: false, error: "paq.ar no está configurado." };

  let data;
  try {
    data = await pedir(cred, "/rates", { method: "POST", body: cuerpoTarifa({ cred, cpDestino: cp, pesoGramos }) });
  } catch (err) {
    console.warn("paqar: cotización fallida:", err.status || "", err.message);
    return { ok: false, error: "paq.ar no cotizó para esa dirección." };
  }

  const opciones = (data.rates || []).map(normalizarTarifa).filter(Boolean);
  if (!opciones.length) return { ok: false, error: "paq.ar no tiene servicio para esa dirección." };

  // Las sucursales se piden una sola vez y se comparten entre las opciones a
  // sucursal: son las mismas para todos los servicios (Clásico, Expreso…).
  if (opciones.some((o) => o.tipo === "sucursal")) {
    const sucursales = await sucursalesDe(cred, provincia, cp);
    for (const o of opciones) if (o.tipo === "sucursal") o.sucursales = sucursales;
  }

  const habilitadas = await filtrarOpciones(opciones);
  if (!habilitadas.length) return { ok: false, error: "Correo Argentino está apagado en el panel." };
  return { ok: true, opciones: habilitadas.sort((a, b) => a.precio - b.precio) };
}

// Vuelve a cotizar y busca el grupo elegido: nunca se confía en el precio que
// mandó el navegador.
async function precioDeOpcion({ grupo, cp, ciudad, provincia, pesoGramos, valorDeclarado }) {
  const resultado = await cotizarOpciones({ cp, ciudad, provincia, pesoGramos, valorDeclarado });
  if (!resultado.ok) return resultado;
  const opcion = resultado.opciones.find((o) => o.grupo === grupo);
  if (!opcion) {
    return { ok: false, error: "Esa opción de envío ya no está disponible. Volvé a elegir en el carrito." };
  }
  return { ok: true, opcion };
}

module.exports = {
  disponible, cotizarOpciones, precioDeOpcion,
  normalizarTarifa, cuerpoTarifa, codigoProvincia, NOMBRE,
};
