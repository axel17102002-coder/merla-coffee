// Ruta Cloudflare Pages: /api/modo-checkout → misma función que en Netlify
import { adaptar } from "../_adaptador.js";
import { handler } from "../../netlify/functions/modo-checkout.js";

export const onRequest = adaptar(handler);
