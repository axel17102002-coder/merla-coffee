// Worker principal de Merla Coffee para Cloudflare (Workers + assets estáticos).
// Rutea /api/<funcion> al backend compartido (netlify/functions/*) y todo lo
// demás lo sirve como archivo estático desde public/.

import { adaptar } from "../functions/_adaptador.js";
import { limpiarPedidosPendientes } from "../netlify/lib/mantenimiento.js";

import { handler as tienda } from "../netlify/functions/tienda.js";
import { handler as validarCupon } from "../netlify/functions/validar-cupon.js";
import { handler as puntos } from "../netlify/functions/puntos.js";
import { handler as modoCheckout } from "../netlify/functions/modo-checkout.js";
import { handler as modoWebhook } from "../netlify/functions/modo-webhook.js";
import { handler as mercadopagoCheckout } from "../netlify/functions/mercadopago-checkout.js";
import { handler as mercadopagoWebhook } from "../netlify/functions/mercadopago-webhook.js";
import { handler as confirmarPedido } from "../netlify/functions/confirmar-pedido.js";
import { handler as adminPedidos } from "../netlify/functions/admin-pedidos.js";
import { handler as adminStock } from "../netlify/functions/admin-stock.js";
import { handler as whatsappPedido } from "../netlify/functions/whatsapp-pedido.js";
import { handler as adminPrecios } from "../netlify/functions/admin-precios.js"; // <-- NUEVO IMPORT

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
  "admin-stock": adaptar(adminStock),
  "whatsapp-pedido": adaptar(whatsappPedido),
  "admin-precios": adaptar(adminPrecios), // <-- NUEVA RUTA
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
    try {
      const borrados = await limpiarPedidosPendientes();
      console.log(`scheduled: ${borrados} pedidos pendientes vencidos eliminados`);
    } catch (err) {
      console.error("scheduled:", err);
    }
  },
}