// Administración protegida de stock: carga inicial o restock calculando
// cuántas drip bags salen de X gramos de café en grano.
//
//   GET  → { productos: [{id, nombre, stock}], gramosPorUnidad }
//   POST { producto_id, gramos | unidades, gramosPorUnidad?, accion: "sumar"|"fijar" }
//        → { stock, unidades }  (unidades = cuántas bags se calcularon)

const { sb } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");
const { CONFIG } = require("../../public/motor.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "GET") {
      const productos = await sb("productos?select=id,nombre,stock,activo,precio&order=nombre.asc");
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ productos, gramosPorUnidad: CONFIG.drip.gramosPorUnidad }),
      };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { producto_id, accion } = body;
      if (!producto_id || !["sumar", "fijar"].includes(accion)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Acción inválida" }) };
      }

      // Unidades directas, o calculadas desde gramos de café
      const gpu = Number(body.gramosPorUnidad) > 0 ? Number(body.gramosPorUnidad) : CONFIG.drip.gramosPorUnidad;
      let unidades;
      if (Number(body.unidades) > 0) {
        unidades = Math.floor(Number(body.unidades));
      } else if (Number(body.gramos) > 0) {
        unidades = Math.floor(Number(body.gramos) / gpu);
      } else {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Ingresá los gramos de café (o unidades) a cargar" }),
        };
      }

      const [producto] = await sb(`productos?id=eq.${encodeURIComponent(producto_id)}&select=id,stock`);
      if (!producto) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "Producto inexistente" }) };
      }

      const stock = accion === "sumar" ? producto.stock + unidades : unidades;
      await sb(`productos?id=eq.${encodeURIComponent(producto_id)}`, {
        method: "PATCH",
        body: { stock },
      });

      return { statusCode: 200, headers, body: JSON.stringify({ stock, unidades }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  } catch (err) {
    console.error("admin-stock:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No se pudo actualizar el stock" }) };
  }
};
