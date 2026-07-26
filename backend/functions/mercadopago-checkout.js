// POST /api/mercadopago-checkout
//   { items: [{presentacion, qty}], cupon: "CODIGO"|null, canjePuntos: bool, email: string|null }
//
// Crea una preferencia de Mercado Pago Checkout Pro y devuelve init_point
// (la URL a la que se redirige al cliente para pagar). Igual que con MODO,
// todo se recalcula acá con datos de Supabase: nunca se confía en montos del
// navegador. El pedido queda `pendiente` y se aprueba cuando MP confirma el
// pago (webhook o confirmar-pedido), descontando stock y acreditando puntos.

const { sb, obtenerCatalogo, obtenerCupon, obtenerPuntos, cuponYaUsado } = require("../lib/supabase.js");
const { ambienteMp, crearPreferencia } = require("../lib/mercadopago.js");
const { CONFIG, calcularPedido } = require("../../public/motor.js");
const { sanitizarEnvio } = require("../lib/entrega.js");
const { resolverEnvioCosto } = require("../lib/envio-costo.js");
const { itemsConCosto } = require("../lib/costos.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }
  if (!CONFIG.pagos.mercadopago) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "El pago con Mercado Pago está deshabilitado" }) };
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
      // Los cupones son de un solo uso por email
      if (!emailValido) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Para usar un cupón ingresá tu email" }) };
      }
      if (await cuponYaUsado(cupon.codigo, email)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Ya usaste este cupón" }) };
      }
    }

    let puntosDisponibles = null;
    if (body.canjePuntos) {
      puntosDisponibles = await obtenerPuntos(email);
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

    // Registrar el pedido (estado pendiente) antes de crear la preferencia.
    // `modo_id` guarda la referencia externa del pago (la columna es genérica:
    // sirve para matchear el webhook de cualquier pasarela).
    const externalId = `merla-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const filaPedido = {
      external_intention_id: externalId,
      modo_id: externalId,
      origen: "mercadopago",
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
      console.warn("mercadopago-checkout: reintento sin envio_costo (correr migracion-envio.sql):", err.message);
      const { envio_costo, ...sinEnvioCosto } = filaPedido;
      [fila] = await crearPedido(sinEnvioCosto);
    }

    // URL del sitio: SITE_URL manual, o la del propio request (Cloudflare/Netlify)
    const host = (event.headers && event.headers.host) || "";
    const esLocal = host.startsWith("localhost") || host.startsWith("127.");
    const sitio = process.env.SITE_URL || (host ? `${esLocal ? "http" : "https"}://${host}` : "");

    let preferencia;
    try {
      // MP no acepta ítems con monto negativo, así que si hay descuentos o
      // envío mandamos un único ítem por el total final para que la cuenta cierre.
      const itemsMp =
        pedido.total === pedido.subtotal
          ? pedido.lineas.map((l) => ({
              id: l.presentacion_id,
              title: `${l.nombre} - Drip Bag (${l.presentacionNombre})`,
              category_id: "food",
              quantity: l.qty,
              currency_id: "ARS",
              unit_price: l.precioUnitario,
            }))
          : [
              {
                id: "pedido",
                title: `Pedido Merla Coffee (${pedido.unidades} drip bags${pedido.envioCosto ? " + envío" : ", descuentos aplicados"})`,
                category_id: "food",
                quantity: 1,
                currency_id: "ARS",
                unit_price: pedido.total,
              },
            ];

      preferencia = await crearPreferencia({
        items: itemsMp,
        external_reference: externalId,
        metadata: { pedido_id: fila.id },
        statement_descriptor: "MERLA COFFEE",
        // Solo pagos instantáneos: se excluye el efectivo (Rapipago/Pago Fácil),
        // que tarda días en acreditar y no encaja con la limpieza de pendientes.
        payment_methods: { excluded_payment_types: [{ id: "ticket" }] },
        ...(sitio
          ? {
              back_urls: {
                success: `${sitio}/?pago=mp-ok`,
                pending: `${sitio}/?pago=mp-pendiente`,
                failure: `${sitio}/?pago=mp-no`,
              },
            }
          : {}),
        ...(sitio.startsWith("https://")
          ? {
              auto_return: "approved",
              notification_url: `${sitio}/api/mercadopago-webhook`,
            }
          : {}),
      });
    } catch (err) {
      // Si MP falló, no dejamos el pedido huérfano
      await sb(`pedidos?id=eq.${fila.id}`, { method: "DELETE" }).catch(() => {});
      throw err;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        init_point: preferencia.init_point,
        numero: fila.numero,
        total: pedido.total,
        puntosGanados: emailValido ? pedido.puntosGanados : 0,
        ambiente: await ambienteMp(),
      }),
    };
  } catch (err) {
    console.error("mercadopago-checkout:", err);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "No se pudo generar el pago. Probá de nuevo en unos minutos." }),
    };
  }
};
