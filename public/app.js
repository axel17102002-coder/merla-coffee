// ===== Configuración =====
// El catálogo (productos, precios, stock) y los cupones viven en Supabase y
// llegan por las funciones de Netlify. Las reglas de precios están en motor.js.
// Número de WhatsApp para recibir pedidos (formato internacional, sin + ni espacios)
const WHATSAPP = "5492216803376";

// Ambiente de MODO: "test" (sandbox, no cobra de verdad) o "produccion".
const MODO_AMBIENTE = "test";

const MODO_SCRIPT =
  MODO_AMBIENTE === "produccion"
    ? "https://ecommerce-modal.modo.com.ar/bundle.js"
    : "https://ecommerce-modal.preprod.modo.com.ar/bundle.js";

// El SDK de MODO solo se carga si la pasarela está habilitada (CONFIG.pagos)
if (CONFIG.pagos.modo) {
  const modoScript = document.createElement("script");
  modoScript.src = MODO_SCRIPT;
  modoScript.defer = true;
  document.head.appendChild(modoScript);
}

// ===== Estado =====
// Carrito: { <id de presentación>: cantidad }  (ej. "volcanico-pack5": 1)
let carrito = JSON.parse(localStorage.getItem("merla-carrito") || "{}");
// Los carritos del formato viejo (claves "producto:presentacion") se descartan
if (Object.keys(carrito).some((k) => k.includes(":"))) {
  carrito = {};
  localStorage.removeItem("merla-carrito");
}

let DATOS = null; // { productos, config } — llega de /tienda
let filtroRegion = "todos";
let saldoPuntos = null; // saldo conocido del email actual (null = sin consultar)

const $ = (sel) => document.querySelector(sel);

const formatear = (n) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function guardar() {
  localStorage.setItem("merla-carrito", JSON.stringify(carrito));
}

function itemsDelCarrito() {
  return Object.entries(carrito)
    .filter(([, qty]) => qty > 0)
    .map(([presentacion, qty]) => ({ presentacion, qty }));
}

const cuponActivo = () => JSON.parse(localStorage.getItem("merla-cupon") || "null");
const canjeActivo = () => localStorage.getItem("merla-canje") === "1";
const emailCliente = () => (localStorage.getItem("merla-email") || "").trim().toLowerCase();
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ===== Carga del catálogo =====
async function cargarTienda() {
  $("#product-grid").innerHTML = `<p class="grid__estado">Cargando cafés… ☕</p>`;
  try {
    const res = await fetch("/api/tienda");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATOS = await res.json();
    renderFiltros();
    renderProductos();
    renderCarrito();
  } catch (err) {
    console.error("No se pudo cargar la tienda:", err);
    $("#product-grid").innerHTML = `
      <p class="grid__estado">⚠️ No pudimos cargar los cafés.
      <button class="grid__retry" id="retry-tienda">Reintentar</button></p>`;
    $("#retry-tienda").addEventListener("click", cargarTienda);
  }
}

function productoDe(presentacionId) {
  for (const p of DATOS.productos) {
    const pres = (p.presentaciones || []).find((x) => x.id === presentacionId);
    if (pres) return { producto: p, pres };
  }
  return null;
}

// ===== Filtro por región =====
function renderFiltros() {
  const box = $("#region-filtros");
  const origenes = [...new Set(DATOS.productos.map((p) => p.origen).filter(Boolean))];
  if (origenes.length < 2) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML =
    `<button class="filtro ${filtroRegion === "todos" ? "activo" : ""}" data-region="todos">Todos</button>` +
    origenes
      .map(
        (o) =>
          `<button class="filtro ${filtroRegion === o ? "activo" : ""}" data-region="${o}">${o}</button>`
      )
      .join("");
}

// ===== Render de productos =====
function selectorPresentaciones(p) {
  const opciones = presentacionesDe(p);
  if (opciones.length < 2) return "";
  return `
    <div class="pres">
      ${opciones
        .map((o, i) => {
          const ahorro = ahorroDe(p, o);
          return `
        <button class="pres__btn ${i === 0 ? "activo" : ""}" data-pres="${o.id}"
          data-precio="${o.precio}" ${o.unidades_stock > p.stock ? "disabled" : ""}>
          ${o.nombre}${ahorro > 0 ? ` <em>-${ahorro}%</em>` : ""}
        </button>`;
        })
        .join("")}
    </div>`;
}

function badgeStock(p) {
  if (p.stock === 0) return `<span class="card__stock card__stock--agotado">Agotado</span>`;
  if (p.stock <= 5) return `<span class="card__stock">¡Quedan ${p.stock}!</span>`;
  return "";
}

function renderProductos() {
  const visibles = DATOS.productos
    .filter((p) => filtroRegion === "todos" || p.origen === filtroRegion)
    // Con stock primero, agotados al final (el orden original se mantiene dentro de cada grupo)
    .sort((a, b) => (b.stock > 0) - (a.stock > 0));
  if (visibles.length === 0) {
    $("#product-grid").innerHTML = `<p class="grid__estado">No hay cafés de ${filtroRegion} ahora mismo.</p>`;
    return;
  }
  $("#product-grid").innerHTML = visibles
    .map((p, i) => {
      const presentaciones = presentacionesDe(p);
      const base = presentaciones[0];
      return `
    <article class="card reveal ${p.stock === 0 ? "card--agotado" : ""}" style="--delay:${i * 60}ms" data-card="${p.id}">
      <div class="card__img" data-modal="${p.id}">
        <img src="${p.imagen}" alt="${p.nombre} - Drip Bag" loading="lazy">
        <span class="card__origin">${p.origen || ""}</span>
        ${p.sca ? `<span class="card__sca">SCA ${p.sca}</span>` : ""}
        ${badgeStock(p)}
      </div>
      <div class="card__body">
        <h3>${p.nombre}</h3>
        <div class="card__notes">${p.notas.map((n) => `<span class="chip">${n}</span>`).join("")}</div>
        <button class="card__more" data-modal="${p.id}">Ver detalle del café</button>
        ${p.stock > 0 ? selectorPresentaciones(p) : ""}
        <div class="card__foot">
          <div class="card__precios">
            <span class="card__price" data-precio-de="${p.id}">${base ? formatear(base.precio) : ""}</span>
            ${base ? `<span class="precio-transf"><strong data-transf-de="${p.id}">${formatear(precioTransferencia(base.precio))}</strong> con transferencia</span>` : ""}
          </div>
          <button class="card__add" data-add="${p.id}" ${p.stock === 0 || !base ? "disabled" : ""}>
            ${p.stock === 0 ? "Sin stock" : "Agregar"}
          </button>
        </div>
      </div>
    </article>`;
    })
    .join("");
  observarReveals();
}

// Presentación seleccionada dentro de una tarjeta o del modal
function presSeleccionada(contenedor, productoId) {
  const activo = contenedor.querySelector(".pres__btn.activo");
  if (activo) return activo.dataset.pres;
  const p = DATOS.productos.find((x) => x.id === productoId);
  const opciones = presentacionesDe(p);
  return opciones[0] ? opciones[0].id : null;
}

// ===== Pedido actual =====
// Calcula con el motor, soltando cupón/canje si dejaron de ser válidos
function estadoPedido() {
  const items = itemsDelCarrito();
  if (!DATOS || items.length === 0) return { items, calc: null, error: null };

  let cupon = cuponActivo();
  let canje = canjeActivo();

  let calc = calcularPedido(items, { cupon, canjePuntos: canje, puntosDisponibles: saldoPuntos }, DATOS);
  if (!calc.ok && canje) {
    canje = false;
    localStorage.removeItem("merla-canje");
    calc = calcularPedido(items, { cupon }, DATOS);
  }
  if (!calc.ok && cupon) {
    cupon = null;
    localStorage.removeItem("merla-cupon");
    calc = calcularPedido(items, {}, DATOS);
  }
  return calc.ok ? { items, calc, error: null } : { items, calc: null, error: calc.error };
}

// ===== Render del carrito =====
function renderCarrito() {
  if (!DATOS) return;
  const { items, calc, error } = estadoPedido();
  const badge = $("#cart-count");

  badge.hidden = items.length === 0;
  badge.textContent = calc ? calc.unidades : items.reduce((a, i) => a + i.qty, 0);

  $("#email-input").value = emailCliente();
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
    .map(({ presentacion, qty }) => {
      const info = productoDe(presentacion);
      if (!info) return "";
      const { producto, pres } = info;
      return `
      <div class="cart-item">
        <img src="${producto.imagen}" alt="${producto.nombre}">
        <div>
          <div class="cart-item__name">${producto.nombre} <span class="cart-item__pres">${pres.nombre}</span></div>
          <div class="cart-item__price">${formatear(pres.precio)} c/u</div>
          <div class="cart-item__qty">
            <button data-menos="${presentacion}" aria-label="Restar">−</button>
            <b>${qty}</b>
            <button data-mas="${presentacion}" aria-label="Sumar">+</button>
          </div>
        </div>
        <div style="text-align:right">
          <div class="cart-item__total">${formatear(pres.precio * qty)}</div>
          <button class="cart-item__remove" data-quitar="${presentacion}">Quitar</button>
        </div>
      </div>`;
    })
    .join("");

  const cupon = calc ? calc.cupon : null;
  $("#coupon-form").hidden = Boolean(cupon);
  $("#coupon-applied").hidden = !cupon;
  if (cupon) $("#coupon-applied-code").textContent = cupon;

  if (error) {
    $("#cart-summary").hidden = true;
    $("#cart-error").hidden = false;
    $("#cart-error").textContent = `⚠️ ${error}. Ajustá las cantidades para continuar.`;
    $("#pay-mp").disabled = true;
    $("#pay-modo").disabled = true;
    $("#checkout").disabled = true;
    return;
  }

  $("#cart-error").hidden = true;
  $("#cart-summary").hidden = false;
  $("#pay-mp").disabled = false;
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

  $("#cart-transf").hidden = false;
  $("#cart-transf").innerHTML = `💵 Por transferencia: <strong>${formatear(precioTransferencia(calc.total))}</strong> (${CONFIG.transferencia.descuento}% OFF, pedilo por WhatsApp)`;

  const cfg = DATOS.config;
  const faltan = cfg.descuentoCantidad - calc.unidadesSueltas;
  $("#discount-hint").textContent =
    calc.descuentoCantidad > 0
      ? `🎉 ¡Tenés el ${cfg.descuentoPorcentaje}% de descuento por cantidad!`
      : calc.unidadesSueltas > 0 && faltan <= 2
        ? `Agregá ${faltan} unidad${faltan > 1 ? "es" : ""} suelta${faltan > 1 ? "s" : ""} más y llevate ${cfg.descuentoPorcentaje}% OFF`
        : "";

  $("#cart-earn").textContent = emailValido(emailCliente())
    ? `Al confirmar tu pago sumás ${calc.puntosGanados} puntos Club Merla ⭐`
    : `Dejá tu email y sumá ${calc.puntosGanados} puntos Club Merla al confirmar el pago ⭐`;

  $("#modo-test-note").hidden = (DATOS.config.pagoAmbiente || "test") !== "test";
}

// Widget de puntos dentro del carrito
function renderPuntosWidget() {
  const box = $("#points-box");
  const cfg = DATOS.config.fidelidad;
  const email = emailCliente();

  if (canjeActivo()) {
    box.innerHTML = `⭐ Canje aplicado: <strong>-${formatear(cfg.canjeDescuento)}</strong>
      (${cfg.canjePuntos} puntos) <button class="points-box__quitar" id="points-remove">Quitar</button>`;
    return;
  }
  if (!emailValido(email)) {
    box.innerHTML = `⭐ Club Merla: dejá tu email arriba para sumar y usar puntos.`;
    return;
  }
  if (saldoPuntos === null) {
    box.innerHTML = `⭐ Club Merla: <button class="points-box__canjear" id="points-check">Consultar mis puntos</button>`;
    return;
  }
  if (saldoPuntos >= cfg.canjePuntos) {
    box.innerHTML = `⭐ Tenés <strong>${saldoPuntos} puntos</strong> ·
      <button class="points-box__canjear" id="points-redeem">Canjear ${cfg.canjePuntos} por ${formatear(cfg.canjeDescuento)} OFF</button>`;
    return;
  }
  box.innerHTML = `⭐ Tenés <strong>${saldoPuntos} puntos</strong>. Juntá ${cfg.canjePuntos} y canjealos por ${formatear(cfg.canjeDescuento)} de descuento.`;
}

async function consultarPuntos(email) {
  const res = await fetch(`/api/puntos?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error("No pudimos consultar tus puntos");
  const data = await res.json();
  return data.puntos;
}

// ===== Acciones del carrito =====
function intentarCambio(nuevoCarrito, mensajeOk) {
  const items = Object.entries(nuevoCarrito)
    .filter(([, qty]) => qty > 0)
    .map(([presentacion, qty]) => ({ presentacion, qty }));
  if (items.length > 0) {
    const r = calcularPedido(items, {}, DATOS);
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

function agregar(productoId, presentacionId, abrir = false) {
  const nuevo = { ...carrito, [presentacionId]: (carrito[presentacionId] || 0) + 1 };
  const info = productoDe(presentacionId);
  if (!info) return;
  const ok = intentarCambio(nuevo, `${info.producto.nombre} (${info.pres.nombre}) agregado ☕`);
  if (ok && abrir) abrirCarrito();
}

function cambiar(presentacionId, delta) {
  const nuevo = { ...carrito, [presentacionId]: (carrito[presentacionId] || 0) + delta };
  intentarCambio(nuevo, null);
}

function quitar(presentacionId) {
  const nuevo = { ...carrito };
  delete nuevo[presentacionId];
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
async function aplicarCupon(codigo) {
  if (itemsDelCarrito().length === 0) {
    mostrarToast("Agregá productos al carrito para usar el cupón");
    return false;
  }
  let cupon;
  try {
    const res = await fetch("/api/validar-cupon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo, email: emailCliente() || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      mostrarToast(`⚠️ ${data.error || "Cupón inválido"}`);
      return false;
    }
    cupon = (await res.json()).cupon;
  } catch {
    mostrarToast("⚠️ No pudimos validar el cupón. Probá de nuevo.");
    return false;
  }

  const r = calcularPedido(
    itemsDelCarrito(),
    { cupon, canjePuntos: canjeActivo(), puntosDisponibles: saldoPuntos },
    DATOS
  );
  if (!r.ok) {
    mostrarToast(`⚠️ ${r.error}`);
    return false;
  }
  localStorage.setItem("merla-cupon", JSON.stringify(cupon));
  renderCarrito();
  mostrarToast(`✅ Cupón ${cupon.codigo} aplicado: -${formatear(r.descuentoCupon)}`);
  return true;
}

function quitarCupon() {
  localStorage.removeItem("merla-cupon");
  renderCarrito();
}

// ===== Canje de puntos =====
function canjearPuntos() {
  const r = calcularPedido(
    itemsDelCarrito(),
    { cupon: cuponActivo(), canjePuntos: true, puntosDisponibles: saldoPuntos },
    DATOS
  );
  if (!r.ok) {
    mostrarToast(`⚠️ ${r.error}`);
    return;
  }
  localStorage.setItem("merla-canje", "1");
  renderCarrito();
  mostrarToast(`⭐ Canje aplicado: -${formatear(DATOS.config.fidelidad.canjeDescuento)}`);
}

function quitarCanje() {
  localStorage.removeItem("merla-canje");
  renderCarrito();
}

// ===== Checkout por WhatsApp =====
async function checkoutWhatsApp() {
  const { calc } = estadoPedido();
  if (!calc) return;

  // Abrimos la pestaña dentro del click del usuario para que el navegador no
  // bloquee WhatsApp mientras registramos el pedido en el servidor.
  const ventana = window.open("", "_blank");
  const btn = $("#checkout");
  const textoOriginal = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Registrando pedido…";

  let pedido;
  try {
    const res = await fetch("/api/whatsapp-pedido", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: itemsDelCarrito(),
        cupon: cuponActivo() ? cuponActivo().codigo : null,
        canjePuntos: canjeActivo(),
        email: emailCliente() || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No pudimos registrar el pedido");
    pedido = data;
  } catch (err) {
    if (ventana) ventana.close();
    mostrarToast(`⚠️ ${err.message || "No pudimos registrar el pedido"}`);
    return;
  } finally {
    btn.disabled = false;
    btn.innerHTML = textoOriginal;
  }

  let msg = "¡Hola Merla Coffee! Quiero hacer este pedido:\n\n";
  msg += `Pedido ${pedido.codigo}\n\n`;
  calc.lineas.forEach((l) => {
    msg += `• ${l.qty}x ${l.nombre} - ${l.presentacionNombre} (${formatear(l.precioUnitario)} c/u)\n`;
  });
  msg += `\nSubtotal: ${formatear(calc.subtotal)}`;
  if (calc.descuentoCantidad) {
    msg += `\nDescuento ${DATOS.config.descuentoPorcentaje}% por cantidad: -${formatear(calc.descuentoCantidad)}`;
  }
  if (calc.descuentoCupon) {
    msg += `\nCupón ${calc.cupon}: -${formatear(calc.descuentoCupon)}`;
  }
  if (calc.descuentoPuntos) {
    msg += `\nCanje puntos Club Merla: -${formatear(calc.descuentoPuntos)}`;
  }
  msg += `\n*Total: ${formatear(calc.total)}*`;
  msg += `\n💵 Pagando por transferencia o depósito: *${formatear(precioTransferencia(calc.total))}* (${CONFIG.transferencia.descuento}% OFF)`;
  msg += "\n\n¿Me confirmás disponibilidad y cómo coordinamos envío y pago?";

  const urlWhatsApp = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`;
  if (ventana) ventana.location.href = urlWhatsApp;
  else window.location.href = urlWhatsApp;
  vaciarCarrito();
  cerrarCarrito();
  mostrarToast(`✅ Pedido ${pedido.codigo} registrado como pendiente`);
}

// ===== Checkout con Mercado Pago (Checkout Pro) =====
async function pagarConMercadoPago() {
  const { calc } = estadoPedido();
  if (!calc) return;

  const btn = $("#pay-mp");
  const textoOriginal = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Generando pago…";

  try {
    const cupon = cuponActivo();
    const res = await fetch("/api/mercadopago-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: itemsDelCarrito(),
        cupon: cupon ? cupon.codigo : null,
        canjePuntos: canjeActivo(),
        email: emailCliente() || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Error ${res.status} al generar el pago`);
    }
    const pago = await res.json();
    // Redirigimos al checkout de MP; al volver (?pago=mp-ok) confirmamos
    window.location.href = pago.init_point;
  } catch (err) {
    console.error(err);
    mostrarToast(`⚠️ ${err.message || "No pudimos iniciar el pago. Probá por WhatsApp."}`);
    btn.disabled = false;
    btn.innerHTML = textoOriginal;
  }
}

// ===== Checkout con MODO =====
async function crearPagoModo() {
  const cupon = cuponActivo();
  const res = await fetch("/api/modo-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: itemsDelCarrito(),
      cupon: cupon ? cupon.codigo : null,
      canjePuntos: canjeActivo(),
      email: emailCliente() || null,
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

    // Para confirmar el pedido cuando volvemos del flujo mobile (?pago=ok)
    localStorage.setItem("merla-ultimo-pago", pago.id);

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
      refreshData: async () => {
        const nuevo = await crearPagoModo();
        localStorage.setItem("merla-ultimo-pago", nuevo.id);
        return { checkoutId: nuevo.id, qrString: nuevo.qr, deeplink: nuevo.deeplink };
      },
      onSuccess: () => confirmarCompra(pago.id),
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

// Confirma el pedido en el servidor (verifica el pago real contra MODO,
// descuenta stock y acredita puntos). El webhook hace lo mismo por su lado;
// la operación es idempotente.
async function confirmarCompra(pagoId, mpPaymentId) {
  const id = pagoId || localStorage.getItem("merla-ultimo-pago");
  let puntos = null;
  if (id || mpPaymentId) {
    try {
      const res = await fetch("/api/confirmar-pedido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mpPaymentId ? { mpPaymentId } : { id }),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.puntos === "number") puntos = data.puntos;
      }
    } catch (err) {
      console.error("confirmar-pedido:", err);
    }
    localStorage.removeItem("merla-ultimo-pago");
  }

  vaciarCarrito();
  cerrarCarrito();
  saldoPuntos = puntos !== null ? puntos : saldoPuntos;
  renderPuntosWidget();
  actualizarClub();
  cargarTienda(); // refresca stock en pantalla

  mostrarToast(
    puntos !== null && emailValido(emailCliente())
      ? `✅ ¡Pago aprobado! Tu saldo Club Merla: ${puntos} puntos ⭐`
      : "✅ ¡Pago aprobado! Gracias por tu compra 💚"
  );
}

// Si MODO nos redirige de vuelta con ?pago=ok (flujo mobile), confirmamos acá
if (new URLSearchParams(location.search).get("pago") === "ok") {
  history.replaceState(null, "", location.pathname);
  window.addEventListener("DOMContentLoaded", () => confirmarCompra(null));
}

// Si volvemos del checkout de Mercado Pago, confirmamos contra el servidor
// (que verifica el estado real del pago en la API de MP antes de aprobar)
{
  const qp = new URLSearchParams(location.search);
  const retornoMp = qp.get("pago");
  if (retornoMp === "mp-ok") {
    const mpPaymentId = qp.get("payment_id") || qp.get("collection_id");
    history.replaceState(null, "", location.pathname);
    window.addEventListener("DOMContentLoaded", () => confirmarCompra(null, mpPaymentId));
  } else if (retornoMp === "mp-pendiente") {
    history.replaceState(null, "", location.pathname);
    window.addEventListener("DOMContentLoaded", () =>
      mostrarToast("Tu pago quedó pendiente de acreditación. Apenas se apruebe, sumás tus puntos ⭐")
    );
  } else if (retornoMp === "mp-no") {
    history.replaceState(null, "", location.pathname);
    window.addEventListener("DOMContentLoaded", () =>
      mostrarToast("El pago no se completó. Podés intentarlo de nuevo o pedir por WhatsApp.")
    );
  }
}

// ===== Sección Club Merla =====
function actualizarClub() {
  const el = $("#club-saldo");
  if (!el) return;
  if (saldoPuntos !== null && emailValido(emailCliente())) {
    el.textContent = `Tenés ${saldoPuntos} puntos ⭐`;
  }
}

async function consultarClub() {
  const input = $("#club-email");
  const email = input.value.trim().toLowerCase();
  if (!emailValido(email)) {
    mostrarToast("Ingresá un email válido");
    return;
  }
  localStorage.setItem("merla-email", email);
  const btn = $("#club-consultar");
  btn.disabled = true;
  try {
    saldoPuntos = await consultarPuntos(email);
    $("#club-saldo").textContent = `Tenés ${saldoPuntos} puntos ⭐`;
    renderCarrito();
  } catch (err) {
    mostrarToast(`⚠️ ${err.message}`);
  } finally {
    btn.disabled = false;
  }
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
  }, 350);
}

// ===== UI: modal de producto =====
function abrirModal(id) {
  const p = DATOS.productos.find((p) => p.id === id);
  if (!p) return;
  const base = presentacionesDe(p)[0];
  $("#modal-card").innerHTML = `
    <div class="modal__img"><img src="${p.imagen}" alt="${p.nombre}"></div>
    <div class="modal__body" data-card="${p.id}">
      <button class="modal__close" aria-label="Cerrar">✕</button>
      <h3>${p.nombre}</h3>
      <p class="modal__region">📍 ${p.region || p.origen || ""}</p>
      <p class="modal__desc">${p.descripcion || ""}</p>
      <div class="modal__specs">
        ${p.variedad ? `<div><strong>Variedad</strong>${p.variedad}</div>` : ""}
        ${p.proceso ? `<div><strong>Proceso</strong>${p.proceso}</div>` : ""}
        ${p.tostador ? `<div><strong>Tostado por</strong>${p.tostador}</div>` : ""}
        ${p.sca ? `<div><strong>Puntaje SCA</strong>${p.sca}</div>` : ""}
        ${p.notas.length ? `<div><strong>Notas</strong>${p.notas.join(", ")}</div>` : ""}
        <div><strong>Stock</strong>${p.stock > 0 ? `${p.stock} drip bags` : "Agotado"}</div>
      </div>
      ${p.stock > 0 ? selectorPresentaciones(p) : ""}
      <div class="modal__foot">
        <div class="card__precios">
          <span class="modal__price" data-precio-de="${p.id}">${base ? formatear(base.precio) : ""}</span>
          ${base ? `<span class="precio-transf"><strong data-transf-de="${p.id}">${formatear(precioTransferencia(base.precio))}</strong> con transferencia</span>` : ""}
        </div>
        <button class="btn btn--primary" data-add-modal="${p.id}" ${p.stock === 0 || !base ? "disabled" : ""}>
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
    setTimeout(() => (toast.hidden = true), 350);
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
  // Filtro por región
  const filtro = e.target.closest(".filtro");
  if (filtro) {
    filtroRegion = filtro.dataset.region;
    renderFiltros();
    renderProductos();
    return;
  }

  // Selector de presentación (tarjeta o modal)
  const presBtn = e.target.closest(".pres__btn");
  if (presBtn && !presBtn.disabled) {
    const grupo = presBtn.closest(".pres");
    grupo.querySelectorAll(".pres__btn").forEach((b) => b.classList.remove("activo"));
    presBtn.classList.add("activo");
    const contenedor = grupo.closest("[data-card]");
    const precioEl = contenedor.querySelector("[data-precio-de]");
    if (precioEl) precioEl.textContent = formatear(Number(presBtn.dataset.precio));
    const transfEl = contenedor.querySelector("[data-transf-de]");
    if (transfEl) transfEl.textContent = formatear(precioTransferencia(Number(presBtn.dataset.precio)));
    return;
  }

  const add = e.target.closest("[data-add]");
  if (add && !add.disabled) {
    const card = add.closest("[data-card]");
    return agregar(add.dataset.add, presSeleccionada(card, add.dataset.add));
  }

  const addModal = e.target.closest("[data-add-modal]");
  if (addModal && !addModal.disabled) {
    const cuerpo = addModal.closest("[data-card]");
    const pres = presSeleccionada(cuerpo, addModal.dataset.addModal);
    cerrarModal();
    return agregar(addModal.dataset.addModal, pres, true);
  }

  const modal = e.target.closest("[data-modal]");
  if (modal) return abrirModal(modal.dataset.modal);

  if (e.target.closest("[data-mas]")) return cambiar(e.target.closest("[data-mas]").dataset.mas, 1);
  if (e.target.closest("[data-menos]")) return cambiar(e.target.closest("[data-menos]").dataset.menos, -1);
  if (e.target.closest("[data-quitar]")) return quitar(e.target.closest("[data-quitar]").dataset.quitar);

  if (e.target.id === "coupon-remove") return quitarCupon();
  if (e.target.id === "points-redeem") return canjearPuntos();
  if (e.target.id === "points-remove") return quitarCanje();
  if (e.target.id === "points-check") {
    consultarPuntos(emailCliente())
      .then((p) => {
        saldoPuntos = p;
        renderCarrito();
      })
      .catch(() => mostrarToast("⚠️ No pudimos consultar tus puntos"));
    return;
  }

  if (e.target.closest(".modal__close") || e.target.id === "modal") return cerrarModal();
});

$("#coupon-apply").addEventListener("click", () => {
  const codigo = $("#coupon-input").value.trim();
  if (codigo) aplicarCupon(codigo).then((ok) => ok && ($("#coupon-input").value = ""));
});

$("#coupon-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#coupon-apply").click();
});

$("#email-input").addEventListener("change", () => {
  const email = $("#email-input").value.trim().toLowerCase();
  localStorage.setItem("merla-email", email);
  saldoPuntos = null; // saldo desconocido para el nuevo email
  localStorage.removeItem("merla-canje");
  renderCarrito();
});

$("#club-consultar").addEventListener("click", consultarClub);
$("#club-email").addEventListener("keydown", (e) => {
  if (e.key === "Enter") consultarClub();
});

$("#cart-open").addEventListener("click", abrirCarrito);
$("#cart-close").addEventListener("click", cerrarCarrito);
$("#overlay").addEventListener("click", cerrarCarrito);
$("#checkout").addEventListener("click", checkoutWhatsApp);
// Botones de pago según pasarelas habilitadas (CONFIG.pagos en motor.js)
$("#pay-mp").hidden = !CONFIG.pagos.mercadopago;
$("#pay-modo").hidden = !CONFIG.pagos.modo;
$("#pay-mp").addEventListener("click", pagarConMercadoPago);
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
const emailGuardado = emailCliente();
if ($("#club-email") && emailGuardado) $("#club-email").value = emailGuardado;
cargarTienda();
observarReveals();
