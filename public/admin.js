const TOKEN_KEY = "merla-admin-token";
const $ = (selector) => document.querySelector(selector);
const formato = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function escapar(valor) {
  return String(valor || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

function token() { return sessionStorage.getItem(TOKEN_KEY) || ""; }
function mensaje(id, texto = "") { $(id).textContent = texto; }

async function api(url, opciones = {}) {
  const res = await fetch(url, {
    ...opciones,
    headers: { "Content-Type": "application/json", "X-Admin-Token": token(), ...(opciones.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "No se pudo completar la operación");
  return data;
}

function renderPedidos(pedidos) {
  const contenedor = $("#pedidos");
  if (!pedidos.length) {
    contenedor.innerHTML = `<div class="vacio">No hay pedidos de WhatsApp todavía.</div>`;
    return;
  }
  contenedor.innerHTML = pedidos.map((p) => {
    const lineas = (p.items || []).map((i) => `<li>${escapar(i.qty)}× ${escapar(i.nombre)} <span>${formato.format(i.precio_unitario * i.qty)}</span></li>`).join("");
    const fecha = new Date(p.creado).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" });
    const pendiente = p.estado === "pendiente";
    return `<article class="pedido pedido--${escapar(p.estado)}">
      <div class="pedido__top">
        <div><span class="estado">${escapar(p.estado)}</span><strong>#${escapar(p.id.slice(0, 8).toUpperCase())}</strong></div>
        <time>${fecha}</time>
      </div>
      <ul>${lineas}</ul>
      <div class="pedido__meta"><span>${escapar(p.cliente_email || "Sin email / sin puntos")}</span><strong>${formato.format(p.total)}</strong></div>
      ${p.cliente_email ? `<p class="pedido__points">Puntos al cobrar: +${p.puntos_ganados}${p.puntos_canjeados ? ` · Canje: -${p.puntos_canjeados}` : ""}</p>` : ""}
      ${pendiente ? `<div class="pedido__actions"><button class="aprobar" data-action="aprobar" data-id="${escapar(p.id)}">Marcar cobrado</button><button class="rechazar" data-action="rechazar" data-id="${escapar(p.id)}">Rechazar</button></div>` : ""}
    </article>`;
  }).join("");
}

async function cargarPedidos() {
  mensaje("#panel-message", "Cargando pedidos…");
  try {
    const { pedidos } = await api("/api/admin-pedidos");
    renderPedidos(pedidos);
    mensaje("#panel-message", "");
  } catch (err) {
    mensaje("#panel-message", `⚠️ ${err.message}`);
    if (/autorizado/i.test(err.message)) cerrarSesion();
  }
}

// ===== Stock por gramos de café =====
let gramosPorUnidad = 12;

function renderStock(productos) {
  const contenedor = $("#stock");
  $("#stock-gpu").textContent = gramosPorUnidad;
  if (!productos) return;
  contenedor.innerHTML = productos
    .map(
      (p) => `<article class="stock__fila${p.activo ? "" : " stock__fila--inactivo"}" data-producto="${escapar(p.id)}">
        <div class="stock__info">
          <strong>${escapar(p.nombre)}</strong>
          <span class="stock__actual">Stock: <b data-stock-de="${escapar(p.id)}">${p.stock}</b> bags${p.activo ? "" : " · inactivo"}</span>
        </div>
        <div class="stock__form">
          <input type="number" min="0" step="1" inputmode="numeric" placeholder="Gramos de café" data-gramos aria-label="Gramos de café para ${escapar(p.nombre)}">
          <span class="stock__preview" data-preview>= 0 bags</span>
          <button data-stock-action="sumar" disabled>Sumar</button>
          <button data-stock-action="fijar" disabled>Fijar</button>
        </div>
      </article>`
    )
    .join("");
}

// ===== Gestión de Precios =====
function renderPrecios(productos) {
  const contenedor = $("#precios");
  if (!productos) return;
  contenedor.innerHTML = productos
    .map(
      (p) => `<article class="stock__fila${p.activo ? "" : " stock__fila--inactivo"}" data-producto="${escapar(p.id)}">
        <div class="stock__info">
          <strong>${escapar(p.nombre)}</strong>
          <span class="stock__actual">Precio actual: <b data-precio-de="${escapar(p.id)}">${formato.format(p.precio || 0)}</b></span>
        </div>
        <div class="stock__form">
          <input type="number" min="0" step="1" inputmode="numeric" placeholder="Nuevo precio" data-precio aria-label="Nuevo precio para ${escapar(p.nombre)}">
          <button data-precio-action="guardar">Guardar</button>
        </div>
      </article>`
    )
    .join("");
}

// Única función para cargar Stock (ya no carga precios)
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

// NUEVA función exclusiva para cargar Precios
async function cargarPrecios() {
  mensaje("#precio-message", "Cargando precios…");
  try {
    const data = await api("/api/admin-precios");
    renderPrecios(data.productos);
    mensaje("#precio-message", "");
  } catch (err) {
    mensaje("#precio-message", `⚠️ ${err.message}`);
  }
}

// Modificamos abrirPanel para que llame a las tres cosas por separado
function abrirPanel() {
  $("#login").hidden = true;
  $("#panel").hidden = false;
  $("#logout").hidden = false;
  cargarPedidos();
  cargarStock();
  cargarPrecios(); // <-- Llama a la nueva función
}

// ===== Eventos =====

// Evento de Precios
$("#precios").addEventListener("click", async (e) => {
  const boton = e.target.closest("[data-precio-action]");
  if (!boton) return;
  const fila = boton.closest(".stock__fila");
  const nuevoPrecio = Number(fila.querySelector("[data-precio]").value);
  
  if (!nuevoPrecio || nuevoPrecio <= 0) return;
  
  const nombre = fila.querySelector("strong").textContent;
  if (!confirm(`¿Actualizar el precio de ${nombre} a ${formato.format(nuevoPrecio)}?`)) return;

  fila.querySelectorAll("button").forEach((b) => (b.disabled = true));
  
  try {
    const r = await api("/api/admin-precios", {
      method: "POST",
      body: JSON.stringify({ producto_id: fila.dataset.producto, precio: nuevoPrecio }),
    });
    
    fila.querySelector("[data-precio-de]").textContent = formato.format(r.precio || nuevoPrecio);
    fila.querySelector("[data-precio]").value = "";
    mensaje("#precio-message", `✅ ${nombre}: precio actualizado a ${formato.format(r.precio || nuevoPrecio)}`);
  } catch (err) {
    mensaje("#precio-message", `⚠️ ${err.message}`);
  } finally {
    fila.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
});

// Eventos de Stock
$("#stock").addEventListener("input", (e) => {
  const input = e.target.closest("[data-gramos]");
  if (!input) return;
  const fila = input.closest(".stock__fila");
  const unidades = Math.floor((Number(input.value) || 0) / gramosPorUnidad);
  fila.querySelector("[data-preview]").textContent = `= ${unidades} bags`;
  fila.querySelectorAll("[data-stock-action]").forEach((b) => (b.disabled = unidades <= 0));
});

$("#stock").addEventListener("click", async (e) => {
  const boton = e.target.closest("[data-stock-action]");
  if (!boton) return;
  const fila = boton.closest(".stock__fila");
  const gramos = Number(fila.querySelector("[data-gramos]").value) || 0;
  const unidades = Math.floor(gramos / gramosPorUnidad);
  const accion = boton.dataset.stockAction;
  const nombre = fila.querySelector("strong").textContent;
  const pregunta =
    accion === "sumar"
      ? `¿Sumar ${unidades} bags (${gramos} g) al stock de ${nombre}?`
      : `¿Reemplazar el stock de ${nombre} por ${unidades} bags (${gramos} g)?`;
  if (!confirm(pregunta)) return;

  fila.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const r = await api("/api/admin-stock", {
      method: "POST",
      body: JSON.stringify({ producto_id: fila.dataset.producto, gramos, accion }),
    });
    fila.querySelector("[data-stock-de]").textContent = r.stock;
    fila.querySelector("[data-gramos]").value = "";
    fila.querySelector("[data-preview]").textContent = "= 0 bags";
    mensaje("#stock-message", `✅ ${nombre}: stock actualizado a ${r.stock} bags`);
  } catch (err) {
    mensaje("#stock-message", `⚠️ ${err.message}`);
    fila.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
});

// Panel y Login
function abrirPanel() {
  $("#login").hidden = true;
  $("#panel").hidden = false;
  $("#logout").hidden = false;
  cargarPedidos();
  cargarStock();
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

$("#pedidos").addEventListener("click", async (e) => {
  const boton = e.target.closest("[data-action]");
  if (!boton) return;
  const accion = boton.dataset.action;
  if (accion === "rechazar" && !confirm("¿Rechazar este pedido pendiente?")) return;
  if (accion === "aprobar" && !confirm("¿Confirmar el cobro? Esto descuenta stock y actualiza puntos.")) return;
  boton.disabled = true;
  try {
    await api("/api/admin-pedidos", {
      method: "POST",
      body: JSON.stringify({ accion, id: boton.dataset.id }),
    });
    await cargarPedidos();
  } catch (err) {
    mensaje("#panel-message", `⚠️ ${err.message}`);
    boton.disabled = false;
  }
});

$("#reload").addEventListener("click", cargarPedidos);
$("#logout").addEventListener("click", cerrarSesion);
if (token()) abrirPanel();