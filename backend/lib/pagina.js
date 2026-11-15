// Lo que el Worker le agrega al <head> de la tienda antes de servirla.
//
// La tienda es una sola página (index.html) y el detalle de cada producto se
// dibuja con JavaScript. Eso alcanza para una persona, pero no para los robots:
//   - Google Merchant y el catálogo de Meta abren el link de cada producto
//     (/?producto=<id>) y esperan encontrar EN EL HTML su nombre, precio y
//     stock, para compararlos con el feed (/api/feed);
//   - WhatsApp, Instagram y Facebook arman la vista previa de un link leyendo
//     las etiquetas og: sin ejecutar JavaScript.
// Por eso, cuando se pide /?producto=<id>, el Worker reescribe el <head> con
// los datos de ese producto. Acá están las funciones puras (sin red, se pueden
// probar); el reemplazo en sí lo hace HTMLRewriter en src/worker.js.

const { presentacionesDe } = require("../../public/motor.js");
const { DOMINIO } = require("./dominio.js");

const SITIO = `https://${DOMINIO}`;

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

// Etiquetas con las que Google y Meta comprueban que el dominio es nuestro.
// Los códigos son públicos (van en el HTML) y se cargan en wrangler.toml:
//   GOOGLE_SITE_VERIFICATION → Search Console / Merchant Center ("etiqueta HTML")
//   META_DOMAIN_VERIFICATION → Meta Business → Seguridad de la marca → Dominios
// Un valor con caracteres raros se ignora: esto termina dentro del HTML.
function etiquetasVerificacion(env) {
  const valido = (v) => (/^[A-Za-z0-9_-]{8,120}$/.test(String(v || "")) ? String(v) : "");
  const google = valido(env && env.GOOGLE_SITE_VERIFICATION);
  const meta = valido(env && env.META_DOMAIN_VERIFICATION);
  return (
    (google ? `<meta name="google-site-verification" content="${google}">\n` : "") +
    (meta ? `<meta name="facebook-domain-verification" content="${meta}">\n` : "")
  );
}

function recortar(texto, max) {
  const limpio = String(texto || "").replace(/\s+/g, " ").trim();
  if (limpio.length <= max) return limpio;
  return limpio.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

// Datos de la ficha de un producto para el <head>, o null si no se puede
// mostrar (no existe, está oculto o no tiene nada para vender).
// `producto` viene de obtenerCatalogo() (solo activos, con presentaciones).
function fichaProducto(producto) {
  if (!producto) return null;
  const presentaciones = presentacionesDe(producto);
  const unidad = presentaciones.find((x) => x.unidades_stock === 1) || presentaciones[0];
  if (!unidad) return null;

  const url = `${SITIO}/?producto=${encodeURIComponent(producto.id)}`;
  const notas = Array.isArray(producto.notas) ? producto.notas : [];
  const descripcion = recortar(producto.descripcion || (notas.length ? `Notas: ${notas.join(", ")}.` : producto.nombre), 300);
  const titulo = producto.tipo === "simple"
    ? `${producto.nombre} | Merla Coffee`
    : `${producto.nombre} · Café de especialidad en drip bag | Merla Coffee`;
  // Misma regla que el feed: la copia JPG (<nombre>_web.jpg) de las fotos
  // sembradas, porque Meta no toma WebP
  const imagen = !producto.imagen
    ? ""
    : /^https?:\/\//i.test(producto.imagen)
      ? producto.imagen
      : `${SITIO}/${String(producto.imagen).replace(/^\//, "").replace(/^(img\/[^/?#]+)\.webp$/i, "$1_web.jpg")}`;
  const hayStock = producto.stock >= unidad.unidades_stock;

  return { id: producto.id, nombre: producto.nombre, titulo, descripcion, url, imagen, precio: Number(unidad.precio), hayStock };
}

// Etiquetas que se AGREGAN al <head> para un producto: los datos de producto de
// Open Graph (los lee Meta) y el JSON-LD de schema.org (lo lee Google).
function etiquetasProducto(ficha) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: ficha.nombre,
    description: ficha.descripcion,
    sku: ficha.id,
    brand: { "@type": "Brand", name: "Merla Coffee" },
    ...(ficha.imagen ? { image: ficha.imagen } : {}),
    offers: {
      "@type": "Offer",
      url: ficha.url,
      price: ficha.precio,
      priceCurrency: "ARS",
      itemCondition: "https://schema.org/NewCondition",
      availability: ficha.hayStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };
  // "<" escapado: un nombre con "</script>" no puede cerrar la etiqueta
  const json = JSON.stringify(jsonLd).replace(/</g, "\\u003c");
  return [
    `<meta property="product:retailer_item_id" content="${esc(ficha.id)}">`,
    `<meta property="product:brand" content="Merla Coffee">`,
    `<meta property="product:condition" content="new">`,
    `<meta property="product:availability" content="${ficha.hayStock ? "in stock" : "out of stock"}">`,
    `<meta property="product:price:amount" content="${ficha.precio.toFixed(2)}">`,
    `<meta property="product:price:currency" content="ARS">`,
    `<script type="application/ld+json" id="ld-producto">${json}</script>`,
  ].join("\n") + "\n";
}

// Valores con los que se pisan las etiquetas que index.html ya trae
// (clave = atributo `property` o `name` de la etiqueta <meta>).
function reemplazosProducto(ficha) {
  return {
    "og:type": "product",
    "og:url": ficha.url,
    "og:title": ficha.titulo,
    "og:description": ficha.descripcion,
    "og:image:alt": ficha.nombre,
    "twitter:title": ficha.titulo,
    "twitter:description": ficha.descripcion,
    ...(ficha.imagen ? { "og:image": ficha.imagen, "twitter:image": ficha.imagen } : {}),
  };
}

module.exports = { etiquetasVerificacion, fichaProducto, etiquetasProducto, reemplazosProducto, SITIO };
