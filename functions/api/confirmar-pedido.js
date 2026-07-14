// Ruta Cloudflare Pages: /api/confirmar-pedido → misma función que en Netlify
import { adaptar } from "../_adaptador.js";
import { handler } from "../../netlify/functions/confirmar-pedido.js";

export const onRequest = adaptar(handler);
