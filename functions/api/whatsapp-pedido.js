// Ruta Cloudflare Pages: /api/whatsapp-pedido → misma función que en Netlify
import { adaptar } from "../_adaptador.js";
import { handler } from "../../netlify/functions/whatsapp-pedido.js";

export const onRequest = adaptar(handler);
