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
      ${cupon}${puntos}${entrega}
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
    const { pedidos } = await api("/api/admin-pedidos");
    pedidosCache = pedidos;
    renderPedidos();
    mensaje("#panel-message", "");
  } catch (err) {
    mensaje("#panel-message", `⚠️ ${err.message}`);
    if (/autorizado/i.test(err.message)) cerrarSesion();
  }
}

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

$("#reload").addEventListener("click", cargarPedidos);

// Secciones Pedidos / Gestión
$("#secciones").addEventListener("click", (e) => {
  const b = e.target.closest("[data-seccion]");
  if (!b) return;
  $("#secciones").querySelectorAll("button").forEach((x) => x.classList.toggle("seccion-activa", x === b));
  $("#seccion-pedidos").hidden = b.dataset.seccion !== "pedidos";
  $("#seccion-gestion").hidden = b.dataset.seccion !== "gestion";
});
// ===== Stock por gramos de café =====
let gramosPorUnidad = 12;

function renderStock(productos) {
  const contenedor = $("#stock");
  $("#stock-gpu").textContent = gramosPorUnidad;
  if (!productos) return;
  contenedor.innerHTML = productos.map((p) => `<article class="fila${p.activo ? "" : " fila--inactivo"}" data-producto="${escapar(p.id)}">
      <div class="fila__info">
        <strong>${escapar(p.nombre)}</strong>
        <span class="fila__dato">Stock: <b data-stock-de="${escapar(p.id)}">${p.stock}</b> bags${p.activo ? "" : " · inactivo"}</span>
      </div>
      <div class="fila__form">
        <input type="number" min="0" step="1" inputmode="numeric" placeholder="Gramos de café" data-gramos aria-label="Gramos de café para ${escapar(p.nombre)}">
        <span class="fila__preview" data-preview>= 0 bags</span>
        <button data-stock-action="sumar" disabled>Sumar</button>
        <button class="sec" data-stock-action="fijar" disabled>Fijar</button>
      </div>
    </article>`).join("");
}

async function cargarStock() {
  try {
    const data = await api("/api/admin-stock");
    gramosPorUnidad = data.gramosPorUnidad || 12;
    renderStock(data.productos);
    mensaje("#stock-message", "");
  } catch (err) {
    mensaje("#stock-message", `⚠️ ${err.message}`);
  }
}

$("#stock").addEventListener("input", (e) => {
  const input = e.target.closest("[data-gramos]");
  if (!input) return;
  const fila = input.closest(".fila");
  const unidades = Math.floor((Number(input.value) || 0) / gramosPorUnidad);
  fila.querySelector("[data-preview]").textContent = `= ${unidades} bags`;
  const vacio = input.value.trim() === "";
  fila.querySelector('[data-stock-action="sumar"]').disabled = unidades <= 0;
  fila.querySelector('[data-stock-action="fijar"]').disabled = vacio;
});

$("#stock").addEventListener("click", async (e) => {
  const boton = e.target.closest("[data-stock-action]");
  if (!boton) return;
  const fila = boton.closest(".fila");
  const gramos = Number(fila.querySelector("[data-gramos]").value) || 0;
  const unidades = Math.floor(gramos / gramosPorUnidad);
  const accion = boton.dataset.stockAction;
  const nombre = fila.querySelector("strong").textContent;
  const pregunta = accion === "sumar"
    ? `¿Sumar ${unidades} bags (${gramos} g) al stock de ${nombre}?`
    : `¿Reemplazar el stock de ${nombre} por ${unidades} bags (${gramos} g)?`;
  if (!confirm(pregunta)) return;

  fila.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const r = await api("/api/admin-stock", { method: "POST", body: JSON.stringify({ producto_id: fila.dataset.producto, gramos, accion }) });
    fila.querySelector("[data-stock-de]").textContent = r.stock;
    fila.querySelector("[data-gramos]").value = "";
    fila.querySelector("[data-preview]").textContent = "= 0 bags";
    mensaje("#stock-message", `✅ ${nombre}: stock actualizado a ${r.stock} bags`, true);
  } catch (err) {
    mensaje("#stock-message", `⚠️ ${err.message}`);
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

// Con "precios automáticos" prendido, cada café recupera su margen previo:
// precio nuevo = costo nuevo ÷ (1 − margen), redondeado a $50.
async function actualizarPreciosAutomaticos(margenes) {
  const cfg = cfgLocal();
  let cambios = 0;
  for (const p of preciosCache) {
    const margen = margenes[p.id];
    if (p.costo_kg == null || !p.precio || margen == null || margen < 5 || margen > 90) continue;
    const nuevo = redondearPrecio(costoUnidad(Number(p.costo_kg), cfg) / (1 - margen / 100), 50);
    if (!(nuevo > 0) || nuevo === p.precio) continue;
    try {
      const r = await api("/api/admin-precios", {
        method: "POST",
        body: JSON.stringify({ producto_id: p.id, costo_kg: Number(p.costo_kg), precio: nuevo }),
      });
      Object.assign(p, { costo_kg: r.costo_kg, precio: r.precio, precioPack: r.precioPack });
      cambios++;
    } catch (err) {
      toast(`⚠️ ${p.nombre}: ${err.message}`);
    }
  }
  return cambios;
}

// Después de cualquier cambio de costos (insumo, gramos): refresca la vista y,
// si los precios automáticos están prendidos, también los precios guardados.
async function aplicarCambioDeCostos(margenes) {
  let cambios = 0;
  if (Number(cfgPrecios.preciosAuto)) cambios = await actualizarPreciosAutomaticos(margenes);
  renderPrecios();
  actualizarTotalesInsumos();
  toast(cambios > 0
    ? `Costos recalculados · ${cambios} precio${cambios > 1 ? "s" : ""} actualizado${cambios > 1 ? "s" : ""}.`
    : "Todos los costos fueron recalculados.");
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

function filaProducto(p, cfg) {
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
  c.innerHTML = `<div class="px-productos__head">
      <span>Café</span><span>Costo</span><span>Unidad</span><span>Pack x${cfg.packUnidades}</span><span>Margen</span><span></span>
    </div>` + preciosCache.map((p) => filaProducto(p, cfg)).join("");

  const abierta = c.querySelector(".px-prod--abierto");
  if (!abierta) return;
  if (estado && estado.id === abierta.dataset.producto) {
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
    precioAbierto = null;
    renderPrecios();
    toast(`${p.nombre}: precio actualizado.`);
  } catch (err) {
    const resultado = fila.querySelector("[data-resultado]");
    if (resultado) resultado.innerHTML = `<span class="px-alerta">⚠️ ${escapar(err.message)}</span>`;
    boton.disabled = false;
  }
}

$("#precios").addEventListener("click", async (e) => {
  const fila = e.target.closest(".px-prod");

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
});

$("#precios").addEventListener("input", (e) => {
  const fila = e.target.closest(".px-prod--abierto");
  if (!fila) return;
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
    $("#cfg-precios-auto").checked = Boolean(Number(cfgPrecios.preciosAuto));
    mensaje("#precio-message", dataConfig.desdeLaBase ? "" : "⚠️ Falta correr supabase/migracion-insumos.sql: mientras tanto se usan los valores anteriores y los insumos no se pueden editar.");
  } catch (err) {
    mensaje("#precio-message", `⚠️ ${err.message}`);
  }
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
    await aplicarCambioDeCostos(margenes);
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
    await aplicarCambioDeCostos(margenes);
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
    await aplicarCambioDeCostos(margenes);
  } catch (err) {
    toast(`⚠️ ${err.message}`);
  } finally {
    boton.disabled = false;
  }
});

// ===== Configuración global (se guarda sola) =====
const configPendientes = new Map();
document.querySelectorAll(".px-config [data-clave]").forEach((input) => {
  input.addEventListener("input", () => {
    const fila = input.closest(".px-config__fila");
    ponerEstado(fila, "Guardando…");
    clearTimeout(configPendientes.get(input.dataset.clave));
    configPendientes.set(input.dataset.clave, setTimeout(() => guardarConfigGlobal(input, fila), 800));
  });
});

async function guardarConfigGlobal(input, fila) {
  const clave = input.dataset.clave;
  const valor = input.type === "checkbox" ? (input.checked ? 1 : 0) : Number(input.value);
  if (input.type !== "checkbox" && (input.value === "" || !Number.isFinite(valor) || valor < 0)) {
    ponerEstado(fila, "⚠️ Valor inválido");
    return;
  }
  try {
    const margenes = margenesActuales(); // antes del cambio, para mantenerlos
    await api("/api/admin-config", { method: "PATCH", body: JSON.stringify({ clave, valor }) });
    if (clave === "precios_auto") {
      cfgPrecios.preciosAuto = valor;
      ponerEstado(fila, "✓ Guardado", true);
      toast(valor ? "Precios automáticos activados." : "Precios automáticos desactivados: los precios solo cambian si los editás.");
    } else if (clave === "gramos_por_bag") {
      cfgPrecios.gramosPorBag = valor;
      ponerEstado(fila, "✓ Guardado", true);
      await aplicarCambioDeCostos(margenes);
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

// ===== Productos =====
function renderProductos(productos) {
  const contenedor = $("#productos");
  if (!productos || !productos.length) {
    contenedor.innerHTML = `<div class="vacio">No hay productos.</div>`;
    return;
  }
  contenedor.innerHTML = productos.map((p) => `<article class="fila${p.activo ? "" : " fila--inactivo"}">
      <div class="fila__info">
        <strong>${escapar(p.nombre)}</strong>
        <span class="fila__dato">${p.activo ? "Publicado" : "Oculto"} · ${p.stock} bags${p.origen ? " · " + escapar(p.origen) : ""}${p.imagen ? "" : " · ⚠️ sin foto"}</span>
      </div>
      <div class="fila__form">
        <button class="${p.activo ? "sec" : ""}" data-producto-toggle="${escapar(p.id)}" data-activo="${p.activo}">${p.activo ? "Ocultar" : "Publicar"}</button>
      </div>
    </article>`).join("");
}

async function cargarProductos() {
  mensaje("#producto-message", "Cargando productos…");
  try {
    // La vista previa del costo necesita la config (insumos + gramos por bag)
    if (!cfgPrecios) {
      try {
        const d = await api("/api/admin-config");
        cfgPrecios = d.cfg;
        insumosCache = d.insumos;
      } catch {}
    }
    const { productos } = await api("/api/admin-productos");
    renderProductos(productos);
    mensaje("#producto-message", "");
  } catch (err) {
    mensaje("#producto-message", `⚠️ ${err.message}`);
  }
}

// Vista previa del costo mientras se escribe (el precio final se decide en Precios)
$("#prod-costo").addEventListener("input", () => {
  const costo = Number($("#prod-costo").value) || 0;
  const cfg = cfgLocal();
  if (costo <= 0 || !cfg) { $("#prod-preview").textContent = ""; return; }
  const inicial = precioUnidadDesdeCosto(costo, cfg);
  $("#prod-preview").textContent = `→ Costo por unidad ${formato.format(Math.round(costoUnidad(costo, cfg)))} · precio inicial ${formato.format(inicial)} (después lo ajustás en Precios)`;
});

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

    // 2) Creamos el producto (oculto) con sus dos presentaciones
    mensaje("#producto-message", "Creando el producto…");
    const r = await api("/api/admin-productos", {
      method: "POST",
      body: JSON.stringify({
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
      }),
    });
    mensaje("#producto-message", `✅ ${r.producto.nombre} creado (oculto) · unidad ${formato.format(r.precio)} · pack ${formato.format(r.precioPack)}`, true);
    $("#producto-form").reset();
    $("#prod-preview").textContent = "";
    $("#prod-thumb").hidden = true;
    fotoDataUrl = null;
    TABS["tab-precios"].cargado = false; // que Precios muestre el café nuevo
    cargarProductos();
  } catch (err) {
    mensaje("#producto-message", `⚠️ ${err.message}`);
  } finally {
    boton.disabled = false;
  }
});

$("#productos").addEventListener("click", async (e) => {
  const boton = e.target.closest("[data-producto-toggle]");
  if (!boton) return;
  const publicar = boton.dataset.activo !== "true";
  if (publicar && !confirm("¿Publicar este producto? Va a aparecer en la tienda.")) return;
  boton.disabled = true;
  try {
    await api("/api/admin-productos", {
      method: "PATCH",
      body: JSON.stringify({ id: boton.dataset.productoToggle, activo: publicar }),
    });
    cargarProductos();
  } catch (err) {
    mensaje("#producto-message", `⚠️ ${err.message}`);
    boton.disabled = false;
  }
});

// ===== Tabs de gestión =====
const TABS = {
  "tab-stock": { vista: "vista-stock", cargar: cargarStock, cargado: false },
  "tab-precios": { vista: "vista-precios", cargar: cargarPrecios, cargado: false },
  "tab-cupones": { vista: "vista-cupones", cargar: cargarCupones, cargado: false },
  "tab-productos": { vista: "vista-productos", cargar: cargarProductos, cargado: false },
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
  // reiniciar el estado "cargado" de las tabs y abrir Stock
  Object.values(TABS).forEach((t) => (t.cargado = false));
  activarTab("tab-stock");
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
