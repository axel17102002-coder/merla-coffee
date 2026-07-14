// Ruta Cloudflare Pages: /api/admin-pedidos → misma función que en Netlify
import { adaptar } from "../_adaptador.js";
import { handler } from "../../netlify/functions/admin-pedidos.js";

export const onRequest = adaptar(handler);
