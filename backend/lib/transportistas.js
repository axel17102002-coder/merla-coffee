// Qué transportistas ve el cliente, se prendan desde /admin → Precios → Envío
// (tabla `transportistas`). Vive aparte de cada proveedor porque el interruptor
// es uno solo: da igual si la tarifa la trae Zipnova o si la pedimos directo a
// la API de Andreani, si el transportista está apagado no se muestra.
//
// Si la tabla todavía no existe (migración sin correr) o la consulta falla, se
// usa la lista de respaldo: los tres que se mostraban desde siempre.

const { sb } = require("./supabase.js");

const RESPALDO_PERMITIDOS = ["andreani", "correo argentino", "oca"];

// La lista se cachea en memoria: una cotización no puede pagar una consulta
// extra a la base, y esto cambia una vez cada varios meses.
const CACHE_MS = 5 * 60 * 1000;
let cache = { hasta: 0, activos: null, conocidos: new Set() };

async function estado() {
  if (cache.activos && cache.hasta > Date.now()) return cache;
  try {
    const filas = await sb("transportistas?select=nombre,activo");
    cache = {
      hasta: Date.now() + CACHE_MS,
      activos: filas.filter((t) => t.activo).map((t) => t.nombre.toLowerCase()),
      conocidos: new Set(filas.map((t) => t.nombre.toLowerCase())),
    };
  } catch (err) {
    console.warn("transportistas: sin tabla (correr migracion-transportistas.sql):", err.message);
    cache = { hasta: Date.now() + CACHE_MS, activos: RESPALDO_PERMITIDOS, conocidos: new Set(RESPALDO_PERMITIDOS) };
  }
  return cache;
}

// Comparación por substring y sin distinguir mayúsculas, para tolerar variantes
// del mismo nombre ("Correo Argentino S.A.").
function permitido(nombre, activos) {
  const n = (nombre || "").toLowerCase();
  return (activos || []).some((t) => n.includes(t) || t.includes(n));
}

// Un transportista que aparece por primera vez se guarda APAGADO: queda listo
// en el panel para prenderlo, pero nunca se muestra solo en la tienda. Es
// "best effort" y no frena la cotización.
async function fichar(nombres, conocidos) {
  const nuevos = [...new Set((nombres || []).filter((n) => n && !conocidos.has(n.toLowerCase())))];
  if (!nuevos.length) return;
  try {
    await sb("transportistas", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: nuevos.map((nombre) => ({ nombre, activo: false, visto: new Date().toISOString() })),
    });
    for (const n of nuevos) conocidos.add(n.toLowerCase());
    console.log("transportistas: nuevos fichados (apagados):", nuevos.join(", "));
  } catch (err) {
    console.warn("transportistas: no pude fichar los nuevos:", err.message);
  }
}

// Filtra una lista de opciones ya normalizadas ({ transportista, ... }) dejando
// solo las de transportistas prendidos, y ficha los que no conocíamos.
async function filtrarOpciones(opciones) {
  const { activos, conocidos } = await estado();
  fichar(opciones.map((o) => o.transportista), conocidos); // sin await: no cambia esta respuesta
  return opciones.filter((o) => permitido(o.transportista, activos));
}

module.exports = { estado, permitido, fichar, filtrarOpciones, RESPALDO_PERMITIDOS };
