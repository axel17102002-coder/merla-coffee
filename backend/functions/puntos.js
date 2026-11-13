// GET /.netlify/functions/puntos?email=...
// Devuelve el saldo de puntos Club Merla de un cliente (0 si no existe).

const { obtenerPuntos } = require("../lib/supabase.js");
const { permitir, claveDe } = require("../lib/limite.js");

// El saldo se consulta solo con el email: el tope evita que alguien recorra
// una lista de direcciones para ver quién tiene puntos.
const MAX_POR_MINUTO = 30;

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  const tope = permitir(claveDe("puntos", event), { max: MAX_POR_MINUTO, ventanaMs: 60000 });
  if (!tope.ok) {
    return {
      statusCode: 429,
      headers: { ...headers, "Retry-After": String(tope.esperaSegundos) },
      body: JSON.stringify({ error: "Demasiadas consultas. Probá de nuevo en un minuto." }),
    };
  }
  try {
    const email = (event.queryStringParameters || {}).email;
    const puntos = await obtenerPuntos(email);
    if (puntos === null) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Email inválido" }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ puntos }) };
  } catch (err) {
    console.error("puntos:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Error consultando puntos" }) };
  }
};
