// Administración de los transportistas que se le muestran al cliente.
//
//   GET                          → { transportistas: [{nombre, activo, visto}] }
//   PATCH { nombre, activo }     → prende o apaga uno
//
// La tabla se completa sola: cada cotización ficha (apagados) los que Zipnova
// devuelve y no estaban. Ver backend/lib/zipnova.js.

const { sb } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "GET") {
      // Primero los prendidos, después alfabético: arriba queda lo que se usa
      const transportistas = await sb("transportistas?select=nombre,activo,visto&order=activo.desc,nombre.asc");
      return { statusCode: 200, headers, body: JSON.stringify({ transportistas }) };
    }

    if (event.httpMethod === "PATCH") {
      const { nombre, activo } = JSON.parse(event.body || "{}");
      if (!nombre || typeof activo !== "boolean") {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Falta el transportista o el estado" }) };
      }
      const [fila] = await sb(`transportistas?nombre=eq.${encodeURIComponent(nombre)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { activo },
      });
      if (!fila) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "Transportista inexistente" }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, transportista: fila }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  } catch (err) {
    console.error("admin-transportistas:", err);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "No se pudieron gestionar los transportistas. ¿Corriste supabase/migracion-transportistas.sql?" }),
    };
  }
};
