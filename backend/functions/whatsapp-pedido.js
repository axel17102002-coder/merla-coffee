// POST /.netlify/functions/whatsapp-pedido
// Registra un pedido manual en estado pendiente ANTES de abrir WhatsApp.
// El stock y los puntos se mueven recién desde /admin.html al marcarlo cobrado.

const { sb, obtenerCatalogo, obtenerCupon, obtenerPuntos, cuponYaUsado } = require("../lib/supabase.js");
const { calcularPedido, numeroPedido: formatearNumero } = require("../../public/motor.js");
const { sanitizarEnvio } = require("../lib/entrega.js");
const { resolverEnvioCosto } = require("../lib/envio-costo.js");
const { avisarAdminPorId } = require("../lib/avisos.js");
const { itemsConCosto } = require("../lib/costos.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailValido) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Ingresá tu email para hacer el pedido" }) };
    }
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
    if (cupon) {
      if (!emailValido) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Para usar un cupón ingresá tu email" }) };
      }
      if (await cuponYaUsado(cupon.codigo, email)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Ya usaste este cupón" }) };
      }
    }

    const opcionesPedido = { cupon, canjePuntos: Boolean(body.canjePuntos), puntosDisponibles };

    // El costo de envío se cotiza en el servidor (nunca se confía en un monto
    // mandado por el navegador): retiro no cotiza nada, envío sí.
    const envio = sanitizarEnvio(body.envio);
    if (envio && envio.metodo === "envio") {
      const previo = calcularPedido(body.items, opcionesPedido, { productos });
      if (!previo.ok) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: previo.error }) };
      }
      const resultadoEnvio = await resolverEnvioCosto(body.items, productos, envio, previo.subtotal);
      if (!resultadoEnvio.ok) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: resultadoEnvio.error }) };
      }
      opcionesPedido.envioCosto = resultadoEnvio.costo;
    }

    const pedido = calcularPedido(body.items, opcionesPedido, { productos });
    if (!pedido.ok) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: pedido.error }) };
    }

    const externalId = `wsp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const filaPedido = {
      external_intention_id: externalId,
      origen: "whatsapp",
      items: await itemsConCosto(pedido.lineas, productos),
      subtotal: pedido.subtotal,
      descuento_cantidad: pedido.descuentoCantidad,
      cupon: pedido.cupon,
      descuento_cupon: pedido.descuentoCupon,
      puntos_canjeados: pedido.puntosCanjeados,
      descuento_puntos: pedido.descuentoPuntos,
      total: pedido.total,
      envio_costo: pedido.envioCosto,
      puntos_ganados: emailValido ? pedido.puntosGanados : 0,
      cliente_email: emailValido ? email : null,
      envio,
    };
    const crearPedido = (cuerpo) =>
      sb("pedidos", { method: "POST", headers: { Prefer: "return=representation" }, body: cuerpo });

    let fila;
    try {
      [fila] = await crearPedido(filaPedido);
    } catch (err) {
      // Si la migración de envio_costo todavía no se corrió, registramos
      // igual: el monto ya está incluido en `total`, solo falta el desglose.
      console.warn("whatsapp-pedido: reintento sin envio_costo (correr migracion-envio.sql):", err.message);
      const { envio_costo, ...sinEnvioCosto } = filaPedido;
      [fila] = await crearPedido(sinEnvioCosto);
    }

    // Aviso al admin de que entró un pedido nuevo (no bloquea la respuesta)
    await avisarAdminPorId(fila.id);

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({ pedidoId: fila.id, numero: fila.numero, codigo: formatearNumero(fila.numero) }),
    };
  } catch (err) {
    console.error("whatsapp-pedido:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No pudimos registrar el pedido" }) };
  }
};
