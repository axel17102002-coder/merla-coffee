// Administración protegida de pedidos (todos los canales).
//
//   GET                      → { pedidos: [...] }  (todos, más nuevos primero)
//   POST { accion, id }      → aprobar/rechazar un pedido de WhatsApp
//   DELETE ?id=<uuid>        → borra un pedido definitivamente

const { sb, sbRpc } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "GET") {
      const pedidos = await sb(
        "pedidos?select=id,numero,origen,items,total,cupon,descuento_cupon,cliente_email,estado,creado,puntos_ganados,puntos_canjeados,envio,envio_costo&order=creado.desc&limit=200"
      );
      return { statusCode: 200, headers, body: JSON.stringify({ pedidos }) };
    }

    if (event.httpMethod === "POST") {
      const { accion, id } = JSON.parse(event.body || "{}");
      if (!id || !["aprobar", "rechazar"].includes(accion)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Acción inválida" }) };
      }
      const rpc = accion === "aprobar" ? "aprobar_pedido_manual" : "rechazar_pedido_manual";
      const resultado = await sbRpc(rpc, { p_pedido_id: id });
      if (!resultado.ok) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: resultado.error || "No se pudo actualizar" }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify(resultado) };
    }

    if (event.httpMethod === "DELETE") {
      const id = (event.queryStringParameters || {}).id;
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Falta el id del pedido" }) };
      }
      await sb(`pedidos?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  } catch (err) {
    console.error("admin-pedidos:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No se pudieron gestionar los pedidos" }) };
  }
};
