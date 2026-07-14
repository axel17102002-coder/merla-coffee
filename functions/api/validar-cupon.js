// Ruta Cloudflare Pages: /api/validar-cupon → misma función que en Netlify
import { adaptar } from "../_adaptador.js";
import { handler } from "../../netlify/functions/validar-cupon.js";

export const onRequest = adaptar(handler);
