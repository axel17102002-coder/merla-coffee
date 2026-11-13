// Worker principal de Merla Coffee para Cloudflare (Workers + assets estáticos).
// Rutea /api/<funcion> al backend (backend/functions/*) y todo lo
// demás lo sirve como archivo estático desde public/.

import { adaptar } from "./adaptador.js";
import { conciliarPagosMp, limpiarPedidosPendientes, recordarCarritosAbandonados } from "../backend/lib/mantenimiento.js";

import { handler as tienda } from "../backend/functions/tienda.js";
import { handler as validarCupon } from "../backend/functions/validar-cupon.js";
import { handler as puntos } from "../backend/functions/puntos.js";
import { handler as modoCheckout } from "../backend/functions/modo-checkout.js";
import { handler as modoWebhook } from "../backend/functions/modo-webhook.js";
import { handler as mercadopagoCheckout } from "../backend/functions/mercadopago-checkout.js";
import { handler as mercadopagoWebhook } from "../backend/functions/mercadopago-webhook.js";
import { handler as confirmarPedido } from "../backend/functions/confirmar-pedido.js";
import { handler as adminPedidos } from "../backend/functions/admin-pedidos.js";
import { handler as adminStock } from "../backend/functions/admin-stock.js";
import { handler as adminCupones } from "../backend/functions/admin-cupones.js";
import { handler as adminMail } from "../backend/functions/admin-mail.js";
import { handler as adminProductos } from "../backend/functions/admin-productos.js";
import { handler as adminImagen } from "../backend/functions/admin-imagen.js";
import { handler as adminConfig } from "../backend/functions/admin-config.js";
import { handler as whatsappPedido } from "../backend/functions/whatsapp-pedido.js";
import { handler as adminPrecios } from "../backend/functions/admin-precios.js";
import { handler as adminTransportistas } from "../backend/functions/admin-transportistas.js";
import { handler as cotizarEnvio } from "../backend/functions/cotizar-envio.js";
import { handler as feed } from "../backend/functions/feed.js";

const rutas = {
  "tienda": adaptar(tienda),
  "validar-cupon": adaptar(validarCupon),
  "puntos": adaptar(puntos),
  "modo-checkout": adaptar(modoCheckout),
  "modo-webhook": adaptar(modoWebhook),
  "mercadopago-checkout": adaptar(mercadopagoCheckout),
  "mercadopago-webhook": adaptar(mercadopagoWebhook),
  "confirmar-pedido": adaptar(confirmarPedido),
  "admin-pedidos": adaptar(adminPedidos),
  "admin-transportistas": adaptar(adminTransportistas),
  "admin-stock": adaptar(adminStock),
  "admin-cupones": adaptar(adminCupones),
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/([a-z0-9-]+)\/?$/);
    if (match && rutas[match[1]]) {
      return rutas[match[1]]({ request, env });
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
    try {
      const borrados = await limpiarPedidosPendientes(conciliacion);
      console.log(`scheduled: ${borrados} pedidos pendientes vencidos eliminados`);
    } catch (err) {
      console.error("scheduled:", err);
    }
  },
};
