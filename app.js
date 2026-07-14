// ===== Configuración =====
// Productos, precios, stock, packs, cupones y puntos viven en productos.js
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

// ===== Estado =====
// Carrito: { "productoId:presentacionId": cantidad }
let carrito = JSON.parse(localStorage.getItem("merla-carrito") || "{}");

// Migración de carritos viejos (claves sin presentación)
for (const clave of Object.keys(carrito)) {
  if (!clave.includes(":")) {
    carrito[`${clave}:unidad`] = (carrito[`${clave}:unidad`] || 0) + carrito[clave];
    delete carrito[clave];
  }
}

const $ = (sel) => document.querySelector(sel);

const formatear = (n) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function guardar() {
  localStorage.setItem("merla-carrito", JSON.stringify(carrito));
}

function itemsDelCarrito(extra = null) {
  const items = Object.entries(carrito)
    .filter(([, qty]) => qty > 0)
    .map(([clave, qty]) => {
      const [id, presentacion] = clave.split(":");
      return { id, presentacion, qty };
    });
  if (extra) items.push(extra);
  return items;
}

function cantidadLineas() {
  return Object.values(carrito).reduce((a, b) => a + b, 0);
}

// --- Cupón y canje activos ---
const cuponActivo = () => localStorage.getItem("merla-cupon") || null;
const canjeActivo = () => localStorage.getItem("merla-canje") === "1";

// --- Puntos Club Merla (guardados en este navegador) ---
const puntos = () => Number.parseInt(localStorage.getItem("merla-puntos") || "0", 10);
const setPuntos = (n) => localStorage.setItem("merla-puntos", String(Math.max(0, Math.round(n))));

// Calcula el pedido actual soltando cupón/canje si dejaron de ser válidos
function estadoPedido() {
  const items = itemsDelCarrito();
  if (items.length === 0) return { items, calc: null, error: null };

  let cupon = cuponActivo();
  let canje = canjeActivo();

  let calc = calcularPedido(items, { cupon, canjePuntos: canje });
  if (!calc.ok && canje) {
    canje = false;
    localStorage.removeItem("merla-canje");
    calc = calcularPedido(items, { cupon });
  }
  if (!calc.ok && cupon) {
    cupon = null;
    localStorage.removeItem("merla-cupon");
    calc = calcularPedido(items, {});
  }
  return calc.ok
    ? { items, calc, error: null }
    : { items, calc: null, error: calc.error };
}

// ===== Render de productos =====
function selectorPresentaciones(p, contexto) {
  const opciones = presentacionesDe(p);
  return `
    <div class="pres" data-pres-de="${p.id}" data-contexto="${contexto}">
      ${opciones
        .map(
          (o, i) => `
        <button class="pres__btn ${i === 0 ? "activo" : ""}" data-pres="${o.id}"
          data-precio="${o.precio}" ${o.unidades > p.stock ? "disabled" : ""}>
          ${o.nombre}${o.unidades > 1 ? ` <em>-${PACK_X5.descuento}%</em>` : ""}
        </button>`
        )
        .join("")}
    </div>`;
}

function badgeStock(p) {
  if (p.stock === 0) return `<span class="card__stock card__stock--agotado">Agotado</span>`;
  if (p.stock <= 5) return `<span class="card__stock">¡Quedan ${p.stock}!</span>`;
  return "";
}

function renderProductos() {
  $("#product-grid").innerHTML = PRODUCTOS.map(
    (p, i) => `
    <article class="card reveal ${p.stock === 0 ? "card--agotado" : ""}" style="--delay:${i * 60}ms" data-card="${p.id}">
      <div class="card__img" data-modal="${p.id}">
        <img src="${p.img}" alt="${p.nombre} - Drip Bag" loading="lazy">
        <span class="card__origin">${p.origen}</span>
        ${p.sca ? `<span class="card__sca">SCA ${p.sca}</span>` : ""}
        ${badgeStock(p)}
      </div>
      <div class="card__body">
        <h3>${p.nombre}</h3>
        <div class="card__notes">${p.notas.map((n) => `<span class="chip">${n}</span>`).join("")}</div>
        <button class="card__more" data-modal="${p.id}">Ver detalle del café</button>
        ${p.stock > 0 ? selectorPresentaciones(p, "card") : ""}
        <div class="card__foot">
          <span class="card__price" data-precio-de="${p.id}">${formatear(p.precio)}</span>
          <button class="card__add" data-add="${p.id}" ${p.stock === 0 ? "disabled" : ""}>
            ${p.stock === 0 ? "Sin stock" : "Agregar"}
          </button>
        </div>
      </div>
    </article>`
  ).join("");
  observarReveals();
}

// Presentación seleccionada dentro de una tarjeta o del modal
function presSeleccionada(contenedor) {
  const activo = contenedor.querySelector(".pres__btn.activo");
  return activo ? activo.dataset.pres : "unidad";
}

// ===== Render del carrito =====
function renderCarrito() {
  const { items, calc, error } = estadoPedido();
  const badge = $("#cart-count");
  const totalLineas = cantidadLineas();

  badge.hidden = totalLineas === 0;
  badge.textContent = calc ? calc.unidades : totalLineas;

  renderPuntosWidget();

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
    .map(({ id, presentacion, qty }) => {
      const p = PRODUCTOS.find((p) => p.id === id);
      if (!p) return "";
      const pres = presentacionesDe(p).find((x) => x.id === presentacion);
      const clave = `${id}:${presentacion}`;
      return `
      <div class="cart-item">
        <img src="${p.img}" alt="${p.nombre}">
        <div>
          <div class="cart-item__name">${p.nombre} <span class="cart-item__pres">${pres.nombre}</span></div>
          <div class="cart-item__price">${formatear(pres.precio)} c/u</div>
          <div class="cart-item__qty">
            <button data-menos="${clave}" aria-label="Restar">−</button>
            <b>${qty}</b>
            <button data-mas="${clave}" aria-label="Sumar">+</button>
          </div>
        </div>
        <div style="text-align:right">
          <div class="cart-item__total">${formatear(pres.precio * qty)}</div>
          <button class="cart-item__remove" data-quitar="${clave}">Quitar</button>
        </div>
      </div>`;
    })
    .join("");

  // Cupón: input o chip aplicado
  const cupon = calc ? calc.cupon : null;
  $("#coupon-form").hidden = Boolean(cupon);
  $("#coupon-applied").hidden = !cupon;
  if (cupon) $("#coupon-applied-code").textContent = cupon;

  if (error) {
    // p. ej. quedó más cantidad en el carrito que stock disponible
    $("#cart-summary").hidden = true;
    $("#cart-error").hidden = false;
    $("#cart-error").textContent = `⚠️ ${error}. Ajustá las cantidades para continuar.`;
    $("#pay-modo").disabled = true;
    $("#checkout").disabled = true;
    return;
  }

  $("#cart-error").hidden = true;
  $("#cart-summary").hidden = false;
  $("#pay-modo").disabled = false;
  $("#checkout").disabled = false;

  $("#cart-subtotal").textContent = formatear(calc.subtotal);

  $("#discount-row").hidden = calc.descuentoCantidad === 0;
  $("#cart-discount").textContent = "-" + formatear(calc.descuentoCantidad);

  $("#coupon-row").hidden = calc.descuentoCupon === 0;
  $("#coupon-row-label").textContent = `Cupón ${calc.cupon || ""}`;
  $("#cart-coupon-discount").textContent = "-" + formatear(calc.descuentoCupon);

  $("#points-row").hidden = calc.descuentoPuntos === 0;
  $("#cart-points-discount").textContent = "-" + formatear(calc.descuentoPuntos);

  $("#cart-total").textContent = formatear(calc.total);

  // Hint de descuento por cantidad (solo aplica a unidades sueltas)
  const faltan = DESCUENTO_CANTIDAD - calc.unidadesSueltas;
  $("#discount-hint").textContent =
    calc.descuentoCantidad > 0
      ? `🎉 ¡Tenés el ${DESCUENTO_PORCENTAJE}% de descuento por cantidad!`
      : calc.unidadesSueltas > 0 && faltan <= 2
        ? `Agregá ${faltan} unidad${faltan > 1 ? "es" : ""} suelta${faltan > 1 ? "s" : ""} más y llevate ${DESCUENTO_PORCENTAJE}% OFF`
        : "";

  $("#cart-earn").textContent = `Pagando con MODO sumás ${calc.puntosGanados} puntos Club Merla ⭐`;

  $("#modo-test-note").hidden = MODO_AMBIENTE !== "test";
}

// Widget de puntos dentro del carrito
function renderPuntosWidget() {
  const box = $("#points-box");
  const pts = puntos();
  const canje = canjeActivo();

  if (canje) {
    box.innerHTML = `⭐ Canje aplicado: <strong>-${formatear(FIDELIDAD.canjeDescuento)}</strong>
      (${FIDELIDAD.canjePuntos} puntos) <button class="points-box__quitar" id="points-remove">Quitar</button>`;
    return;
  }
  if (pts >= FIDELIDAD.canjePuntos) {
    box.innerHTML = `⭐ Tenés <strong>${pts} puntos</strong> ·
      <button class="points-box__canjear" id="points-redeem">Canjear ${FIDELIDAD.canjePuntos} por ${formatear(FIDELIDAD.canjeDescuento)} OFF</button>`;
    return;
  }
  box.innerHTML = `⭐ Club Merla: tenés <strong>${pts} puntos</strong>. Juntá ${FIDELIDAD.canjePuntos} y canjealos por ${formatear(FIDELIDAD.canjeDescuento)} de descuento.`;
}

// Sección "Cupones y Club Merla"
function renderBeneficios() {
  const grid = $("#coupon-grid");
  if (!grid) return;
  const publicos = CUPONES.filter((c) => c.publico);
  grid.innerHTML =
    publicos
      .map(
        (c) => `
      <div class="coupon reveal">
        <div class="coupon__code">${c.codigo}</div>
        <p class="coupon__desc">${c.descripcion}</p>
        ${c.minimo ? `<p class="coupon__min">Mínimo: ${formatear(c.minimo)}</p>` : ""}
        <button class="coupon__use" data-cupon="${c.codigo}">Usar cupón</button>
      </div>`
      )
      .join("") +
    `
    <div class="coupon coupon--club reveal">
      <div class="coupon__code">⭐ Club Merla</div>
      <p class="coupon__desc">Sumás <strong>${FIDELIDAD.puntosPorCien} punto por cada $100</strong> pagando online con MODO. Con ${FIDELIDAD.canjePuntos} puntos canjeás <strong>${formatear(FIDELIDAD.canjeDescuento)} de descuento</strong>.</p>
      <p class="coupon__min">Tus puntos en este dispositivo: <strong id="club-puntos">${puntos()}</strong></p>
    </div>`;
  observarReveals();
}

// ===== Acciones del carrito =====
// Valida contra el motor antes de aplicar: respeta stock y presentaciones
function intentarCambio(nuevoCarrito, mensajeOk) {
  const items = Object.entries(nuevoCarrito)
    .filter(([, qty]) => qty > 0)
    .map(([clave, qty]) => {
      const [id, presentacion] = clave.split(":");
      return { id, presentacion, qty };
    });
  if (items.length > 0) {
    const r = calcularPedido(items, {});
    if (!r.ok) {
      mostrarToast(`⚠️ ${r.error}`);
      return false;
    }
  }
  carrito = Object.fromEntries(Object.entries(nuevoCarrito).filter(([, q]) => q > 0));
  guardar();
  renderCarrito();
  if (mensajeOk) mostrarToast(mensajeOk);
  return true;
}

function agregar(id, presentacion, abrir = false) {
  const clave = `${id}:${presentacion}`;
  const nuevo = { ...carrito, [clave]: (carrito[clave] || 0) + 1 };
  const p = PRODUCTOS.find((p) => p.id === id);
  const pres = presentacionesDe(p).find((x) => x.id === presentacion);
  const ok = intentarCambio(nuevo, `${p.nombre} (${pres.nombre}) agregado ☕`);
  if (ok && abrir) abrirCarrito();
}

function cambiar(clave, delta) {
  const nuevo = { ...carrito, [clave]: (carrito[clave] || 0) + delta };
  intentarCambio(nuevo, null);
}

function quitar(clave) {
  const nuevo = { ...carrito };
  delete nuevo[clave];
  intentarCambio(nuevo, null);
}

function vaciarCarrito() {
  carrito = {};
  guardar();
  localStorage.removeItem("merla-cupon");
  localStorage.removeItem("merla-canje");
  renderCarrito();
}

// ===== Cupones =====
function aplicarCupon(codigo) {
  const items = itemsDelCarrito();
  if (items.length === 0) {
    mostrarToast("Agregá productos al carrito para usar el cupón");
    return false;
  }
  const r = calcularPedido(items, { cupon: codigo, canjePuntos: canjeActivo() });
  if (!r.ok) {
    mostrarToast(`⚠️ ${r.error}`);
    return false;
  }
  localStorage.setItem("merla-cupon", r.cupon);
  renderCarrito();
  mostrarToast(`✅ Cupón ${r.cupon} aplicado: -${formatear(r.descuentoCupon)}`);
  return true;
}

function quitarCupon() {
  localStorage.removeItem("merla-cupon");
  renderCarrito();
}

// ===== Canje de puntos =====
function canjearPuntos() {
  if (puntos() < FIDELIDAD.canjePuntos) return;
  const r = calcularPedido(itemsDelCarrito(), { cupon: cuponActivo(), canjePuntos: true });
  if (!r.ok) {
    mostrarToast(`⚠️ ${r.error}`);
    return;
  }
  localStorage.setItem("merla-canje", "1");
  renderCarrito();
  mostrarToast(`⭐ Canje aplicado: -${formatear(FIDELIDAD.canjeDescuento)}`);
}

function quitarCanje() {
  localStorage.removeItem("merla-canje");
  renderCarrito();
}

// ===== Checkout por WhatsApp =====
function checkoutWhatsApp() {
  const { calc } = estadoPedido();
  if (!calc) return;

  let msg = "¡Hola Merla Coffee! Quiero hacer este pedido:\n\n";
  calc.lineas.forEach((l) => {
    msg += `• ${l.qty}x ${l.nombre} - ${l.presentacionNombre} (${formatear(l.precioUnitario)} c/u)\n`;
  });
  msg += `\nSubtotal: ${formatear(calc.subtotal)}`;
  if (calc.descuentoCantidad) {
    msg += `\nDescuento ${DESCUENTO_PORCENTAJE}% por cantidad: -${formatear(calc.descuentoCantidad)}`;
  }
  if (calc.descuentoCupon) {
    msg += `\nCupón ${calc.cupon}: -${formatear(calc.descuentoCupon)}`;
  }
  if (calc.descuentoPuntos) {
    msg += `\nCanje puntos Club Merla: -${formatear(calc.descuentoPuntos)}`;
  }
  msg += `\n*Total: ${formatear(calc.total)}*`;
  msg += "\n\n¿Me confirmás disponibilidad y cómo coordinamos envío y pago?";

  window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`, "_blank");
}

// ===== Checkout con MODO =====
async function crearPagoModo() {
  const res = await fetch("/.netlify/functions/modo-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: itemsDelCarrito(),
      cupon: cuponActivo(),
      canjePuntos: canjeActivo(),
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error ${res.status} al generar el pago`);
  }
  return res.json();
}

async function pagarConModo() {
  const { calc } = estadoPedido();
  if (!calc) return;

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

    // Guardamos la compra pendiente para acreditar puntos al confirmarse
    localStorage.setItem(
      "merla-pendiente",
      JSON.stringify({ puntosGanados: pago.puntosGanados, canje: canjeActivo() })
    );

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
      onSuccess: () => confirmarCompra(),
      onFailure: () => mostrarToast("El pago no se completó. Podés intentarlo de nuevo."),
    });
  } catch (err) {
    console.error(err);
    mostrarToast(
      err.message.includes("SDK")
        ? err.message
        : `⚠️ ${err.message || "No pudimos iniciar el pago con MODO. Probá por WhatsApp."}`
    );
  } finally {
    btn.disabled = false;
    btn.innerHTML = textoOriginal;
  }
}

// Acredita los puntos del Club Merla y limpia el carrito
function confirmarCompra() {
  const pendiente = JSON.parse(localStorage.getItem("merla-pendiente") || "null");
  if (pendiente) {
    const gastados = pendiente.canje ? FIDELIDAD.canjePuntos : 0;
    setPuntos(puntos() - gastados + (pendiente.puntosGanados || 0));
    localStorage.removeItem("merla-pendiente");
  }
  vaciarCarrito();
  cerrarCarrito();
  renderBeneficios();
  const ganados = pendiente ? pendiente.puntosGanados : 0;
  mostrarToast(
    ganados
      ? `✅ ¡Pago aprobado! Sumaste ${ganados} puntos Club Merla ⭐`
      : "✅ ¡Pago aprobado! Gracias por tu compra 💚"
  );
}

// Si MODO nos redirige de vuelta con ?pago=ok (flujo mobile), confirmamos acá
if (new URLSearchParams(location.search).get("pago") === "ok") {
  history.replaceState(null, "", location.pathname);
  window.addEventListener("DOMContentLoaded", () => confirmarCompra());
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
        <div><strong>Stock</strong>${p.stock > 0 ? `${p.stock} drip bags` : "Agotado"}</div>
      </div>
      ${p.stock > 0 ? selectorPresentaciones(p, "modal") : ""}
      <div class="modal__foot">
        <span class="modal__price" data-precio-de="${p.id}">${formatear(p.precio)}</span>
        <button class="btn btn--primary" data-add-modal="${p.id}" ${p.stock === 0 ? "disabled" : ""}>
          ${p.stock === 0 ? "Sin stock" : "Agregar al carrito"}
        </button>
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
  }, 2800);
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
  // Selector de presentación (tarjeta o modal)
  const presBtn = e.target.closest(".pres__btn");
  if (presBtn && !presBtn.disabled) {
    const grupo = presBtn.closest(".pres");
    grupo.querySelectorAll(".pres__btn").forEach((b) => b.classList.remove("activo"));
    presBtn.classList.add("activo");
    const contenedor = grupo.closest("[data-card], .modal__body");
    const precioEl = contenedor.querySelector("[data-precio-de]");
    if (precioEl) precioEl.textContent = formatear(Number(presBtn.dataset.precio));
    return;
  }

  const add = e.target.closest("[data-add]");
  if (add && !add.disabled) {
    const card = add.closest("[data-card]");
    const grupo = card.querySelector(".pres");
    return agregar(add.dataset.add, grupo ? presSeleccionada(grupo) : "unidad");
  }

  const addModal = e.target.closest("[data-add-modal]");
  if (addModal && !addModal.disabled) {
    const cuerpo = addModal.closest(".modal__body");
    const grupo = cuerpo.querySelector(".pres");
    cerrarModal();
    return agregar(addModal.dataset.addModal, grupo ? presSeleccionada(grupo) : "unidad", true);
  }

  const modal = e.target.closest("[data-modal]");
  if (modal) return abrirModal(modal.dataset.modal);

  const usar = e.target.closest("[data-cupon]");
  if (usar) {
    const ok = aplicarCupon(usar.dataset.cupon);
    if (ok) abrirCarrito();
    return;
  }

  if (e.target.closest("[data-mas]")) return cambiar(e.target.closest("[data-mas]").dataset.mas, 1);
  if (e.target.closest("[data-menos]")) return cambiar(e.target.closest("[data-menos]").dataset.menos, -1);
  if (e.target.closest("[data-quitar]")) return quitar(e.target.closest("[data-quitar]").dataset.quitar);

  if (e.target.id === "coupon-remove") return quitarCupon();
  if (e.target.id === "points-redeem") return canjearPuntos();
  if (e.target.id === "points-remove") return quitarCanje();

  if (e.target.closest(".modal__close") || e.target.id === "modal") return cerrarModal();
});

$("#coupon-apply").addEventListener("click", () => {
  const codigo = $("#coupon-input").value.trim();
  if (codigo && aplicarCupon(codigo)) $("#coupon-input").value = "";
});

$("#coupon-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#coupon-apply").click();
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
renderBeneficios();
renderCarrito();
observarReveals();
