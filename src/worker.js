// Worker principal de Merla Coffee para Cloudflare (Workers + assets estáticos).
// Rutea /api/<funcion> al backend compartido (netlify/functions/*) y todo lo
// demás lo sirve como archivo estático desde public/.

import { adaptar } from "../functions/_adaptador.js";

import { handler as tienda } from "../netlify/functions/tienda.js";
import { handler as validarCupon } from "../netlify/functions/validar-cupon.js";
import { handler as puntos } from "../netlify/functions/puntos.js";
import { handler as modoCheckout } from "../netlify/functions/modo-checkout.js";
import { handler as modoWebhook } from "../netlify/functions/modo-webhook.js";
import { handler as confirmarPedido } from "../netlify/functions/confirmar-pedido.js";
import { handler as adminPedidos } from "../netlify/functions/admin-pedidos.js";
import { handler as whatsappPedido } from "../netlify/functions/whatsapp-pedido.js";

const rutas = {
  "tienda": adaptar(tienda),
  "validar-cupon": adaptar(validarCupon),
  "puntos": adaptar(puntos),
  "modo-checkout": adaptar(modoCheckout),
  "modo-webhook": adaptar(modoWebhook),
  "confirmar-pedido": adaptar(confirmarPedido),
  "admin-pedidos": adaptar(adminPedidos),
  "whatsapp-pedido": adaptar(whatsappPedido),
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/([a-z0-9-]+)\/?$/);
    if (match && rutas[match[1]]) {
      // El adaptador espera un "context" estilo Pages: { request, env }
      return rutas[match[1]]({ request, env });
    }
    return env.ASSETS.fetch(request);
  },
};
