// POST /.netlify/functions/validar-cupon  { codigo }
// Valida un cupón contra la base SIN exponer la lista de cupones.
// Devuelve el cupón (para que el carrito muestre el descuento); el cobro
// igualmente lo re-valida todo en modo-checkout.

const { obtenerCupon, cuponYaUsado } = require("../lib/supabase.js");
const { permitir, ipDe } = require("../lib/limite.js");

// Intentos por IP y por minuto. Hay cupones ocultos (no se listan en ningún
// lado), y este endpoint responde distinto con un código válido: sin tope,
// probar diccionarios hasta encontrarlos es cuestión de tiempo. Un cliente de
// verdad prueba dos o tres códigos, no veinte.
const MAX_POR_MINUTO = 12;

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  const tope = permitir(`cupon:${ipDe(event)}`, { max: MAX_POR_MINUTO, ventanaMs: 60000 });
  if (!tope.ok) {
    return {
      statusCode: 429,
      headers: { ...headers, "Retry-After": String(tope.esperaSegundos) },
      body: JSON.stringify({ error: "Demasiados intentos. Probá de nuevo en un minuto." }),
    };
  }

  try {
    const { codigo, email } = JSON.parse(event.body || "{}");
    const cupon = await obtenerCupon(codigo);
    if (!cupon) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Cupón inválido" }) };
    }
    // Si ya tenemos el email, avisamos temprano que el cupón es de un solo uso.
    // (El bloqueo real igual ocurre al crear el pago; acá es solo para la UI.)
    const mail = String(email || "").trim().toLowerCase();
    if (mail && (await cuponYaUsado(cupon.codigo, mail))) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: "Ya usaste este cupón" }) };
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        cupon: {
          codigo: cupon.codigo,
          tipo: cupon.tipo,
          valor: cupon.valor,
          minimo: cupon.minimo,
          activo: cupon.activo,
          descripcion: cupon.descripcion,
        },
      }),
    };
  } catch (err) {
    console.error("validar-cupon:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Error validando el cupón" }) };
  }
};
