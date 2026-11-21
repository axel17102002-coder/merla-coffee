// Andreani con tarifa propia: el envío se despacha a mano en Andreani (sin API
// ni contrato) y se le cobra al cliente según una tabla que se edita en
// /admin → Gestión → Envío.
//
// Andreani cobra por zonas fijas según la provincia de destino y por tamaño de
// caja (hasta 600 g da lo mismo el peso: manda el volumen). La tabla replica
// eso: 4 zonas × 3 cajas (chica / mediana / grande, las de empaque.js) × a
// sucursal / a domicilio. Los valores de respaldo salen del cotizador público
// de andreani.com (origen La Plata, noviembre 2026).
//
// A sucursal no hay lista oficial (eso también pide la API): el cliente escribe
// en qué sucursal lo retira, y se despacha ahí.

const { filtrarOpciones } = require("./transportistas.js");

const NOMBRE = "Andreani";
const ZONAS = ["z1", "z2", "z3", "z4"];
const CAJAS = ["chica", "mediana", "grande"];
const TIPOS = ["sucursal", "domicilio"];

const NOMBRES_ZONA = {
  z1: "AMBA (CABA y Gran Buenos Aires)",
  z2: "Centro (resto de Buenos Aires, Córdoba, Santa Fe, Entre Ríos, La Pampa)",
  z3: "Cuyo, NOA, NEA y norte de la Patagonia",
  z4: "Lejana (Salta, Jujuy, Chubut, Santa Cruz, Tierra del Fuego)",
};

const PLAZOS = {
  z1: "2 a 4 días hábiles",
  z2: "3 a 6 días hábiles",
  z3: "4 a 7 días hábiles",
  z4: "5 a 9 días hábiles",
};

// Tarifa de respaldo (pesos, IVA incluido)
const TARIFAS_RESPALDO = {
  z1: { chica: { sucursal: 8740, domicilio: 12343 }, mediana: { sucursal: 10037, domicilio: 15756 }, grande: { sucursal: 15976, domicilio: 19879 } },
  z2: { chica: { sucursal: 11450, domicilio: 13890 }, mediana: { sucursal: 17534, domicilio: 20288 }, grande: { sucursal: 26375, domicilio: 27516 } },
  z3: { chica: { sucursal: 12441, domicilio: 15141 }, mediana: { sucursal: 21045, domicilio: 23771 }, grande: { sucursal: 31353, domicilio: 33650 } },
  z4: { chica: { sucursal: 13736, domicilio: 15965 }, mediana: { sucursal: 23949, domicilio: 25670 }, grande: { sucursal: 37627, domicilio: 40325 } },
};

// Clave de `configuracion` de cada celda: tarifa_z1_chica_sucursal, …
const claveTarifa = (zona, caja, tipo) => `tarifa_${zona}_${caja}_${tipo}`;
const CLAVES_TARIFA = [];
for (const z of ZONAS) for (const c of CAJAS) for (const t of TIPOS) CLAVES_TARIFA.push(claveTarifa(z, c, t));

function sinAcentos(v) {
  return String(v || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const ZONA_PROVINCIA = {
  "cordoba": "z2", "santa fe": "z2", "entre rios": "z2", "la pampa": "z2",
  "mendoza": "z3", "san juan": "z3", "san luis": "z3", "neuquen": "z3", "rio negro": "z3",
  "tucuman": "z3", "santiago del estero": "z3", "catamarca": "z3", "la rioja": "z3",
  "chaco": "z3", "corrientes": "z3", "misiones": "z3", "formosa": "z3",
  "salta": "z4", "jujuy": "z4", "chubut": "z4", "santa cruz": "z4",
  "tierra del fuego": "z4",
};

// AMBA según Andreani: CABA y los CP del conurbano (1000 a 1999; La Plata,
// Berisso y Ensenada incluidos). El resto de la provincia es zona Centro.
function zonaDe({ cp, provincia }) {
  const p = sinAcentos(provincia);
  if (!p) return null;
  if (p.includes("autonoma") || p === "caba" || p === "capital federal") return "z1";
  if (p.startsWith("tierra del fuego")) return "z4";
  if (p === "buenos aires" || p === "bs as" || p === "bs. as.") {
    const m = String(cp || "").match(/\d{4}/);
    const n = m ? Number(m[0]) : 0;
    return n >= 1000 && n <= 1999 ? "z1" : "z2";
  }
  return ZONA_PROVINCIA[p] || null;
}

function tarifas(cfg) {
  return (cfg && cfg.tarifasAndreani) || TARIFAS_RESPALDO;
}

// Siempre disponible (no depende de secretos); se prende o apaga desde
// /admin → Gestión → Envío (`configuracion.envio_tabla`).
function disponible() {
  return true;
}

function armarOpcion(zona, caja, tipo, cfg) {
  const precio = Math.round(Number(((tarifas(cfg)[zona] || {})[caja] || {})[tipo]) || 0);
  if (!(precio > 0)) return null;
  const grupo = `tabla:andreani:${tipo}`;
  return {
    clave: grupo,
    grupo,
    proveedor: "tabla",
    tipo,
    transportista: NOMBRE,
    servicio: tipo === "sucursal" ? "Estándar a sucursal" : "Estándar a domicilio",
    plazo: PLAZOS[zona],
    precio,
    sucursales: null,
    // Sin lista oficial: el cliente escribe en qué sucursal lo retira
    sucursalLibre: tipo === "sucursal" ? true : undefined,
  };
}

function opcionesPara({ cp, provincia, paquete, cfg }) {
  const zona = zonaDe({ cp, provincia });
  if (!zona) return [];
  const caja = CAJAS.includes(paquete && paquete.caja) ? paquete.caja : "chica";
  return TIPOS.map((tipo) => armarOpcion(zona, caja, tipo, cfg)).filter(Boolean);
}

async function cotizarOpciones(consulta) {
  const opciones = opcionesPara(consulta);
  if (!opciones.length) return { ok: true, opciones: [] };
  return { ok: true, opciones: await filtrarOpciones(opciones) };
}

async function precioDeOpcion(consulta) {
  const opcion = opcionesPara(consulta).find((o) => o.grupo === consulta.grupo);
  if (!opcion) return { ok: false, error: "Esa opción de envío ya no está disponible. Volvé a elegir en el carrito." };
  return { ok: true, opcion };
}

module.exports = {
  NOMBRE, ZONAS, CAJAS, TIPOS, NOMBRES_ZONA, TARIFAS_RESPALDO, CLAVES_TARIFA,
  claveTarifa, zonaDe, disponible, cotizarOpciones, precioDeOpcion,
};
