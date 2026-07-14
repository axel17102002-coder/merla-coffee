// GET /.netlify/functions/puntos?email=...
// Devuelve el saldo de puntos Club Merla de un cliente (0 si no existe).

const { obtenerPuntos } = require("../lib/supabase.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
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
