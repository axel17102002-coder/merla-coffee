// ===== Configuración =====
// Número de WhatsApp para recibir pedidos (formato internacional, sin + ni espacios)
const WHATSAPP = "5492216803376";
const DESCUENTO_CANTIDAD = 5; // unidades mínimas para el descuento
const DESCUENTO_PORCENTAJE = 5; // % de descuento

// ===== Productos =====
const PRODUCTOS = [
  {
    id: "brasil-honey",
    nombre: "Brasil Honey Cup",
    precio: 1720,
    origen: "Brasil",
    region: "Alta Mogiana, Brasil",
    variedad: "Caturra",
    proceso: "Semi lavado",
    sca: "83,5",
    tostador: "Rito Tostadores",
    notas: ["Azúcar morena", "Almendras", "Frambuesas"],
    desc: "Un café brasileño de la región Alta Mogiana, cultivado entre 1000 y 1200 m y procesado mediante método semi lavado, que realza su dulzura natural. Proveniente de cooperativas locales, destaca por su cuerpo equilibrado. Una taza suave, dulce y persistente, perfecta para disfrutar en cualquier momento.",
    img: "img/brasil-honey.webp",
  },
  {
    id: "oldfashion",
    nombre: "Oldfashion",
    precio: 2360,
    origen: "Colombia",
    region: "Huila, Pitalito (Colombia)",
    variedad: "Bourbon y Caturra",
    proceso: "Lavado",
    sca: "84,5",
    tostador: "La Motofeca",
    notas: ["Especias", "Chocolate", "Pasas de uva"],
    desc: "Cultivado entre 1650 y 2100 m de altitud, destaca por su cuerpo medio, acidez equilibrada y una complejidad aromática que recuerda al clásico cóctel que le da nombre. Con una dulzura sutil y persistente, es un café redondo y aromático, ideal para quienes disfrutan de perfiles intensos y elegantes.",
    img: "img/oldfashion.webp",
  },
  {
    id: "peru",
    nombre: "Perú",
    precio: 2270,
    origen: "Perú",
    region: "Rodríguez de Mendoza, Perú",
    variedad: "Blend de variedades",
    proceso: "Lavado, secado en camas africanas",
    sca: null,
    tostador: "Jack Flash",
    notas: ["Naranja", "Toffee", "Avellanas"],
    desc: "Crece entre 1650 y 2100 m de altitud, donde el clima templado favorece una maduración lenta del grano. Ofrece una taza limpia y balanceada con acidez media melosa y un final dulce y persistente. Un café elegante y complejo, ideal para quienes disfrutan de matices cítricos y dulces.",
    img: "img/peru.webp",
  },
  {
    id: "volcanico",
    nombre: "Volcánico",
    precio: 2100,
    origen: "Colombia",
    region: "Tolima, Chaparral (Colombia)",
    variedad: "Caturra, Colombia y Castillo",
    proceso: "Lavado",
    sca: null,
    tostador: "Momo Tostadores",
    notas: ["Miel", "Toffee", "Frutas amarillas"],
    desc: "Cultivado entre 1500 y 2000 m de altitud, destaca por su buen cuerpo, una acidez media vibrante y un perfil que evoca el clásico café colombiano. Con un dulzor equilibrado y toques cítricos, es un café amable y balanceado, dulce, fresco y reconfortante.",
    img: "img/volcanico.webp",
  },
  {
    id: "brasil",
    nombre: "Brasil",
    precio: 2100,
    origen: "Brasil",
    region: "Espíritu Santo, Brasil",
    variedad: "Catuaí Amarillo y Rojo",
    proceso: "Natural",
    sca: "87",
    tostador: "Familia Cabrales",
    notas: ["Caramelo", "Frutos rojos", "Cítricos dulces"],
    desc: "Microlote cultivado entre 750 y 900 m de altitud por Wallace Junior Schneider. Su proceso natural potencia la dulzura y una acidez brillante y jugosa. Cuerpo medio y aroma intenso: ideal para quienes disfrutan de perfiles frutales y balanceados.",
    img: "img/brasil.webp",
  },
  {
    id: "silverio-nina",
    nombre: "Silverio Nina",
    precio: 2100,
    origen: "Bolivia",
    region: "Los Yungas, Bolivia",
    variedad: "Caturra",
    proceso: "Lavado",
    sca: null,
    tostador: "Momo Tostadores",
    notas: ["Caramelo", "Cítricos", "Ciruela"],
    desc: "Cultivado a más de 1550 m de altitud, destaca por su cuerpo agradable, una acidez refrescante y un perfil notablemente limpio, con un dulzor llamativo y persistente. Un café elegante y fresco, ideal para una taza frutal a cualquier hora del día.",
    img: "img/silverio-nina.webp",
  },
  {
    id: "andino",
    nombre: "Andino",
    precio: 2100,
    origen: "Colombia",
    region: "Quindío, Colombia",
    variedad: "Caturra, Colombia, Catimor y Castillo",
    proceso: "Lavado",
    sca: null,
    tostador: "Momo Tostadores",
    notas: ["Caramelo", "Frutos rojos", "Cítrico"],
    desc: "Cultivado entre 1500 y 2000 m de altitud, destaca por su buen cuerpo, acidez media vibrante y un perfil clásico irresistible, con una dulzura fresca y balanceada. Un café amable, ideal para quienes disfrutan de la elegancia de un tradicional café colombiano.",
    img: "img/andino.webp",
  },
];

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

// ===== Render de productos =====
function renderProductos() {
  $("#product-grid").innerHTML = PRODUCTOS.map(
    (p) => `
    <article class="card">
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

// ===== Checkout por WhatsApp =====
function checkout() {
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
  }, 2200);
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
$("#checkout").addEventListener("click", checkout);

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
