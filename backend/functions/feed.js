// Feed de productos para Meta (Catálogo / Instagram Shopping) y Google Merchant
// Center (Google Shopping). Formato RSS 2.0 con el namespace g: de Google, que
// Meta también acepta, así una sola URL sirve para las dos plataformas.
//
// Se genera desde el catálogo activo en Supabase (mismos datos que la tienda).
// El dominio NO se hardcodea: sale de los headers, así funciona igual si algún
// día se cambia a un dominio propio.
//
//   GET /api/feed  → XML (application/xml)

const { obtenerCatalogo } = require("../lib/supabase.js");
const { presentacionesDe } = require("../../public/motor.js");

const MONEDA = "ARS";
// Categoría de Google (taxonomía oficial). Café = Food, Beverages & Tobacco…
const CATEGORIA_GOOGLE = "Food, Beverages & Tobacco > Beverages > Coffee";

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// URL base (https://host) desde los headers de la request, sin hardcodear nada
function baseUrl(event) {
  const h = event.headers || {};
  const host = h["x-forwarded-host"] || h.host || "merla-coffee.merlacoffee.workers.dev";
  const proto = h["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

// Las imágenes sembradas son relativas (img/andino.webp); las subidas desde el
// panel son URLs absolutas de Supabase. El feed necesita siempre absolutas.
function absolutizar(url, base) {
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `${base}/${String(url).replace(/^\//, "")}`;
}

function itemXml(p, base) {
  const pres = presentacionesDe(p);
  const unidad = pres.find((x) => x.unidades_stock === 1) || pres[0];
  if (!unidad) return ""; // sin presentación vendible, no va al feed
  const precio = `${Number(unidad.precio).toFixed(2)} ${MONEDA}`;
  const disponible = p.stock > 0 ? "in stock" : "out of stock";
  const imagen = absolutizar(p.imagen, base);
  const descripcion =
    p.descripcion ||
    (Array.isArray(p.notas) && p.notas.length ? `Notas: ${p.notas.join(", ")}.` : p.nombre);
  const link = `${base}/?producto=${encodeURIComponent(p.id)}`;
  const tipoProducto =
    p.tipo === "simple"
      ? p.categoria === "cafe_bolsa" ? "Café en bolsa" : "Accesorios"
      : "Drip bags";

  return `
    <item>
      <g:id>${esc(p.id)}</g:id>
      <title>${esc(p.nombre)}</title>
      <description>${esc(descripcion)}</description>
      <link>${esc(link)}</link>
      <g:image_link>${esc(imagen)}</g:image_link>
      <g:availability>${disponible}</g:availability>
      <g:price>${esc(precio)}</g:price>
      <g:condition>new</g:condition>
      <g:brand>Merla Coffee</g:brand>
      <g:identifier_exists>no</g:identifier_exists>
      <g:google_product_category>${esc(CATEGORIA_GOOGLE)}</g:google_product_category>
      <g:product_type>${esc(tipoProducto)}</g:product_type>
    </item>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Método no permitido" }) };
  }
  try {
    const base = baseUrl(event);
    const productos = await obtenerCatalogo();
    const items = productos.map((p) => itemXml(p, base)).filter(Boolean).join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Merla Coffee — Catálogo</title>
    <link>${esc(base)}/</link>
    <description>Café de especialidad en drip bags. Envíos a todo el país desde La Plata.</description>${items}
  </channel>
</rss>`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        // Los precios/stock no cambian a cada rato; media hora de caché alcanza
        "Cache-Control": "public, max-age=1800",
      },
      body: xml,
    };
  } catch (err) {
    console.error("feed:", err);
    return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "No se pudo generar el feed" }) };
  }
};
