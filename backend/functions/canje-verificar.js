// POST /api/canje-verificar  { email, codigo }  →  { pase, dias }
// Cambia el código que llegó por mail por un pase firmado que deja canjear
// puntos desde ese navegador. Ver backend/lib/canje.js.

const { codigoValido, crearPase, DIAS_PASE } = require("../lib/canje.js");
const { permitir, claveDe } = require("../lib/limite.js");

const VENTANA_MS = 10 * 60 * 1000;

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const responder = (statusCode, cuerpo) => ({ statusCode, headers, body: JSON.stringify(cuerpo) });
  if (event.httpMethod !== "POST") return responder(405, { error: "Método no permitido" });

  try {
    const { email: crudo, codigo } = JSON.parse(event.body || "{}");
    const email = String(crudo || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return responder(400, { error: "Ingresá un email válido" });

    // El código tiene un millón de combinaciones: con pocos intentos por
    // visitante y por casilla, adivinarlo probando no es viable.
    const tope = [
      permitir(claveDe("canje-verificar", event), { max: 12, ventanaMs: VENTANA_MS }),
      permitir(`canje-verificar-mail:${email}`, { max: 6, ventanaMs: VENTANA_MS }),
    ].find((t) => !t.ok);
    if (tope) {
      return {
        statusCode: 429,
        headers: { ...headers, "Retry-After": String(tope.esperaSegundos) },
        body: JSON.stringify({ error: "Demasiados intentos. Esperá unos minutos y pedí un código nuevo." }),
      };
    }

    if (!codigoValido(email, codigo)) {
      return responder(400, { error: "El código no es correcto o ya venció. Revisalo o pedí uno nuevo." });
    }
    return responder(200, { pase: crearPase(email), dias: DIAS_PASE });
  } catch (err) {
    console.error("canje-verificar:", err);
    return responder(502, { error: "No pudimos verificar el código. Probá de nuevo." });
  }
};
