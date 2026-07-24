// Administración protegida de pedidos (todos los canales).
//
//   GET                      → { pedidos: [...] }  (todos, más nuevos primero)
//   POST { accion, id }      → aprobar/rechazar un pedido de WhatsApp
//   PATCH { id, mp_metodo }  → corrige el método de pago de Mercado Pago
//   DELETE ?id=<uuid>        → borra un pedido definitivamente

const { sb, sbRpc } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");
const { METODOS_MP } = require("../../public/motor.js");

const CAMPOS = "id,numero,origen,items,total,cupon,descuento_cupon,cliente_email,estado,creado,puntos_ganados,puntos_canjeados,envio,envio_costo";

// `mp_metodo` (el medio con que se pagó en MP, para su comisión) puede no existir
// todavía: si falta la migración, el panel sigue andando sin esa columna.
async function traerPedidos() {
  const orden = "&order=creado.desc&limit=200";
  try {
    return await sb(`pedidos?select=${CAMPOS},mp_metodo${orden}`);
  } catch (err) {
    console.warn("admin-pedidos: falta mp_metodo (correr migracion-metodo-pago-mp.sql):", err.message);
    return await sb(`pedidos?select=${CAMPOS}${orden}`);
  }
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "GET") {
      const pedidos = await traerPedidos();
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

    // Corregir a mano el método de pago de MP (el webhook lo completa solo en
    // los pedidos nuevos; los viejos y los que MP informa raro se ajustan acá).
    if (event.httpMethod === "PATCH") {
      const { id, mp_metodo: metodo } = JSON.parse(event.body || "{}");
      const valido = metodo == null || metodo === "" || METODOS_MP.some((m) => m.clave === metodo);
      if (!id || !valido) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Método de pago inválido" }) };
      }
      try {
        const [pedido] = await sb(`pedidos?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: { mp_metodo: metodo || null },
        });
        if (!pedido) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: "Pedido inexistente" }) };
        }
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, mp_metodo: pedido.mp_metodo }) };
      } catch (err) {
        console.warn("admin-pedidos PATCH mp_metodo:", err.message);
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: "Falta correr supabase/migracion-metodo-pago-mp.sql en Supabase" }),
        };
      }
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
