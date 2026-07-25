/**
 * ============================================================================
 * Merla Coffee - app.js
 * ----------------------------------------------------------------------------
 * Controla toda la interfaz de la tienda online.
 *
 * Responsabilidades:
 *  - Cargar catálogo desde la API.
 *  - Administrar el carrito.
 *  - Aplicar descuentos, cupones y puntos.
 *  - Gestionar los checkouts (WhatsApp, Mercado Pago y MODO).
 *  - Manejar la interfaz (modales, carrito, filtros y animaciones).
 *
 * El cálculo de precios NO se realiza aquí.
 * Toda la lógica comercial está centralizada en motor.js.
 * ============================================================================
 */

// ============================================================================
// CONFIGURACIÓN
// ----------------------------------------------------------------------------
// Variables globales de configuración del frontend.
//
// - Define el número de WhatsApp.
// - Configura el ambiente de MODO.
// - Carga dinámicamente el SDK de MODO cuando está habilitado.
// ============================================================================
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

// ============================================================================
// ESTADO DE LA APLICACIÓN
// ----------------------------------------------------------------------------
// Variables que representan el estado actual del frontend.
//
// carrito       -> Productos agregados por el usuario.
// DATOS         -> Catálogo descargado desde la API.
// filtroRegion  -> Región actualmente seleccionada.
// saldoPuntos   -> Puntos disponibles del cliente.
// ============================================================================
let carrito = JSON.parse(localStorage.getItem("merla-carrito") || "{}");
// Los carritos del formato viejo (claves "producto:presentacion") se descartan
if (Object.keys(carrito).some((k) => k.includes(":"))) {
  carrito = {};
  localStorage.removeItem("merla-carrito");
}

let DATOS = null; // { productos, config } — llega de /tienda
let filtroRegion = "todos";
let saldoPuntos = null; // saldo conocido del email actual (null = sin consultar)

// Última cotización de envío (Zipnova), atada al destino (CP, ciudad,
// provincia) y al contenido del carrito: si cualquiera cambia, se recotiza.
// `opciones` trae todas las alternativas (a domicilio y a sucursal, de
// todos los transportistas); el cliente elige una en envioOpcionElegida.
let envioQuote = { clave: "", firma: "", opciones: [], cargando: false, error: null };
let envioOpcionElegida = null; // clave de la opción elegida (carrier+servicio)
let envioSucursalElegida = null; // id de la sucursal, solo si la opción es tipo 'sucursal'

const $ = (sel) => document.querySelector(sel);
/**
 * Formatea un número como moneda argentina.
 *
 * @param {number} n
 * @returns {string}
 */
const formatear = (n) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

/**
 * Guarda el carrito en LocalStorage.
 */
function guardar() {
  localStorage.setItem("merla-carrito", JSON.stringify(carrito));
}

/**
 * Devuelve el carrito como un arreglo de objetos.
 * @returns {Array<{presentacion:string, qty:number}>}
 */
function itemsDelCarrito() {
  return Object.entries(carrito)
    .filter(([, qty]) => qty > 0)
    .map(([presentacion, qty]) => ({ presentacion, qty }));
}

const cuponActivo = () => JSON.parse(localStorage.getItem("merla-cupon") || "null");
const canjeActivo = () => localStorage.getItem("merla-canje") === "1";
const emailCliente = () => (localStorage.getItem("merla-email") || "").trim().toLowerCase();
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ============================================================================
// CARGA DE LA TIENDA
// ----------------------------------------------------------------------------
// Obtiene el catálogo desde Netlify/Supabase y renderiza:
//
// - filtros
// - productos
// - carrito
//
// Si ocurre un error se muestra un botón para reintentar.
// ============================================================================
async function cargarTienda() {
  $("#product-grid").innerHTML = `<p class="grid__estado">Cargando cafés… ☕</p>`;
  try {
    const res = await fetch("/api/tienda");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATOS = await res.json();
    renderFiltros();
    renderProductos();
    renderCarrito();
    abrirProductoDeURL(); // deep-link ?producto=<id> (lo usan los feeds de ads)
  } catch (err) {
    console.error("No se pudo cargar la tienda:", err);
    $("#product-grid").innerHTML = `
      <p class="grid__estado">⚠️ No pudimos cargar los cafés.
      <button class="grid__retry" id="retry-tienda">Reintentar</button></p>`;
    $("#retry-tienda").addEventListener("click", cargarTienda);
  }
}

// ============================================================================
// PRODUCTOS
// ----------------------------------------------------------------------------
// Funciones relacionadas con:
//
// - tarjetas de productos
// - selector de presentaciones
// - badges de stock
// - render del catálogo
// ============================================================================
function productoDe(presentacionId) {
  for (const p of DATOS.productos) {
    const pres = (p.presentaciones || []).find((x) => x.id === presentacionId);
    if (pres) return { producto: p, pres };
  }
  return null;
}

// ===== Filtro por región =====
function renderFiltros() {
  const filtros = document.querySelectorAll(".region-filtros");

  let productosFiltro = [];

  if (categoriaActiva === "cafes") {
    productosFiltro = DATOS.productos.filter((p) => p.tipo !== "simple");
  } else if (categoriaActiva === "cafe14") {
    productosFiltro = DATOS.productos.filter(
      (p) => p.tipo === "simple" && p.categoria === "cafe_bolsa"
    );
  } else {
    filtros.forEach((box) => {
      box.hidden = true;
      box.innerHTML = "";
    });
    return;
  }

  const origenes = [
    ...new Set(productosFiltro.map((p) => p.origen).filter(Boolean))
  ];

  if (origenes.length < 2) {
    filtros.forEach((box) => {
      box.hidden = true;
      box.innerHTML = "";
    });
    return;
  }

  const html =
    `<button class="filtro ${filtroRegion === "todos" ? "activo" : ""}" data-region="todos">Todos</button>` +
    origenes
      .map(
        (o) =>
          `<button class="filtro ${filtroRegion === o ? "activo" : ""}" data-region="${o}">${o}</button>`
      )
      .join("");

  filtros.forEach((box) => {
    box.hidden = false;
    box.innerHTML = html;
  });
  marcarDeslizables();
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
/**
 * Devuelve el badge de stock que se mostrará sobre la tarjeta.
 *
 * Reglas:
 * - Agotado.
 * - Últimas unidades.
 * - Sin badge.
 *
 * @param {Object} p
 * @returns {string}
 */
function badgeStock(p) {
  // "Sin reposición": productos que no vuelven a ingresar. El flag
  // `descontinuado` se edita desde el panel (Productos y Stock); antes estos
  // ids venían hardcodeados acá y había que tocar el código en cada cambio.
  if (p.descontinuado && p.stock > 0) {
    return `<span class="card__stock--ultima">
        🔥 Últimas ${p.stock} unidades
      </span>
    `;
  }
  if (p.stock === 0) return `<span class="card__stock card__stock--agotado">Agotado</span>`;
  if (p.stock <= 5) return `<span class="card__stock">¡Quedan ${p.stock}!</span>`;
  return "";
}

function tarjetaProducto(p, i) {
  const presentaciones = presentacionesDe(p);
  const base = presentaciones[0];
  return `
    <article class="card reveal ${p.stock === 0 ? "card--agotado" : ""}" style="--delay:${i * 60}ms" data-card="${p.id}">
      <div class="card__img" data-modal="${p.id}">
        <img src="${p.imagen}" alt="${p.nombre}" loading="lazy">
        <span class="card__origin">${p.origen || ""}</span>
        ${p.sca ? `<span class="card__sca">SCA ${p.sca}</span>` : ""}
        ${badgeStock(p)}
      </div>
      <div class="card__body">
        <h3>${p.nombre}</h3>
        <div class="card__notes">${p.notas.map((n) => `<span class="chip">${n}</span>`).join("")}</div>
        <button class="card__more" data-modal="${p.id}">Ver detalle</button>
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
}

// Con stock primero, agotados al final (el orden original se mantiene dentro de cada grupo)
function ordenados(productos) {
  return [...productos].sort((a, b) => (b.stock > 0) - (a.stock > 0));
}

function renderGrilla(selector, productos, mensajeVacio) {
  const el = $(selector);
  if (!productos.length) {
    el.innerHTML = mensajeVacio ? `<p class="grid__estado">${mensajeVacio}</p>` : "";
    return;
  }
  el.innerHTML = productos.map((p, i) => tarjetaProducto(p, i)).join("");
}

// El catálogo se separa en tres vidrieras: drip bags (con filtro de región),
// café en bolsa de 1/4 y tazas/otros — cada una en su propia sección.
function renderProductos() {
  const cafes = ordenados(
    DATOS.productos
      .filter((p) => p.tipo !== "simple")
      .filter((p) => filtroRegion === "todos" || p.origen === filtroRegion)
  );
  renderGrilla("#product-grid", cafes, `No hay cafés de ${filtroRegion} ahora mismo.`);

  const cafe14 = ordenados(
    DATOS.productos
      .filter((p) => p.tipo === "simple" && p.categoria === "cafe_bolsa")
      .filter((p) => filtroRegion === "todos" || p.origen === filtroRegion)
  );
  renderGrilla("#product-grid-cafe14", cafe14);
  const merch = ordenados(
    DATOS.productos.filter(
      (p) => p.tipo === "simple" && p.categoria !== "cafe_bolsa"
    )
  );
  if (merch.length) {
    renderGrilla("#product-grid-merch", merch);
  }
  construirTabsCategorias(cafe14.length > 0, merch.length > 0);
  observarReveals();
}

// Selector de categorías tipo pestañas (como el panel de admin): al cambiar,
// se muestran SOLO los productos de esa categoría en el lugar (no scrollea).
// Solo aparece si hay café 1/4 y/o tazas; con drip bags nomás, no se muestra.
let categoriaActiva = "cafes";

function construirTabsCategorias(hayCafe14, hayTazas) {
  const tabs = $("#cat-tabs");
  if (!tabs) return;

  const cats = [{ id: "cafes", t: "Drip Bags" }];
  if (hayCafe14) cats.push({ id: "cafe14", t: "Café ⅛ kg" });
  if (hayTazas) cats.push({ id: "tazas", t: "Tazas" });

  if (cats.length === 1) {
    tabs.hidden = true;
    tabs.innerHTML = "";
    categoriaActiva = "cafes";
  } else {
    if (!cats.some(c => c.id === categoriaActiva)) {
      categoriaActiva = "cafes";
    }

    tabs.innerHTML = cats.map(c =>
      `<button class="cat-tab" data-categoria="${c.id}">${c.t}</button>`
    ).join("");

    tabs.hidden = false;
  }

  aplicarCategoria(categoriaActiva);
  marcarDeslizables();
}

// Muestra el panel de la categoría activa y oculta los demás (sin scrollear)
function aplicarCategoria(cat) {
  categoriaActiva = cat;

  $("#panel-cafes").hidden = cat !== "cafes";
  $("#cafe14-seccion").hidden = cat !== "cafe14";
  $("#tazas-seccion").hidden = cat !== "tazas";

  const tabs = $("#cat-tabs");
  if (tabs) {
    tabs.querySelectorAll(".cat-tab").forEach((b) =>
      b.classList.toggle("activo", b.dataset.categoria === cat)
    );
  }
}

// Desliza la pill activa al centro de su barra con scroll suave (para que al
// elegir una que quedaba medio tapada, entre completa y no se sienta brusco)
function centrarPill(pill) {
  if (pill) pill.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
}

// ===== Barras de pills: arrastrar con el mouse =====
// En touch ya funciona el swipe nativo (overflow-x). Esto agrega el "agarrar y
// tirar" con el mouse, que si no obliga a usar la rueda o shift+rueda. Va con
// delegación en document porque las barras se re-renderizan.

// Marca las barras que hoy se desbordan, para mostrar la manito solo ahí
function marcarDeslizables() {
  document.querySelectorAll(".cat-tabs, .filtros").forEach((pista) =>
    pista.classList.toggle("deslizable", pista.scrollWidth > pista.clientWidth + 1)
  );
}
window.addEventListener("resize", marcarDeslizables);

let arrastre = null;

document.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "mouse" || e.button !== 0) return;
  // Agarrar la pill activa mueve la selección, no la barra (ver más abajo)
  if (e.target.closest(".cat-tab.activo, .filtro.activo")) return;
  const pista = e.target.closest(".cat-tabs, .filtros");
  if (!pista || pista.scrollWidth <= pista.clientWidth) return;
  arrastre = { pista, x0: e.clientX, scroll0: pista.scrollLeft, movido: false };
});

document.addEventListener("pointermove", (e) => {
  if (!arrastre) return;
  const dx = e.clientX - arrastre.x0;
  // Tolerancia de 4 px: por debajo sigue siendo un click, no un arrastre
  if (!arrastre.movido && Math.abs(dx) < 4) return;
  arrastre.movido = true;
  arrastre.pista.classList.add("arrastrando");
  arrastre.pista.scrollLeft = arrastre.scroll0 - dx;
  e.preventDefault();
}, { passive: false });

function terminarArrastre() {
  if (!arrastre) return;
  const { pista, movido } = arrastre;
  arrastre = null;
  pista.classList.remove("arrastrando");
  if (!movido) return;
  // Si arrastró, nos comemos el click que viene después para no cambiar de
  // filtro sin querer. El timeout lo saca si ese click nunca llega.
  const tragarClick = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener("click", tragarClick, { capture: true, once: true });
  setTimeout(() => document.removeEventListener("click", tragarClick, { capture: true }), 50);
}

document.addEventListener("pointerup", terminarArrastre);
document.addEventListener("pointercancel", terminarArrastre);

// ===== Arrastrar la pill verde para cambiar de opción =====
// La pill activa se agarra y se desliza por la barra: el verde acompaña al
// puntero (o al dedo) y el filtro se aplica al soltar. Funciona igual que
// clickear la opción, pero se siente como mover el selector.
let arrastrePill = null;

// Pill que cae bajo esa x; fuera de los extremos, la más cercana
function pillEnX(pista, x) {
  const pills = [...pista.children];
  let cerca = null, dist = Infinity;
  for (const p of pills) {
    const r = p.getBoundingClientRect();
    if (x >= r.left && x <= r.right) return p;
    const d = Math.abs(x - (r.left + r.width / 2));
    if (d < dist) { dist = d; cerca = p; }
  }
  return cerca;
}

document.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const pill = e.target.closest(".cat-tab.activo, .filtro.activo");
  if (!pill || !pill.parentElement) return;
  arrastrePill = { pista: pill.parentElement, origen: pill, actual: pill, x0: e.clientX, movido: false };
});

document.addEventListener("pointermove", (e) => {
  if (!arrastrePill) return;
  if (!arrastrePill.movido && Math.abs(e.clientX - arrastrePill.x0) < 4) return;
  arrastrePill.movido = true;
  arrastrePill.pista.classList.add("arrastrando-pill");
  e.preventDefault();
  const destino = pillEnX(arrastrePill.pista, e.clientX);
  if (destino && destino !== arrastrePill.actual) {
    arrastrePill.actual.classList.remove("activo");
    destino.classList.add("activo");
    arrastrePill.actual = destino;
  }
}, { passive: false });

function terminarArrastrePill() {
  if (!arrastrePill) return;
  const { pista, origen, actual, movido } = arrastrePill;
  arrastrePill = null;
  pista.classList.remove("arrastrando-pill");
  if (!movido || actual === origen) return;
  // Dejamos el verde donde estaba y disparamos el click de la opción elegida:
  // así el cambio pasa por la misma lógica de siempre (filtrar + centrar).
  actual.classList.remove("activo");
  origen.classList.add("activo");
  actual.click();
}

document.addEventListener("pointerup", terminarArrastrePill);
document.addEventListener("pointercancel", terminarArrastrePill);

$("#cat-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-categoria]");
  if (!b) return;

  categoriaActiva = b.dataset.categoria;
  filtroRegion = "todos";

  renderFiltros();
  renderProductos();

  centrarPill(b);
});

// Presentación seleccionada dentro de una tarjeta o del modal
function presSeleccionada(contenedor, productoId) {
  const activo = contenedor.querySelector(".pres__btn.activo");
  if (activo) return activo.dataset.pres;
  const p = DATOS.productos.find((x) => x.id === productoId);
  const opciones = presentacionesDe(p);
  return opciones[0] ? opciones[0].id : null;
}

/**
 * Calcula el estado actual del pedido utilizando el motor de precios.
 *
 * Si un cupón o un canje dejaron de ser válidos (por cambios en el carrito),
 * los elimina automáticamente y vuelve a calcular el pedido.
 *
 * @returns {{
 *   items:Array,
 *   calc:Object|null,
 *   error:string|null,
 *   pendiente:string|null  (envío a domicilio sin cotizar todavía; no es un error)
 * }}
 */
function estadoPedido() {
  const items = itemsDelCarrito();
  if (!DATOS || items.length === 0) return { items, calc: null, error: null, pendiente: null };

  if (metodoEntrega() === "envio") actualizarCotizacionEnvio(items); // dispara la cotización si hace falta

  const envioCosto = envioCostoActual(items);
  if (envioCosto == null) {
    const pendiente = envioQuote.cargando
      ? "Calculando el costo de envío…"
      : envioQuote.error || "Ingresá tu código postal para calcular el envío";
    return { items, calc: null, error: null, pendiente };
  }

  let cupon = cuponActivo();
  let canje = canjeActivo();

  let calc = calcularPedido(items, { cupon, canjePuntos: canje, puntosDisponibles: saldoPuntos, envioCosto }, DATOS);
  if (!calc.ok && canje) {
    canje = false;
    localStorage.removeItem("merla-canje");
    calc = calcularPedido(items, { cupon, envioCosto }, DATOS);
  }
  if (!calc.ok && cupon) {
    cupon = null;
    localStorage.removeItem("merla-cupon");
    calc = calcularPedido(items, { envioCosto }, DATOS);
  }
  return calc.ok
    ? { items, calc, error: null, pendiente: null }
    : { items, calc: null, error: calc.error, pendiente: null };
}

/**
 * Renderiza completamente el carrito.
 *
 * Actualiza:
 * - listado de productos
 * - descuentos
 * - puntos
 * - botones de pago
 * - mensajes promocionales
 */
function renderCarrito() {
  if (!DATOS) return;
  const { items, calc, error, pendiente } = estadoPedido();
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

  actualizarEnvioCostoEstado(items);

  if (error || pendiente) {
    $("#cart-summary").hidden = true;
    $("#cart-error").hidden = false;
    $("#cart-error").textContent = error ? `⚠️ ${error}. Ajustá las cantidades para continuar.` : pendiente;
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

  $("#shipping-row").hidden = !calc.envioCosto;
  $("#cart-shipping").textContent = formatear(calc.envioCosto);

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

// ============================================================================
// CLUB MERLA
// ----------------------------------------------------------------------------
// Gestiona:
//
// - Consulta de puntos.
// - Canje.
// - Visualización del saldo.
// ============================================================================
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

/**
 * Agrega una presentación al carrito.
 *
 * @param {string} productoId
 * @param {string} presentacionId
 * @param {boolean} abrir Si es true abre el carrito al agregar.
 */
function agregar(productoId, presentacionId, abrir = false) {
  const nuevo = { ...carrito, [presentacionId]: (carrito[presentacionId] || 0) + 1 };
  const info = productoDe(presentacionId);
  if (!info) return;
  const ok = intentarCambio(nuevo, `${info.producto.nombre} (${info.pres.nombre}) agregado ☕`);
  if (ok) {
    metaTrack("AddToCart", {
      content_ids: [info.producto.id],
      content_type: "product",
      content_name: `${info.producto.nombre} (${info.pres.nombre})`,
      value: info.pres.precio,
      currency: "ARS",
    });
    if (abrir) abrirCarrito();
  }
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
  envioQuote = { clave: "", firma: "", opciones: [], cargando: false, error: null };
  envioOpcionElegida = null;
  envioSucursalElegida = null;
  renderCarrito();
}

// ============================================================================
// CUPONES
// ----------------------------------------------------------------------------
// Valida cupones contra la API.
//
// Endpoint:
// POST /api/validar-cupon
// ============================================================================
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
// ============================================================================
// CHECKOUT
// ----------------------------------------------------------------------------
// Métodos disponibles:
//
// - WhatsApp.
// - Mercado Pago.
// - MODO.
//
// Antes de iniciar cualquier pago:
//
// - valida el carrito
// - valida los datos de envío
// - registra el pedido en el servidor
// ============================================================================
// ===== Checkout por WhatsApp =====

async function checkoutWhatsApp() {
  const { calc } = estadoPedido();
  if (!calc) return;
  metaTrack("InitiateCheckout", metaDesdeCalc(calc));

  const errorEntrega = validarEntrega();
  if (errorEntrega) { mostrarToast(`⚠️ ${errorEntrega}`); return; }

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
        envio: datosEntrega(),
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
  if (calc.envioCosto) {
    msg += `\nEnvío: ${formatear(calc.envioCosto)}`;
  }
  msg += `\n*Total: ${formatear(calc.total)}*`;
  msg += `\n💵 Pagando por transferencia o depósito: *${formatear(precioTransferencia(calc.total))}* (${CONFIG.transferencia.descuento}% OFF)`;

  const entrega = datosEntrega();
  if (entrega.metodo === "envio" && entrega.opcionTipo === "sucursal") {
    msg += `\n\n🏤 *Envío a sucursal (${entrega.transportista})*`;
    msg += `\n${entrega.nombre}`;
    if (entrega.sucursal) msg += `\n${entrega.sucursal.descripcion || entrega.sucursal.direccion}`;
    msg += `\nTel: ${entrega.telefono}`;
    if (entrega.notas) msg += `\nNotas: ${entrega.notas}`;
  } else if (entrega.metodo === "envio") {
    msg += `\n\n📦 *Envío a domicilio (${entrega.transportista})*`;
    msg += `\n${entrega.nombre} — ${entrega.direccion}`;
    msg += `\n${entrega.ciudad}${entrega.provincia ? ", " + entrega.provincia : ""}${entrega.cp ? " (CP " + entrega.cp + ")" : ""}`;
    msg += `\nTel: ${entrega.telefono}`;
    if (entrega.notas) msg += `\nNotas: ${entrega.notas}`;
  } else {
    msg += `\n\n🏪 *Retiro en el local*`;
  }
  msg += "\n\n¿Me confirmás disponibilidad y cómo coordinamos el pago?";

  const urlWhatsApp = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`;
  if (ventana) ventana.location.href = urlWhatsApp;
  else window.location.href = urlWhatsApp;
  vaciarCarrito();
  cerrarCarrito();
  mostrarToast(`✅ Pedido ${pedido.codigo} registrado como pendiente`);
}

// ===== Entrega (retiro / envío) =====
function metodoEntrega() {
  const sel = document.querySelector('input[name="entrega"]:checked');
  return sel ? sel.value : "retiro";
}

// Opción de envío elegida por el cliente (de las que devolvió la última
// cotización), o null si todavía no hay ninguna.
function opcionElegida() {
  if (!envioOpcionElegida) return null;
  return envioQuote.opciones.find((o) => o.clave === envioOpcionElegida) || null;
}

// Devuelve el objeto de envío para el pedido, o { metodo:'retiro' }.
// El precio NUNCA viaja acá: el servidor vuelve a cotizar y busca, dentro
// del mismo grupo (transportista+servicio), la opción más barata disponible.
function datosEntrega() {
  if (metodoEntrega() === "retiro") return { metodo: "retiro" };
  const op = opcionElegida();
  const esSucursal = op && op.tipo === "sucursal";
  const sucursal = esSucursal ? (op.sucursales || []).find((s) => s.id === envioSucursalElegida) : null;
  return {
    metodo: "envio",
    nombre: $("#envio-nombre").value.trim(),
    direccion: esSucursal ? "" : $("#envio-direccion").value.trim(),
    ciudad: $("#envio-ciudad").value.trim(),
    provincia: $("#envio-provincia").value.trim(),
    cp: $("#envio-cp").value.trim(),
    telefono: $("#envio-telefono").value.trim(),
    notas: $("#envio-notas").value.trim(),
    opcionGrupo: op ? op.grupo : "",
    opcionTipo: esSucursal ? "sucursal" : "domicilio",
    transportista: op ? op.transportista : "",
    sucursal: sucursal ? { id: sucursal.id, descripcion: sucursal.descripcion, direccion: sucursal.direccion } : null,
  };
}

// Valida los datos de envío; devuelve un mensaje de error o null si está OK
function validarEntrega() {
  if (!emailValido(emailCliente())) return "Ingresá tu email para hacer el pedido";
  if (metodoEntrega() === "retiro") return null;
  const e = datosEntrega();
  if (!e.nombre) return "Ingresá tu nombre para el envío";
  if (!e.ciudad || !e.provincia || !e.cp) return "Ingresá tu ciudad, provincia y código postal";
  if (!e.telefono) return "Ingresá un teléfono de contacto";
  if (!e.opcionGrupo) return "Elegí una opción de envío";
  if (e.opcionTipo === "domicilio" && !e.direccion) return "Ingresá la dirección de envío";
  if (e.opcionTipo === "sucursal" && !e.sucursal) return "Elegí la sucursal donde retirar el pedido";
  return null;
}

// Muestra u oculta el formulario de envío según el método elegido
function actualizarEntrega() {
  $("#envio-form").hidden = metodoEntrega() !== "envio";
  renderCarrito();
}
document.querySelectorAll('input[name="entrega"]').forEach((r) =>
  r.addEventListener("change", actualizarEntrega)
);

// ===== Cotización de envío (Zipnova) =====
// "Firma" del carrito: cambia si cambian los ítems o las cantidades, para
// saber cuándo una cotización guardada quedó vieja y hay que pedir otra.
function firmaCarrito(items) {
  return items.map((i) => `${i.presentacion}:${i.qty}`).sort().join(",");
}

// Zipnova exige código postal + ciudad + provincia para cotizar.
function destinoEnvio() {
  return {
    cp: $("#envio-cp").value.trim(),
    ciudad: $("#envio-ciudad").value.trim(),
    provincia: $("#envio-provincia").value.trim(),
  };
}
function claveDestino(d) {
  return `${d.cp}|${d.ciudad.toLowerCase()}|${d.provincia.toLowerCase()}`;
}

// La cotización sigue siendo válida para el destino y el carrito actuales
// (no cambió nada desde que se pidió).
function cotizacionVigente(items) {
  return envioQuote.clave === claveDestino(destinoEnvio()) && envioQuote.firma === firmaCarrito(items);
}

// Costo de la opción elegida, o null si todavía no hay una opción elegida
// válida (falta cotizar, está en curso, cambió el destino/carrito, o no se
// eligió ninguna opción todavía).
function envioCostoActual(items) {
  if (metodoEntrega() !== "envio") return 0;
  if (!cotizacionVigente(items) || envioQuote.cargando) return null;
  const op = opcionElegida();
  return op ? op.precio : null;
}

// Pide una cotización nueva si hace falta (destino completo, carrito no
// vacío, y no hay ya una cotización o una petición en curso para ese mismo
// destino+carrito). No bloquea: solo dispara el fetch y vuelve a renderizar
// cuando termina. Al llegar, preselecciona la opción más barata.
async function actualizarCotizacionEnvio(items) {
  const destino = destinoEnvio();
  if (metodoEntrega() !== "envio" || destino.cp.length < 4 || !destino.ciudad || !destino.provincia || !items.length) return;
  const clave = claveDestino(destino);
  const firma = firmaCarrito(items);
  if (envioQuote.clave === clave && envioQuote.firma === firma) return; // ya cotizado o pedido en curso

  envioQuote = { clave, firma, opciones: [], cargando: true, error: null };
  envioOpcionElegida = null;
  envioSucursalElegida = null;
  renderCarrito();
  try {
    const res = await fetch("/api/cotizar-envio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, ...destino }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No pudimos calcular el envío");
    envioQuote = { clave, firma, opciones: data.opciones || [], cargando: false, error: null };
    const primera = envioQuote.opciones[0];
    if (primera) {
      envioOpcionElegida = primera.clave;
      if (primera.tipo === "sucursal" && primera.sucursales && primera.sucursales.length) {
        envioSucursalElegida = primera.sucursales[0].id;
      }
    }
  } catch (err) {
    envioQuote = { clave, firma, opciones: [], cargando: false, error: err.message };
  }
  renderCarrito();
}

// Actualiza el aviso y la lista de opciones dentro del formulario de envío
function actualizarEnvioCostoEstado(items) {
  const el = $("#envio-costo-estado");
  const cont = $("#envio-opciones");
  if (metodoEntrega() !== "envio") return;
  const destino = destinoEnvio();
  const vigente = cotizacionVigente(items);

  if (!destino.cp || !destino.ciudad || !destino.provincia) {
    el.textContent = "📦 Ingresá tu código postal, ciudad y provincia para ver las opciones de envío.";
    cont.hidden = true;
    cont.innerHTML = "";
    return;
  }
  if (envioQuote.cargando) {
    el.textContent = "📦 Buscando opciones de envío…";
    cont.hidden = true;
    return;
  }
  if (vigente && envioQuote.error) {
    el.textContent = `⚠️ ${envioQuote.error}`;
    cont.hidden = true;
    cont.innerHTML = "";
    return;
  }
  if (!vigente || !envioQuote.opciones.length) {
    el.textContent = "📦 Ingresá tu código postal, ciudad y provincia para ver las opciones de envío.";
    cont.hidden = true;
    cont.innerHTML = "";
    return;
  }

  el.textContent = "📦 Elegí cómo recibirlo:";
  cont.hidden = false;
  cont.innerHTML = envioQuote.opciones.map((o) => {
    const marcada = o.clave === envioOpcionElegida;
    const icono = o.tipo === "sucursal" ? "🏤" : "🚚";
    const etiqueta = o.tipo === "sucursal" ? "A sucursal" : "A domicilio";
    let html = `<label class="envio-opcion">
        <span class="envio-opcion__label">
          <input type="radio" name="envio-opcion" value="${o.clave}" ${marcada ? "checked" : ""}>
          <span class="envio-opcion__texto">${icono} ${etiqueta} — ${o.transportista}</span>
        </span>
        <span class="envio-opcion__precio">${formatear(o.precio)}</span>
      </label>`;
    if (marcada && o.tipo === "sucursal" && o.sucursales && o.sucursales.length) {
      html += `<select class="envio-sucursal-select" id="envio-sucursal-select">
          ${o.sucursales.map((s) =>
            `<option value="${s.id}" ${s.id === envioSucursalElegida ? "selected" : ""}>${s.descripcion || s.direccion}</option>`
          ).join("")}
        </select>`;
    }
    return html;
  }).join("");

  const op = opcionElegida();
  $("#envio-direccion").hidden = Boolean(op && op.tipo === "sucursal");
}
$("#envio-opciones").addEventListener("change", (e) => {
  if (e.target.name === "envio-opcion") {
    envioOpcionElegida = e.target.value;
    const op = opcionElegida();
    envioSucursalElegida = op && op.sucursales && op.sucursales.length ? op.sucursales[0].id : null;
    renderCarrito();
  } else if (e.target.id === "envio-sucursal-select") {
    envioSucursalElegida = e.target.value;
  }
});
["#envio-cp", "#envio-ciudad", "#envio-provincia"].forEach((sel) => {
  $(sel).addEventListener("input", () => {
    clearTimeout($(sel)._debounce);
    $(sel)._debounce = setTimeout(() => renderCarrito(), 500);
  });
});

// ===== Checkout con Mercado Pago (Checkout Pro) =====
async function pagarConMercadoPago() {
  const { calc } = estadoPedido();
  if (!calc) return;
  metaTrack("InitiateCheckout", metaDesdeCalc(calc));

  const errorEntrega = validarEntrega();
  if (errorEntrega) { mostrarToast(`⚠️ ${errorEntrega}`); return; }

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
        envio: datosEntrega(),
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
  metaTrack("InitiateCheckout", metaDesdeCalc(calc));

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
  // Se captura antes de vaciar el carrito; si está vacío (recarga del success)
  // no se dispara, así no cuenta la compra dos veces.
  const compra = metaDesdeCarrito();
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

  if (compra.content_ids.length) metaTrack("Purchase", compra);

  vaciarCarrito();
  cerrarCarrito();
  saldoPuntos = puntos !== null ? puntos : saldoPuntos;
  renderPuntosWidget();
  actualizarClub();
  cargarTienda(); // refresca stock en pantalla

  // Solo prometemos el mail si el cliente dejó su dirección
  const conEmail = emailValido(emailCliente());
  const porMail = conEmail ? " Pronto te escribimos por mail." : "";
  mostrarToast(
    puntos !== null && conEmail
      ? `✅ ¡Pago aprobado!${porMail} Tu saldo Club Merla: ${puntos} puntos ⭐`
      : `✅ ¡Pago aprobado!${porMail} ¡Gracias por tu compra! 💚`
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
  metaActualizarEmail(email); // Advanced Matching del pixel
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
// Deep-link: /?producto=<id> abre ese café directamente al cargar la página.
// Lo usan los feeds de Meta/Google como `link` de cada producto, para que el
// anuncio caiga en la tienda con el café ya abierto.
function abrirProductoDeURL() {
  const id = new URLSearchParams(location.search).get("producto");
  if (id && DATOS.productos.some((p) => p.id === id)) abrirModal(id);
}

function abrirModal(id) {
  const p = DATOS.productos.find((p) => p.id === id);
  if (!p) return;
  const base = presentacionesDe(p)[0];
  metaTrack("ViewContent", {
    content_ids: [p.id],
    content_type: "product",
    content_name: p.nombre,
    value: base ? base.precio : undefined,
    currency: "ARS",
  });
  $("#modal-card").innerHTML = `
    <div class="modal__img"><img src="${p.imagen}" alt="${p.nombre}"></div>
    <div class="modal__body" data-card="${p.id}">
      <button class="modal__close" aria-label="Cerrar">✕</button>
      <h3>${p.nombre}</h3>
      ${(p.region || p.origen) ? `<p class="modal__region">📍 ${p.region || p.origen}</p>` : ""}
      <p class="modal__desc">${p.descripcion || ""}</p>
      <div class="modal__specs">
        ${p.variedad ? `<div><strong>Variedad</strong>${p.variedad}</div>` : ""}
        ${p.proceso ? `<div><strong>Proceso</strong>${p.proceso}</div>` : ""}
        ${p.tostador ? `<div><strong>Tostado por</strong>${p.tostador}</div>` : ""}
        ${p.sca ? `<div><strong>Puntaje SCA</strong>${p.sca}</div>` : ""}
        ${p.notas.length ? `<div><strong>Notas</strong>${p.notas.join(", ")}</div>` : ""}
        <div><strong>Stock</strong>${p.stock > 0 ? `${p.stock} ${p.tipo === "simple" ? "unidades" : "drip bags"}` : "Agotado"}</div>
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
    centrarPill($("#region-filtros").querySelector(".activo")); // desliza al centro
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
  metaActualizarEmail(email); // Advanced Matching del pixel
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

// ===== Meta Pixel: eventos estándar =====
// Solo disparan si el visitante aceptó las cookies (activarAnalitica ya cargó
// el pixel). Usamos el id de PRODUCTO como content_id: coincide con el <g:id>
// del feed (/api/feed), que es lo que Meta necesita para el retargeting dinámico.
function metaTrack(evento, params) {
  if (window.__analiticaCargada && window.fbq) window.fbq("track", evento, params);
}

// Advanced Matching: cuando el cliente deja su email (carrito o Club Merla),
// re-inicializamos el pixel con ese dato. fbq lo hashea antes de enviarlo, así
// Meta matchea mejor las conversiones. Solo corre si ya aceptó las cookies.
function metaActualizarEmail(email) {
  const em = String(email || "").trim().toLowerCase();
  if (em && window.__analiticaCargada && window.fbq && window.META_PIXEL_ID) {
    window.fbq("init", window.META_PIXEL_ID, { em });
  }
}

// Parámetros de Meta a partir de un pedido calculado (calcularPedido)
function metaDesdeCalc(calc) {
  return {
    content_ids: [...new Set(calc.lineas.map((l) => l.producto_id))],
    content_type: "product",
    value: calc.total,
    num_items: calc.unidades,
    currency: "ARS",
  };
}

// Parámetros de Meta a partir del carrito actual (para Purchase, cuando ya no
// tenemos el calc a mano: al volver del pago la página se recargó)
function metaDesdeCarrito() {
  const ids = new Set();
  let value = 0;
  let items = 0;
  for (const { presentacion, qty } of itemsDelCarrito()) {
    const info = productoDe(presentacion);
    if (!info) continue;
    ids.add(info.producto.id);
    value += info.pres.precio * qty;
    items += qty;
  }
  return { content_ids: [...ids], content_type: "product", value, num_items: items, currency: "ARS" };
}

// ===== Banner de cookies (consentimiento para la analítica GA4) =====
// La analítica en sí vive en el <head> (activarAnalitica). Acá solo mostramos
// el banner la primera vez y recordamos la elección en localStorage.
(function bannerCookies() {
  const banner = $("#cookie-banner");
  if (!banner) return;
  if (!localStorage.getItem("merla-cookies")) banner.hidden = false;
  $("#cookie-accept").addEventListener("click", () => {
    localStorage.setItem("merla-cookies", "aceptadas");
    banner.hidden = true;
    if (window.activarAnalitica) window.activarAnalitica();
  });
  $("#cookie-reject").addEventListener("click", () => {
    localStorage.setItem("merla-cookies", "rechazadas");
    banner.hidden = true;
  });
})();

// ===== Inicio =====
const emailGuardado = emailCliente();
if ($("#club-email") && emailGuardado) $("#club-email").value = emailGuardado;
cargarTienda();
observarReveals();
