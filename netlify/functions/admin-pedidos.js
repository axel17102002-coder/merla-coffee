// Administración protegida de pedidos por WhatsApp.

const { sb, sbRpc } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "GET") {
      const pedidos = await sb(
        "pedidos?select=id,origen,items,total,cliente_email,estado,creado,puntos_ganados,puntos_canjeados&origen=eq.whatsapp&order=creado.desc&limit=100"
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

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  } catch (err) {
    console.error("admin-pedidos:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No se pudieron gestionar los pedidos" }) };
  }
};
