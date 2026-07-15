// Administración protegida de precios: actualización del precio de venta
//
//   POST { producto_id, precio }
//        → { precio }

const { sb } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  
  // Validar token de administrador
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { producto_id, precio } = body;
      
      // Validación básica de datos
      if (!producto_id || isNaN(Number(precio)) || Number(precio) <= 0) {
        return { 
            statusCode: 400, 
            headers, 
            body: JSON.stringify({ error: "Ingresá un precio mayor a 0" }) 
        };
      }

      // Actualizamos el precio en Supabase
      await sb(`productos?id=eq.${encodeURIComponent(producto_id)}`, {
        method: "PATCH",
        body: { precio: Number(precio) },
      });

      return { 
          statusCode: 200, 
          headers, 
          body: JSON.stringify({ precio: Number(precio) }) 
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  } catch (err) {
    console.error("admin-precios:", err);
    return { 
        statusCode: 502, 
        headers, 
        body: JSON.stringify({ error: "No se pudo actualizar el precio" }) 
    };
  }
};