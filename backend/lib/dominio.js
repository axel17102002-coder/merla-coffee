// Dirección única de la tienda.
//
// El mismo Worker responde en varias direcciones: la del dominio, la de www y
// la de workers.dev que da Cloudflare. Si Google las encuentra todas, las toma
// como contenido duplicado y reparte el posicionamiento entre ellas. Por eso las
// otras redirigen (301, "se mudó para siempre") al dominio principal.

const DOMINIO = "merlacoffee.com.ar";
const ALIAS = ["www.merlacoffee.com.ar", "merla-coffee.merlacoffee.workers.dev"];

// URL a la que hay que mandar este pedido, o null si se sirve tal cual.
// `url` es una URL (o algo con hostname, pathname y search).
//
// /api/* nunca se redirige: Mercado Pago guarda la dirección de aviso (webhook)
// al crear cada pago, y puede haber pagos viejos apuntando a workers.dev. Un
// aviso redirigido llega como GET y sin cuerpo: se perdería la venta.
// Por lo mismo, solo se redirigen GET y HEAD (lo que hace un navegador al
// abrir una página).
function urlCanonica(url, metodo) {
  if (!url || !ALIAS.includes(url.hostname)) return null;
  if (metodo !== "GET" && metodo !== "HEAD") return null;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return null;
  return `https://${DOMINIO}${url.pathname}${url.search || ""}`;
}

module.exports = { DOMINIO, ALIAS, urlCanonica };
