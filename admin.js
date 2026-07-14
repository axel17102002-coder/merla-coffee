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
    const { pedidos } = await api("/.netlify/functions/admin-pedidos");
    renderPedidos(pedidos);
    mensaje("#panel-message", "");
  } catch (err) {
    mensaje("#panel-message", `⚠️ ${err.message}`);
    if (/autorizado/i.test(err.message)) cerrarSesion();
  }
}

function abrirPanel() {
  $("#login").hidden = true;
  $("#panel").hidden = false;
  $("#logout").hidden = false;
  cargarPedidos();
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
    await api("/.netlify/functions/admin-pedidos");
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
    await api("/.netlify/functions/admin-pedidos", {
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
