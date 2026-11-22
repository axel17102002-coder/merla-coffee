// Worker principal de Merla Coffee para Cloudflare (Workers + assets estáticos).
// Rutea /api/<funcion> al backend (backend/functions/*) y todo lo
// demás lo sirve como archivo estático desde public/.

import { adaptar } from "./adaptador.js";
import { urlCanonica } from "../backend/lib/dominio.js";
import { etiquetasVerificacion, fichaProducto, etiquetasProducto, reemplazosProducto } from "../backend/lib/pagina.js";
import { obtenerCatalogo, sb } from "../backend/lib/supabase.js";
import { conciliarPagosMp, limpiarPedidosPendientes, pedirResenas, recordarCarritosAbandonados } from "../backend/lib/mantenimiento.js";

import { handler as tienda } from "../backend/functions/tienda.js";
import { handler as validarCupon } from "../backend/functions/validar-cupon.js";
import { handler as puntos } from "../backend/functions/puntos.js";
import { handler as canjeCodigo } from "../backend/functions/canje-codigo.js";
import { handler as canjeVerificar } from "../backend/functions/canje-verificar.js";
import { handler as modoCheckout } from "../backend/functions/modo-checkout.js";
import { handler as modoWebhook } from "../backend/functions/modo-webhook.js";
import { handler as mercadopagoCheckout } from "../backend/functions/mercadopago-checkout.js";
import { handler as mercadopagoWebhook } from "../backend/functions/mercadopago-webhook.js";
import { handler as confirmarPedido } from "../backend/functions/confirmar-pedido.js";
import { handler as adminPedidos } from "../backend/functions/admin-pedidos.js";
import { handler as adminStock } from "../backend/functions/admin-stock.js";
import { handler as adminCupones } from "../backend/functions/admin-cupones.js";
import { handler as adminResenas } from "../backend/functions/admin-resenas.js";
import { handler as resena } from "../backend/functions/resena.js";
import { handler as visita } from "../backend/functions/visita.js";
import { handler as adminMetricas } from "../backend/functions/admin-metricas.js";
import { handler as adminTelegram } from "../backend/functions/admin-telegram.js";
import { handler as adminPush } from "../backend/functions/admin-push.js";
import { handler as adminPresupuestos } from "../backend/functions/admin-presupuestos.js";
import { handler as presupuesto } from "../backend/functions/presupuesto.js";
import { paginaPresupuesto } from "../backend/lib/presupuestos.js";
import { handler as adminMail } from "../backend/functions/admin-mail.js";
import { handler as adminProductos } from "../backend/functions/admin-productos.js";
import { handler as adminImagen } from "../backend/functions/admin-imagen.js";
import { handler as adminConfig } from "../backend/functions/admin-config.js";
import { handler as whatsappPedido } from "../backend/functions/whatsapp-pedido.js";
import { handler as adminPrecios } from "../backend/functions/admin-precios.js";
import { handler as adminTransportistas } from "../backend/functions/admin-transportistas.js";
import { handler as adminEnvioSimular } from "../backend/functions/admin-envio-simular.js";
import { handler as cotizarEnvio } from "../backend/functions/cotizar-envio.js";
import { handler as feed } from "../backend/functions/feed.js";

const rutas = {
  "tienda": adaptar(tienda),
  "validar-cupon": adaptar(validarCupon),
  "puntos": adaptar(puntos),
  "canje-codigo": adaptar(canjeCodigo),
  "canje-verificar": adaptar(canjeVerificar),
  "modo-checkout": adaptar(modoCheckout),
  "modo-webhook": adaptar(modoWebhook),
  "mercadopago-checkout": adaptar(mercadopagoCheckout),
  "mercadopago-webhook": adaptar(mercadopagoWebhook),
  "confirmar-pedido": adaptar(confirmarPedido),
  "admin-pedidos": adaptar(adminPedidos),
  "admin-transportistas": adaptar(adminTransportistas),
  "admin-envio-simular": adaptar(adminEnvioSimular),
  "admin-stock": adaptar(adminStock),
  "admin-cupones": adaptar(adminCupones),
  "admin-resenas": adaptar(adminResenas),
  "resena": adaptar(resena),
  "visita": adaptar(visita),
  "admin-metricas": adaptar(adminMetricas),
  "admin-telegram": adaptar(adminTelegram),
  "admin-push": adaptar(adminPush),
  "admin-presupuestos": adaptar(adminPresupuestos),
  "presupuesto": adaptar(presupuesto),
  "admin-mail": adaptar(adminMail),
  "admin-productos": adaptar(adminProductos),
  "admin-imagen": adaptar(adminImagen),
  "admin-config": adaptar(adminConfig),
  "whatsapp-pedido": adaptar(whatsappPedido),
  "admin-precios": adaptar(adminPrecios),
  "cotizar-envio": adaptar(cotizarEnvio),
  "feed": adaptar(feed),
};

function cargarEnv(env) {
  if (typeof globalThis.process === "undefined") globalThis.process = { env: {} };
  if (!globalThis.process.env) globalThis.process.env = {};
  for (const [clave, valor] of Object.entries(env)) {
    if (typeof valor === "string") globalThis.process.env[clave] = valor;
  }
}

// Catálogo en memoria por un minuto: las fichas de producto las piden sobre
// todo robots (Google, Meta, WhatsApp), a veces de a muchas seguidas.
let catalogoEnMemoria = { productos: null, hasta: 0 };
async function catalogo() {
  if (catalogoEnMemoria.productos && catalogoEnMemoria.hasta > Date.now()) return catalogoEnMemoria.productos;
  const productos = await obtenerCatalogo();
  catalogoEnMemoria = { productos, hasta: Date.now() + 60 * 1000 };
  return productos;
}

// La tienda con el <head> ajustado: las etiquetas de verificación de dominio y,
// si se pidió /?producto=<id>, el título, la foto, el precio y el stock de ese
// producto (ver backend/lib/pagina.js). Devuelve null cuando no hay nada que
// agregar: ahí la tienda sale como archivo estático, igual que siempre.
async function paginaTienda(env, url) {
  const verificacion = etiquetasVerificacion(env);
  const idProducto = url.searchParams.get("producto");
  if (!verificacion && !idProducto) return null;

  let ficha = null;
  if (idProducto) {
    cargarEnv(env);
    try {
      ficha = fichaProducto((await catalogo()).find((p) => p.id === idProducto));
    } catch (err) {
      console.error("pagina: no pude armar la ficha del producto:", err.message);
    }
  }
  if (!verificacion && !ficha) return null;

  // Pedido nuevo, sin los headers condicionales del navegador: hace falta el
  // HTML completo para reescribirlo (un 304 vendría vacío).
  const base = await env.ASSETS.fetch(new Request(`${url.origin}/`, { headers: { accept: "text/html" } }));
  if (!base.ok || !(base.headers.get("content-type") || "").includes("text/html")) return null;

  let reescritor = new HTMLRewriter().on("head", {
    element(el) {
      el.append(verificacion + (ficha ? etiquetasProducto(ficha) : ""), { html: true });
    },
  });
  if (ficha) {
    const valores = reemplazosProducto(ficha);
    const pisar = (atributo) => ({
      element(el) {
        const clave = el.getAttribute(atributo);
        // El tamaño declarado es el del logo: con otra foto, mejor no declararlo
        if (ficha.imagen && (clave === "og:image:width" || clave === "og:image:height")) return el.remove();
        if (valores[clave]) el.setAttribute("content", valores[clave]);
      },
    });
    reescritor = reescritor
      .on("title", { element(el) { el.setInnerContent(ficha.titulo); } })
      .on('meta[name="description"]', { element(el) { el.setAttribute("content", ficha.descripcion); } })
      .on('link[rel="canonical"]', { element(el) { el.setAttribute("href", ficha.url); } })
      .on("meta[property]", pisar("property"))
      .on("meta[name]", pisar("name"));
  }

  const respuesta = reescritor.transform(base);
  const headers = new Headers(respuesta.headers);
  headers.delete("etag"); // el contenido ya no es el del archivo
  headers.delete("last-modified");
  headers.set("cache-control", "public, max-age=300");
  return new Response(respuesta.body, { status: 200, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // www y workers.dev → merlacoffee.com.ar (ver backend/lib/dominio.js)
    const destino = urlCanonica(url, request.method);
    if (destino) return Response.redirect(destino, 301);
    const match = url.pathname.match(/^\/api\/([a-z0-9-]+)\/?$/);
    if (match && rutas[match[1]]) {
      return rutas[match[1]]({ request, env });
    }
    // Presupuesto para un cliente: /presupuesto/<token> (ver backend/lib/presupuestos.js)
    const presu = url.pathname.match(/^\/presupuesto\/([A-Za-z0-9_-]{16,64})\/?$/);
    if (presu && request.method === "GET") {
      cargarEnv(env);
      const html = (cuerpo, status = 200) => new Response(cuerpo, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
      try {
        const [p] = await sb(`presupuestos?token=eq.${encodeURIComponent(presu[1])}&select=*&limit=1`);
        if (p) return html(paginaPresupuesto(p));
        return html('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Presupuesto · Merla Coffee</title><p style="font-family:sans-serif;padding:24px">Este presupuesto no existe o fue eliminado. Escribinos por WhatsApp al +54 9 221 680-3376.</p>', 404);
      } catch (err) {
        console.error("presupuesto (página):", err);
        return html('<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif;padding:24px">No pudimos mostrar el presupuesto. Probá de nuevo en un rato.</p>', 500);
      }
    }
    if (request.method === "GET" && url.pathname === "/") {
      // Si algo falla acá, la tienda se sirve igual, sin los agregados
      try {
        const pagina = await paginaTienda(env, url);
        if (pagina) return pagina;
      } catch (err) {
        console.error("pagina:", err);
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    cargarEnv(env);
    // 1) Conciliar con Mercado Pago: un pedido pendiente que en realidad se
    //    pagó se aprueba acá, antes de tratarlo como carrito abandonado.
    //    Si la conciliación falla entera, no se toca ningún pedido de MP.
    let conciliacion = { aprobados: 0, sinPago: new Set() };
    try {
      conciliacion = await conciliarPagosMp();
      if (conciliacion && conciliacion.aprobados) {
        console.log(`scheduled: ${conciliacion.aprobados} pedidos pagados que seguían pendientes, aprobados`);
      }
    } catch (err) {
      console.error("scheduled (conciliación):", err);
    }
    // 2) Recordatorio y 3) limpieza, en ese orden: al revés, los pedidos que
    //    están justo en el borde de las 48 h se borrarían antes de avisarles.
    try {
      const recordados = await recordarCarritosAbandonados(conciliacion);
      if (recordados) console.log(`scheduled: ${recordados} recordatorios de carrito abandonado enviados`);
    } catch (err) {
      console.error("scheduled (recordatorios):", err);
    }
    // Pedido de reseña a quienes compraron hace unos días
    try {
      const pedidas = await pedirResenas();
      if (pedidas) console.log(`scheduled: ${pedidas} pedidos de reseña enviados`);
    } catch (err) {
      console.error("scheduled (reseñas):", err);
    }
    try {
      const borrados = await limpiarPedidosPendientes(conciliacion);
      console.log(`scheduled: ${borrados} pedidos pendientes vencidos eliminados`);
    } catch (err) {
      console.error("scheduled:", err);
    }
  },
};
