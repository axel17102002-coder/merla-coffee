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
  fila.querySelectorAll("[data-stock-action]").forEach((b) => (b.disabled = unidades <= 0));
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

// ===== Precios (se cargan desde el costo del café) =====
let cfgPrecios = null;

// Vista previa de la cadena de precios mientras se escribe el costo
function previewPrecios(costo) {
  const precio = precioUnidadDesdeCosto(costo);
  const pack = precioPack(precio);
  return { precio, pack, margen: margenPack(costo, pack) };
}

function renderPrecios(productos) {
  const contenedor = $("#precios");
  if (!productos) return;
  contenedor.innerHTML = productos.map((p) => `<article class="fila${p.activo ? "" : " fila--inactivo"}" data-producto="${escapar(p.id)}">
      <div class="fila__info">
        <strong>${escapar(p.nombre || p.id)}</strong>
        <span class="fila__dato">
          Unidad <b data-precio-de="${escapar(p.id)}">${formato.format(p.precio || 0)}</b>
          ${p.tienePack ? ` · Pack <b data-pack-de="${escapar(p.id)}">${formato.format(p.precioPack || 0)}</b>` : ""}
          ${p.margenPack != null ? ` · margen pack <b data-margen-de="${escapar(p.id)}">${p.margenPack}%</b>` : ""}
        </span>
      </div>
      <div class="fila__form">
        <input type="number" min="0" step="1" inputmode="numeric" placeholder="Costo 250 g"
               value="${p.costo_250g != null ? Math.round(p.costo_250g) : ""}"
               data-costo aria-label="Costo de 250 g de ${escapar(p.nombre || p.id)}">
        <span class="fila__preview" data-preview></span>
        <button data-precio-action="guardar">Guardar</button>
      </div>
    </article>`).join("");
}

async function cargarPrecios() {
  mensaje("#precio-message", "Cargando precios…");
  try {
    const data = await api("/api/admin-precios");
    cfgPrecios = data.config;
    renderPrecios(data.productos);
    mensaje("#precio-message", "");
  } catch (err) {
    mensaje("#precio-message", `⚠️ ${err.message}`);
  }
}

// Al tipear el costo, mostramos a cuánto quedaría la unidad y el pack
$("#precios").addEventListener("input", (e) => {
  const input = e.target.closest("[data-costo]");
  if (!input) return;
  const costo = Number(input.value) || 0;
  const prev = input.closest(".fila").querySelector("[data-preview]");
  prev.textContent = costo > 0 ? `→ ${formato.format(previewPrecios(costo).precio)} c/u` : "";
});

$("#precios").addEventListener("click", async (e) => {
  const boton = e.target.closest("[data-precio-action]");
  if (!boton) return;
  const fila = boton.closest(".fila");
  const costo = Number(fila.querySelector("[data-costo]").value);
  if (!costo || costo <= 0) return;
  const nombre = fila.querySelector("strong").textContent;
  const { precio, pack, margen } = previewPrecios(costo);
  if (!confirm(`${nombre}\n\nCosto 250 g: ${formato.format(costo)}\n→ Unidad: ${formato.format(precio)}\n→ Pack x5: ${formato.format(pack)} (${cfgPrecios ? cfgPrecios.pack.descuento : 10}% OFF, margen ${margen}%)\n\n¿Guardar estos precios?`)) return;

  fila.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const r = await api("/api/admin-precios", { method: "POST", body: JSON.stringify({ producto_id: fila.dataset.producto, costo_250g: costo }) });
    fila.querySelector("[data-precio-de]").textContent = formato.format(r.precio);
    const elPack = fila.querySelector("[data-pack-de]");
    if (elPack) elPack.textContent = formato.format(r.precioPack);
    const elMargen = fila.querySelector("[data-margen-de]");
    if (elMargen) elMargen.textContent = `${r.margenPack}%`;
    fila.querySelector("[data-preview]").textContent = "";
    mensaje("#precio-message", `✅ ${nombre}: unidad ${formato.format(r.precio)} · pack ${formato.format(r.precioPack)}`, true);
  } catch (err) {
    mensaje("#precio-message", `⚠️ ${err.message}`);
  } finally {
    fila.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
});

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

// ===== Tabs de gestión =====
const TABS = {
  "tab-stock": { vista: "vista-stock", cargar: cargarStock, cargado: false },
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
