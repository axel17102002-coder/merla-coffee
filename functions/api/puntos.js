// Ruta Cloudflare Pages: /api/puntos → misma función que en Netlify
import { adaptar } from "../_adaptador.js";
import { handler } from "../../netlify/functions/puntos.js";

export const onRequest = adaptar(handler);
