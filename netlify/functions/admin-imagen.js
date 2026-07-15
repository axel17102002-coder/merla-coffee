// Sube la foto de un producto a Supabase Storage (bucket público "productos").
// La imagen llega en base64 (data URL) porque el body de las funciones se lee
// como texto: para archivos chicos como estos es lo más simple y seguro.
//
//   POST { nombre, dataUrl } → { url }

const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");

const BUCKET = "productos";
const TIPOS = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "image/avif": "avif" };
const MAX_BYTES = 5 * 1024 * 1024;

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Falta la configuración de Supabase" }) };
  }

  try {
    const { nombre, dataUrl } = JSON.parse(event.body || "{}");
    const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ""));
    if (!m) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Imagen inválida" }) };
    }
    const tipo = m[1];
    const ext = TIPOS[tipo];
    if (!ext) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Formato no permitido (usá webp, jpg, png o avif)" }) };
    }

    // base64 → bytes
    const binario = atob(m[2]);
    if (binario.length > MAX_BYTES) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "La imagen supera los 5 MB" }) };
    }
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);

    // Nombre de archivo seguro y único
    const base = String(nombre || "producto")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "producto";
    const archivo = `${base}-${Date.now()}.${ext}`;

    const base_url = SUPABASE_URL.replace(/\/$/, "");
    const res = await fetch(`${base_url}/storage/v1/object/${BUCKET}/${archivo}`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": tipo, "x-upsert": "true" },
      body: bytes,
    });
    if (!res.ok) {
      const detalle = (await res.text()).slice(0, 200);
      console.error("admin-imagen: storage", res.status, detalle);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "No se pudo subir la imagen" }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: `${base_url}/storage/v1/object/public/${BUCKET}/${archivo}` }),
    };
  } catch (err) {
    console.error("admin-imagen:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No se pudo subir la imagen" }) };
  }
};
