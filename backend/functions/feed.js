// Feed de productos para Meta (Catálogo / Instagram Shopping) y Google Merchant
// Center (Google Shopping). Formato RSS 2.0 con el namespace g: de Google, que
// Meta también acepta, así una sola URL sirve para las dos plataformas.
//
// Se genera desde el catálogo activo en Supabase (mismos datos que la tienda).
// Cada <link> apunta a /?producto=<id>, que el Worker sirve con el título, el
// precio y el stock de ese producto en el HTML (backend/lib/pagina.js): es lo
// que Google y Meta comparan contra el feed para aprobar el producto.
//
//   GET /api/feed  → XML (application/xml)

const { obtenerCatalogo } = require("../lib/supabase.js");
const { presentacionesDe } = require("../../public/motor.js");
const { DOMINIO, ALIAS } = require("../lib/dominio.js");

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

// URL base (https://host) desde los headers de la request. Si el feed se pide
// por www o por workers.dev, los links igual salen con el dominio principal:
// Meta y Google tienen que ver una sola dirección por producto.
function baseUrl(event) {
  const h = event.headers || {};
  const host = h["x-forwarded-host"] || h.host || DOMINIO;
  if (ALIAS.includes(host)) return `https://${DOMINIO}`;
  const proto = h["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

// Las imágenes sembradas son relativas (img/andino.webp); las subidas desde el
// panel son URLs absolutas de Supabase. El feed necesita siempre absolutas.
//
// Las relativas en WebP se mandan en su copia JPG (public/img/<nombre>_web.jpg):
// Google acepta WebP, pero el catálogo de Meta no lo toma de forma confiable.
// Las subidas desde el panel van tal cual: conviene subirlas en JPG o PNG.
function absolutizar(url, base) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const relativa = String(url).replace(/^\//, "").replace(/^(img\/[^/?#]+)\.webp$/i, "$1_web.jpg");
  return `${base}/${relativa}`;
}

// Título para el catálogo: el nombre solo ("Andino") no dice qué se vende, y
// los buscadores de Google Shopping y de Meta se guían por el título.
function tituloFeed(p) {
  if (p.tipo === "simple") return p.nombre;
  return `${p.nombre} · Café de especialidad${p.origen ? ` de ${p.origen}` : ""} en drip bag`;
}

function itemXml(p, base) {
  const pres = presentacionesDe(p);
  const unidad = pres.find((x) => x.unidades_stock === 1) || pres[0];
  if (!unidad) return ""; // sin presentación vendible, no va al feed
  const imagen = absolutizar(p.imagen, base);
  // Sin foto, Meta y Google rechazan el producto y lo marcan como error en el
  // catálogo: no se manda hasta que tenga una.
  if (!imagen) return "";
  const precio = `${Number(unidad.precio).toFixed(2)} ${MONEDA}`;
  // Se compara contra lo que lleva la presentación (un pack necesita 5)
  const disponible = p.stock >= unidad.unidades_stock ? "in stock" : "out of stock";
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
      <title>${esc(tituloFeed(p))}</title>
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

// Para los tests
exports.itemXml = itemXml;
exports.baseUrl = baseUrl;
