// ===== Configuración =====
// Los productos, precios y reglas de descuento viven en productos.js
// Número de WhatsApp para recibir pedidos (formato internacional, sin + ni espacios)
const WHATSAPP = "5492216803376";

// Ambiente de MODO: "test" (sandbox, no cobra de verdad) o "produccion".
// Al pasar a producción también hay que configurar las credenciales reales
// en Netlify (ver README).
const MODO_AMBIENTE = "test";

const MODO_SCRIPT =
  MODO_AMBIENTE === "produccion"
    ? "https://ecommerce-modal.modo.com.ar/bundle.js"
    : "https://ecommerce-modal.preprod.modo.com.ar/bundle.js";

// Cargamos el SDK del modal de MODO según el ambiente configurado
const modoScript = document.createElement("script");
modoScript.src = MODO_SCRIPT;
modoScript.defer = true;
document.head.appendChild(modoScript);

// ===== Estado del carrito =====
let carrito = JSON.parse(localStorage.getItem("merla-carrito") || "{}");

const $ = (sel) => document.querySelector(sel);

const formatear = (n) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function guardar() {
  localStorage.setItem("merla-carrito", JSON.stringify(carrito));
}

function cantidadTotal() {
  return Object.values(carrito).reduce((a, b) => a + b, 0);
}

function subtotal() {
  return Object.entries(carrito).reduce((acc, [id, qty]) => {
    const p = PRODUCTOS.find((p) => p.id === id);
    return acc + (p ? p.precio * qty : 0);
  }, 0);
}

function itemsDelCarrito() {
  return Object.entries(carrito)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ id, qty }));
}

// ===== Render de productos =====
function renderProductos() {
  $("#product-grid").innerHTML = PRODUCTOS.map(
    (p, i) => `
    <article class="card reveal" style="--delay:${i * 60}ms">
      <div class="card__img" data-modal="${p.id}">
        <img src="${p.img}" alt="${p.nombre} - Drip Bag" loading="lazy">
        <span class="card__origin">${p.origen}</span>
        ${p.sca ? `<span class="card__sca">SCA ${p.sca}</span>` : ""}
      </div>
      <div class="card__body">
        <h3>${p.nombre}</h3>
        <div class="card__notes">${p.notas.map((n) => `<span class="chip">${n}</span>`).join("")}</div>
        <button class="card__more" data-modal="${p.id}">Ver detalle del café</button>
        <div class="card__foot">
          <span class="card__price">${formatear(p.precio)}</span>
          <button class="card__add" data-add="${p.id}">Agregar</button>
        </div>
      </div>
    </article>`
  ).join("");
  observarReveals();
}

// ===== Render del carrito =====
function renderCarrito() {
  const items = Object.entries(carrito).filter(([, qty]) => qty > 0);
  const badge = $("#cart-count");
  const total = cantidadTotal();

  badge.hidden = total === 0;
  badge.textContent = total;

  if (items.length === 0) {
    $("#cart-items").innerHTML = `
      <div class="cart__empty">
        <span>☕</span>
        <p>Tu carrito está vacío.<br>¡Elegí tu próximo café!</p>
      </div>`;
    $("#cart-foot").style.display = "none";
    return;
  }

  $("#cart-foot").style.display = "block";
  $("#cart-items").innerHTML = items
    .map(([id, qty]) => {
      const p = PRODUCTOS.find((p) => p.id === id);
      if (!p) return "";
      return `
      <div class="cart-item">
        <img src="${p.img}" alt="${p.nombre}">
        <div>
          <div class="cart-item__name">${p.nombre}</div>
          <div class="cart-item__price">${formatear(p.precio)} c/u</div>
          <div class="cart-item__qty">
            <button data-menos="${id}" aria-label="Restar">−</button>
            <b>${qty}</b>
            <button data-mas="${id}" aria-label="Sumar">+</button>
          </div>
        </div>
        <div style="text-align:right">
          <div class="cart-item__total">${formatear(p.precio * qty)}</div>
          <button class="cart-item__remove" data-quitar="${id}">Quitar</button>
        </div>
      </div>`;
    })
    .join("");

  const sub = subtotal();
  const aplicaDescuento = total >= DESCUENTO_CANTIDAD;
  const descuento = aplicaDescuento ? Math.round((sub * DESCUENTO_PORCENTAJE) / 100) : 0;

  $("#cart-subtotal").textContent = formatear(sub);
  $("#discount-row").hidden = !aplicaDescuento;
  $("#cart-discount").textContent = "-" + formatear(descuento);
  $("#cart-total").textContent = formatear(sub - descuento);

  const faltan = DESCUENTO_CANTIDAD - total;
  $("#discount-hint").textContent = aplicaDescuento
    ? "🎉 ¡Tenés el 5% de descuento por cantidad!"
    : `Agregá ${faltan} drip bag${faltan > 1 ? "s" : ""} más y llevate 5% OFF`;

  $("#modo-test-note").hidden = MODO_AMBIENTE !== "test";
}

// ===== Acciones del carrito =====
function agregar(id, abrir = false) {
  carrito[id] = (carrito[id] || 0) + 1;
  guardar();
  renderCarrito();
  const p = PRODUCTOS.find((p) => p.id === id);
  mostrarToast(`${p.nombre} agregado al carrito ☕`);
  if (abrir) abrirCarrito();
}

function cambiar(id, delta) {
  carrito[id] = Math.max(0, (carrito[id] || 0) + delta);
  if (carrito[id] === 0) delete carrito[id];
  guardar();
  renderCarrito();
}

function quitar(id) {
  delete carrito[id];
  guardar();
  renderCarrito();
}

function vaciarCarrito() {
  carrito = {};
  guardar();
  renderCarrito();
}

// ===== Checkout por WhatsApp =====
function checkoutWhatsApp() {
  const items = Object.entries(carrito).filter(([, qty]) => qty > 0);
  if (items.length === 0) return;

  const total = cantidadTotal();
  const sub = subtotal();
  const aplicaDescuento = total >= DESCUENTO_CANTIDAD;
  const descuento = aplicaDescuento ? Math.round((sub * DESCUENTO_PORCENTAJE) / 100) : 0;

  let msg = "¡Hola Merla Coffee! Quiero hacer este pedido:\n\n";
  items.forEach(([id, qty]) => {
    const p = PRODUCTOS.find((p) => p.id === id);
    msg += `• ${qty}x ${p.nombre} - Drip Bag (${formatear(p.precio)} c/u)\n`;
  });
  msg += `\nSubtotal: ${formatear(sub)}`;
  if (aplicaDescuento) {
    msg += `\nDescuento 5% (${total} unidades): -${formatear(descuento)}`;
  }
  msg += `\n*Total: ${formatear(sub - descuento)}*`;
  msg += "\n\n¿Me confirmás disponibilidad y cómo coordinamos envío y pago?";

  window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`, "_blank");
}

// ===== Checkout con MODO =====
async function crearPagoModo() {
  const res = await fetch("/.netlify/functions/modo-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: itemsDelCarrito() }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error ${res.status} al generar el pago`);
  }
  return res.json();
}

async function pagarConModo() {
  if (cantidadTotal() === 0) return;

  const btn = $("#pay-modo");
  const textoOriginal = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Generando pago…";

  const urlBase = location.origin + location.pathname;

  try {
    if (typeof ModoSDK === "undefined") {
      throw new Error("No se pudo cargar el SDK de MODO. Revisá tu conexión y recargá la página.");
    }
    const pago = await crearPagoModo();
    ModoSDK.modoInitPayment({
      version: "2",
      checkoutId: pago.id,
      qrString: pago.qr,
      deeplink: {
        url: pago.deeplink,
        callbackURL: urlBase,
        callbackURLSuccess: `${urlBase}?pago=ok`,
      },
      callbackURL: `${urlBase}?pago=ok`,
      // MODO llama a esto cuando el usuario pide "Generar nuevo QR"
      refreshData: async () => {
        const nuevo = await crearPagoModo();
        return { checkoutId: nuevo.id, qrString: nuevo.qr, deeplink: nuevo.deeplink };
      },
      onSuccess: () => pagoExitoso(),
      onFailure: () => mostrarToast("El pago no se completó. Podés intentarlo de nuevo."),
    });
  } catch (err) {
    console.error(err);
    mostrarToast(
      err.message.includes("SDK")
        ? err.message
        : "No pudimos iniciar el pago con MODO. Probá de nuevo o pedí por WhatsApp."
    );
  } finally {
    btn.disabled = false;
    btn.innerHTML = textoOriginal;
  }
}

function pagoExitoso() {
  vaciarCarrito();
  cerrarCarrito();
  mostrarToast("✅ ¡Pago aprobado! Gracias por tu compra 💚");
}

// Si MODO nos redirige de vuelta con ?pago=ok (flujo mobile), confirmamos acá
if (new URLSearchParams(location.search).get("pago") === "ok") {
  vaciarCarrito();
  history.replaceState(null, "", location.pathname);
  window.addEventListener("DOMContentLoaded", () =>
    mostrarToast("✅ ¡Pago aprobado! Gracias por tu compra 💚")
  );
}

// ===== UI: carrito drawer =====
function abrirCarrito() {
  $("#cart").hidden = false;
  $("#overlay").hidden = false;
  requestAnimationFrame(() => {
    $("#cart").classList.add("visible");
    $("#overlay").classList.add("visible");
  });
  document.body.style.overflow = "hidden";
}

function cerrarCarrito() {
  $("#cart").classList.remove("visible");
  $("#overlay").classList.remove("visible");
  document.body.style.overflow = "";
  setTimeout(() => {
    $("#cart").hidden = true;
    $("#overlay").hidden = true;
  }, 300);
}

// ===== UI: modal de producto =====
function abrirModal(id) {
  const p = PRODUCTOS.find((p) => p.id === id);
  if (!p) return;
  $("#modal-card").innerHTML = `
    <div class="modal__img"><img src="${p.img}" alt="${p.nombre}"></div>
    <div class="modal__body">
      <button class="modal__close" aria-label="Cerrar">✕</button>
      <h3>${p.nombre}</h3>
      <p class="modal__region">📍 ${p.region}</p>
      <p class="modal__desc">${p.desc}</p>
      <div class="modal__specs">
        <div><strong>Variedad</strong>${p.variedad}</div>
        <div><strong>Proceso</strong>${p.proceso}</div>
        <div><strong>Tostado por</strong>${p.tostador}</div>
        ${p.sca ? `<div><strong>Puntaje SCA</strong>${p.sca}</div>` : ""}
        <div><strong>Notas</strong>${p.notas.join(", ")}</div>
        <div><strong>Contenido</strong>1 drip bag · rinde 1 taza (200 cc)</div>
      </div>
      <div class="modal__foot">
        <span class="modal__price">${formatear(p.precio)}</span>
        <button class="btn btn--primary" data-add-modal="${p.id}">Agregar al carrito</button>
      </div>
    </div>`;
  $("#modal").hidden = false;
  document.body.style.overflow = "hidden";
}

function cerrarModal() {
  $("#modal").hidden = true;
  document.body.style.overflow = "";
}

// ===== Toast =====
let toastTimer;
function mostrarToast(texto) {
  const toast = $("#toast");
  toast.textContent = texto;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("visible"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => (toast.hidden = true), 300);
  }, 2600);
}

// ===== Animaciones de aparición =====
const prefiereMenosMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("visible");
        revealObserver.unobserve(e.target);
      }
    });
  },
  { threshold: 0.12 }
);

function observarReveals() {
  document.querySelectorAll(".reveal:not(.visible)").forEach((el) => {
    if (prefiereMenosMovimiento) {
      el.classList.add("visible");
    } else {
      revealObserver.observe(el);
    }
  });
}

// ===== Eventos =====
document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) return agregar(add.dataset.add);

  const addModal = e.target.closest("[data-add-modal]");
  if (addModal) {
    cerrarModal();
    return agregar(addModal.dataset.addModal, true);
  }

  const modal = e.target.closest("[data-modal]");
  if (modal) return abrirModal(modal.dataset.modal);

  if (e.target.closest("[data-mas]")) return cambiar(e.target.closest("[data-mas]").dataset.mas, 1);
  if (e.target.closest("[data-menos]")) return cambiar(e.target.closest("[data-menos]").dataset.menos, -1);
  if (e.target.closest("[data-quitar]")) return quitar(e.target.closest("[data-quitar]").dataset.quitar);

  if (e.target.closest(".modal__close") || e.target.id === "modal") return cerrarModal();
});

$("#cart-open").addEventListener("click", abrirCarrito);
$("#cart-close").addEventListener("click", cerrarCarrito);
$("#overlay").addEventListener("click", cerrarCarrito);
$("#checkout").addEventListener("click", checkoutWhatsApp);
$("#pay-modo").addEventListener("click", pagarConModo);

$("#burger").addEventListener("click", () => $("#nav").classList.toggle("open"));
$("#nav").addEventListener("click", (e) => {
  if (e.target.tagName === "A") $("#nav").classList.remove("open");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    cerrarModal();
    cerrarCarrito();
  }
});

// ===== Inicio =====
renderProductos();
renderCarrito();
observarReveals();
