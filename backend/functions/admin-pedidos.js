// Administración protegida de pedidos (todos los canales).
//
//   GET                      → { pedidos: [...] }  (todos, más nuevos primero)
//   GET ?q=<texto>           → busca por número de pedido o email (contra la base)
//   GET ?limite=<n>          → cuántos traer (200 por defecto, 2000 máximo)
//   POST { accion, id }      → aprobar/rechazar un pedido de WhatsApp o manual
//   POST { accion: "cancelar", id, devolverStock }
//                            → cancela un pedido ya cobrado (cualquier canal): revierte
//                              puntos, libera el cupón y, si se pide, devuelve el stock
//   POST { accion: "crear", origen, nombre?, email?, metodo, notas?, cobrado, items:[{presentacion, qty, precio}],
//          cupon?, aplicarCantidad?, metodoPago?, aplicarTransferencia? }
//                            → carga un pedido a mano, con precio acordado
//   PATCH { id, mp_metodo }  → corrige el método de pago de Mercado Pago
//   DELETE ?id=<uuid>        → borra un pedido definitivamente

const { sb, sbRpc, obtenerCatalogo, obtenerCupon, cuponYaUsado } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");
const { itemsConCosto, obtenerCostos } = require("../lib/costos.js");
const { CONFIG, METODOS_MP, METODOS_PAGO_MANUAL, ESTADOS_ENTREGA, urlTracking, ORIGENES_MANUALES, calcularDescuentosManual } = require("../../public/motor.js");

const CAMPOS = "id,numero,origen,items,total,descuento_cantidad,cupon,descuento_cupon,cliente_email,estado,creado,puntos_ganados,puntos_canjeados,envio,envio_costo";

// Filtro de búsqueda por número de pedido o email. La búsqueda va contra la
// base y no contra los 200 que trae el panel: el pedido que se busca suele ser
// justamente uno viejo. Se limpian los caracteres que rompen la sintaxis de
// filtros de PostgREST (comas, paréntesis, comodines).
function filtroBusqueda(texto) {
  const limpio = String(texto || "").trim().replace(/[(),*"\\]/g, "").slice(0, 80);
  if (!limpio) return "";

  // "#0012", "0012" y "12" son el mismo pedido
  const soloNumero = limpio.replace(/^#/, "").replace(/^0+/, "");
  const numero = /^\d{1,9}$/.test(soloNumero) ? Number(soloNumero) : null;

  const porEmail = `cliente_email.ilike.*${encodeURIComponent(limpio)}*`;
  return numero != null
    ? `&or=(numero.eq.${numero},${porEmail})`
    : `&${porEmail.replace(".ilike.", "=ilike.")}`;
}

// Cuántos pedidos trae por defecto la lista, y el techo que puede pedir
// Insights (que necesita la serie completa para no calcular sobre una ventana
// recortada sin avisar).
const LIMITE_DEFECTO = 200;
const LIMITE_MAXIMO = 2000;

function limitePedido(valor) {
  const n = Number.parseInt(valor, 10);
  if (!Number.isInteger(n) || n < 1) return LIMITE_DEFECTO;
  return Math.min(n, LIMITE_MAXIMO);
}

// Columnas agregadas por migraciones: si falta alguna, el panel sigue andando
// degradando el SELECT al conjunto anterior.
async function traerPedidos(busqueda, limite) {
  const filtro = filtroBusqueda(busqueda);
  const orden = `${filtro}&order=creado.desc&limit=${limite}`;
  const intentos = [
    ",mp_metodo,confirmacion_enviada,metodo_pago,descuento_pago,estado_entrega,tracking_codigo,tracking_url,despachado_en,envio_costo_real",
    ",mp_metodo,confirmacion_enviada,metodo_pago,descuento_pago",
    ",mp_metodo,confirmacion_enviada",
    ",mp_metodo",
    "",
  ];
  for (const [i, extras] of intentos.entries()) {
    try {
      return await sb(`pedidos?select=${CAMPOS}${extras}${orden}`);
    } catch (err) {
      if (i === intentos.length - 1) throw err;
      console.warn("admin-pedidos: falta una columna opcional:", err.message);
    }
  }
}

// Pedido cargado a mano (venta mayorista o directa). Es el único lugar donde el
// precio no sale del motor: lo fija el admin autenticado porque es un precio
// negociado. Suma puntos Club Merla si tiene email, como en la tienda: se
// acreditan al marcarlo cobrado. Devuelve { statusCode, cuerpo }.
async function crearPedidoManual(body) {
  const falla = (statusCode, error) => ({ statusCode, cuerpo: { error } });

  const origen = String(body.origen || "");
  if (!ORIGENES_MANUALES.includes(origen)) return falla(400, "Elegí el canal de la venta");

  // Opcional: si no está, el mail saluda sin nombre
  const nombre = String(body.nombre || "").trim().slice(0, 120);

  const email = String(body.email || "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return falla(400, "El email no es válido");

  const pedidos = Array.isArray(body.items) ? body.items : [];
  if (!pedidos.length) return falla(400, "Agregá al menos un producto");

  const productos = await obtenerCatalogo();
  const lineas = [];
  const unidadesPorProducto = {};
  for (const item of pedidos) {
    const producto = productos.find((p) => (p.presentaciones || []).some((x) => x.id === item.presentacion));
    const presentacion = producto && producto.presentaciones.find((x) => x.id === item.presentacion);
    if (!presentacion) return falla(400, "Hay un producto que ya no está disponible");

    const qty = Number(item.qty);
    // El precio acordado puede llevar centavos: se guarda con dos decimales y
    // el total del pedido se redondea a pesos (calcularDescuentosManual).
    const precio = Math.round(Number(item.precio) * 100) / 100;
    if (!Number.isInteger(qty) || qty < 1) return falla(400, `Revisá la cantidad de ${producto.nombre}`);
    if (!Number.isFinite(precio) || precio <= 0) return falla(400, `Revisá el precio de ${producto.nombre}`);

    const unidades = presentacion.unidades_stock * qty;
    unidadesPorProducto[producto.id] = (unidadesPorProducto[producto.id] || 0) + unidades;
    if (unidadesPorProducto[producto.id] > producto.stock) {
      return falla(409, `No alcanza el stock de ${producto.nombre}: hay ${producto.stock} y pediste ${unidadesPorProducto[producto.id]}`);
    }
    lineas.push({
      producto_id: producto.id,
      presentacion_id: presentacion.id,
      nombre: producto.nombre,
      presentacionNombre: presentacion.nombre,
      qty,
      unidades,
      precioUnitario: precio,
      esPack: presentacion.unidades_stock > 1,
      esDrip: producto.tipo !== "simple" && presentacion.unidades_stock === 1,
    });
  }

  const metodoPago = String(body.metodoPago || "");
  if (metodoPago && !METODOS_PAGO_MANUAL.some((m) => m.clave === metodoPago)) return falla(400, "Método de pago inválido");

  let cupon = null;
  if (body.cupon) {
    cupon = await obtenerCupon(body.cupon);
    if (!cupon) return falla(400, "Cupón inválido");
    // Los cupones son de un solo uso por email: sin email no se puede controlar
    if (!email) return falla(400, "Para usar un cupón cargá el email del cliente");
    if (await cuponYaUsado(cupon.codigo, email)) return falla(409, "Este email ya usó ese cupón");
  }

  const { cfg } = await obtenerCostos();
  const descuentos = calcularDescuentosManual(lineas, {
    cupon,
    aplicarCantidad: Boolean(body.aplicarCantidad),
    aplicarTransferencia: metodoPago === "transferencia" && Boolean(body.aplicarTransferencia),
    redondeoTransferencia: cfg && cfg.redondeoTransferencia,
  });
  if (!descuentos.ok) return falla(400, descuentos.error);
  const { total } = descuentos;
  const notas = String(body.notas || "").trim().slice(0, 300);

  let fila;
  try {
    [fila] = await sb("pedidos", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        external_intention_id: `man-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        origen,
        items: await itemsConCosto(lineas, productos),
        subtotal: descuentos.subtotal,
        descuento_cantidad: descuentos.descuentoCantidad,
        cupon: cupon ? cupon.codigo : null,
        descuento_cupon: descuentos.descuentoCupon,
        total,
        // Solo si hay dato: así sin la migración se pueden seguir cargando pedidos sin método
        ...(metodoPago ? { metodo_pago: metodoPago } : {}),
        ...(descuentos.descuentoPago ? { descuento_pago: descuentos.descuentoPago } : {}),
        puntos_ganados: email ? Math.floor(total / 100) * CONFIG.fidelidad.puntosPorCien : 0,
        cliente_email: email || null,
        envio: { metodo: body.metodo === "envio" ? "envio" : "retiro", ...(nombre ? { nombre } : {}), ...(notas ? { notas } : {}) },
      },
    });
  } catch (err) {
    if (String(err.message).includes("pedidos_origen_check")) {
      return falla(409, "Falta correr supabase/migracion-pedido-manual.sql en Supabase");
    }
    if (/metodo_pago|descuento_pago/.test(String(err.message))) {
      return falla(409, "Falta correr supabase/migracion-pago-manual.sql en Supabase");
    }
    throw err;
  }

  if (body.cobrado) {
    const resultado = await sbRpc("aprobar_pedido_manual", { p_pedido_id: fila.id });
    if (!resultado.ok) {
      await sb(`pedidos?id=eq.${encodeURIComponent(fila.id)}`, { method: "DELETE" });
      return falla(409, resultado.error || "No se pudo marcar como cobrado");
    }
  }
  return { statusCode: 201, cuerpo: { numero: fila.numero, total, estado: body.cobrado ? "aprobado" : "pendiente" } };
}

// Cancela un pedido ya cobrado. Todo ocurre dentro de la función SQL
// `cancelar_pedido` (una sola transacción): le quita al cliente los puntos que
// había sumado, le devuelve los que canjeó, libera el cupón para que lo pueda
// volver a usar y, si `devolverStock`, repone las unidades. NO devuelve la
// plata: eso se hace aparte (Mercado Pago, transferencia). El pedido queda
// `cancelado` y deja de contar en Insights. Devuelve { statusCode, cuerpo }.
async function cancelarPedido(body) {
  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { statusCode: 400, cuerpo: { error: "Falta el id del pedido" } };

  let resultado;
  try {
    resultado = await sbRpc("cancelar_pedido", {
      p_pedido_id: id,
      p_devolver_stock: body.devolverStock !== false,
    });
  } catch (err) {
    // PGRST202 = la función no existe; el check = el estado 'cancelado' todavía no está permitido
    if (/PGRST202|pedidos_estado_check/.test(String(err.message))) {
      return { statusCode: 409, cuerpo: { error: "Falta correr supabase/migracion-cancelar-pedido.sql en Supabase" } };
    }
    throw err;
  }
  if (!resultado || !resultado.ok) {
    return { statusCode: 409, cuerpo: { error: (resultado && resultado.error) || "No se pudo cancelar el pedido" } };
  }
  return { statusCode: 200, cuerpo: resultado };
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "GET") {
      const { q, limite: limitePedido_ } = event.queryStringParameters || {};
      const limite = limitePedido(limitePedido_);
      const pedidos = await traerPedidos(q, limite);
      // `truncado` = hay más pedidos de los que entraron: Insights lo avisa en
      // vez de mostrar un total incompleto como si fuera el definitivo.
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ pedidos, limite, truncado: pedidos.length >= limite }),
      };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      if (body.accion === "crear") {
        const { statusCode, cuerpo } = await crearPedidoManual(body);
        return { statusCode, headers, body: JSON.stringify(cuerpo) };
      }
      if (body.accion === "cancelar") {
        const { statusCode, cuerpo } = await cancelarPedido(body);
        return { statusCode, headers, body: JSON.stringify(cuerpo) };
      }
      const { accion, id } = body;
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

    // Actualizar método de pago de MP o datos de despacho (estado_entrega,
    // tracking_codigo, tracking_url, envio_costo_real).
    if (event.httpMethod === "PATCH") {
      const body = JSON.parse(event.body || "{}");
      const { id } = body;
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Falta el id del pedido" }) };
      }

      const esDespacho = ["estado_entrega", "tracking_codigo", "tracking_url", "envio_costo_real"]
        .some((k) => k in body);

      if (esDespacho) {
        const cambios = {};
        if ("estado_entrega" in body) {
          if (!ESTADOS_ENTREGA.some((e) => e.clave === body.estado_entrega)) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "Estado de entrega inválido" }) };
          }
          cambios.estado_entrega = body.estado_entrega;
        }
        if ("tracking_codigo" in body) {
          cambios.tracking_codigo = String(body.tracking_codigo || "").trim().slice(0, 120) || null;
        }
        if ("tracking_url" in body) {
          const url = String(body.tracking_url || "").trim().slice(0, 400);
          if (url && !/^https?:\/\//i.test(url)) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "El link de seguimiento debe empezar con https://" }) };
          }
          cambios.tracking_url = url || null;
        }
        if ("envio_costo_real" in body) {
          const v = body.envio_costo_real === "" || body.envio_costo_real == null ? null : Math.round(Number(body.envio_costo_real));
          if (v !== null && (!Number.isFinite(v) || v < 0)) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "Costo real de envío inválido" }) };
          }
          cambios.envio_costo_real = v;
        }

        try {
          const [actual] = await sb(`pedidos?id=eq.${encodeURIComponent(id)}&select=id,envio,despachado_en,tracking_url&limit=1`);
          if (!actual) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: "Pedido inexistente" }) };
          }
          if (
            ["despachado", "listo_retiro", "entregado"].includes(cambios.estado_entrega) &&
            !actual.despachado_en
          ) {
            cambios.despachado_en = new Date().toISOString();
          }
          // Si se carga código de seguimiento sin URL explícita, armamos la oficial del correo
          if ("tracking_codigo" in cambios && !("tracking_url" in cambios)) {
            const transportista = actual.envio && actual.envio.transportista;
            cambios.tracking_url = cambios.tracking_codigo ? (urlTracking(transportista, cambios.tracking_codigo) || null) : null;
          }

          const [pedido] = await sb(`pedidos?id=eq.${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: cambios,
          });
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              ok: true,
              estado_entrega: pedido.estado_entrega,
              tracking_codigo: pedido.tracking_codigo,
              tracking_url: pedido.tracking_url,
              despachado_en: pedido.despachado_en,
              envio_costo_real: pedido.envio_costo_real,
            }),
          };
        } catch (err) {
          console.warn("admin-pedidos PATCH despacho:", err.message);
          return {
            statusCode: 409,
            headers,
            body: JSON.stringify({ error: "Falta correr supabase/migracion-despacho.sql en Supabase" }),
          };
        }
      }

      const metodo = body.mp_metodo;
      const valido = metodo == null || metodo === "" || METODOS_MP.some((m) => m.clave === metodo);
      if (!valido) {
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
