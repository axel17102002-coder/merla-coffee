// Proveedor de envío propio dentro de La Plata (cadetería local).
//
// Vive con la misma interfaz que los correos externos (zipnova, andreani,
// paqar) pero cotiza en 0 ms desde la configuración de Supabase: funciona
// incluso si las APIs externas están caídas o apagadas.

const NOMBRE = "Envío en La Plata";
const GRUPO = "local:laplata";

// Códigos postales del partido de La Plata alcanzados por la cadetería local:
//   1900 = La Plata casco · 1901 = Tolosa / Ringuelet · 1902 = Gonnet / Gorina
//   1904 = City Bell · 1906 = Villa Elisa · 1908 = Los Hornos / San Carlos
const CPS_LA_PLATA = new Set(["1900", "1901", "1902", "1904", "1906", "1908"]);

// Extrae los 4 dígitos del código postal argentino: "B1900ABC" → "1900".
function normalizarCp(cp) {
  const match = String(cp || "").match(/\d{4}/);
  return match ? match[0] : "";
}

function esBuenosAires(provincia) {
  const limpia = String(provincia || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return !limpia || limpia === "buenos aires" || limpia === "bs as" || limpia === "bs. as.";
}

function cubreDestino({ cp, provincia }) {
  return CPS_LA_PLATA.has(normalizarCp(cp)) && esBuenosAires(provincia);
}

// Siempre disponible (no depende de secretos externos); se prende o apaga desde
// /admin → Ajustes → Envío (`configuracion.envio_local`).
function disponible() {
  return true;
}

function opcionLocal(cfg) {
  const precio = Math.max(0, Math.round(Number(cfg && cfg.envioLocalPrecio != null ? cfg.envioLocalPrecio : 1500)));
  return {
    clave: GRUPO,
    grupo: GRUPO,
    proveedor: "local",
    tipo: "domicilio",
    transportista: NOMBRE,
    servicio: "Cadetería propia",
    plazo: "24 a 48 hs hábiles",
    precio,
    local: true,
    sucursales: null,
  };
}

async function cotizarOpciones({ cp, provincia, cfg }) {
  if (!cubreDestino({ cp, provincia })) {
    return { ok: true, opciones: [] };
  }
  return { ok: true, opciones: [opcionLocal(cfg)] };
}

async function precioDeOpcion({ grupo, cp, provincia, cfg }) {
  if (grupo !== GRUPO || !cubreDestino({ cp, provincia })) {
    return { ok: false, error: "El envío local solo aplica a códigos postales de La Plata." };
  }
  return { ok: true, opcion: opcionLocal(cfg) };
}

module.exports = {
  NOMBRE, GRUPO, CPS_LA_PLATA,
  disponible, normalizarCp, cubreDestino, cotizarOpciones, precioDeOpcion,
};
