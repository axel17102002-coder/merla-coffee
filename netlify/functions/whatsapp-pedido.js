// POST /.netlify/functions/whatsapp-pedido
// Registra un pedido manual en estado pendiente ANTES de abrir WhatsApp.
// El stock y los puntos se mueven recién desde /admin.html al marcarlo cobrado.

const { sb, obtenerCatalogo, obtenerCupon, obtenerPuntos } = require("../lib/supabase.js");
const { calcularPedido } = require("../../public/motor.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (body.canjePuntos && !emailValido) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Para canjear puntos ingresá tu email" }) };
    }

    const [productos, cupon, puntosDisponibles] = await Promise.all([
      obtenerCatalogo(),
      body.cupon ? obtenerCupon(body.cupon) : null,
      body.canjePuntos ? obtenerPuntos(email) : null,
    ]);
    if (body.cupon && !cupon) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Cupón inválido" }) };
    }

    const pedido = calcularPedido(
      body.items,
      { cupon, canjePuntos: Boolean(body.canjePuntos), puntosDisponibles },
      { productos }
    );
    if (!pedido.ok) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: pedido.error }) };
    }

    const externalId = `wsp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [fila] = await sb("pedidos", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        external_intention_id: externalId,
        origen: "whatsapp",
        items: pedido.lineas.map((l) => ({
          producto_id: l.producto_id,
          presentacion_id: l.presentacion_id,
          nombre: `${l.nombre} - ${l.presentacionNombre}`,
          qty: l.qty,
          unidades: l.unidades,
          precio_unitario: l.precioUnitario,
        })),
        subtotal: pedido.subtotal,
        descuento_cantidad: pedido.descuentoCantidad,
        cupon: pedido.cupon,
        descuento_cupon: pedido.descuentoCupon,
        puntos_canjeados: pedido.puntosCanjeados,
        descuento_puntos: pedido.descuentoPuntos,
        total: pedido.total,
        puntos_ganados: emailValido ? pedido.puntosGanados : 0,
        cliente_email: emailValido ? email : null,
      },
    });

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({ pedidoId: fila.id, codigo: fila.id.slice(0, 8).toUpperCase() }),
    };
  } catch (err) {
    console.error("whatsapp-pedido:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No pudimos registrar el pedido" }) };
  }
};
