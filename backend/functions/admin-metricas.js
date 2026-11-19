// GET /api/admin-metricas → { metricas: [{ fecha, clave, valor }] } (último año)
// Los contadores diarios de Insights: visitas por fuente y carritos.

const { sb } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();
  if (event.httpMethod !== "GET") return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  try {
    const desde = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const metricas = await sb(`metricas_dia?select=fecha,clave,valor&fecha=gte.${desde}&order=fecha.asc&limit=20000`);
    return { statusCode: 200, headers, body: JSON.stringify({ metricas }) };
  } catch (err) {
    // Sin la migración: Insights muestra que falta, no un error
    console.warn("admin-metricas:", err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ metricas: [], falta: "migracion-metricas.sql" }) };
  }
};
