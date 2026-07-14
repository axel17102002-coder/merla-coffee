// Ruta Cloudflare Pages: /api/modo-webhook → misma función que en Netlify
import { adaptar } from "../_adaptador.js";
import { handler } from "../../netlify/functions/modo-webhook.js";

export const onRequest = adaptar(handler);
