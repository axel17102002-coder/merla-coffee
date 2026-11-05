// Administración protegida de pedidos (todos los canales).
//
//   GET                      → { pedidos: [...] }  (todos, más nuevos primero)
//   GET ?q=<texto>           → busca por número de pedido o email (contra la base)
//   GET ?limite=<n>          → cuántos traer (200 por defecto, 2000 máximo)
//   POST { accion, id }      → aprobar/rechazar un pedido de WhatsApp o manual
//   POST { accion: "crear", origen, nombre, email?, metodo, notas?, cobrado, items:[{presentacion, qty, precio}] }
//                            → carga un pedido a mano, con precio acordado
//   PATCH { id, mp_metodo }  → corrige el método de pago de Mercado Pago
//   DELETE ?id=<uuid>        → borra un pedido definitivamente

const { sb, sbRpc, obtenerCatalogo } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");
const { itemsConCosto } = require("../lib/costos.js");
const { METODOS_MP, ORIGENES_MANUALES } = require("../../public/motor.js");

const CAMPOS = "id,numero,origen,items,total,cupon,descuento_cupon,cliente_email,estado,creado,puntos_ganados,puntos_canjeados,envio,envio_costo";

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

// `mp_metodo` (el medio con que se pagó en MP, para su comisión) puede no existir
// todavía: si falta la migración, el panel sigue andando sin esa columna.
async function traerPedidos(busqueda, limite) {
  const filtro = filtroBusqueda(busqueda);
  const orden = `${filtro}&order=creado.desc&limit=${limite}`;
  try {
    return await sb(`pedidos?select=${CAMPOS},mp_metodo${orden}`);
  } catch (err) {
    console.warn("admin-pedidos: falta mp_metodo (correr migracion-metodo-pago-mp.sql):", err.message);
    return await sb(`pedidos?select=${CAMPOS}${orden}`);
  }
}

// Pedido cargado a mano (venta mayorista o directa). Es el único lugar donde el
// precio no sale del motor: lo fija el admin autenticado porque es un precio
// negociado. No suma puntos Club Merla. Devuelve { statusCode, cuerpo }.
async function crearPedidoManual(body) {
  const falla = (statusCode, error) => ({ statusCode, cuerpo: { error } });

  const origen = String(body.origen || "");
  if (!ORIGENES_MANUALES.includes(origen)) return falla(400, "Elegí el canal de la venta");

  const nombre = String(body.nombre || "").trim().slice(0, 120);
  if (!nombre) return falla(400, "Poné el nombre del cliente");

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
    const precio = Number(item.precio);
    if (!Number.isInteger(qty) || qty < 1) return falla(400, `Revisá la cantidad de ${producto.nombre}`);
    if (!Number.isInteger(precio) || precio < 1) return falla(400, `Revisá el precio de ${producto.nombre}`);

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
    });
  }

  const total = lineas.reduce((t, l) => t + l.precioUnitario * l.qty, 0);
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
        subtotal: total,
        total,
        puntos_ganados: 0,
        cliente_email: email || null,
        envio: { metodo: body.metodo === "envio" ? "envio" : "retiro", nombre, ...(notas ? { notas } : {}) },
      },
    });
  } catch (err) {
    if (String(err.message).includes("pedidos_origen_check")) {
      return falla(409, "Falta correr supabase/migracion-pedido-manual.sql en Supabase");
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
