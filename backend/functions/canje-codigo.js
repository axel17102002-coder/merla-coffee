// POST /api/canje-codigo  { email }
// Manda por mail el código de 6 dígitos para canjear puntos Club Merla.
// Ver backend/lib/canje.js para el porqué.

const { obtenerPuntos } = require("../lib/supabase.js");
const { enviarMail, config } = require("../lib/brevo.js");
const { mailCodigoCanje } = require("../lib/mails.js");
const { codigoActual, MINUTOS_CODIGO } = require("../lib/canje.js");
const { permitir, claveDe } = require("../lib/limite.js");
const { CONFIG } = require("../../public/motor.js");

const VENTANA_MS = 10 * 60 * 1000;

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const responder = (statusCode, cuerpo) => ({ statusCode, headers, body: JSON.stringify(cuerpo) });
  if (event.httpMethod !== "POST") return responder(405, { error: "Método no permitido" });

  try {
    const { email: crudo } = JSON.parse(event.body || "{}");
    const email = String(crudo || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return responder(400, { error: "Ingresá un email válido" });

    // Tope por visitante y por casilla: cada pedido de código es un mail que
    // sale. Sin tope, alguien podría usar esto para llenarle la casilla a un
    // cliente o gastar la cuota diaria de mails de la tienda.
    const tope = [
      permitir(claveDe("canje-codigo", event), { max: 6, ventanaMs: VENTANA_MS }),
      permitir(`canje-codigo-mail:${email}`, { max: 3, ventanaMs: VENTANA_MS }),
    ].find((t) => !t.ok);
    if (tope) {
      return {
        statusCode: 429,
        headers: { ...headers, "Retry-After": String(tope.esperaSegundos) },
        body: JSON.stringify({ error: "Ya te mandamos varios códigos. Esperá unos minutos y probá de nuevo." }),
      };
    }

    // Solo se le escribe a quien de verdad puede canjear: así este endpoint no
    // sirve para mandarle mails a cualquier dirección.
    const puntos = await obtenerPuntos(email);
    if (!(puntos >= CONFIG.fidelidad.canjePuntos)) {
      return responder(400, { error: "Todavía no tenés puntos suficientes para canjear" });
    }

    if (!config().apiKey) {
      return responder(503, { error: "No podemos mandarte el código en este momento. Escribinos por WhatsApp." });
    }
    const mail = mailCodigoCanje(codigoActual(email), MINUTOS_CODIGO);
    const salio = await enviarMail({ para: email, asunto: mail.asunto, html: mail.html });
    if (!salio) {
      return responder(502, { error: "No pudimos mandarte el código. Probá de nuevo en un minuto." });
    }
    return responder(200, { ok: true, minutos: MINUTOS_CODIGO });
  } catch (err) {
    console.error("canje-codigo:", err);
    return responder(502, { error: "No pudimos mandarte el código. Probá de nuevo en un minuto." });
  }
};
