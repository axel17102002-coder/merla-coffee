// Ruta Cloudflare Pages: /api/tienda → misma función que en Netlify
import { adaptar } from "../_adaptador.js";
import { handler } from "../../netlify/functions/tienda.js";

export const onRequest = adaptar(handler);
