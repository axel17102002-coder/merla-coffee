// Cliente mínimo de Supabase (REST/PostgREST) para las funciones de Netlify.
// Usa la SERVICE ROLE key: solo puede vivir en variables de entorno del
// servidor, nunca en el código del navegador.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sb(path, { method = "GET", body, headers = {} } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Faltan las variables SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (ver README)"
    );
  }
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${method} ${path}: HTTP ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// Llamada a una función SQL (RPC)
function sbRpc(nombre, args) {
  return sb(`rpc/${nombre}`, { method: "POST", body: args });
}

// Trae el catálogo completo: productos activos con sus presentaciones activas
async function obtenerCatalogo() {
  const productos = await sb(
    "productos?select=*,presentaciones(*)&activo=is.true&order=nombre.asc"
  );
  return productos.map((p) => ({
    ...p,
    notas: p.notas ? p.notas.split(";").map((n) => n.trim()).filter(Boolean) : [],
    presentaciones: (p.presentaciones || []).filter((x) => x.activo),
  }));
}

// Busca un cupón activo por código (solo letras, números, guiones)
async function obtenerCupon(codigo) {
  const limpio = String(codigo || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(limpio)) return null;
  const rows = await sb(`cupones?codigo=eq.${encodeURIComponent(limpio)}&activo=is.true`);
  return rows[0] || null;
}

// Puntos de un cliente por email (0 si no existe)
async function obtenerPuntos(email) {
  const limpio = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio)) return null;
  const rows = await sb(`clientes?select=puntos&email=eq.${encodeURIComponent(limpio)}`);
  return rows[0] ? rows[0].puntos : 0;
}

module.exports = { sb, sbRpc, obtenerCatalogo, obtenerCupon, obtenerPuntos };
