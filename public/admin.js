const TOKEN_KEY = "merla-admin-token";
const $ = (s) => document.querySelector(s);
const formato = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function escapar(v) {
  return String(v || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}
function token() { return sessionStorage.getItem(TOKEN_KEY) || ""; }
function mensaje(id, texto = "", ok = false) {
  const el = $(id);
  el.textContent = texto;
  el.classList.toggle("ok", ok);
}

async function api(url, opciones = {}) {
  const res = await fetch(url, {
    ...opciones,
    headers: { "Content-Type": "application/json", "X-Admin-Token": token(), ...(opciones.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "No se pudo completar la operación");
  return data;
}

// número legible del pedido (#0001); antes de la migración usa el id como respaldo
function numeroDe(p) {
  return p.numero ? numeroPedido(p.numero) : "#" + String(p.id).slice(0, 8).toUpperCase();
}
const CANALES = { mercadopago: "Mercado Pago", whatsapp: "WhatsApp", modo: "MODO" };

// Etiqueta del método con que se pagó en MP (lo guarda el webhook al acreditarse)
function etiquetaMetodoMp(clave) {
  const m = METODOS_MP.find((x) => x.clave === clave);
  return m ? m.etiqueta : null;
}

// Selector del método de pago, solo en pedidos de Mercado Pago. El webhook lo
// completa solo; esto es para corregirlo (pedidos viejos, o cuando MP informa
// un medio que cae en "otros"). Cambia qué comisión se resta en Insights.
function selectorMetodoMp(p) {
  if (p.origen !== "mercadopago") return "";
  const opciones = [{ clave: "", etiqueta: "Sin especificar" }].concat(METODOS_MP)
    .map((m) => `<option value="${m.clave}"${(p.mp_metodo || "") === m.clave ? " selected" : ""}>${escapar(m.etiqueta)}</option>`)
    .join("");
  return `<div class="pedido__pago">
      <span class="pedido__pago-label">💳 Pagó con</span>
      <select class="pedido__metodo" data-metodo data-id="${escapar(p.id)}" aria-label="Método de pago de Mercado Pago">${opciones}</select>
      <span class="pedido__metodo-estado" data-metodo-estado></span>
    </div>`;
}

// Línea de entrega para la tarjeta del pedido (retiro o dirección de envío)
function renderEntrega(envio) {
  if (!envio || !envio.metodo) return "";
  if (envio.metodo === "retiro") return `<p class="pedido__extra">🏪 Retiro en el local</p>`;
  const partes = [envio.direccion, envio.ciudad, envio.provincia, envio.cp && `CP ${envio.cp}`].filter(Boolean).map(escapar).join(", ");
  return `<p class="pedido__extra">📦 Envío a: ${escapar(envio.nombre)} — ${partes}${envio.telefono ? " · Tel " + escapar(envio.telefono) : ""}${envio.notas ? " · " + escapar(envio.notas) : ""}</p>`;
}

// ===== Pedidos =====
let pedidosCache = [];
let filtroCanal = "todos";

function renderPedidos() {
  const contenedor = $("#pedidos");
  const lista = filtroCanal === "todos" ? pedidosCache : pedidosCache.filter((p) => p.origen === filtroCanal);
  if (!lista.length) {
    contenedor.innerHTML = `<div class="vacio">No hay pedidos${filtroCanal === "todos" ? " todavía" : ` de ${CANALES[filtroCanal] || filtroCanal}`}.</div>`;
    return;
  }
  contenedor.innerHTML = lista.map((p) => {
    const lineas = (p.items || []).map((i) => `<li><span>${escapar(i.qty)}× ${escapar(i.nombre)}</span> <span>${formato.format(i.precio_unitario * i.qty)}</span></li>`).join("");
    const fecha = new Date(p.creado).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" });
    const canal = CANALES[p.origen] || p.origen || "—";
    const pendienteWsp = p.estado === "pendiente" && p.origen === "whatsapp";
    const cupon = p.cupon ? `<p class="pedido__extra">Cupón ${escapar(p.cupon)}: -${formato.format(p.descuento_cupon || 0)}</p>` : "";
    const puntos = p.cliente_email ? `<p class="pedido__extra">Puntos: +${p.puntos_ganados}${p.puntos_canjeados ? ` · canje -${p.puntos_canjeados}` : ""}</p>` : "";
    const entrega = renderEntrega(p.envio);
    return `<article class="pedido pedido--${escapar(p.estado)}">
      <div class="pedido__top">
        <div class="pedido__top-izq">
          <span class="pedido__num">${escapar(numeroDe(p))}</span>
          <span class="estado">${escapar(p.estado)}</span>
          <span class="canal canal--${escapar(p.origen)}">${escapar(canal)}</span>
        </div>
        <time>${fecha}</time>
      </div>
      <ul>${lineas}</ul>
      <div class="pedido__meta">
        <span class="pedido__email">${escapar(p.cliente_email || "Sin email")}</span>
        <strong>${formato.format(p.total)}</strong>
      </div>
      ${cupon}${puntos}${entrega}${selectorMetodoMp(p)}
      <div class="pedido__actions">
        <button class="borrar" data-action="eliminar" data-id="${escapar(p.id)}" title="Eliminar pedido">🗑 Eliminar</button>
        ${p.cliente_email ? `<button class="mail" data-action="mail" data-id="${escapar(p.id)}" title="Enviar confirmación por mail">✉️ Confirmación</button>` : ""}
        ${pendienteWsp ? `<button class="rechazar" data-action="rechazar" data-id="${escapar(p.id)}">Rechazar</button>
        <button class="aprobar" data-action="aprobar" data-id="${escapar(p.id)}">Marcar cobrado</button>` : ""}
      </div>
    </article>`;
  }).join("");
}

async function cargarPedidos() {
  mensaje("#panel-message", "Cargando pedidos…");
  try {
    // Los costos (para la contribución marginal) se traen en paralelo y no
    // frenan la carga si fallan: la contribución simplemente queda sin costo.
    const [{ pedidos }] = await Promise.all([api("/api/admin-pedidos"), cargarCostosInsights()]);
    pedidosCache = pedidos;
    renderPedidos();
    renderInsights();
    mensaje("#panel-message", "");
  } catch (err) {
    mensaje("#panel-message", `⚠️ ${err.message}`);
    if (/autorizado/i.test(err.message)) cerrarSesion();
  }
}

// ===== Insights =====
// Sale de los pedidos que ya carga la pestaña Pedidos, más los costos por
// producto (admin-precios) para la contribución marginal. "Pendientes" es lo
// más parecido a un carrito en curso, porque el carrito no toca el backend.

// Costos por producto para la contribución marginal. café: costo por drip bag y
// por pack (ya con insumos); simple: costo por unidad. Más el origen (para el
// rendimiento por lote). Se cargan una vez, junto con los pedidos.
let costosPorProducto = null;
// Comisiones de Mercado Pago de la config: el promedio general y el % de cada
// método de pago (el pedido guarda con cuál se pagó en `mp_metodo`).
let cfgComisionMp = { comisionMp: 0, comisionMpMetodos: {} };
async function cargarCostosInsights() {
  try {
    const { productos, cfg } = await api("/api/admin-precios");
    cfgComisionMp = {
      comisionMp: cfg && Number(cfg.comisionMp) > 0 ? Number(cfg.comisionMp) : 0,
      comisionMpMetodos: (cfg && cfg.comisionMpMetodos) || {},
    };
    costosPorProducto = {};
    for (const p of productos) {
      costosPorProducto[p.id] = {
        costoUnidad: p.tipo === "simple" ? (p.costo != null ? p.costo : null) : (p.costoUnidad != null ? p.costoUnidad : null),
        costoPack: p.tipo === "simple" ? null : (p.costoPack != null ? p.costoPack : null),
        origen: p.origen || null,
      };
    }
  } catch {
    costosPorProducto = costosPorProducto || {};
  }
}

// ¿Hay alguna comisión de MP cargada? (el promedio o la de algún método)
function hayComisionMp() {
  const m = cfgComisionMp.comisionMpMetodos || {};
  return cfgComisionMp.comisionMp > 0 || Object.keys(m).some((k) => Number(m[k]) > 0);
}

// Contribución marginal de un pedido cobrado: ingreso de productos (total menos
// envío, que es un pass-through al correo) menos el costo de los productos.
// `revSinCosto` = facturación de líneas sin costo cargado (ese margen queda
// inflado, porque cuenta como si no costara nada).
//
// Cada línea guarda `costo_linea`: lo que costó el día de la venta. Los pedidos
// anteriores a ese cambio no lo tienen y caen en los costos de HOY — su margen
// se mueve si cambian los costos, pero es lo único que se puede reconstruir.
function contribucionPedido(p) {
  const costos = costosPorProducto || {};
  let costo = 0, revSinCosto = 0;
  for (const it of p.items || []) {
    const c = costos[it.producto_id];
    const unidades = Number(it.unidades) || 0;
    const qty = Number(it.qty) || 0;
    const rev = (Number(it.precio_unitario) || 0) * qty;
    const esPack = qty > 0 && unidades / qty > 1;
    let lc = it.costo_linea != null ? Number(it.costo_linea) : null;
    if (lc == null && c) {
      if (esPack && c.costoPack != null) lc = c.costoPack * qty;
      else if (c.costoUnidad != null) lc = c.costoUnidad * unidades;
    }
    if (lc != null) costo += lc;
    else revSinCosto += rev;
  }
  const ingresoProducto = (Number(p.total) || 0) - (Number(p.envio_costo) || 0);
  // Comisión de Mercado Pago: solo los pedidos cobrados por ese medio, con el %
  // del método con que se pagó (o el promedio si no se sabe). Ver motor.js.
  const comision = comisionMpDe(p, cfgComisionMp);
  return { margen: ingresoProducto - costo - comision, revSinCosto };
}

function calcularInsights(pedidos) {
  const aprobados = pedidos.filter((p) => p.estado === "aprobado");
  const pendientes = pedidos.filter((p) => p.estado === "pendiente");
  const rechazados = pedidos.filter((p) => p.estado === "rechazado");
  const facturacion = aprobados.reduce((t, p) => t + (Number(p.total) || 0), 0);
  const ticketPromedio = aprobados.length ? facturacion / aprobados.length : 0;
  const conCupon = pedidos.filter((p) => p.cupon);
  const descuentoTotal = conCupon.reduce((t, p) => t + (Number(p.descuento_cupon) || 0), 0);

  // Contribución marginal total y facturación sin costo conocido
  let contribucion = 0, revSinCosto = 0;
  for (const p of aprobados) {
    const r = contribucionPedido(p);
    contribucion += r.margen;
    revSinCosto += r.revSinCosto;
  }

  const porCanal = {};
  for (const p of pedidos) {
    const canal = p.origen || "otro";
    porCanal[canal] = (porCanal[canal] || 0) + 1;
  }

  // Ranking de productos: unidades vendidas por nombre (solo pedidos cobrados)
  const unidadesPorProducto = {};
  for (const p of aprobados) {
    for (const it of p.items || []) {
      const nombre = it.nombre || "—";
      unidadesPorProducto[nombre] = (unidadesPorProducto[nombre] || 0) + (Number(it.qty) || 0);
    }
  }
  const topProductos = Object.entries(unidadesPorProducto)
    .map(([nombre, unidades]) => ({ nombre, unidades }))
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, 5);

  // Tasa de recompra: clientes (por email) con 2+ compras cobradas ÷ total
  const comprasPorEmail = {};
  for (const p of aprobados) {
    const email = (p.cliente_email || "").trim().toLowerCase();
    if (email) comprasPorEmail[email] = (comprasPorEmail[email] || 0) + 1;
  }
  const clientes = Object.keys(comprasPorEmail).length;
  const repiten = Object.values(comprasPorEmail).filter((n) => n >= 2).length;
  const tasaRecompra = clientes ? Math.round((repiten / clientes) * 100) : null;

  // Rendimiento por origen/lote: unidades y facturación (solo cafés con origen)
  const costos = costosPorProducto || {};
  const porOrigen = {};
  for (const p of aprobados) {
    for (const it of p.items || []) {
      const origen = costos[it.producto_id] && costos[it.producto_id].origen;
      if (!origen) continue;
      if (!porOrigen[origen]) porOrigen[origen] = { unidades: 0, revenue: 0 };
      porOrigen[origen].unidades += Number(it.unidades) || 0;
      porOrigen[origen].revenue += (Number(it.precio_unitario) || 0) * (Number(it.qty) || 0);
    }
  }
  const rendimientoOrigen = Object.entries(porOrigen)
    .map(([origen, v]) => ({ origen, ...v }))
    .sort((a, b) => b.unidades - a.unidades);

  // Cómo pagan, en todos los canales: pedidos, facturación y comisión por medio
  // de pago. Los de Mercado Pago se abren por método (el que informa MP); los
  // de WhatsApp son transferencia/depósito y no pagan comisión. Los de MP sin
  // método guardado van juntos en "sin_dato", con la comisión promedio.
  const porMedio = {};
  let comisionMpTotal = 0, facturacionMp = 0;
  for (const p of aprobados) {
    const clave = p.origen === "mercadopago" ? (p.mp_metodo || "sin_dato") : (p.origen || "otro");
    if (!porMedio[clave]) porMedio[clave] = { clave, pedidos: 0, facturacion: 0, comision: 0 };
    const total = Number(p.total) || 0;
    const comision = comisionMpDe(p, cfgComisionMp);
    porMedio[clave].pedidos++;
    porMedio[clave].facturacion += total;
    porMedio[clave].comision += comision;
    comisionMpTotal += comision;
    if (p.origen === "mercadopago") facturacionMp += total;
  }
  const metodosPago = Object.values(porMedio).sort((a, b) => b.facturacion - a.facturacion);

  return {
    aprobados, pendientes, rechazados, facturacion, contribucion, revSinCosto,
    ticketPromedio, conCupon, descuentoTotal, porCanal, topProductos,
    tasaRecompra, clientes, repiten, rendimientoOrigen,
    metodosPago, comisionMpTotal, facturacionMp,
  };
}

// ===== Filtro de rango y granularidad =====
// El filtro achica pedidosCache a un período; la serie de ventas se agrupa por
// semana o mes. Ojo: todo se calcula sobre los últimos 200 pedidos que trae el
// panel, así que un rango más viejo que esa ventana quedaría incompleto.
let insightsRango = "todo";        // todo | este-mes | 30-dias | este-anio
let insightsGranularidad = "mes";  // semana | mes (solo el gráfico de tendencia)

// Fecha desde la que empieza el rango (o null = sin límite)
function inicioDeRango(rango) {
  const ahora = new Date();
  if (rango === "este-mes") return new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  if (rango === "30-dias") { const d = new Date(ahora); d.setDate(d.getDate() - 30); return d; }
  if (rango === "este-anio") return new Date(ahora.getFullYear(), 0, 1);
  return null;
}

function pedidosEnRango() {
  const desde = inicioDeRango(insightsRango);
  if (!desde) return pedidosCache;
  return pedidosCache.filter((p) => { const d = new Date(p.creado); return !isNaN(d) && d >= desde; });
}

// Pedidos del período inmediatamente anterior, del mismo largo que el elegido
// (para los deltas "vs período anterior"). Null en "Todo": no hay con qué comparar.
function pedidosPeriodoAnterior() {
  const desde = inicioDeRango(insightsRango);
  if (!desde) return null;
  const dur = Date.now() - desde.getTime();
  const desdePrev = new Date(desde.getTime() - dur);
  return pedidosCache.filter((p) => {
    const d = new Date(p.creado);
    return !isNaN(d) && d >= desdePrev && d < desde;
  });
}

// Variación relativa (%). Null si no hay base para comparar.
function variacion(actual, anterior) {
  if (anterior == null || anterior === 0) return null;
  return Math.round(((actual - anterior) / Math.abs(anterior)) * 100);
}

// Chip de delta: ▲/▼ + valor. `positivoEsBueno=false` invierte el color (para
// métricas donde subir es malo). Vacío si no hay dato.
function chipDelta(valor, { sufijo = "%", positivoEsBueno = true } = {}) {
  if (valor == null) return "";
  const sube = valor >= 0;
  const bien = sube === positivoEsBueno;
  const flecha = sube ? "▲" : "▼";
  return `<span class="delta delta--${bien ? "bien" : "mal"}">${flecha} ${Math.abs(valor)}${sufijo}</span>`;
}

// Sparkline: mini SVG de tendencia (una línea, sin ejes) para el stat tile.
function sparkline(valores) {
  const v = valores.filter((x) => Number.isFinite(x));
  if (v.length < 2) return "";
  const w = 96, h = 28, pad = 3;
  const min = Math.min(...v), max = Math.max(...v);
  const rango = max - min || 1;
  const puntos = v.map((y, x) => {
    const px = pad + (x / (v.length - 1)) * (w - pad * 2);
    const py = pad + (1 - (y - min) / rango) * (h - pad * 2);
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  });
  const ult = puntos[puntos.length - 1].split(",");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${puntos.join(" ")}" fill="none" stroke="var(--verde-claro)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${ult[0]}" cy="${ult[1]}" r="2.6" fill="var(--verde)"/>
    </svg>`;
}

// Serie de un valor por semana (últimas N) para las sparklines, sobre toda la
// cache (la tendencia reciente no depende del filtro de rango).
function serieSparkline(valorFn, n = 12) {
  const aprobados = pedidosCache.filter((p) => p.estado === "aprobado");
  const buckets = {};
  for (const p of aprobados) {
    const d = new Date(p.creado);
    if (isNaN(d)) continue;
    const clave = inicioSemana(d).toISOString().slice(0, 10);
    buckets[clave] = (buckets[clave] || 0) + valorFn(p);
  }
  return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).slice(-n).map(([, v]) => v);
}

// Lunes de la semana de una fecha (semana arranca lunes)
function inicioSemana(fecha) {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function etiquetaBucket(fecha, granularidad) {
  return granularidad === "semana"
    ? fecha.toLocaleDateString("es-AR", { day: "numeric", month: "short" })
    : fecha.toLocaleString("es-AR", { month: "short" });
}

// Serie agrupada por semana (últimas 8) o mes (últimos 6). `valorFn(pedido)`
// decide qué se suma en cada bucket: facturación (total) o contribución.
function serieAgrupada(aprobados, granularidad, valorFn) {
  const buckets = {};
  for (const p of aprobados) {
    const d = new Date(p.creado);
    if (isNaN(d)) continue;
    const inicio = granularidad === "semana" ? inicioSemana(d) : new Date(d.getFullYear(), d.getMonth(), 1);
    const clave = inicio.toISOString().slice(0, 10);
    if (!buckets[clave]) buckets[clave] = { total: 0, fecha: inicio };
    buckets[clave].total += valorFn(p);
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(granularidad === "semana" ? -8 : -6)
    .map(([clave, v]) => ({ clave, total: v.total, etiqueta: etiquetaBucket(v.fecha, granularidad) }));
}

function renderInsights() {
  sincronizarFiltrosInsights();
  const i = calcularInsights(pedidosEnRango());
  const anteriores = pedidosPeriodoAnterior();
  const prev = anteriores ? calcularInsights(anteriores) : null;

  renderPulso(i, prev);
  renderTendencia(i.aprobados);
  renderClientes(i);
  renderOrigen(i.rendimientoOrigen);
  renderTopProductos(i.topProductos);
  renderCanal(i.porCanal);
  renderMetodosPago(i);
  renderOps(i);
}

// ① Pulso: las 4 métricas que importan, con delta vs período anterior y una
// mini-tendencia. Reemplaza los dos hero gigantes y la fila plana de KPIs.
function renderPulso(i, prev) {
  const margenPct = i.facturacion > 0 ? Math.round((i.contribucion / i.facturacion) * 100) : null;
  const dFact = prev ? variacion(i.facturacion, prev.facturacion) : null;
  const dCM = prev ? variacion(i.contribucion, prev.contribucion) : null;
  const dPed = prev ? i.aprobados.length - prev.aprobados.length : null;
  const dRec = prev && i.tasaRecompra != null && prev.tasaRecompra != null ? i.tasaRecompra - prev.tasaRecompra : null;

  const tile = (label, valor, delta, nota, spark, destacado) => `
    <div class="pulso__tile${destacado ? " pulso__tile--destacado" : ""}">
      <span class="pulso__label">${label}</span>
      <div class="pulso__fila"><strong class="pulso__valor">${valor}</strong>${delta}</div>
      <div class="pulso__pie">${nota ? `<span class="pulso__nota">${nota}</span>` : "<span></span>"}${spark || ""}</div>
    </div>`;

  $("#pulso").innerHTML =
    tile("Facturación", formato.format(i.facturacion), chipDelta(dFact),
      `${i.aprobados.length} pedido${i.aprobados.length === 1 ? "" : "s"}`,
      sparkline(serieSparkline((p) => Number(p.total) || 0))) +
    tile("Contribución marginal", formato.format(Math.round(i.contribucion)), chipDelta(dCM),
      margenPct != null ? `${margenPct}% de margen${i.revSinCosto > 0 ? " · faltan costos" : ""}` : "",
      sparkline(serieSparkline((p) => contribucionPedido(p).margen))) +
    tile("Recompra", i.tasaRecompra != null ? i.tasaRecompra + "%" : "—", chipDelta(dRec, { sufijo: " pts" }),
      `${i.repiten}/${i.clientes} cliente${i.clientes === 1 ? "" : "s"} volvieron`, "", true) +
    tile("Pedidos", String(i.aprobados.length), chipDelta(dPed, { sufijo: "" }),
      `ticket ${formato.format(Math.round(i.ticketPromedio))}`,
      sparkline(serieSparkline(() => 1)));
}

// ② Tendencia: un solo gráfico. Cada barra es la facturación, partida en
// contribución (verde) + costo/envío (gris). Una sola escala ($), sin doble eje.
function renderTendencia(aprobados) {
  const g = insightsGranularidad;
  const fact = serieAgrupada(aprobados, g, (p) => Number(p.total) || 0);
  const cmPorClave = {};
  for (const s of serieAgrupada(aprobados, g, (p) => contribucionPedido(p).margen)) cmPorClave[s.clave] = s.total;
  const max = Math.max(...fact.map((s) => s.total), 0) || 1;
  const H = 150; // alto del área de barras (px)
  const cuerpo = !fact.length
    ? `<div class="vacio">Sin datos en este período.</div>`
    : `<div class="cols">` + fact.map((s) => {
        const facturacion = s.total;
        const margen = Math.max(0, cmPorClave[s.clave] || 0);
        const costo = Math.max(0, facturacion - margen);
        return `<div class="cols__col" title="${escapar(s.etiqueta)} · facturación ${formato.format(Math.round(facturacion))} · contribución ${formato.format(Math.round(cmPorClave[s.clave] || 0))}">
            <span class="cols__valor">${formato.format(Math.round(facturacion))}</span>
            <div class="cols__stack">
              <div class="cols__seg cols__seg--costo" style="height:${((costo / max) * H).toFixed(1)}px"></div>
              <div class="cols__seg cols__seg--margen" style="height:${((margen / max) * H).toFixed(1)}px"></div>
            </div>
            <span class="cols__mes">${escapar(s.etiqueta)}</span>
          </div>`;
      }).join("") + `</div>`;
  $("#tendencia").innerHTML = `
    <div class="stats-panel__head">
      <div>
        <h3 class="stats-panel__titulo">Facturación y margen en el tiempo</h3>
        <p class="stats-panel__sub">Cada barra es la facturación; el verde es la contribución${hayComisionMp() ? " (neta de la comisión de Mercado Pago)" : ""}</p>
      </div>
      <div class="stats-toggle" id="tendencia-toggle">
        <button data-gran="semana" class="${g === "semana" ? "activo" : ""}">Semana</button>
        <button data-gran="mes" class="${g === "semana" ? "" : "activo"}">Mes</button>
      </div>
    </div>
    <div class="leyenda">
      <span class="leyenda__item"><i class="leyenda__sw leyenda__sw--margen"></i>Contribución</span>
      <span class="leyenda__item"><i class="leyenda__sw leyenda__sw--costo"></i>Costo / envío</span>
    </div>` + cuerpo;
}

// Primera compra (fecha) por email en toda la cache: sirve para separar clientes
// nuevos de recurrentes.
function primeraCompraPorEmail() {
  const mapa = {};
  for (const p of pedidosCache) {
    if (p.estado !== "aprobado") continue;
    const email = (p.cliente_email || "").trim().toLowerCase();
    if (!email) continue;
    const d = new Date(p.creado);
    if (isNaN(d)) continue;
    if (!mapa[email] || d < mapa[email]) mapa[email] = d;
  }
  return mapa;
}

// ③ Clientes: nuevos vs recurrentes en el período (según su primera compra).
function renderClientes(i) {
  const primera = primeraCompraPorEmail();
  const desde = inicioDeRango(insightsRango);
  const vistos = new Set();
  let nuevos = 0, recurrentes = 0;
  for (const p of i.aprobados) {
    const email = (p.cliente_email || "").trim().toLowerCase();
    if (!email || vistos.has(email)) continue;
    vistos.add(email);
    if (!desde || (primera[email] && primera[email] >= desde)) nuevos++; else recurrentes++;
  }
  const total = nuevos + recurrentes;
  const cuerpo = !total
    ? `<div class="vacio">Sin clientes con email en este período.</div>`
    : `<div class="split">
         <div class="split__barra">
           <div class="split__parte split__parte--rec" style="width:${(recurrentes / total) * 100}%"></div>
           <div class="split__parte split__parte--nue" style="width:${(nuevos / total) * 100}%"></div>
         </div>
         <div class="split__leyenda">
           <span><i class="leyenda__sw leyenda__sw--margen"></i>Recurrentes <b>${recurrentes}</b></span>
           <span><i class="leyenda__sw leyenda__sw--costo"></i>Nuevos <b>${nuevos}</b></span>
         </div>
       </div>`;
  $("#stats-clientes").innerHTML =
    `<h3 class="stats-panel__titulo">Clientes</h3>
     <p class="stats-panel__sub">Nuevos vs recurrentes en el período · recompra ${i.tasaRecompra != null ? i.tasaRecompra + "%" : "—"}</p>` + cuerpo;
}

// ④ Por canal, como ranking (dónde entran los pedidos)
function renderCanal(porCanal) {
  const canales = Object.entries(porCanal);
  const cuerpo = !canales.length
    ? `<div class="vacio">Todavía no hay pedidos.</div>`
    : (() => {
        const max = Math.max(...canales.map(([, n]) => n)) || 1;
        return `<div class="rank">` + canales.map(([canal, n]) => `<div class="rank__fila">
            <span class="rank__nombre"><span class="canal canal--${escapar(canal)}">${escapar(CANALES[canal] || canal)}</span></span>
            <span class="rank__valor">${n} pedido${n === 1 ? "" : "s"}</span>
            <div class="rank__track"><div class="rank__barra" style="width:${(n / max) * 100}%"></div></div>
          </div>`).join("") + `</div>`;
      })();
  $("#stats-canal").innerHTML =
    `<h3 class="stats-panel__titulo">Por canal</h3>
     <p class="stats-panel__sub">Pedidos por canal de compra</p>` + cuerpo;
}

// Nombre y aclaración de cada medio de pago del panel. Los métodos de MP salen
// de METODOS_MP; los otros canales cobran de otra forma (WhatsApp = transferencia).
function medioDePago(clave) {
  if (clave === "sin_dato") {
    return { etiqueta: "Sin dato", nota: "Pedidos de Mercado Pago anteriores al registro del método: se les aplica la comisión promedio", dudoso: true };
  }
  if (clave === "whatsapp") {
    return { etiqueta: "Transferencia", nota: "Pedidos coordinados por WhatsApp: transferencia o depósito, sin comisión" };
  }
  if (clave === "modo") return { etiqueta: "MODO", nota: "Pedidos cobrados con MODO" };
  const etiqueta = etiquetaMetodoMp(clave);
  if (!etiqueta) return { etiqueta: clave, nota: clave };
  // La etiqueta de "dinero en cuenta" ya dice Mercado Pago: no lo repetimos
  return { etiqueta, nota: etiqueta.includes("Mercado Pago") ? etiqueta : `Mercado Pago · ${etiqueta}` };
}

// Cómo pagan, en todos los canales, y qué comisión deja cada medio. Ranking por
// facturación; la comisión va al lado porque es la razón de ser del panel.
function renderMetodosPago(i) {
  const lista = i.metodosPago;
  const pctEfectivo = i.facturacionMp > 0 ? (i.comisionMpTotal / i.facturacionMp) * 100 : null;
  const cuerpo = !lista.length
    ? `<div class="vacio">Sin pedidos cobrados en este período.</div>`
    : (() => {
        const max = Math.max(...lista.map((m) => m.facturacion)) || 1;
        return `<div class="rank">` + lista.map((m) => {
          const { etiqueta, nota, dudoso } = medioDePago(m.clave);
          const pct = m.facturacion > 0 ? (m.comision / m.facturacion) * 100 : 0;
          return `<div class="rank__fila">
            <span class="rank__nombre" title="${escapar(nota)}">${escapar(etiqueta)}${dudoso ? " <span class=\"rank__aviso\">?</span>" : ""}</span>
            <span class="rank__valor">${m.pedidos} ped. · ${formato.format(Math.round(m.facturacion))}${m.comision > 0 ? ` · <b class="rank__costo">−${formato.format(Math.round(m.comision))}</b> (${pct.toFixed(1)}%)` : ""}</span>
            <div class="rank__track"><div class="rank__barra" style="width:${(m.facturacion / max) * 100}%"></div></div>
          </div>`;
        }).join("") + `</div>`;
      })();
  const sub = !lista.length || !hayComisionMp()
    ? "Pedidos cobrados por medio de pago (cargá las comisiones en Precios para ver cuánto se lleva Mercado Pago)"
    : `Comisión de Mercado Pago en el período <b>${formato.format(Math.round(i.comisionMpTotal))}</b> · ${pctEfectivo.toFixed(1)}% de lo cobrado por MP · la transferencia no paga comisión`;
  $("#stats-metodos").innerHTML =
    `<h3 class="stats-panel__titulo">Cómo pagan</h3>
     <p class="stats-panel__sub">${sub}</p>` + cuerpo;
}

// ⑤ Operación: consulta ocasional, compacta y al final.
function renderOps(i) {
  const item = (valor, label, nota, cls = "") => `
    <div class="ops__item${cls ? " " + cls : ""}">
      <strong class="ops__valor">${valor}</strong>
      <span class="ops__label">${label}${nota ? ` · ${nota}` : ""}</span>
    </div>`;
  $("#ops").innerHTML =
    item(i.pendientes.length, "Pendientes", '≈ "carritos" en curso', "ops__item--pendiente") +
    item(i.rechazados.length, "Rechazados", "", "ops__item--rechazado") +
    item(i.conCupon.length, "Cupones usados", `${formato.format(i.descuentoTotal)} en descuentos`);
}

// Ranking horizontal: la barra más larga fija la escala (100%); una sola serie,
// así que el color es el verde de marca y no hace falta leyenda.
function renderTopProductos(top) {
  const cuerpo = !top.length
    ? `<div class="vacio">Sin ventas cobradas todavía.</div>`
    : (() => {
        const max = Math.max(...top.map((p) => p.unidades)) || 1;
        return `<div class="rank">` + top.map((p) => `<div class="rank__fila">
            <span class="rank__nombre" title="${escapar(p.nombre)}">${escapar(p.nombre)}</span>
            <span class="rank__valor">${p.unidades} u.</span>
            <div class="rank__track"><div class="rank__barra" style="width:${(p.unidades / max) * 100}%"></div></div>
          </div>`).join("") + `</div>`;
      })();
  $("#stats-top-productos").innerHTML =
    `<h3 class="stats-panel__titulo">Más vendidos</h3>
     <p class="stats-panel__sub">Unidades en pedidos cobrados</p>` + cuerpo;
}

// Rendimiento por origen/lote: ranking horizontal por unidades, con la
// facturación al lado (una sola serie → verde de marca).
function renderOrigen(lista) {
  const cuerpo = !lista.length
    ? `<div class="vacio">Sin ventas con origen cargado.</div>`
    : (() => {
        const max = Math.max(...lista.map((o) => o.unidades)) || 1;
        return `<div class="rank">` + lista.map((o) => `<div class="rank__fila">
            <span class="rank__nombre" title="${escapar(o.origen)}">${escapar(o.origen)}</span>
            <span class="rank__valor">${o.unidades} u. · ${formato.format(Math.round(o.revenue))}</span>
            <div class="rank__track"><div class="rank__barra" style="width:${(o.unidades / max) * 100}%"></div></div>
          </div>`).join("") + `</div>`;
      })();
  $("#stats-origen").innerHTML =
    `<h3 class="stats-panel__titulo">Rendimiento por origen</h3>
     <p class="stats-panel__sub">Unidades y facturación por lote/origen (cafés)</p>` + cuerpo;
}

// Marca el preset de rango activo (los botones son estáticos en el HTML)
function sincronizarFiltrosInsights() {
  $("#stats-filtros").querySelectorAll("button").forEach((b) =>
    b.classList.toggle("filtro-activo", b.dataset.rango === insightsRango));
}

// Cambiar el rango de fechas: recalcula todo
$("#stats-filtros").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rango]");
  if (!b || b.dataset.rango === insightsRango) return;
  insightsRango = b.dataset.rango;
  renderInsights();
});

// Toggle semana/mes del gráfico de tendencia (encabezado re-renderizado)
$("#tendencia").addEventListener("click", (e) => {
  const b = e.target.closest("[data-gran]");
  if (!b || b.dataset.gran === insightsGranularidad) return;
  insightsGranularidad = b.dataset.gran;
  renderTendencia(calcularInsights(pedidosEnRango()).aprobados);
});

$("#filtros").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filtro]");
  if (!b) return;
  filtroCanal = b.dataset.filtro;
  $("#filtros").querySelectorAll("button").forEach((x) => x.classList.toggle("filtro-activo", x === b));
  renderPedidos();
});

$("#pedidos").addEventListener("click", async (e) => {
  const boton = e.target.closest("[data-action]");
  if (!boton) return;
  const { action, id } = boton.dataset;
  if (action === "eliminar" && !confirm("¿Eliminar este pedido definitivamente? No se puede deshacer.")) return;
  if (action === "rechazar" && !confirm("¿Rechazar este pedido pendiente?")) return;
  if (action === "aprobar" && !confirm("¿Confirmar el cobro? Esto descuenta stock y actualiza puntos.")) return;
  if (action === "mail" && !confirm("¿Enviar el mail de confirmación al cliente?")) return;
  boton.disabled = true;
  try {
    if (action === "eliminar") {
      await api(`/api/admin-pedidos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } else if (action === "mail") {
      const r = await api("/api/admin-mail", { method: "POST", body: JSON.stringify({ pedido_id: id }) });
      mensaje("#panel-message", `✅ Confirmación enviada a ${r.para}`, true);
      boton.disabled = false;
      return;
    } else {
      await api("/api/admin-pedidos", { method: "POST", body: JSON.stringify({ accion: action, id }) });
    }
    await cargarPedidos();
  } catch (err) {
    mensaje("#panel-message", `⚠️ ${err.message}`);
    boton.disabled = false;
  }
});

// Corregir el método de pago de un pedido de MP: se guarda al elegirlo y solo
// recalcula Insights (no re-renderiza la lista, para no perder el foco).
$("#pedidos").addEventListener("change", async (e) => {
  const select = e.target.closest("[data-metodo]");
  if (!select) return;
  const estado = select.parentElement.querySelector("[data-metodo-estado]");
  const pedido = pedidosCache.find((p) => p.id === select.dataset.id);
  const anterior = pedido ? pedido.mp_metodo : null;
  const ponerEstadoMetodo = (texto, ok = false, seVa = false) => {
    clearTimeout(estado.dataset.timer);
    estado.textContent = texto;
    estado.classList.toggle("pedido__metodo-estado--ok", ok);
    estado.classList.remove("pedido__metodo-estado--se-va");
    // El "✓ Guardado" se desvanece solo; el error queda hasta el próximo intento
    if (seVa) estado.dataset.timer = setTimeout(() => estado.classList.add("pedido__metodo-estado--se-va"), 1800);
  };
  select.disabled = true;
  ponerEstadoMetodo("Guardando…");
  try {
    const r = await api("/api/admin-pedidos", {
      method: "PATCH",
      body: JSON.stringify({ id: select.dataset.id, mp_metodo: select.value }),
    });
    if (pedido) pedido.mp_metodo = r.mp_metodo;
    ponerEstadoMetodo("✓ Guardado", true, true);
    renderInsights();
  } catch (err) {
    select.value = anterior || "";
    ponerEstadoMetodo(`⚠️ ${err.message}`);
  } finally {
    select.disabled = false;
  }
});

$("#reload").addEventListener("click", cargarPedidos);

// Secciones Pedidos / Gestión
$("#secciones").addEventListener("click", (e) => {
  const b = e.target.closest("[data-seccion]");
  if (!b) return;
  $("#secciones").querySelectorAll("button").forEach((x) => x.classList.toggle("seccion-activa", x === b));
  $("#seccion-pedidos").hidden = b.dataset.seccion !== "pedidos";
  $("#seccion-insights").hidden = b.dataset.seccion !== "insights";
  $("#seccion-gestion").hidden = b.dataset.seccion !== "gestion";
});
// ===== Productos y stock (unificados) =====
// Una sola lista: cada producto muestra su estado y su stock, con la carga
// por gramos y el publicar/ocultar en la misma fila.
let gramosPorUnidad = 12;

// Fila de un producto (café o simple) para la lista de Productos y Stock
function filaProductoStock(p) {
  const esSimple = p.tipo === "simple";
  return `<article class="fila${p.activo ? "" : " fila--inactivo"}" data-producto="${escapar(p.id)}" data-fila-tipo="${esSimple ? "simple" : "cafe"}">
      <div class="fila__info">
        <strong>${escapar(p.nombre)}</strong>
        <span class="fila__dato">${p.activo ? "Publicado" : "Oculto"} · <b data-stock-de="${escapar(p.id)}">${p.stock}</b> ${esSimple ? "unidades" : "bags"}${p.origen ? " · " + escapar(p.origen) : ""}${p.descontinuado ? " · 🔥 sin reposición" : ""}${p.imagen ? "" : " · ⚠️ sin foto"}</span>
      </div>
      <div class="fila__form">
        ${esSimple
          ? `<input type="number" min="0" step="1" inputmode="numeric" placeholder="Unidades" data-unidades aria-label="Unidades para ${escapar(p.nombre)}">`
          : `<input type="number" min="0" step="1" inputmode="numeric" placeholder="Gramos de café" data-gramos aria-label="Gramos de café para ${escapar(p.nombre)}">
        <span class="fila__preview" data-preview>= 0 bags</span>`}
        <button data-stock-action="sumar" disabled>Sumar</button>
        <button class="sec" data-stock-action="restar" disabled>Restar</button>
        <button class="sec" data-stock-action="fijar" disabled>Fijar</button>
        <button class="sec" data-desc-toggle="${escapar(p.id)}" data-desc="${Boolean(p.descontinuado)}" title="Producto sin reposición: la tienda muestra 'Últimas N unidades' en vez del stock normal">${p.descontinuado ? "Reponer" : "Sin reposición"}</button>
        <button class="${p.activo ? "sec" : ""}" data-producto-toggle="${escapar(p.id)}" data-activo="${p.activo}">${p.activo ? "Ocultar" : "Publicar"}</button>
        <button class="px-borrar" data-producto-eliminar="${escapar(p.id)}" title="Eliminar producto" aria-label="Eliminar ${escapar(p.nombre)}">🗑</button>
      </div>
    </article>`;
}

function listaOVacio(productos, vacioTexto) {
  return productos.length ? productos.map(filaProductoStock).join("") : `<div class="vacio">${vacioTexto}</div>`;
}

// Se agrupan en tres bloques: drip bags (café), café en bolsa 1/4 y tazas/otros
function renderProductos(productos) {
  $("#stock-gpu").textContent = gramosPorUnidad;
  const lista = productos || [];
  const cafes = lista.filter((p) => p.tipo !== "simple");
  const cafe14 = lista.filter((p) => p.tipo === "simple" && p.categoria === "cafe_bolsa");
  const merch = lista.filter((p) => p.tipo === "simple" && p.categoria !== "cafe_bolsa");

  $("#productos-lista-cafe").innerHTML = listaOVacio(cafes, "No hay drip bags todavía.");
  $("#productos-lista-cafe14").innerHTML = listaOVacio(cafe14, "No hay café en bolsa todavía.");
  $("#productos-lista-merch").innerHTML = listaOVacio(merch, "No hay tazas ni otros productos todavía.");
}

async function cargarProductos() {
  mensaje("#producto-message", "Cargando productos…");
  try {
    // La vista previa del costo y los gramos por bag salen de la config
    if (!cfgPrecios) {
      try {
        const d = await api("/api/admin-config");
        cfgPrecios = d.cfg;
        insumosCache = d.insumos;
      } catch {}
    }
    if (cfgPrecios && cfgPrecios.gramosPorBag) gramosPorUnidad = cfgPrecios.gramosPorBag;
    const { productos } = await api("/api/admin-productos");
    renderProductos(productos);
    mensaje("#producto-message", "");
  } catch (err) {
    mensaje("#producto-message", `⚠️ ${err.message}`);
  }
}

$("#productos-columnas").addEventListener("input", (e) => {
  const gramosInput = e.target.closest("[data-gramos]");
  if (gramosInput) {
    const fila = gramosInput.closest(".fila");
    const unidades = Math.floor((Number(gramosInput.value) || 0) / gramosPorUnidad);
    fila.querySelector("[data-preview]").textContent = `= ${unidades} bags`;
    const vacio = gramosInput.value.trim() === "";
    fila.querySelector('[data-stock-action="sumar"]').disabled = unidades <= 0;
    fila.querySelector('[data-stock-action="restar"]').disabled = unidades <= 0;
    fila.querySelector('[data-stock-action="fijar"]').disabled = vacio;
    return;
  }
  const unidadesInput = e.target.closest("[data-unidades]");
  if (unidadesInput) {
    const fila = unidadesInput.closest(".fila");
    const vacio = unidadesInput.value.trim() === "";
    const positivo = (Number(unidadesInput.value) || 0) > 0;
    fila.querySelector('[data-stock-action="sumar"]').disabled = !positivo;
    fila.querySelector('[data-stock-action="restar"]').disabled = !positivo;
    fila.querySelector('[data-stock-action="fijar"]').disabled = vacio;
  }
});

$("#productos-columnas").addEventListener("click", async (e) => {
  // Publicar / ocultar
  const toggle = e.target.closest("[data-producto-toggle]");
  if (toggle) {
    const publicar = toggle.dataset.activo !== "true";
    if (publicar && !confirm("¿Publicar este producto? Va a aparecer en la tienda.")) return;
    toggle.disabled = true;
    try {
      await api("/api/admin-productos", {
        method: "PATCH",
        body: JSON.stringify({ id: toggle.dataset.productoToggle, activo: publicar }),
      });
      cargarProductos();
    } catch (err) {
      mensaje("#producto-message", `⚠️ ${err.message}`);
      toggle.disabled = false;
    }
    return;
  }

  // Marcar / desmarcar "sin reposición" (muestra "Últimas N unidades" en la tienda)
  const desc = e.target.closest("[data-desc-toggle]");
  if (desc) {
    const marcar = desc.dataset.desc !== "true";
    desc.disabled = true;
    try {
      await api("/api/admin-productos", {
        method: "PATCH",
        body: JSON.stringify({ id: desc.dataset.descToggle, descontinuado: marcar }),
      });
      await cargarProductos();
      mensaje("#producto-message", marcar ? "✅ Marcado sin reposición." : "✅ Vuelve a reponerse.", true);
    } catch (err) {
      mensaje("#producto-message", `⚠️ ${err.message}`);
      desc.disabled = false;
    }
    return;
  }

  // Eliminar producto (y sus presentaciones)
  const borrar = e.target.closest("[data-producto-eliminar]");
  if (borrar) {
    const fila = borrar.closest(".fila");
    const nombre = fila.querySelector("strong").textContent;
    if (!confirm(`¿Eliminar "${nombre}" definitivamente? No se puede deshacer.`)) return;
    borrar.disabled = true;
    try {
      await api(`/api/admin-productos?id=${encodeURIComponent(borrar.dataset.productoEliminar)}`, { method: "DELETE" });
      TABS["tab-precios"].cargado = false; // que Precios deje de mostrarlo
      await cargarProductos();
      mensaje("#producto-message", `✅ "${nombre}" eliminado.`, true);
    } catch (err) {
      mensaje("#producto-message", `⚠️ ${err.message}`);
      borrar.disabled = false;
    }
    return;
  }

  // Sumar / fijar stock (por gramos de café, o directo en unidades)
  const boton = e.target.closest("[data-stock-action]");
  if (!boton) return;
  const fila = boton.closest(".fila");
  const esSimple = fila.dataset.filaTipo === "simple";
  const accion = boton.dataset.stockAction;
  const nombre = fila.querySelector("strong").textContent;

  let unidades, cuerpo, pregunta;
  if (esSimple) {
    unidades = Math.max(0, Math.floor(Number(fila.querySelector("[data-unidades]").value) || 0));
    cuerpo = { producto_id: fila.dataset.producto, unidades, accion };
    pregunta = accion === "sumar" ? `¿Sumar ${unidades} unidades al stock de ${nombre}?`
      : accion === "restar" ? `¿Restar ${unidades} unidades del stock de ${nombre}?`
      : `¿Reemplazar el stock de ${nombre} por ${unidades} unidades?`;
  } else {
    const gramos = Number(fila.querySelector("[data-gramos]").value) || 0;
    unidades = Math.floor(gramos / gramosPorUnidad);
    cuerpo = { producto_id: fila.dataset.producto, gramos, accion };
    pregunta = accion === "sumar" ? `¿Sumar ${unidades} bags (${gramos} g) al stock de ${nombre}?`
      : accion === "restar" ? `¿Restar ${unidades} bags (${gramos} g) del stock de ${nombre}?`
      : `¿Reemplazar el stock de ${nombre} por ${unidades} bags (${gramos} g)?`;
  }
  if (!confirm(pregunta)) return;

  fila.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const r = await api("/api/admin-stock", { method: "POST", body: JSON.stringify(cuerpo) });
    fila.querySelector("[data-stock-de]").textContent = r.stock;
    if (esSimple) {
      fila.querySelector("[data-unidades]").value = "";
    } else {
      fila.querySelector("[data-gramos]").value = "";
      fila.querySelector("[data-preview]").textContent = "= 0 bags";
    }
    fila.querySelectorAll("button").forEach((b) => (b.disabled = false));
    fila.querySelector('[data-stock-action="sumar"]').disabled = true;
    fila.querySelector('[data-stock-action="restar"]').disabled = true;
    fila.querySelector('[data-stock-action="fijar"]').disabled = true;
    mensaje("#producto-message", `✅ ${nombre}: stock actualizado a ${r.stock} ${esSimple ? "unidades" : "bags"}`, true);
  } catch (err) {
    mensaje("#producto-message", `⚠️ ${err.message}`);
    fila.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
});

// ===== Precios: productos, insumos y configuración =====
// Los números sensibles (insumos, costos, márgenes) viven en la base y solo
// llegan al panel autenticado. Acá todo se guarda solo y se recalcula al
// instante: cada café tiene su propio precio y su margen real; no existe un
// margen objetivo global.
let cfgPrecios = null;    // configuración global (gramos por bag, pack, insumos sumados)
let insumosCache = [];
let preciosCache = [];
let precioAbierto = null; // café en edición (uno a la vez)

const MARGEN_BAJO = 25; // % debajo del cual avisamos
const MARGEN_ALTO = 65; // % arriba del cual avisamos

// cfg con los insumos vivos del panel: al editar un insumo no hace falta
// esperar al servidor para ver los costos nuevos.
function cfgLocal() {
  if (!cfgPrecios) return null;
  if (!insumosCache.length) return cfgPrecios;
  const suma = (campo) =>
    Math.round(insumosCache.reduce((t, i) => t + (Number(i.costo) || 0) * (Number(i[campo]) || 0), 0) * 100) / 100;
  return { ...cfgPrecios, fijoUnidad: suma("cant_unidad"), fijoPack: suma("cant_pack") };
}

// Toast: confirma sin interrumpir (guardados, recálculos)
let toastTimer = null;
function toast(texto) {
  const el = $("#px-toast");
  el.textContent = texto;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("px-toast--visible"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("px-toast--visible");
    toastTimer = setTimeout(() => { el.hidden = true; }, 250);
  }, 2800);
}

// Indicador chico de estado (Guardando… / ✓ Guardado) al lado del campo
function ponerEstado(contenedor, texto, ok = false) {
  const el = contenedor.querySelector("[data-estado]");
  if (!el) return;
  el.textContent = texto;
  el.classList.toggle("px-estado--ok", ok);
  if (ok) setTimeout(() => { if (el.textContent === texto) el.textContent = ""; }, 2500);
}

function badgeMargen(margen) {
  if (margen == null) return "";
  if (margen < MARGEN_BAJO) return ` <span class="px-badge px-badge--bajo">⚠️ Margen bajo</span>`;
  if (margen > MARGEN_ALTO) return ` <span class="px-badge px-badge--alto">💰 Margen alto</span>`;
  return "";
}

// El costo puede estar tipeado por kilo o por cuarto: siempre lo pasamos a kilo
function costoKgDe(fila) {
  const v = Number(fila.querySelector("[data-costo]").value) || 0;
  const cuarto = fila.querySelector('[data-modo-costo="cuarto"]')?.classList.contains("px-chip--activo");
  return cuarto ? v * 4 : v;
}

// Precio sugerido: el que mantiene el margen actual del café con el costo
// tipeado. Si el café todavía no tiene precio, propone un 50% como punto de
// partida (después cada café lleva el margen que quieras).
function sugeridoDe(p, cfg, costoKg) {
  const total = costoUnidad(costoKg, cfg);
  if (!(total > 0)) return null;
  let margen = null;
  if (p && p.precio && p.costo_kg != null) margen = margenUnidadReal(Number(p.costo_kg), p.precio, cfg);
  const usable = margen != null && margen >= 5 && margen <= 90;
  const objetivo = usable ? margen : 50;
  return {
    precio: redondearPrecio(total / (1 - objetivo / 100), 50),
    nota: usable ? `mantiene tu margen de ${Math.round(objetivo)}%` : "punto de partida (50%)",
  };
}

// Margen actual de cada café con la config vigente. Se toma ANTES de aplicar
// un cambio de costos, para poder recuperar ese margen al recalcular precios.
function margenesActuales() {
  const cfg = cfgLocal();
  const mapa = {};
  for (const p of preciosCache) {
    if (p.costo_kg != null && p.precio) mapa[p.id] = margenUnidadReal(Number(p.costo_kg), p.precio, cfg);
  }
  return mapa;
}

// Propuesta de precios pendiente de aceptar. Guarda los márgenes que tenía
// cada café ANTES del primer cambio de costos, así aunque toques varios
// insumos seguidos la propuesta siempre apunta a recuperar esos márgenes.
let propuestaPendiente = null;

// Qué precio necesitaría cada café para recuperar su margen previo:
// precio nuevo = costo nuevo ÷ (1 − margen), redondeado a $50.
function calcularPropuesta(margenes) {
  const cfg = cfgLocal();
  const items = [];
  for (const p of preciosCache) {
    const margen = margenes[p.id];
    if (p.costo_kg == null || !p.precio || margen == null || margen < 5 || margen > 90) continue;
    const nuevo = redondearPrecio(costoUnidad(Number(p.costo_kg), cfg) / (1 - margen / 100), 50);
    if (nuevo > 0 && nuevo !== p.precio) items.push({ id: p.id, nombre: p.nombre, antes: p.precio, despues: nuevo });
  }
  return items;
}

// Después de cualquier cambio de costos (insumo, gramos): refresca la vista y
// arma la propuesta de precios. NUNCA se aplica sola: se acepta con un botón.
function aplicarCambioDeCostos(margenes) {
  const base = propuestaPendiente ? propuestaPendiente.margenes : margenes;
  const items = calcularPropuesta(base);
  propuestaPendiente = items.length ? { margenes: base, items } : null;
  renderPrecios();
  actualizarTotalesInsumos();
  toast(items.length
    ? "Todos los costos fueron recalculados. Revisá los precios sugeridos."
    : "Todos los costos fueron recalculados.");
}

async function aplicarPropuesta(boton) {
  if (!propuestaPendiente) return;
  boton.disabled = true;
  const items = calcularPropuesta(propuestaPendiente.margenes);
  let cambios = 0;
  for (const it of items) {
    const p = preciosCache.find((x) => x.id === it.id);
    try {
      const r = await api("/api/admin-precios", {
        method: "POST",
        body: JSON.stringify({ producto_id: p.id, costo_kg: Number(p.costo_kg), precio: it.despues }),
      });
      Object.assign(p, { costo_kg: r.costo_kg, precio: r.precio, precioPack: r.precioPack });
      cambios++;
    } catch (err) {
      toast(`⚠️ ${p.nombre}: ${err.message}`);
    }
  }
  propuestaPendiente = null;
  renderPrecios();
  if (cambios) toast(`${cambios} precio${cambios > 1 ? "s" : ""} actualizado${cambios > 1 ? "s" : ""}.`);
}

function editorProducto(p) {
  return `<div class="px-editor">
      <div class="px-paso">
        <span class="px-paso__label">Costo del café</span>
        <div class="px-paso__control">
          <div class="px-modo">
            <button type="button" class="px-chip px-chip--activo" data-modo-costo="kilo">por kilo</button>
            <button type="button" class="px-chip" data-modo-costo="cuarto">por ¼ (250 g)</button>
          </div>
          <input type="number" min="0" step="1" inputmode="numeric" placeholder="68000"
                 value="${p.costo_kg != null ? Math.round(p.costo_kg) : ""}" data-costo aria-label="Costo del café por kilo">
        </div>
      </div>
      <div class="px-calculo" data-calculo></div>
      <div class="px-paso">
        <span class="px-paso__label">Precio final (unidad)</span>
        <div class="px-paso__control">
          <input type="number" min="0" step="1" inputmode="numeric" placeholder="0"
                 value="${p.precio != null ? p.precio : ""}" data-precio aria-label="Precio final de la unidad">
          <button type="button" class="px-btn-sec" data-redondear title="Redondear a múltiplos de $50">Redondear</button>
        </div>
      </div>
      ${p.precioPack == null ? "" : `<div class="px-paso">
        <span class="px-paso__label">Precio final (pack x${cfgLocal().packUnidades})</span>
        <div class="px-paso__control">
          <input type="number" min="0" step="1" inputmode="numeric" placeholder="0"
                 value="${p.precioPack}" data-precio-pack aria-label="Precio final del pack">
          <button type="button" class="px-btn-sec" data-redondear-pack title="Redondear a múltiplos de $50">Redondear</button>
        </div>
        <span class="px-nota">Al cambiar el precio de la unidad se propone solo con el ${cfgLocal().packDescuento}% OFF, redondeado; podés escribir otro.</span>
      </div>`}
      <p class="px-resultado" data-resultado></p>
      <div class="px-editor__acciones">
        <button type="button" class="px-btn" data-precio-action>Guardar</button>
      </div>
    </div>`;
}

// Editor de un producto simple: sin fórmula, un único campo de precio
function editorProductoSimple(p) {
  return `<div class="px-editor">
      <div class="px-paso">
        <span class="px-paso__label">Costo por unidad <small>(opcional)</small></span>
        <div class="px-paso__control">
          <input type="number" min="0" step="1" inputmode="numeric" placeholder="0"
                 value="${p.costo != null ? p.costo : ""}" data-costo-simple aria-label="Costo por unidad">
        </div>
      </div>
      <div class="px-paso">
        <span class="px-paso__label">Precio de venta</span>
        <div class="px-paso__control">
          <input type="number" min="0" step="1" inputmode="numeric" placeholder="0"
                 value="${p.precio != null ? p.precio : ""}" data-precio-simple aria-label="Precio de venta">
        </div>
      </div>
      <p class="px-resultado" data-resultado-simple></p>
      <div class="px-editor__acciones">
        <button type="button" class="px-btn" data-precio-simple-action>Guardar</button>
      </div>
    </div>`;
}

function filaProductoSimple(p) {
  const abierto = p.id === precioAbierto;
  const margen = p.costo != null && p.precio ? margenSimple(p.costo, p.precio) : null;
  return `<article class="px-prod px-prod--simple${abierto ? " px-prod--abierto" : ""}${p.activo ? "" : " px-prod--inactivo"}" data-producto="${escapar(p.id)}">
      <div class="px-prod__linea">
        <span class="px-prod__nombre">${escapar(p.nombre || p.id)}${p.activo ? "" : ` <small>oculto</small>`}</span>
        <span class="px-num">${p.costo != null ? formato.format(p.costo) : "—"}</span>
        <span class="px-num px-num--precio">${p.precio != null ? formato.format(p.precio) : "—"}</span>
        <span class="px-num">—</span>
        <span class="px-margen">${margen != null ? `<b>${Math.round(margen)}%</b>` : "—"}${badgeMargen(margen)}</span>
        <button class="px-btn-sec px-editar" data-editar="${escapar(p.id)}">${abierto ? "Cerrar" : "Editar"}</button>
      </div>
      ${abierto ? editorProductoSimple(p) : ""}
    </article>`;
}

function filaProducto(p, cfg) {
  if (p.tipo === "simple") return filaProductoSimple(p);
  const costoKg = p.costo_kg != null ? Number(p.costo_kg) : null;
  const costoU = costoKg != null ? Math.round(costoUnidad(costoKg, cfg)) : null;
  const margen = costoKg != null && p.precio ? margenUnidadReal(costoKg, p.precio, cfg) : null;
  const abierto = p.id === precioAbierto;
  return `<article class="px-prod${abierto ? " px-prod--abierto" : ""}${p.activo ? "" : " px-prod--inactivo"}" data-producto="${escapar(p.id)}">
      <div class="px-prod__linea">
        <span class="px-prod__nombre">${escapar(p.nombre || p.id)}${p.activo ? "" : ` <small>oculto</small>`}</span>
        <span class="px-num">${costoU != null ? formato.format(costoU) : "—"}</span>
        <span class="px-num px-num--precio">${p.precio != null ? formato.format(p.precio) : "—"}</span>
        <span class="px-num">${p.precioPack != null ? formato.format(p.precioPack) : "—"}</span>
        <span class="px-margen">${margen != null ? `<b>${Math.round(margen)}%</b>` : "—"}${badgeMargen(margen)}</span>
        <button class="px-btn-sec px-editar" data-editar="${escapar(p.id)}">${abierto ? "Cerrar" : "Editar"}</button>
      </div>
      ${abierto ? editorProducto(p) : ""}
    </article>`;
}

// Guarda lo tipeado en el editor abierto antes de re-renderizar (los insumos
// pueden cambiar mientras se edita un café y no queremos pisar nada)
function estadoEditorAbierto() {
  const fila = $("#precios").querySelector(".px-prod--abierto");
  if (!fila) return null;
  if (fila.classList.contains("px-prod--simple")) {
    const precio = fila.querySelector("[data-precio-simple]");
    const costo = fila.querySelector("[data-costo-simple]");
    return precio ? { id: fila.dataset.producto, simple: true, precio: precio.value, costo: costo ? costo.value : "" } : null;
  }
  const pack = fila.querySelector("[data-precio-pack]");
  return {
    id: fila.dataset.producto,
    costo: fila.querySelector("[data-costo]").value,
    precio: fila.querySelector("[data-precio]").value,
    pack: pack ? pack.value : null,
    packTocado: pack ? pack.dataset.tocado : null,
    cuarto: fila.querySelector('[data-modo-costo="cuarto"]')?.classList.contains("px-chip--activo") || false,
  };
}

function renderPrecios() {
  const c = $("#precios");
  const cfg = cfgLocal();
  if (!cfg) return;
  if (!preciosCache.length) {
    c.innerHTML = `<div class="vacio">No hay productos.</div>`;
    return;
  }
  const estado = estadoEditorAbierto();
  const banner = !propuestaPendiente ? "" : `<div class="px-banner">
      <div class="px-banner__info">
        <strong>Los costos cambiaron.</strong>
        <span>Para que cada café mantenga su margen, los precios quedarían así:</span>
        <ul>${propuestaPendiente.items.map((i) =>
          `<li>${escapar(i.nombre)}: ${formato.format(i.antes)} → <b>${formato.format(i.despues)}</b></li>`).join("")}</ul>
      </div>
      <div class="px-banner__acciones">
        <button type="button" class="px-btn-sec" data-propuesta="descartar">Mantener como están</button>
        <button type="button" class="px-btn" data-propuesta="aplicar">Actualizar precios</button>
      </div>
    </div>`;
  const cafes = preciosCache.filter((p) => p.tipo !== "simple");
  const cafe14 = preciosCache.filter((p) => p.tipo === "simple" && p.categoria === "cafe_bolsa");
  const merch = preciosCache.filter((p) => p.tipo === "simple" && p.categoria !== "cafe_bolsa");
  const grupo = (titulo, lista, vacioTexto) => `<h4 class="px-grupo__titulo">${titulo}</h4>` +
    (lista.length ? lista.map((p) => filaProducto(p, cfg)).join("") : `<div class="vacio">${vacioTexto}</div>`);

  c.innerHTML = banner + `<div class="px-productos__head">
      <span>Producto</span><span>Costo</span><span>Unidad</span><span>Pack x${cfg.packUnidades}</span><span>Margen</span><span></span>
    </div>`
    + grupo("☕ Drip bags", cafes, "No hay drip bags todavía.")
    + grupo("🛍️ Café en bolsa (1/4)", cafe14, "No hay café en bolsa todavía.")
    + grupo("🏷️ Tazas y otros", merch, "No hay tazas ni otros productos todavía.");

  const abierta = c.querySelector(".px-prod--abierto");
  if (!abierta) return;

  if (abierta.classList.contains("px-prod--simple")) {
    if (estado && estado.simple && estado.id === abierta.dataset.producto) {
      abierta.querySelector("[data-precio-simple]").value = estado.precio;
      const costo = abierta.querySelector("[data-costo-simple]");
      if (costo && estado.costo != null) costo.value = estado.costo;
    }
    refrescarEditorSimple(abierta);
    return;
  }

  if (estado && !estado.simple && estado.id === abierta.dataset.producto) {
    abierta.querySelector("[data-costo]").value = estado.costo;
    abierta.querySelector("[data-precio]").value = estado.precio;
    const pack = abierta.querySelector("[data-precio-pack]");
    if (pack && estado.pack != null) {
      pack.value = estado.pack;
      if (estado.packTocado) pack.dataset.tocado = estado.packTocado;
    }
    if (estado.cuarto) {
      abierta.querySelectorAll("[data-modo-costo]").forEach((b) =>
        b.classList.toggle("px-chip--activo", b.dataset.modoCosto === "cuarto"));
    }
  }
  refrescarEditor(abierta);
}

// Desglose vivo del editor: café → insumos → costo total → sugerido → final
function refrescarEditor(fila) {
  const cfg = cfgLocal();
  const p = preciosCache.find((x) => x.id === fila.dataset.producto);
  const costoKg = costoKgDe(fila);
  const calc = fila.querySelector("[data-calculo]");
  const resultado = fila.querySelector("[data-resultado]");
  if (!(costoKg > 0)) {
    calc.innerHTML = `<p class="px-nota">Cargá el costo del café para ver el desglose.</p>`;
    resultado.textContent = "";
    return;
  }

  const cafe = costoCafePorUnidad(costoKg, cfg);
  const total = costoUnidad(costoKg, cfg);
  const sug = sugeridoDe(p, cfg, costoKg);
  calc.innerHTML = `
      <div class="px-calculo__fila"><span>Café por drip (${cfg.gramosPorBag} g)</span><b>${formato.format(Math.round(cafe))}</b></div>
      <div class="px-calculo__fila"><span>+ Insumos por unidad</span><b>${formato.format(Math.round(cfg.fijoUnidad))}</b></div>
      <div class="px-calculo__fila px-calculo__fila--total"><span>Costo total por unidad</span><b>${formato.format(Math.round(total))}</b></div>
      ${sug ? `<div class="px-calculo__fila px-calculo__fila--sugerido"><span>Precio sugerido <small>(${sug.nota})</small></span>
        <span><b>${formato.format(sug.precio)}</b><button type="button" class="px-usar" data-usar-sugerido="${sug.precio}">Usar</button></span></div>` : ""}`;

  const precio = Number(fila.querySelector("[data-precio]").value) || 0;
  if (!(precio > 0)) {
    resultado.innerHTML = `<span class="px-nota">Escribí el precio final o usá el sugerido.</span>`;
    return;
  }
  if (precio < total) {
    resultado.innerHTML = `<span class="px-alerta">⚠️ Perdés plata: el precio está por debajo del costo (${formato.format(Math.round(total))}).</span>`;
    return;
  }
  const margen = margenUnidadReal(costoKg, precio, cfg);
  const campoPack = fila.querySelector("[data-precio-pack]");
  const pack = campoPack ? Number(campoPack.value) || 0 : precioPack(precio, cfg);
  if (campoPack && pack > 0 && pack < costoPack(costoKg, cfg)) {
    resultado.innerHTML = `<span class="px-alerta">⚠️ El pack está por debajo de su costo (${formato.format(Math.round(costoPack(costoKg, cfg)))}).</span>`;
    return;
  }
  const off = pack > 0 ? Math.round((1 - pack / (precio * cfg.packUnidades)) * 100) : null;
  resultado.innerHTML = `Margen real <b>${margen}%</b>${badgeMargen(margen)}` + (pack > 0
    ? ` · Pack x${cfg.packUnidades} <b>${formato.format(pack)}</b> <small>(margen ${margenPack(costoKg, pack, cfg)}% · ${off}% OFF vs sueltas)</small>`
    : "");
}

async function guardarPrecio(fila, boton) {
  const p = preciosCache.find((x) => x.id === fila.dataset.producto);
  const costoKg = costoKgDe(fila);
  const precio = Number(fila.querySelector("[data-precio]").value) || 0;
  const campoPack = fila.querySelector("[data-precio-pack]");
  const pack = campoPack ? Number(campoPack.value) || 0 : 0;
  if (!(costoKg > 0) || !(precio > 0) || precio < costoUnidad(costoKg, cfgLocal()) ||
      (pack > 0 && pack < costoPack(costoKg, cfgLocal()))) {
    refrescarEditor(fila); // el desglose ya explica qué falta o qué está mal
    return;
  }
  boton.disabled = true;
  try {
    const r = await api("/api/admin-precios", {
      method: "POST",
      body: JSON.stringify({ producto_id: p.id, costo_kg: costoKg, precio, precio_pack: pack || undefined }),
    });
    Object.assign(p, { costo_kg: r.costo_kg, precio: r.precio, precioPack: r.precioPack });
    // Si había una propuesta pendiente, este café ya eligió su precio a mano
    if (propuestaPendiente) {
      delete propuestaPendiente.margenes[p.id];
      const items = calcularPropuesta(propuestaPendiente.margenes);
      propuestaPendiente = items.length ? { margenes: propuestaPendiente.margenes, items } : null;
    }
    precioAbierto = null;
    renderPrecios();
    toast(`${p.nombre}: precio actualizado.`);
  } catch (err) {
    const resultado = fila.querySelector("[data-resultado]");
    if (resultado) resultado.innerHTML = `<span class="px-alerta">⚠️ ${escapar(err.message)}</span>`;
    boton.disabled = false;
  }
}

// Guarda el precio de un producto simple: sin costo, sin pack, sin margen
// Desglose vivo del editor simple: muestra el margen (o avisa si el precio
// queda por debajo del costo). El costo es opcional: sin costo, no hay margen.
function refrescarEditorSimple(fila) {
  const resultado = fila.querySelector("[data-resultado-simple]");
  if (!resultado) return;
  const costo = Number(fila.querySelector("[data-costo-simple]")?.value) || 0;
  const precio = Number(fila.querySelector("[data-precio-simple]").value) || 0;
  if (!(precio > 0)) { resultado.innerHTML = `<span class="px-nota">Escribí el precio de venta.</span>`; return; }
  if (!(costo > 0)) { resultado.innerHTML = `<span class="px-nota">Cargá el costo para ver el margen (opcional).</span>`; return; }
  if (precio < costo) {
    resultado.innerHTML = `<span class="px-alerta">⚠️ Perdés plata: el precio está por debajo del costo (${formato.format(costo)}).</span>`;
    return;
  }
  const margen = margenSimple(costo, precio);
  resultado.innerHTML = `Margen real <b>${margen}%</b>${badgeMargen(margen)}`;
}

async function guardarPrecioSimple(fila, boton) {
  const p = preciosCache.find((x) => x.id === fila.dataset.producto);
  const precio = Number(fila.querySelector("[data-precio-simple]").value) || 0;
  const costoInput = fila.querySelector("[data-costo-simple]");
  const costoStr = costoInput ? costoInput.value.trim() : "";
  const costo = costoStr === "" ? 0 : Number(costoStr) || 0;
  const resultado = fila.querySelector("[data-resultado-simple]");
  if (!(precio > 0)) {
    if (resultado) resultado.innerHTML = `<span class="px-alerta">⚠️ Ingresá un precio mayor a 0.</span>`;
    return;
  }
  if (costo > 0 && precio < costo) {
    if (resultado) resultado.innerHTML = `<span class="px-alerta">⚠️ El precio está por debajo del costo (${formato.format(costo)}).</span>`;
    return;
  }
  boton.disabled = true;
  try {
    const r = await api("/api/admin-precios", {
      method: "POST",
      // costo "" borra el costo (vuelve a sin margen); un número lo guarda
      body: JSON.stringify({ producto_id: p.id, precio, costo: costoStr }),
    });
    Object.assign(p, { precio: r.precio, costo: r.costo });
    precioAbierto = null;
    renderPrecios();
    toast(`${p.nombre}: precio actualizado.`);
  } catch (err) {
    if (resultado) resultado.innerHTML = `<span class="px-alerta">⚠️ ${escapar(err.message)}</span>`;
    boton.disabled = false;
  }
}

$("#precios").addEventListener("click", async (e) => {
  const fila = e.target.closest(".px-prod");

  const propuesta = e.target.closest("[data-propuesta]");
  if (propuesta) {
    if (propuesta.dataset.propuesta === "aplicar") {
      await aplicarPropuesta(propuesta);
    } else {
      propuestaPendiente = null;
      renderPrecios();
    }
    return;
  }

  const modo = e.target.closest("[data-modo-costo]");
  if (modo && fila && !modo.classList.contains("px-chip--activo")) {
    const inp = fila.querySelector("[data-costo]");
    const v = Number(inp.value) || 0;
    if (v) inp.value = modo.dataset.modoCosto === "cuarto" ? Math.round(v / 4) : Math.round(v * 4);
    fila.querySelectorAll("[data-modo-costo]").forEach((x) => x.classList.toggle("px-chip--activo", x === modo));
    refrescarEditor(fila);
    return;
  }

  // Si el pack no fue tocado a mano, sigue al precio de la unidad
  const proponerPack = () => {
    const campoPack = fila.querySelector("[data-precio-pack]");
    if (!campoPack || campoPack.dataset.tocado) return;
    const precio = Number(fila.querySelector("[data-precio]").value) || 0;
    campoPack.value = precio > 0 ? precioPack(precio, cfgLocal()) : "";
  };

  const usar = e.target.closest("[data-usar-sugerido]");
  if (usar && fila) {
    fila.querySelector("[data-precio]").value = usar.dataset.usarSugerido;
    proponerPack();
    refrescarEditor(fila);
    return;
  }

  const redondear = e.target.closest("[data-redondear]");
  if (redondear && fila) {
    const campo = fila.querySelector("[data-precio]");
    const actual = Number(campo.value) || 0;
    if (actual) {
      campo.value = redondearPrecio(actual, 50);
      proponerPack();
      refrescarEditor(fila);
    }
    return;
  }

  const redondearPack = e.target.closest("[data-redondear-pack]");
  if (redondearPack && fila) {
    const campo = fila.querySelector("[data-precio-pack]");
    const actual = Number(campo.value) || 0;
    if (actual) {
      campo.value = redondearPrecio(actual, 50);
      campo.dataset.tocado = "1";
      refrescarEditor(fila);
    }
    return;
  }

  const editar = e.target.closest("[data-editar]");
  if (editar) {
    precioAbierto = precioAbierto === editar.dataset.editar ? null : editar.dataset.editar;
    renderPrecios();
    return;
  }

  const guardar = e.target.closest("[data-precio-action]");
  if (guardar && fila) await guardarPrecio(fila, guardar);

  const guardarSimple = e.target.closest("[data-precio-simple-action]");
  if (guardarSimple && fila) await guardarPrecioSimple(fila, guardarSimple);
});

$("#precios").addEventListener("input", (e) => {
  const fila = e.target.closest(".px-prod--abierto");
  if (!fila) return;
  if (fila.classList.contains("px-prod--simple")) { refrescarEditorSimple(fila); return; }
  // El pack sigue al precio de la unidad (con su % OFF, redondeado) hasta que
  // se lo toque a mano; ahí deja de proponerse solo.
  const campoPack = fila.querySelector("[data-precio-pack]");
  if (campoPack) {
    if (e.target === campoPack) {
      campoPack.dataset.tocado = "1";
    } else if (e.target.matches("[data-precio]") && !campoPack.dataset.tocado) {
      const precio = Number(e.target.value) || 0;
      campoPack.value = precio > 0 ? precioPack(precio, cfgLocal()) : "";
    }
  }
  refrescarEditor(fila);
});

async function cargarPrecios() {
  mensaje("#precio-message", "Cargando…");
  try {
    const [dataPrecios, dataConfig] = await Promise.all([
      api("/api/admin-precios"),
      api("/api/admin-config"),
    ]);
    cfgPrecios = dataConfig.cfg;
    insumosCache = dataConfig.insumos;
    preciosCache = dataPrecios.productos;
    renderPrecios();
    renderInsumos();
    $("#cfg-gramos").value = cfgPrecios.gramosPorBag;
    $("#cfg-pack-desc").value = cfgPrecios.packDescuento;
    $("#cfg-comision-mp").value = cfgPrecios.comisionMp != null ? cfgPrecios.comisionMp : 0;
    renderComisionesMp();
    $("#cfg-peso-drip").value = cfgPrecios.pesoDripBagG;
    $("#cfg-peso-cafe14").value = cfgPrecios.pesoCafeBolsaG;
    $("#cfg-peso-merch").value = cfgPrecios.pesoMerchG;
    mensaje("#zipnova-estado", dataConfig.zipnovaDisponible
      ? "✅ Conectado: el envío a domicilio cotiza en vivo."
      : "⚠️ Sin conectar: faltan ZIPNOVA_TOKEN, ZIPNOVA_SECRET y/o ZIPNOVA_ACCOUNT_ID en las variables de entorno. Mientras tanto, el envío a domicilio no se puede cobrar.",
      dataConfig.zipnovaDisponible);
    mensaje("#precio-message", dataConfig.desdeLaBase ? "" : "⚠️ Falta correr supabase/migracion-insumos.sql: mientras tanto se usan los valores anteriores y los insumos no se pueden editar.");
  } catch (err) {
    mensaje("#precio-message", `⚠️ ${err.message}`);
  }
}

// Una fila por método de pago de MP (los que tienen su propia clave de config).
// Se guardan solas, igual que el resto de la configuración.
function renderComisionesMp() {
  const porMetodo = cfgPrecios.comisionMpMetodos || {};
  $("#cfg-comision-metodos").innerHTML = METODOS_MP.filter((m) => m.config).map((m) => {
    const valor = porMetodo[m.clave] != null ? porMetodo[m.clave] : 0;
    return `<div class="px-config__fila px-config__fila--metodo">
        <div class="px-config__info"><strong>${escapar(m.etiqueta)}</strong></div>
        <div class="px-config__control">
          <input data-clave="${m.config}" type="number" min="0" max="100" step="0.01" inputmode="decimal" value="${valor}" aria-label="Comisión de MP: ${escapar(m.etiqueta)}">
          <span class="px-unidad">%</span>
          <span class="px-estado" data-estado></span>
        </div>
      </div>`;
  }).join("");
}

// ===== Insumos: tabla con guardado automático =====
function actualizarTotalesInsumos() {
  const cfg = cfgLocal();
  $("#insumos-totales").textContent = cfg && insumosCache.length
    ? ` (total por unidad ${formato.format(cfg.fijoUnidad)} · por pack ${formato.format(cfg.fijoPack)})`
    : "";
}

function renderInsumos() {
  const c = $("#insumos");
  actualizarTotalesInsumos();
  if (!insumosCache.length) {
    c.innerHTML = `<div class="vacio">Sin insumos cargados.</div>`;
    return;
  }
  c.innerHTML = `<div class="px-tabla">
      <div class="px-tabla__fila px-tabla__head">
        <span>Insumo</span><span>Costo por pieza</span><span>× por unidad</span><span>× por pack</span><span></span><span></span>
      </div>
      ${insumosCache.map((i) => `<div class="px-tabla__fila" data-insumo="${escapar(i.id)}">
        <span class="px-tabla__nombre">${escapar(i.nombre)}</span>
        <input type="number" min="0" step="0.01" inputmode="decimal" value="${Number(i.costo)}" data-campo="costo" aria-label="Costo por pieza de ${escapar(i.nombre)}">
        <input type="number" min="0" step="1" inputmode="numeric" value="${Number(i.cant_unidad)}" data-campo="cant_unidad" aria-label="Cantidad por unidad de ${escapar(i.nombre)}">
        <input type="number" min="0" step="1" inputmode="numeric" value="${Number(i.cant_pack)}" data-campo="cant_pack" aria-label="Cantidad por pack de ${escapar(i.nombre)}">
        <span class="px-estado" data-estado></span>
        <button type="button" class="px-borrar" data-borrar title="Borrar insumo">🗑</button>
      </div>`).join("")}
    </div>`;
}

// Al editar cualquier campo: se guarda solo (con una pausa corta) y todos los
// costos de arriba se recalculan al instante.
const insumosPendientes = new Map();
$("#insumos").addEventListener("input", (e) => {
  const fila = e.target.closest("[data-insumo]");
  if (!fila || !e.target.matches("[data-campo]")) return;
  ponerEstado(fila, "Guardando…");
  clearTimeout(insumosPendientes.get(fila.dataset.insumo));
  insumosPendientes.set(fila.dataset.insumo, setTimeout(() => guardarInsumo(fila), 700));
});

async function guardarInsumo(fila) {
  const id = fila.dataset.insumo;
  const leer = (campo) => Number(fila.querySelector(`[data-campo="${campo}"]`).value) || 0;
  try {
    const margenes = margenesActuales(); // antes del cambio, para mantenerlos
    const { insumo } = await api("/api/admin-config", {
      method: "PATCH",
      body: JSON.stringify({ id, costo: leer("costo"), cant_unidad: leer("cant_unidad"), cant_pack: leer("cant_pack") }),
    });
    const idx = insumosCache.findIndex((x) => x.id === id);
    if (idx >= 0) insumosCache[idx] = { ...insumosCache[idx], ...insumo };
    ponerEstado(fila, "✓ Guardado", true);
    aplicarCambioDeCostos(margenes);
  } catch (err) {
    ponerEstado(fila, `⚠️ ${err.message}`);
  }
}

$("#insumos").addEventListener("click", async (e) => {
  const boton = e.target.closest("[data-borrar]");
  if (!boton) return;
  const fila = boton.closest("[data-insumo]");
  const nombre = fila.querySelector(".px-tabla__nombre").textContent;
  if (!confirm(`¿Borrar "${nombre}"? El costo de todos los productos baja en consecuencia.`)) return;
  boton.disabled = true;
  try {
    const margenes = margenesActuales();
    await api(`/api/admin-config?id=${encodeURIComponent(fila.dataset.insumo)}`, { method: "DELETE" });
    insumosCache = insumosCache.filter((x) => x.id !== fila.dataset.insumo);
    renderInsumos();
    aplicarCambioDeCostos(margenes);
  } catch (err) {
    ponerEstado(fila, `⚠️ ${err.message}`);
    boton.disabled = false;
  }
});

// Alta de insumo (formulario plegado detrás de "+ Agregar insumo")
$("#insumo-nuevo-toggle").addEventListener("click", () => {
  const form = $("#insumo-form");
  form.hidden = !form.hidden;
  if (!form.hidden) $("#insumo-nombre").focus();
});
$("#insumo-cancelar").addEventListener("click", () => {
  $("#insumo-form").reset();
  $("#insumo-form").hidden = true;
});

// Calculadora de lote: precio del lote ÷ unidades = costo por pieza
function calcularLote() {
  const precio = Number($("#insumo-lote-precio").value) || 0;
  const cant = Number($("#insumo-lote-cant").value) || 0;
  if (precio > 0 && cant > 0) {
    $("#insumo-costo").value = Math.round((precio / cant) * 100) / 100;
  }
}
$("#insumo-lote-precio").addEventListener("input", calcularLote);
$("#insumo-lote-cant").addEventListener("input", calcularLote);

$("#insumo-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = e.target.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    const margenes = margenesActuales();
    const { insumo } = await api("/api/admin-config", {
      method: "POST",
      body: JSON.stringify({
        nombre: $("#insumo-nombre").value,
        costo: Number($("#insumo-costo").value),
        cant_unidad: Number($("#insumo-cant-unidad").value) || 0,
        cant_pack: Number($("#insumo-cant-pack").value) || 0,
      }),
    });
    insumosCache.push(insumo);
    $("#insumo-form").reset();
    $("#insumo-cant-unidad").value = 1;
    $("#insumo-cant-pack").value = 1;
    $("#insumo-form").hidden = true;
    renderInsumos();
    aplicarCambioDeCostos(margenes);
  } catch (err) {
    toast(`⚠️ ${err.message}`);
  } finally {
    boton.disabled = false;
  }
});

// ===== Configuración global (se guarda sola) =====
const configPendientes = new Map();
// Delegado: las comisiones por método de MP se renderizan después (ver
// renderComisionesMp), así que no alcanza con enganchar los inputs del HTML.
document.addEventListener("input", (e) => {
  const input = e.target.closest(".px-config [data-clave]");
  if (!input) return;
  const fila = input.closest(".px-config__fila");
  ponerEstado(fila, "Guardando…");
  clearTimeout(configPendientes.get(input.dataset.clave));
  configPendientes.set(input.dataset.clave, setTimeout(() => guardarConfigGlobal(input, fila), 800));
});

async function guardarConfigGlobal(input, fila) {
  const clave = input.dataset.clave;
  const valor = Number(input.value);
  if (input.value === "" || !Number.isFinite(valor) || valor < 0) {
    ponerEstado(fila, "⚠️ Valor inválido");
    return;
  }
  try {
    const margenes = margenesActuales(); // antes del cambio, para mantenerlos
    await api("/api/admin-config", { method: "PATCH", body: JSON.stringify({ clave, valor }) });
    if (clave === "gramos_por_bag") {
      cfgPrecios.gramosPorBag = valor;
      ponerEstado(fila, "✓ Guardado", true);
      aplicarCambioDeCostos(margenes);
    } else if (clave === "pack_descuento") {
      cfgPrecios.packDescuento = valor;
      // los packs guardados se re-derivan del precio de unidad (que no cambia)
      ponerEstado(fila, "Actualizando packs…");
      await api("/api/admin-config", { method: "POST", body: JSON.stringify({ accion: "recalcular", modo: "packs" }) });
      const data = await api("/api/admin-precios");
      preciosCache = data.productos;
      renderPrecios();
      ponerEstado(fila, "✓ Guardado", true);
      toast("Packs recalculados con el nuevo descuento.");
    } else {
      // Claves sin efecto sobre precios (pesos de envío, comisión MP): solo se
      // guardan. La comisión sí impacta en la contribución de Insights, así que
      // actualizamos su valor local para que se refleje sin recargar.
      if (clave === "comision_mercadopago") {
        cfgPrecios.comisionMp = valor;
        cfgComisionMp.comisionMp = valor;
      }
      const metodoMp = METODOS_MP.find((m) => m.config === clave);
      if (metodoMp) {
        cfgPrecios.comisionMpMetodos = { ...(cfgPrecios.comisionMpMetodos || {}), [metodoMp.clave]: valor };
        cfgComisionMp.comisionMpMetodos = { ...cfgComisionMp.comisionMpMetodos, [metodoMp.clave]: valor };
      }
      ponerEstado(fila, "✓ Guardado", true);
    }
  } catch (err) {
    ponerEstado(fila, `⚠️ ${err.message}`);
  }
}

// ===== Cupones =====
function valorCupon(c) {
  return c.tipo === "porcentaje" ? `${c.valor}% OFF` : `${formato.format(c.valor)} OFF`;
}

function renderCupones(cupones) {
  const contenedor = $("#cupones");
  if (!cupones || !cupones.length) {
    contenedor.innerHTML = `<div class="vacio">No hay cupones creados.</div>`;
    return;
  }
  contenedor.innerHTML = cupones.map((c) => `<article class="fila${c.activo ? "" : " fila--inactivo"}">
      <div class="fila__info">
        <strong>${escapar(c.codigo)} <span class="cupon__badge">${escapar(valorCupon(c))}</span></strong>
        <span class="fila__dato">${c.minimo ? `Mínimo ${formato.format(c.minimo)}` : "Sin mínimo"}${c.descripcion ? " · " + escapar(c.descripcion) : ""}</span>
      </div>
      <div class="fila__form">
        <button class="${c.activo ? "sec" : ""}" data-cupon-toggle="${escapar(c.codigo)}" data-activo="${c.activo}">${c.activo ? "Desactivar" : "Activar"}</button>
      </div>
    </article>`).join("");
}

async function cargarCupones() {
  mensaje("#cupon-message", "Cargando cupones…");
  try {
    const { cupones } = await api("/api/admin-cupones");
    renderCupones(cupones);
    mensaje("#cupon-message", "");
  } catch (err) {
    mensaje("#cupon-message", `⚠️ ${err.message}`);
  }
}

$("#cupon-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cupon = {
    codigo: $("#cupon-codigo").value,
    tipo: $("#cupon-tipo").value,
    valor: Number($("#cupon-valor").value),
    minimo: Number($("#cupon-minimo").value) || 0,
    descripcion: $("#cupon-desc").value,
  };
  try {
    const r = await api("/api/admin-cupones", { method: "POST", body: JSON.stringify(cupon) });
    mensaje("#cupon-message", `✅ Cupón ${r.cupon.codigo} guardado`, true);
    $("#cupon-form").reset();
    cargarCupones();
  } catch (err) {
    mensaje("#cupon-message", `⚠️ ${err.message}`);
  }
});

$("#cupones").addEventListener("click", async (e) => {
  const boton = e.target.closest("[data-cupon-toggle]");
  if (!boton) return;
  boton.disabled = true;
  try {
    await api("/api/admin-cupones", {
      method: "PATCH",
      body: JSON.stringify({ codigo: boton.dataset.cuponToggle, activo: boton.dataset.activo !== "true" }),
    });
    cargarCupones();
  } catch (err) {
    mensaje("#cupon-message", `⚠️ ${err.message}`);
    boton.disabled = false;
  }
});

// ===== Alta de producto =====
// Tipo de producto: 'cafe' (fórmula por kilo) o 'simple' (precio fijo a mano)
let productoTipo = "cafe";
// Categoría, solo aplica a 'simple': 'cafe_bolsa' (café en bolsa 1/4) o 'merch' (tazas y otros)
let productoCategoria = "cafe_bolsa";
// El café en bolsa (1/4) es el mismo café que las drip bags en otra
// presentación, así que muestra los mismos campos descriptivos; las tazas y
// otros productos no los necesitan.
function actualizarCamposDescriptivos() {
  const mostrar = productoTipo === "cafe" || (productoTipo === "simple" && productoCategoria === "cafe_bolsa");
  $("#campos-cafe").hidden = !mostrar;
}
function actualizarPlaceholderNombre() {
  const ejemplo = productoTipo === "cafe"
    ? "ej. Café en Grano"
    : productoCategoria === "cafe_bolsa"
      ? "ej. Andino - Bolsa 1/4"
      : "ej. Taza Merla";
  $("#prod-nombre").placeholder = `Nombre (${ejemplo})`;
}
function aplicarTipoProducto(tipo) {
  productoTipo = tipo;
  const esSimple = tipo === "simple";
  $("#prod-tipo").querySelectorAll("button").forEach((x) => x.classList.toggle("px-chip--activo", x.dataset.tipo === tipo));
  $("#prod-categoria").hidden = !esSimple;
  // El costo se muestra en ambos: por kilo en café (requerido) y por unidad
  // en los simples (opcional, para ver el margen).
  $("#prod-costo").hidden = false;
  $("#prod-costo").required = !esSimple;
  $("#prod-costo").placeholder = esSimple ? "Costo por unidad (opcional)" : "Costo por kilo";
  $("#prod-precio").hidden = !esSimple;
  $("#prod-stock").placeholder = esSimple ? "Stock (unidades)" : "Stock (bags)";
  $("#prod-preview").textContent = "";
  actualizarCamposDescriptivos();
  actualizarPlaceholderNombre();
}
$("#prod-tipo").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tipo]");
  if (b) aplicarTipoProducto(b.dataset.tipo);
});
$("#prod-categoria").addEventListener("click", (e) => {
  const b = e.target.closest("[data-categoria]");
  if (!b) return;
  productoCategoria = b.dataset.categoria;
  $("#prod-categoria").querySelectorAll("button").forEach((x) => x.classList.toggle("px-chip--activo", x === b));
  // Tazas y otros no llevan info de café: se limpia lo que haya quedado tipeado
  if (productoCategoria !== "cafe_bolsa") {
    ["#prod-origen", "#prod-region", "#prod-variedad", "#prod-proceso", "#prod-tostador", "#prod-sca", "#prod-notas"]
      .forEach((sel) => { $(sel).value = ""; });
  }
  actualizarCamposDescriptivos();
  actualizarPlaceholderNombre();
});

// Vista previa del costo mientras se escribe (el precio final se decide en Precios)
// Vista previa según el tipo: café calcula el precio inicial desde el costo del
// kilo; el simple muestra el margen contra el precio de venta que se tipee.
function actualizarPreviewCosto() {
  const costo = Number($("#prod-costo").value) || 0;
  const preview = $("#prod-preview");
  if (productoTipo === "simple") {
    const precio = Number($("#prod-precio").value) || 0;
    if (costo <= 0 || precio <= 0) { preview.textContent = ""; return; }
    if (precio < costo) { preview.textContent = "⚠️ El precio de venta está por debajo del costo."; return; }
    preview.textContent = `→ Margen ${margenSimple(costo, precio)}%`;
    return;
  }
  const cfg = cfgLocal();
  if (costo <= 0 || !cfg) { preview.textContent = ""; return; }
  const inicial = precioUnidadDesdeCosto(costo, cfg);
  preview.textContent = `→ Costo por unidad ${formato.format(Math.round(costoUnidad(costo, cfg)))} · precio inicial ${formato.format(inicial)} (después lo ajustás en Precios)`;
}
$("#prod-costo").addEventListener("input", actualizarPreviewCosto);
$("#prod-precio").addEventListener("input", actualizarPreviewCosto);

// La foto se lee como data URL y se sube al crear
let fotoDataUrl = null;
$("#prod-imagen").addEventListener("change", (e) => {
  const archivo = e.target.files[0];
  fotoDataUrl = null;
  $("#prod-thumb").hidden = true;
  if (!archivo) return;
  if (archivo.size > 5 * 1024 * 1024) {
    mensaje("#producto-message", "⚠️ La foto supera los 5 MB");
    e.target.value = "";
    return;
  }
  const lector = new FileReader();
  lector.onload = () => {
    fotoDataUrl = lector.result;
    $("#prod-thumb").src = fotoDataUrl;
    $("#prod-thumb").hidden = false;
    mensaje("#producto-message", "");
  };
  lector.readAsDataURL(archivo);
});

$("#producto-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = $("#producto-form").querySelector("button[type=submit]");
  boton.disabled = true;
  try {
    // 1) Si hay foto, primero la subimos a Storage
    let imagen = null;
    if (fotoDataUrl) {
      mensaje("#producto-message", "Subiendo la foto…");
      const r = await api("/api/admin-imagen", {
        method: "POST",
        body: JSON.stringify({ nombre: $("#prod-nombre").value, dataUrl: fotoDataUrl }),
      });
      imagen = r.url;
    }

    // 2) Creamos el producto (oculto) con su(s) presentación(es)
    mensaje("#producto-message", "Creando el producto…");
    const esSimple = productoTipo === "simple";
    const cuerpo = esSimple
      ? {
          tipo: "simple",
          categoria: productoCategoria,
          nombre: $("#prod-nombre").value,
          precio: Number($("#prod-precio").value),
          costo: $("#prod-costo").value.trim(), // opcional; "" = sin costo
          stock: Number($("#prod-stock").value) || 0,
          // Solo se completan si la categoría es "Café en bolsa (1/4)"; en
          // "Tazas y otros" quedan vacíos (se limpian solos al elegir esa categoría)
          origen: $("#prod-origen").value,
          region: $("#prod-region").value,
          variedad: $("#prod-variedad").value,
          proceso: $("#prod-proceso").value,
          tostador: $("#prod-tostador").value,
          sca: $("#prod-sca").value,
          notas: $("#prod-notas").value,
          descripcion: $("#prod-descripcion").value,
          imagen,
        }
      : {
          tipo: "cafe",
          nombre: $("#prod-nombre").value,
          costo_kg: Number($("#prod-costo").value),
          stock: Number($("#prod-stock").value) || 0,
          origen: $("#prod-origen").value,
          region: $("#prod-region").value,
          variedad: $("#prod-variedad").value,
          proceso: $("#prod-proceso").value,
          tostador: $("#prod-tostador").value,
          sca: $("#prod-sca").value,
          notas: $("#prod-notas").value,
          descripcion: $("#prod-descripcion").value,
          imagen,
        };
    const r = await api("/api/admin-productos", { method: "POST", body: JSON.stringify(cuerpo) });
    mensaje("#producto-message", esSimple
      ? `✅ ${r.producto.nombre} creado (oculto) · ${formato.format(r.precio)}`
      : `✅ ${r.producto.nombre} creado (oculto) · unidad ${formato.format(r.precio)} · pack ${formato.format(r.precioPack)}`, true);
    $("#producto-form").reset();
    aplicarTipoProducto("cafe");
    productoCategoria = "cafe_bolsa";
    $("#prod-categoria").querySelectorAll("button").forEach((x) => x.classList.toggle("px-chip--activo", x.dataset.categoria === "cafe_bolsa"));
    $("#prod-thumb").hidden = true;
    fotoDataUrl = null;
    TABS["tab-precios"].cargado = false; // que Precios muestre el producto nuevo
    cargarProductos();
  } catch (err) {
    mensaje("#producto-message", `⚠️ ${err.message}`);
  } finally {
    boton.disabled = false;
  }
});

// ===== Tabs de gestión =====
const TABS = {
  "tab-productos": { vista: "vista-productos", cargar: cargarProductos, cargado: false },
  "tab-precios": { vista: "vista-precios", cargar: cargarPrecios, cargado: false },
  "tab-cupones": { vista: "vista-cupones", cargar: cargarCupones, cargado: false },
};

function activarTab(tabId) {
  for (const [id, t] of Object.entries(TABS)) {
    const activa = id === tabId;
    $("#" + id).classList.toggle("tab-activo", activa);
    $("#" + t.vista).hidden = !activa;
  }
  const t = TABS[tabId];
  if (!t.cargado) { t.cargar(); t.cargado = true; }
}

Object.keys(TABS).forEach((id) => $("#" + id).addEventListener("click", () => activarTab(id)));

// ===== Panel / login =====
function abrirPanel() {
  $("#login").hidden = true;
  $("#panel").hidden = false;
  $("#logout").hidden = false;
  cargarPedidos();
  // reiniciar el estado "cargado" de las tabs y abrir Productos
  Object.values(TABS).forEach((t) => (t.cargado = false));
  activarTab("tab-productos");
}

function cerrarSesion() {
  sessionStorage.removeItem(TOKEN_KEY);
  $("#login").hidden = false;
  $("#panel").hidden = true;
  $("#logout").hidden = true;
  $("#token").value = "";
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  sessionStorage.setItem(TOKEN_KEY, $("#token").value);
  try {
    await api("/api/admin-pedidos");
    mensaje("#login-message", "");
    abrirPanel();
  } catch (err) {
    sessionStorage.removeItem(TOKEN_KEY);
    mensaje("#login-message", `⚠️ ${err.message}`);
  }
});

$("#logout").addEventListener("click", cerrarSesion);
if (token()) abrirPanel();
