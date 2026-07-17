// POST /.netlify/functions/modo-checkout
//   { items: [{presentacion, qty}], cupon: "CODIGO"|null, canjePuntos: bool, email: string|null }
//
// Crea un pago con MODO. Todo se recalcula acá con datos de Supabase (precios,
// stock, cupón, puntos): nunca se confía en montos del navegador. Además deja
// el pedido registrado en la tabla `pedidos`; cuando MODO confirma el pago
// (webhook o confirmar-pedido), se descuenta el stock y se acreditan puntos.

const { sb, obtenerCatalogo, obtenerCupon, obtenerPuntos } = require("../lib/supabase.js");
const { ambiente, crearPago } = require("../lib/modo.js");
const { CONFIG, calcularPedido } = require("../../public/motor.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }
  if (!CONFIG.pagos.modo) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "El pago con MODO está deshabilitado por el momento" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Cuerpo inválido" }) };
  }

  try {
    // Email (necesario solo para puntos)
    const email = String(body.email || "").trim().toLowerCase();
    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailValido) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Ingresá tu email para hacer el pedido" }) };
    }
    if (body.canjePuntos && !emailValido) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Para canjear puntos ingresá tu email" }),
      };
    }

    // Datos frescos desde la base
    const productos = await obtenerCatalogo();

    let cupon = null;
    if (body.cupon) {
      cupon = await obtenerCupon(body.cupon);
      if (!cupon) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Cupón inválido" }) };
      }
    }

    let puntosDisponibles = null;
    if (body.canjePuntos) {
      puntosDisponibles = await obtenerPuntos(email);
    }

    const pedido = calcularPedido(
      body.items,
      { cupon, canjePuntos: Boolean(body.canjePuntos), puntosDisponibles },
      { productos }
    );
    if (!pedido.ok) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: pedido.error }) };
    }

    // Registrar el pedido (estado pendiente) antes de crear el pago
    const externalId = `merla-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [fila] = await sb("pedidos", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        external_intention_id: externalId,
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

    // URL pública del sitio para que MODO nos notifique el resultado
    // (SITE_URL manual > Netlify URL > Cloudflare Pages URL)
    const sitio =
      process.env.SITE_URL ||
      process.env.URL ||
      process.env.CF_PAGES_URL ||
      process.env.DEPLOY_PRIME_URL ||
      "";
    const webhook = sitio.startsWith("https://") ? `${sitio}/api/modo-webhook` : undefined;

    let pago;
    try {
      pago = await crearPago({
        description: `Pedido Merla Coffee (${pedido.unidades} drip bags)`.slice(0, 100),
        amount: pedido.total,
        external_intention_id: externalId,
        ...(webhook ? { webhook_notification: webhook } : {}),
        items: pedido.lineas.map((l) => ({
          description: `${l.nombre} - Drip Bag (${l.presentacionNombre})`,
          quantity: l.qty,
          unit_price: l.precioUnitario,
          sku: l.presentacion_id,
          category_name: "Drip Bags",
        })),
      });
    } catch (err) {
      // Si MODO falló, no dejamos el pedido huérfano
      await sb(`pedidos?id=eq.${fila.id}`, { method: "DELETE" }).catch(() => {});
      throw err;
    }

    // Guardar el id de MODO para poder matchear el webhook
    await sb(`pedidos?id=eq.${fila.id}`, {
      method: "PATCH",
      body: { modo_id: pago.id },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        id: pago.id,
        qr: pago.qr,
        deeplink: pago.deeplink,
        total: pedido.total,
        puntosGanados: emailValido ? pedido.puntosGanados : 0,
        ambiente: ambiente(),
      }),
    };
  } catch (err) {
    console.error("modo-checkout:", err);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "No se pudo generar el pago. Probá de nuevo en unos minutos." }),
    };
  }
};
