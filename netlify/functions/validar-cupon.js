// POST /.netlify/functions/validar-cupon  { codigo }
// Valida un cupón contra la base SIN exponer la lista de cupones.
// Devuelve el cupón (para que el carrito muestre el descuento); el cobro
// igualmente lo re-valida todo en modo-checkout.

const { obtenerCupon } = require("../lib/supabase.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }
  try {
    const { codigo } = JSON.parse(event.body || "{}");
    const cupon = await obtenerCupon(codigo);
    if (!cupon) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Cupón inválido" }) };
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
