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
// La URL con la que entró el visitante, antes de que la tienda la limpie
// (?retomar=, ?resena=, ?pago= se borran al leerlos). La usa contarVisita.
const BUSQUEDA_DE_ENTRADA = location.search;

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
let envioAbort = null; // cancela cotizaciones viejas si el cliente cambia destino o carrito
let envioSeq = 0; // descarta respuestas que lleguen fuera de orden
// A domicilio o a sucursal: se elige ANTES de ver transportistas, para no
// mezclar las dos listas. Si el destino solo tiene una modalidad, se asigna
// sola y no se le pregunta al cliente algo que no es una decisión real.
let envioModalidad = null;

// Qué modalidades trajo la última cotización (puede haber una sola)
function tiposDeQuote() {
  return new Set(envioQuote.opciones.map((o) => o.tipo));
}

const $ = (sel) => document.querySelector(sel);
// Ícono de línea del sprite de index.html (<symbol id="i-...">)
const icono = (nombre, clase = "") =>
  `<svg class="icono${clase ? " " + clase : ""}" aria-hidden="true"><use href="#i-${nombre}"></use></svg>`;
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
// El canje solo cuenta si este navegador confirmó el email (ver paseCanje)
const canjeActivo = () => localStorage.getItem("merla-canje") === "1" && Boolean(paseCanje());
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
let cargaTienda = null;

function cargarTienda() {
  cargaTienda = (async () => {
    $("#product-grid").innerHTML = `<p class="grid__estado">Cargando cafés… ☕</p>`;
    try {
      const res = await fetch("/api/tienda");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      DATOS = await res.json();
      aplicarConfigEnvio();
      renderFiltros();
      renderProductos();
      renderCarrito();
      renderParaVos();
      renderResenas();
      datosEstructuradosProductos(); // para que Google muestre precio y stock
      abrirProductoDeURL(); // deep-link ?producto=<id> (lo usan los feeds de ads)
      retomarPedidoDeURL(); // ?retomar=... (botón del mail de carrito abandonado)
    } catch (err) {
      console.error("No se pudo cargar la tienda:", err);
      $("#product-grid").innerHTML = `
        <p class="grid__estado">⚠️ No pudimos cargar los cafés.
        <button class="grid__retry" id="retry-tienda">Reintentar</button></p>`;
      $("#retry-tienda").addEventListener("click", cargarTienda);
    }
  })();
  return cargaTienda;
}

// ===== Retomar un pedido desde el mail de carrito abandonado =====
// El botón del mail trae ?retomar=<presentación>:<cantidad>,... y a veces
// &cupon=CODIGO (lo arma `enlaceRetomar` en backend/lib/mails.js). Como el
// carrito vive en este navegador y el mail se puede abrir en otro, el link
// lleva lo que había elegido: acá se rearma el carrito y se abre para pagar.
let retomarPendiente = (() => {
  const qp = new URLSearchParams(location.search);
  const items = qp.get("retomar");
  if (!items) return null;
  history.replaceState(null, "", location.pathname);
  return { items, cupon: qp.get("cupon") };
})();

async function retomarPedidoDeURL() {
  if (!retomarPendiente || !DATOS) return;
  const { items, cupon } = retomarPendiente;
  retomarPendiente = null; // una sola vez, aunque la tienda se recargue

  // Se arma línea por línea con lo que siga disponible: si de algo queda menos
  // stock, entra la cantidad que haya en vez de perder todo el pedido.
  let nuevo = {};
  let cambios = false;
  for (const parte of items.split(",").slice(0, 60)) {
    const [id, cantidad] = parte.split(":");
    const pedida = Math.min(Number.parseInt(cantidad, 10) || 0, 99);
    let puesta = 0;
    if (pedida >= 1 && productoDe(id)) {
      for (let q = pedida; q >= 1 && !puesta; q--) {
        const prueba = { ...nuevo, [id]: q };
        const lineas = Object.entries(prueba).map(([presentacion, qty]) => ({ presentacion, qty }));
        if (calcularPedido(lineas, {}, DATOS).ok) {
          nuevo = prueba;
          puesta = q;
        }
      }
    }
    if (puesta < pedida || pedida < 1) cambios = true;
  }

  if (!Object.keys(nuevo).length) {
    mostrarToast("Lo que habías elegido ya no está disponible. ¡Mirá los cafés que hay hoy! ☕");
    return;
  }
  carrito = nuevo;
  guardar();
  localStorage.removeItem("merla-cupon");
  localStorage.removeItem("merla-canje");
  renderCarrito();
  abrirCarrito();
  mostrarToast(cambios ? "Recuperamos tu pedido. Algunos productos ya no tienen el mismo stock." : "Recuperamos tu pedido ☕");
  if (cupon) await aplicarCupon(cupon);
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

  // Solo países de productos que se muestran (los descontinuados agotados no
  // aparecen), y sin espacios de más: "Colombia" y "Colombia " eran dos filtros.
  const origenes = [
    ...new Set(productosFiltro.filter(seMuestra).map(origenDe).filter(Boolean))
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
          `<button class="filtro ${filtroRegion === o ? "activo" : ""}" data-region="${escaparAttr(o)}">${escaparHtml(o)}</button>`
      )
      .join("");

  filtros.forEach((box) => {
    box.hidden = false;
    box.innerHTML = html;
  });
  marcarDeslizables();
}

// ===== Perfil de sabor y precio por taza =====
// Dulzor, acidez y cuerpo de 1 a 5 (se cargan en /admin). Si falta alguno, el
// café no muestra perfil ni entra en "¿Cuál es para vos?".
const PERFIL = [
  ["perfil_dulzor", "Dulzor"],
  ["perfil_acidez", "Acidez"],
  ["perfil_cuerpo", "Cuerpo"],
];
function perfilDe(p) {
  const valores = PERFIL.map(([clave]) => Number(p[clave]));
  return valores.every((n) => Number.isInteger(n) && n >= 1 && n <= 5) ? valores : null;
}

function barrasPerfil(p, clase = "") {
  const perfil = perfilDe(p);
  if (!perfil) return "";
  return `<dl class="perfil ${clase}">${PERFIL.map(([, etiqueta], i) => `
      <div class="perfil__fila">
        <dt>${etiqueta}</dt>
        <dd role="img" aria-label="${etiqueta}: ${perfil[i]} de 5">${Array.from({ length: 5 }, (_, j) =>
          `<span class="perfil__punto${j < perfil[i] ? " lleno" : ""}"></span>`).join("")}</dd>
      </div>`).join("")}
    </dl>`;
}

// Una drip bag es una taza: el precio por taza es lo que conviene mirar (y en el
// pack, cuánto sale cada una). Las tazas y el café en bolsa no lo llevan.
function textoTaza(p, pres) {
  if (!pres || p.tipo === "simple") return "";
  const unidades = Number(pres.unidades_stock) || 1;
  return unidades === 1 ? "la taza" : `${formatear(Math.round(pres.precio / unidades))} la taza`;
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
          data-precio="${o.precio}" data-taza="${escaparAttr(textoTaza(p, o))}" ${o.unidades_stock > p.stock ? "disabled" : ""}>
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
    return `<span class="card__stock--ultima">${icono("llama")} Últimas ${p.stock} unidades</span>`;
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
        ${barrasPerfil(p, "perfil--tarjeta")}
        <button class="card__more" data-modal="${p.id}">Ver detalle</button>
        ${p.stock > 0 ? selectorPresentaciones(p) : ""}
        <div class="card__foot">
          <div class="card__precios">
            <span class="card__precio-fila">
              <span class="card__price" data-precio-de="${p.id}">${base ? formatear(base.precio) : ""}</span>
              ${textoTaza(p, base) ? `<span class="precio-taza" data-taza-de="${p.id}">${textoTaza(p, base)}</span>` : ""}
            </span>
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

const origenDe = (p) => String(p.origen || "").trim();
// Un agotado que se marcó como descontinuado no vuelve: no se muestra.
const seMuestra = (p) => p.stock > 0 || !p.descontinuado;

// La grilla muestra solo lo que se puede comprar. Los agotados que van a volver
// van debajo, en una fila chica ("Vuelven pronto"): antes ocupaban el mismo
// lugar que los disponibles y en celular eran pantallas enteras de "Sin stock".
function renderGrilla(selector, productos, mensajeVacio) {
  const el = $(selector);
  const conStock = productos.filter((p) => p.stock > 0);
  const vuelven = productos.filter((p) => p.stock <= 0 && seMuestra(p));

  if (conStock.length) {
    el.innerHTML = conStock.map((p, i) => tarjetaProducto(p, i)).join("");
  } else if (productos.length && vuelven.length) {
    el.innerHTML = `<p class="grid__estado">Por ahora estos cafés están agotados. ¡Vuelven pronto!</p>`;
  } else {
    el.innerHTML = mensajeVacio ? `<p class="grid__estado">${mensajeVacio}</p>` : "";
  }

  let pronto = el.nextElementSibling;
  if (!pronto || !pronto.classList.contains("pronto")) {
    pronto = document.createElement("div");
    pronto.className = "pronto";
    el.after(pronto);
  }
  pronto.hidden = !vuelven.length;
  pronto.innerHTML = vuelven.length
    ? `<p class="pronto__titulo">${icono("reloj")} Vuelven pronto</p>
       <div class="pronto__lista">${vuelven.map(miniaturaAgotado).join("")}</div>`
    : "";
}

function miniaturaAgotado(p) {
  return `<button class="pronto__item" data-modal="${escaparAttr(p.id)}" aria-label="${escaparAttr(`${p.nombre}: agotado, ver detalle`)}">
      <span class="pronto__img">${p.imagen ? `<img src="${escaparAttr(p.imagen)}" alt="" loading="lazy">` : icono("cafe")}</span>
      <span class="pronto__texto">
        <span class="pronto__nombre">${escaparHtml(p.nombre)}</span>
        ${origenDe(p) ? `<span class="pronto__origen">${escaparHtml(origenDe(p))}</span>` : ""}
      </span>
    </button>`;
}

// ===== ¿Cuál es para vos? =====
// El cliente elige qué le gusta y se le recomienda el café con stock que mejor
// encaja, según el perfil de sabor. Sin dos o más cafés con perfil cargado, el
// bloque no aparece. Los puntajes ponderan lo que pide y castigan lo contrario.
const GUSTOS = [
  { id: "dulce", texto: "Dulce y suave", puntaje: ([d, a]) => d * 2 - a },
  { id: "frutal", texto: "Frutal y brillante", puntaje: ([d, a, c]) => a * 2 + d * 0.3 - c * 0.5 },
  { id: "intenso", texto: "Intenso, con cuerpo", puntaje: ([d, a, c]) => c * 2 + d * 0.5 - a * 0.5 },
];
let gustoElegido = null;

function candidatosParaVos() {
  return DATOS.productos.filter((p) => p.tipo !== "simple" && p.stock > 0 && perfilDe(p));
}

function renderParaVos() {
  const caja = $("#para-vos");
  if (!caja) return;
  const candidatos = candidatosParaVos();
  caja.hidden = candidatos.length < 2;
  if (caja.hidden) return;
  $("#para-vos-opciones").innerHTML = GUSTOS.map((g) =>
    `<button type="button" class="para-vos__opcion${gustoElegido === g.id ? " activo" : ""}" data-gusto="${g.id}" aria-pressed="${gustoElegido === g.id}">${g.texto}</button>`
  ).join("");

  const gusto = GUSTOS.find((g) => g.id === gustoElegido);
  if (!gusto) {
    $("#para-vos-resultado").innerHTML = "";
    return;
  }
  // El de mejor puntaje; si empatan, el que va primero en la tienda
  const elegido = candidatos.reduce((mejor, p) => (gusto.puntaje(perfilDe(p)) > gusto.puntaje(perfilDe(mejor)) ? p : mejor));
  const notas = (elegido.notas || []).slice(0, 3).join(", ").toLowerCase();
  $("#para-vos-resultado").innerHTML = `
    <div class="para-vos__sugerencia">
      ${elegido.imagen ? `<img src="${escaparAttr(elegido.imagen)}" alt="" loading="lazy">` : ""}
      <div class="para-vos__texto">
        <p>Te va a gustar el <strong>${escaparHtml(elegido.nombre)}</strong>${notas ? `: ${escaparHtml(notas)}.` : "."}</p>
        <button type="button" class="card__more" data-modal="${escaparAttr(elegido.id)}">Ver detalle y comprar</button>
      </div>
    </div>`;
}

document.addEventListener("click", (e) => {
  const opcion = e.target.closest("[data-gusto]");
  if (!opcion) return;
  gustoElegido = gustoElegido === opcion.dataset.gusto ? null : opcion.dataset.gusto;
  renderParaVos();
});

// ===== Reseñas de clientes =====
// Vienen de /api/tienda (tabla `resenas`, cargadas a mano desde /admin). Sin
// ninguna publicada, la sección queda oculta.
function renderResenas() {
  const lista = (DATOS && DATOS.resenas) || [];
  const seccion = $("#resenas");
  if (!seccion) return;
  seccion.hidden = !lista.length;
  if (!lista.length) return;
  $("#resenas-lista").innerHTML = lista.map((r) => {
    const estrellas = Math.max(1, Math.min(5, Number(r.estrellas) || 5));
    return `<figure class="resena">
        <div class="resena__estrellas" role="img" aria-label="${estrellas} de 5 estrellas">
          ${Array.from({ length: 5 }, (_, i) => icono("estrella", i < estrellas ? "icono--lleno" : "icono--vacio")).join("")}
        </div>
        <blockquote class="resena__texto">${escaparHtml(r.texto)}</blockquote>
        <figcaption class="resena__autor">
          <strong>${escaparHtml(r.nombre)}</strong>
          ${r.detalle || r.producto ? `<span>${escaparHtml(r.detalle || `Compró ${r.producto}`)}</span>` : ""}
          ${r.verificada ? `<span class="resena__verificada">${icono("check")} Compra verificada</span>` : ""}
        </figcaption>
      </figure>`;
  }).join("");
}

// El catálogo se separa en tres vidrieras: drip bags (con filtro de región),
// café en bolsa de 1/4 y tazas/otros — cada una en su propia sección.
function renderProductos() {
  const cafes = ordenados(
    DATOS.productos
      .filter((p) => p.tipo !== "simple")
      .filter((p) => filtroRegion === "todos" || origenDe(p) === filtroRegion)
  );
  renderGrilla("#product-grid", cafes, `No hay cafés de ${filtroRegion} ahora mismo.`);

  const cafe14 = ordenados(
    DATOS.productos
      .filter((p) => p.tipo === "simple" && p.categoria === "cafe_bolsa")
      .filter((p) => filtroRegion === "todos" || origenDe(p) === filtroRegion)
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

// ===== Datos estructurados de producto (schema.org) =====
// El <head> ya declara la tienda (Store); esto agrega los productos con precio
// y disponibilidad, que es lo que Google necesita para mostrarlos en los
// resultados. Va por JS porque el catálogo es dinámico: se arma una vez, al
// cargar la tienda, con el precio de la presentación de unidad.
function datosEstructuradosProductos() {
  const base = location.origin;
  const absoluta = (url) =>
    !url ? undefined : /^https?:\/\//i.test(url) ? url : `${base}/${String(url).replace(/^\//, "")}`;

  const productos = (DATOS.productos || []).filter((p) => presentacionesDe(p).length);
  if (!productos.length) return;

  const lista = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: productos.map((p, i) => {
      const pres = presentacionesDe(p);
      const unidad = pres.find((x) => x.unidades_stock === 1) || pres[0];
      return {
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Product",
          name: p.nombre,
          description: p.descripcion || (p.notas || []).join(", ") || p.nombre,
          image: absoluta(p.imagen),
          brand: { "@type": "Brand", name: "Merla Coffee" },
          url: `${base}/?producto=${encodeURIComponent(p.id)}`,
          offers: {
            "@type": "Offer",
            price: unidad.precio,
            priceCurrency: "ARS",
            availability: p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            url: `${base}/?producto=${encodeURIComponent(p.id)}`,
          },
        },
      };
    }),
  };

  // textContent (no innerHTML): el contenido no se re-parsea como HTML, así que
  // un nombre con "<" no puede romper el script.
  let tag = document.getElementById("ld-productos");
  if (!tag) {
    tag = document.createElement("script");
    tag.type = "application/ld+json";
    tag.id = "ld-productos";
    document.head.appendChild(tag);
  }
  tag.textContent = JSON.stringify(lista);
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
    // El aviso tiene que decir qué falta AHORA: con la cotización ya hecha, lo
    // que falta es elegir modalidad o correo, no el código postal.
    let pendiente;
    if (envioQuote.cargando) pendiente = "Calculando el costo de envío…";
    else if (envioQuote.error) pendiente = envioQuote.error;
    else if (envioQuote.opciones.length && !envioModalidad) pendiente = "Elegí si lo querés a domicilio o a sucursal";
    else if (envioQuote.opciones.length) pendiente = "Elegí con qué correo lo enviamos";
    else pendiente = "Ingresá tu código postal para calcular el envío";
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

// Refleja en la tienda el precio del envío local en La Plata y la nota del
// punto de retiro que vienen de la base (sin quedar desfasados con /admin).
function aplicarConfigEnvio() {
  const transf = DATOS && DATOS.config && DATOS.config.transferencia;
  if (transf && Number(transf.redondeo) >= 1) {
    CONFIG.transferencia.redondeo = Number(transf.redondeo);
  }
  const cfgEnvio = DATOS && DATOS.config && DATOS.config.envio;
  if (!cfgEnvio) return;
  if (Number.isFinite(cfgEnvio.localPrecio) && cfgEnvio.localPrecio >= 0) {
    const texto = cfgEnvio.localPrecio === 0 ? "gratis" : formatear(cfgEnvio.localPrecio);
    document.querySelectorAll("[data-precio-laplata]").forEach((el) => { el.textContent = texto; });
  }
  const nota = $("#retiro-nota");
  if (nota && cfgEnvio.retiroNota) {
    nota.innerHTML = `${icono("pin")} ${escaparHtml(cfgEnvio.retiroNota)}`;
  }
}

// El descuento por transferencia aplica sobre los productos, no sobre el flete
// que se le paga al correo.
function totalTransferencia(calc) {
  const envio = Number(calc.envioCosto) || 0;
  return precioTransferencia(calc.total - envio) + envio;
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
        ${icono("cafe", "icono--grande")}
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

  if (error) {
    $("#cart-summary").hidden = true;
    $("#cart-error").hidden = false;
    $("#cart-error").textContent = `⚠️ ${error}. Ajustá las cantidades para continuar.`;
    $("#pay-mp").disabled = true;
    $("#pay-modo").disabled = true;
    $("#checkout").disabled = true;
    return;
  }

  // Si todavía falta cotizar o elegir correo, mostramos igualmente el resumen
  // de productos (sin esconder el subtotal ni los descuentos) y dejamos los
  // botones de pago bloqueados hasta que el cliente elija su envío.
  const resumen = calc || calcularPedido(
    items,
    { cupon: cuponActivo(), canjePuntos: canjeActivo(), puntosDisponibles: saldoPuntos, envioCosto: 0 },
    DATOS
  );
  if (!resumen || !resumen.ok) {
    $("#cart-summary").hidden = true;
    $("#cart-error").hidden = false;
    $("#cart-error").textContent = pendiente || (resumen && resumen.error) || "";
    $("#pay-mp").disabled = true;
    $("#pay-modo").disabled = true;
    $("#checkout").disabled = true;
    return;
  }

  $("#cart-error").hidden = !pendiente;
  if (pendiente) $("#cart-error").textContent = pendiente;
  $("#cart-summary").hidden = false;
  $("#pay-mp").disabled = Boolean(pendiente);
  $("#pay-modo").disabled = Boolean(pendiente);
  $("#checkout").disabled = Boolean(pendiente);

  const opActiva = metodoEntrega() === "envio" ? opcionElegida() : null;
  $("#cart-subtotal").textContent = formatear(resumen.subtotal);

  const mostrarEnvio = metodoEntrega() === "envio";
  $("#shipping-row").hidden = !mostrarEnvio;
  if (mostrarEnvio) {
    $("#cart-shipping").textContent = pendiente
      ? (envioQuote.cargando ? "Calculando…" : "A definir")
      : opActiva && opActiva.gratis
        ? "Gratis"
        : formatear(resumen.envioCosto);
  }

  $("#discount-row").hidden = resumen.descuentoCantidad === 0;
  $("#cart-discount").textContent = "-" + formatear(resumen.descuentoCantidad);

  $("#coupon-row").hidden = resumen.descuentoCupon === 0;
  $("#coupon-row-label").textContent = `Cupón ${resumen.cupon || ""}`;
  $("#cart-coupon-discount").textContent = "-" + formatear(resumen.descuentoCupon);

  $("#points-row").hidden = resumen.descuentoPuntos === 0;
  $("#cart-points-discount").textContent = "-" + formatear(resumen.descuentoPuntos);

  $("#cart-total").textContent = formatear(resumen.total) + (pendiente ? " + envío" : "");

  $("#cart-transf").hidden = Boolean(pendiente);
  if (!pendiente) {
    $("#cart-transf").innerHTML = `${icono("billete")} Por transferencia: <strong>${formatear(totalTransferencia(resumen))}</strong> (${CONFIG.transferencia.descuento}% OFF${resumen.envioCosto ? " en productos" : ""}, pedilo por WhatsApp)`;
  }

  const cfg = DATOS.config;
  const faltan = cfg.descuentoCantidad - resumen.unidadesSueltas;
  const gratisDesde = Number(cfg.envio && cfg.envio.gratisDesde) || 0;
  const avisos = [];
  if (resumen.descuentoCantidad > 0) {
    avisos.push(`¡Tenés el ${cfg.descuentoPorcentaje}% de descuento por cantidad!`);
  } else if (resumen.unidadesSueltas > 0 && faltan <= 2) {
    avisos.push(`Agregá ${faltan} unidad${faltan > 1 ? "es" : ""} suelta${faltan > 1 ? "s" : ""} más y llevate ${cfg.descuentoPorcentaje}% OFF`);
  }
  if (gratisDesde > 0) {
    const faltaGratis = gratisDesde - resumen.subtotal;
    avisos.push(faltaGratis <= 0
      ? "¡Tenés envío gratis en este pedido!"
      : `Te faltan ${formatear(faltaGratis)} para tener envío gratis`);
  }
  $("#discount-hint").textContent = avisos.join(" · ");

  $("#cart-earn").textContent = emailValido(emailCliente())
    ? `Al confirmar tu pago sumás ${resumen.puntosGanados} puntos Club Merla`
    : `Dejá tu email y sumá ${resumen.puntosGanados} puntos Club Merla al confirmar el pago`;

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
    box.innerHTML = `${icono("estrella")} Canje aplicado: <strong>-${formatear(cfg.canjeDescuento)}</strong>
      (${cfg.canjePuntos} puntos) <button class="points-box__quitar" id="points-remove">Quitar</button>`;
    return;
  }
  if (!emailValido(email)) {
    box.innerHTML = `${icono("estrella")} Club Merla: dejá tu email arriba para sumar y usar puntos.`;
    return;
  }
  // Esperando el código que confirma que el email es suyo (ver canjearPuntos)
  if (canjeVerificando && canjeVerificando.email === email) {
    box.innerHTML = canjeVerificando.enviando
      ? `${icono("sobre")} Mandándote un código a <strong>${escaparHtml(email)}</strong>…`
      : `<span class="points-box__texto">${icono("sobre")} Te mandamos un código a <strong>${escaparHtml(email)}</strong>. Ingresalo para usar tus puntos:</span>
         <input class="points-box__codigo" id="points-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7"
           placeholder="6 dígitos" aria-label="Código de 6 dígitos que te llegó por mail" value="${escaparAttr(canjeVerificando.codigo)}">
         <button class="points-box__canjear" id="points-code-ok">Confirmar</button>
         <span class="points-box__links">
           <button class="points-box__quitar" id="points-code-resend">Reenviar</button>
           <button class="points-box__quitar" id="points-code-cancel">Cancelar</button>
         </span>`;
    return;
  }
  if (saldoPuntos === null) {
    box.innerHTML = `${icono("estrella")} Club Merla: <button class="points-box__canjear" id="points-check">Consultar mis puntos</button>`;
    return;
  }
  if (saldoPuntos >= cfg.canjePuntos) {
    box.innerHTML = `${icono("estrella")} Tenés <strong>${saldoPuntos} puntos</strong> ·
      <button class="points-box__canjear" id="points-redeem">Canjear ${cfg.canjePuntos} por ${formatear(cfg.canjeDescuento)} OFF</button>`;
    return;
  }
  box.innerHTML = `${icono("estrella")} Tenés <strong>${saldoPuntos} puntos</strong>. Juntá ${cfg.canjePuntos} y canjealos por ${formatear(cfg.canjeDescuento)} de descuento.`;
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
  envioModalidad = null;
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
// Los puntos se identifican solo por el email, así que para canjear hay que
// confirmar que el email es de uno: el servidor manda un código por mail y, al
// ingresarlo, devuelve un "pase" que queda guardado en este navegador por unos
// días. Sin pase, el servidor no acepta el canje (backend/lib/canje.js).
let canjeVerificando = null; // { email, codigo, enviando } mientras se espera el código

// Pase vigente para el email actual, o null
function paseCanje() {
  try {
    const p = JSON.parse(localStorage.getItem("merla-canje-pase") || "null");
    return p && p.email === emailCliente() && p.vence > Date.now() ? p.pase : null;
  } catch {
    return null;
  }
}

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
  if (!paseCanje()) {
    pedirCodigoCanje();
    return;
  }
  localStorage.setItem("merla-canje", "1");
  canjeVerificando = null;
  renderCarrito();
  mostrarToast(`⭐ Canje aplicado: -${formatear(DATOS.config.fidelidad.canjeDescuento)}`);
}

async function pedirCodigoCanje() {
  const email = emailCliente();
  canjeVerificando = { email, codigo: "", enviando: true };
  renderCarrito();
  try {
    const res = await fetch("/api/canje-codigo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No pudimos mandarte el código");
    if (!canjeVerificando || canjeVerificando.email !== email) return; // canceló o cambió el email
    canjeVerificando.enviando = false;
    renderCarrito();
    if ($("#points-code")) $("#points-code").focus();
  } catch (err) {
    canjeVerificando = null;
    renderCarrito();
    mostrarToast(`⚠️ ${err.message}`);
  }
}

async function confirmarCodigoCanje() {
  if (!canjeVerificando || canjeVerificando.enviando) return;
  const { email } = canjeVerificando;
  const codigo = String(canjeVerificando.codigo || "").replace(/\D/g, "");
  if (codigo.length !== 6) {
    mostrarToast("Ingresá los 6 dígitos del código que te llegó por mail");
    return;
  }
  const boton = $("#points-code-ok");
  if (boton) boton.disabled = true;
  try {
    const res = await fetch("/api/canje-verificar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, codigo }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "El código no es correcto");
    localStorage.setItem("merla-canje-pase", JSON.stringify({
      email,
      pase: data.pase,
      vence: Number(String(data.pase).split(".")[0]) || 0,
    }));
    canjeVerificando = null;
    canjearPuntos(); // el carrito pudo cambiar mientras tanto: se valida de nuevo
  } catch (err) {
    if (boton) boton.disabled = false;
    mostrarToast(`⚠️ ${err.message}`);
  }
}

function cancelarCodigoCanje() {
  canjeVerificando = null;
  renderCarrito();
}

// El servidor rechazó el canje porque el pase venció o no es válido: se olvida
// y el cliente lo vuelve a pedir tocando "Canjear".
function revisarCanjeRechazado(data) {
  if (!data || data.codigo !== "canje_sin_verificar") return;
  localStorage.removeItem("merla-canje-pase");
  localStorage.removeItem("merla-canje");
  canjeVerificando = null;
  renderCarrito();
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
        canjePase: paseCanje(),
        email: emailCliente() || null,
        envio: datosEntrega(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      revisarCanjeRechazado(data);
      throw new Error(data.error || "No pudimos registrar el pedido");
    }
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
  msg += `\n💵 Pagando por transferencia o depósito: *${formatear(totalTransferencia(calc))}* (${CONFIG.transferencia.descuento}% OFF${calc.envioCosto ? " en productos" : ""})`;

  const entrega = datosEntrega();
  const op = opcionElegida();
  const correoDetalle = [entrega.transportista, op && op.servicio].filter(Boolean).join(" · ");
  if (entrega.metodo === "envio" && entrega.opcionTipo === "sucursal") {
    msg += `\n\n🏤 *Envío a sucursal (${correoDetalle})*`;
    msg += `\n${entrega.nombre}`;
    if (entrega.sucursal) msg += `\n${entrega.sucursal.descripcion || entrega.sucursal.direccion}`;
    msg += `\nTel: ${entrega.telefono}`;
    if (entrega.notas) msg += `\nNotas: ${entrega.notas}`;
  } else if (entrega.metodo === "envio") {
    msg += `\n\n📦 *Envío a domicilio (${correoDetalle})*`;
    msg += `\n${entrega.nombre} — ${entrega.direccion}`;
    msg += `\n${entrega.ciudad}${entrega.provincia ? ", " + entrega.provincia : ""}${entrega.cp ? " (CP " + entrega.cp + ")" : ""}`;
    msg += `\nTel: ${entrega.telefono}`;
    if (entrega.notas) msg += `\nNotas: ${entrega.notas}`;
  } else {
    msg += `\n\n🏪 *Retiro en el local*${entrega.nombre ? `\nA nombre de: ${entrega.nombre}` : ""}`;
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
  if (metodoEntrega() === "retiro") return { metodo: "retiro", nombre: $("#envio-nombre").value.trim() };
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
    cotizacionToken: op && op.cotizacionToken ? op.cotizacionToken : "",
    sucursal: sucursal ? { id: sucursal.id, descripcion: sucursal.descripcion, direccion: sucursal.direccion } : null,
  };
}

// Valida los datos de envío; devuelve un mensaje de error o null si está OK
function validarEntrega() {
  if (!emailValido(emailCliente())) return "Ingresá tu email para hacer el pedido";
  const e = datosEntrega();
  // Para retiro el nombre es opcional (el mail saluda sin nombre); para envío lo necesita el correo
  if (e.metodo === "retiro") return null;
  if (!e.nombre) return "Ingresá tu nombre y apellido para el envío";
  if (!e.ciudad || !e.provincia || !e.cp) return "Ingresá tu ciudad, provincia y código postal";
  if (!e.telefono) return "Ingresá un teléfono de contacto";
  if (!envioModalidad) return "Elegí si el envío es a domicilio o a sucursal";
  if (!e.opcionGrupo) return "Elegí una opción de envío";
  if (e.opcionTipo === "domicilio" && !e.direccion) return "Ingresá la dirección de envío";
  if (e.opcionTipo === "sucursal" && !e.sucursal) return "Elegí la sucursal donde retirar el pedido";
  return null;
}

// Muestra u oculta el formulario de envío y la nota de retiro según el método
function actualizarEntrega() {
  const esEnvio = metodoEntrega() === "envio";
  $("#envio-form").hidden = !esEnvio;
  if ($("#retiro-nota")) $("#retiro-nota").hidden = esEnvio;
  $("#envio-nombre").placeholder = esEnvio ? "Nombre y apellido" : "Nombre y apellido (opcional)";
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
// destino+carrito). Cancela la petición anterior si cambia el destino o el
// carrito, para que una respuesta vieja nunca pise una más nueva.
async function actualizarCotizacionEnvio(items) {
  const destino = destinoEnvio();
  if (metodoEntrega() !== "envio" || destino.cp.length < 4 || !destino.ciudad || !destino.provincia || !items.length) return;
  const clave = claveDestino(destino);
  const firma = firmaCarrito(items);
  if (envioQuote.clave === clave && envioQuote.firma === firma) return; // ya cotizado o pedido en curso

  if (envioAbort) envioAbort.abort();
  envioAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
  const seq = ++envioSeq;

  envioQuote = { clave, firma, opciones: [], cargando: true, error: null };
  envioOpcionElegida = null;
  envioSucursalElegida = null;
  envioModalidad = null;
  renderCarrito();
  try {
    const res = await fetch("/api/cotizar-envio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, ...destino }),
      signal: envioAbort ? envioAbort.signal : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (seq !== envioSeq) return; // ya salió una cotización más nueva
    if (!res.ok) throw new Error(data.error || "No pudimos calcular el envío");
    envioQuote = { clave, firma, opciones: data.opciones || [], cargando: false, error: null };
    envioOpcionElegida = null;
    envioSucursalElegida = null;
    // Si el destino tiene una sola modalidad, se elige sola: preguntar entre
    // una única opción es hacerle dar un paso de más al cliente.
    const tipos = [...tiposDeQuote()];
    envioModalidad = tipos.length === 1 ? tipos[0] : null;
    if (envioModalidad) preseleccionarMasBarata();
  } catch (err) {
    if (seq !== envioSeq || (err && err.name === "AbortError")) return;
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

  // Mientras no haya una cotización usable no se muestra nada de los dos pasos:
  // si no, quedan tarjetas de una cotización vieja debajo del aviso.
  const limpiar = (aviso) => {
    el.textContent = aviso;
    for (const id of ["#envio-modalidad", "#envio-opciones", "#envio-sucursales"]) {
      $(id).hidden = true;
      $(id).innerHTML = "";
    }
    $("#envio-direccion").hidden = false; // el campo de dirección vuelve por defecto
  };

  if (!destino.cp || !destino.ciudad || !destino.provincia) {
    limpiar("Ingresá tu código postal, ciudad y provincia para ver las opciones de envío.");
    return;
  }
  if (envioQuote.cargando) {
    limpiar("Buscando opciones de envío…");
    return;
  }
  if (vigente && envioQuote.error) {
    limpiar(`⚠️ ${envioQuote.error}`);
    return;
  }
  if (!vigente || !envioQuote.opciones.length) {
    limpiar("Ingresá tu código postal, ciudad y provincia para ver las opciones de envío.");
    return;
  }

  // Paso 1: a domicilio o a sucursal. Paso 2: el transportista de esa
  // modalidad. Antes iban las dos listas mezcladas y ordenadas por precio, y
  // había que leer el ícono de cada fila para saber qué era cada cosa.
  const tipos = tiposDeQuote();
  const modalidades = $("#envio-modalidad");
  const hayQueElegir = tipos.size > 1;

  modalidades.hidden = !hayQueElegir;
  modalidades.innerHTML = hayQueElegir ? tarjetasModalidad() : "";

  if (!envioModalidad) {
    el.textContent = "¿Cómo querés recibirlo?";
    cont.hidden = true;
    cont.innerHTML = "";
    $("#envio-direccion").hidden = true;
    $("#envio-sucursales").hidden = true;
    return;
  }

  const deLaModalidad = envioQuote.opciones.filter((o) => o.tipo === envioModalidad);
  // El aviso de arriba rotula el paso 1 (las tarjetas de modalidad); el rótulo
  // de los correos va pegado a su propia lista, si no parece que nombra a las
  // tarjetas que tiene encima.
  el.textContent = hayQueElegir ? "¿Cómo querés recibirlo?" : "Elegí el correo:";
  cont.hidden = false;
  cont.innerHTML = (hayQueElegir ? `<p class="envio-opciones__titulo">${icono(envioModalidad === "sucursal" ? "pin" : "camion")} Elegí el correo</p>` : "") +
    deLaModalidad.map((o) => {
    const marcada = o.clave === envioOpcionElegida;
    // Un mismo correo puede traer varios servicios (paq.ar da Clásico y
    // Expreso): sin el nombre y el plazo, son dos filas iguales con distinto
    // precio y no se entiende por qué una sale más.
    const detalle = [o.servicio, o.plazo].filter(Boolean).join(" · ");
    const badgeLocal = o.local ? `<span class="envio-opcion__badge">Local</span>` : "";
    const precioHtml = o.gratis
      ? `${o.precioOriginal ? `<span class="envio-opcion__tachado">${formatear(o.precioOriginal)}</span>` : ""}<span class="envio-opcion__precio--gratis">Gratis</span>`
      : formatear(o.precio);
    return `<label class="envio-opcion">
        <span class="envio-opcion__label">
          <input type="radio" name="envio-opcion" value="${o.clave}" ${marcada ? "checked" : ""}>
          <span class="envio-opcion__texto">
            <span>${escaparHtml(o.transportista)}${badgeLocal}</span>
            ${detalle ? `<span class="envio-opcion__servicio">${escaparHtml(detalle)}</span>` : ""}
          </span>
        </span>
        <span class="envio-opcion__precio">${precioHtml}</span>
      </label>`;
  }).join("");

  const op = opcionElegida();
  // La dirección solo hace falta si va a domicilio: a sucursal el paquete va al
  // punto de retiro, no a la casa del cliente. Las notas siguen sirviendo en
  // los dos casos, pero "piso, depto" no aplica a una sucursal.
  $("#envio-direccion").hidden = envioModalidad !== "domicilio";
  $("#envio-notas").placeholder = envioModalidad === "sucursal"
    ? "Notas para el envío (opcional)"
    : "Notas (piso, depto, referencia)";

  const caja = $("#envio-sucursales");
  const conSucursales = op && op.tipo === "sucursal" && op.sucursales && op.sucursales.length;
  caja.hidden = !conSucursales;
  caja.innerHTML = conSucursales ? listaSucursales(op.sucursales) : "";
}

// Las dos tarjetas del paso 1, con el precio más barato de cada modalidad para
// que se puedan comparar sin tener que abrir las dos.
function tarjetasModalidad() {
  return ["domicilio", "sucursal"].map((tipo) => {
    const deEse = envioQuote.opciones.filter((o) => o.tipo === tipo);
    if (!deEse.length) return "";
    const desde = Math.min(...deEse.map((o) => o.precio));
    const activa = envioModalidad === tipo;
    const dibujo = icono(tipo === "sucursal" ? "pin" : "camion");
    const titulo = tipo === "sucursal" ? "A sucursal" : "A domicilio";
    const detalle = tipo === "sucursal" ? "Lo retirás vos" : "Te lo llevan";
    const textoDesde = desde === 0 ? "Gratis" : `desde ${formatear(desde)}`;
    return `<label class="modalidad${activa ? " modalidad--activa" : ""}">
        <input type="radio" name="envio-modalidad" value="${tipo}" ${activa ? "checked" : ""}>
        <span class="modalidad__datos">
          <span class="modalidad__titulo">${dibujo} ${titulo}</span>
          <span class="modalidad__detalle">${detalle} · ${textoDesde}</span>
        </span>
      </label>`;
  }).join("");
}

// Deja marcada la opción más barata de la modalidad elegida (vienen ordenadas
// por precio). La sucursal puntual NUNCA se preselecciona.
function preseleccionarMasBarata() {
  const primera = envioQuote.opciones.find((o) => o.tipo === envioModalidad);
  envioOpcionElegida = primera ? primera.clave : null;
  envioSucursalElegida = null;
}
// Las sucursales van como tarjetas y no como <select>: son pocas (hasta 8) y
// cada una necesita dos renglones (nombre y dirección). Metidas en un <select>
// quedaban en una línea recortada, y encima la primera se elegía sola: el
// cliente podía terminar pagando un envío a una sucursal que nunca miró. Acá
// no hay ninguna marcada hasta que elige.
function listaSucursales(sucursales) {
  const filas = sucursales.map((s) => {
    const nombre = s.descripcion || s.direccion || "Sucursal";
    const detalle = [s.descripcion ? s.direccion : "", s.localidad, s.cp && `CP ${s.cp}`]
      .filter(Boolean).join(" · ");
    const marcada = s.id === envioSucursalElegida;
    return `<label class="sucursal${marcada ? " sucursal--activa" : ""}">
        <input type="radio" name="envio-sucursal" value="${escaparAttr(s.id)}" ${marcada ? "checked" : ""}>
        <span class="sucursal__datos">
          <span class="sucursal__nombre">${escaparHtml(nombre)}</span>
          ${detalle ? `<span class="sucursal__detalle">${escaparHtml(detalle)}</span>` : ""}
        </span>
      </label>`;
  }).join("");

  const falta = !envioSucursalElegida;
  return `<div class="sucursales">
      <p class="sucursales__titulo${falta ? " sucursales__titulo--falta" : ""}">
        ${icono("pin")} ${falta ? "Elegí dónde retirarlo" : "Retirás el pedido en"}
      </p>
      ${filas}
    </div>`;
}

function escaparHtml(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}
const escaparAttr = escaparHtml;

$("#envio-modalidad").addEventListener("change", (e) => {
  if (e.target.name !== "envio-modalidad") return;
  envioModalidad = e.target.value;
  preseleccionarMasBarata();
  renderCarrito();
});

$("#envio-opciones").addEventListener("change", (e) => {
  if (e.target.name !== "envio-opcion") return;
  envioOpcionElegida = e.target.value;
  // A propósito no se preelige sucursal: que la elija el cliente
  envioSucursalElegida = null;
  renderCarrito();
});

$("#envio-sucursales").addEventListener("change", (e) => {
  if (e.target.name !== "envio-sucursal") return;
  envioSucursalElegida = e.target.value;
  renderCarrito();
});
// Recuerda los datos de envío del cliente en este navegador para no volver a
// pedirlos en la próxima compra (nunca guarda datos sensibles ni pagos).
const CAMPOS_ENVIO_GUARDADOS = ["nombre", "ciudad", "cp", "provincia", "telefono", "direccion"];
function guardarDatosEnvio() {
  try {
    const datos = {};
    for (const c of CAMPOS_ENVIO_GUARDADOS) {
      const el = $(`#envio-${c}`);
      if (el) datos[c] = el.value.trim();
    }
    localStorage.setItem("merla-envio", JSON.stringify(datos));
  } catch {}
}
function restaurarDatosEnvio() {
  try {
    const datos = JSON.parse(localStorage.getItem("merla-envio") || "null");
    if (!datos || typeof datos !== "object") return;
    for (const c of CAMPOS_ENVIO_GUARDADOS) {
      const el = $(`#envio-${c}`);
      if (el && typeof datos[c] === "string" && datos[c]) el.value = datos[c];
    }
  } catch {}
}

let envioDebounce = null;
["#envio-cp", "#envio-ciudad"].forEach((sel) => {
  $(sel).addEventListener("input", () => {
    guardarDatosEnvio();
    clearTimeout(envioDebounce);
    envioDebounce = setTimeout(() => renderCarrito(), 500);
  });
});
$("#envio-provincia").addEventListener("change", () => {
  guardarDatosEnvio();
  clearTimeout(envioDebounce);
  renderCarrito();
});
["#envio-nombre", "#envio-telefono", "#envio-direccion"].forEach((sel) => {
  $(sel).addEventListener("change", guardarDatosEnvio);
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
        canjePase: paseCanje(),
        email: emailCliente() || null,
        envio: datosEntrega(),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      revisarCanjeRechazado(data);
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
      canjePase: paseCanje(),
      email: emailCliente() || null,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    revisarCanjeRechazado(data);
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

function mostrarConfirmacionCompra({ pedido, puntos, conEmail }) {
  const num = pedido && pedido.numero ? numeroPedido(pedido.numero) : "";
  const total = pedido && pedido.total ? formatear(pedido.total) : "";
  const esLocal = pedido && pedido.proveedor === "local";
  let textoEntrega = "Te enviamos la confirmación por mail con el detalle de tu pedido.";
  if (pedido) {
    if (pedido.metodo === "retiro") {
      textoEntrega = "Elegiste retiro sin cargo en La Plata (zona centro). Te avisamos apenas esté listo para coordinar horario.";
    } else if (esLocal) {
      textoEntrega = "Elegiste envío en La Plata (24 a 48 hs hábiles). Coordinamos la entrega con nuestra cadetería.";
    } else if (pedido.opcionTipo === "sucursal") {
      const detalle = [pedido.transportista, pedido.servicio, pedido.sucursal].filter(Boolean).join(" · ");
      textoEntrega = `Envío a sucursal${detalle ? ` (${detalle})` : ""}. Te avisamos por mail con el código de seguimiento apenas lo despachemos.`;
    } else {
      const detalle = [pedido.transportista, pedido.servicio].filter(Boolean).join(" · ");
      textoEntrega = `Envío a domicilio${detalle ? ` (${detalle})` : ""}. Te avisamos por mail con el código de seguimiento apenas lo despachemos.`;
    }
  }
  const textoPuntos = puntos !== null && conEmail
    ? `<p class="form-resena__nota">⭐ Tu saldo Club Merla: <strong>${puntos} puntos</strong></p>`
    : conEmail
      ? `<p class="form-resena__nota">Te mandamos el detalle completo por mail.</p>`
      : "";
  const msgWsp = encodeURIComponent(`¡Hola Merla Coffee! Acabo de hacer mi pedido${num ? ` ${num}` : ""}.`);

  $("#modal-card").classList.add("modal__card--simple");
  $("#modal-card").innerHTML = `
    <div class="modal__body form-resena form-resena--gracias">
      <button type="button" class="modal__close" aria-label="Cerrar">✕</button>
      ${icono("check", "icono--grande")}
      <h3>¡Gracias por tu compra!</h3>
      ${num ? `<p class="form-resena__pedido">Pedido <strong>${escaparHtml(num)}</strong>${total ? ` · ${escaparHtml(total)}` : ""}</p>` : ""}
      <p>${escaparHtml(textoEntrega)}</p>
      ${textoPuntos}
      <button type="button" class="btn btn--primary btn--full modal__close-texto">Seguir mirando cafés</button>
      <a class="btn btn--ghost btn--full" href="https://wa.me/${WHATSAPP}?text=${msgWsp}" target="_blank" rel="noopener">Consultar por WhatsApp</a>
    </div>`;
  $("#modal").hidden = false;
  document.body.style.overflow = "hidden";
}

// Confirma el pedido en el servidor (verifica el pago real contra MODO/MP,
// descuenta stock y acredita puntos). El webhook hace lo mismo por su lado;
// la operación es idempotente.
async function confirmarCompra(pagoId, mpPaymentId) {
  // Si el catálogo todavía está cargando (al volver de MP), esperamos para que
  // metaDesdeCarrito() tenga precios/ids reales antes de vaciar el carrito.
  if (!DATOS && cargaTienda) await cargaTienda;
  // Se captura antes de vaciar el carrito; si está vacío (recarga del success)
  // no se dispara, así no cuenta la compra dos veces.
  const compra = DATOS ? metaDesdeCarrito() : { content_ids: [] };
  const id = pagoId || localStorage.getItem("merla-ultimo-pago");
  let puntos = null;
  let pedidoConfirmado = null;
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
        if (data.pedido) pedidoConfirmado = data.pedido;
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
  mostrarConfirmacionCompra({ pedido: pedidoConfirmado, puntos, conEmail });
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
    el.textContent = `Tenés ${saldoPuntos} puntos`;
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
    $("#club-saldo").textContent = `Tenés ${saldoPuntos} puntos`;
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
      ${(p.region || p.origen) ? `<p class="modal__region">${icono("pin")} ${escaparHtml(p.region || p.origen)}</p>` : ""}
      <p class="modal__desc">${p.descripcion || ""}</p>
      ${barrasPerfil(p, "perfil--modal")}
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
          <span class="card__precio-fila">
            <span class="modal__price" data-precio-de="${p.id}">${base ? formatear(base.precio) : ""}</span>
            ${textoTaza(p, base) ? `<span class="precio-taza" data-taza-de="${p.id}">${textoTaza(p, base)}</span>` : ""}
          </span>
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
  $("#modal-card").classList.remove("modal__card--simple"); // el formulario de reseña la usa de una columna
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

// ===== Barra de avisos: carrusel =====
// Los avisos de arriba se turnan solos: en el celular los tres juntos no
// entraban en una línea. Se frena con el puntero encima y con la pestaña en
// segundo plano (si no, al volver se ve el salto de todos los turnos perdidos).
(() => {
  const barra = document.getElementById("announcement");
  if (!barra) return;
  const avisos = [...barra.querySelectorAll(".announcement__item")];
  if (avisos.length < 2) return;

  const ESPERA = 4500;
  const SALIDA = 450; // igual que la transición del CSS
  let actual = 0, temporizador = null, pausado = false;

  function pasarA(siguiente) {
    const sale = avisos[actual];
    sale.classList.remove("activo");
    sale.classList.add("saliendo");
    setTimeout(() => sale.classList.remove("saliendo"), SALIDA);
    actual = siguiente;
    avisos[actual].classList.add("activo");
  }

  function programar() {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      if (!pausado && !document.hidden) pasarA((actual + 1) % avisos.length);
      programar();
    }, ESPERA);
  }

  barra.addEventListener("pointerenter", () => { pausado = true; });
  barra.addEventListener("pointerleave", () => { pausado = false; });
  document.addEventListener("visibilitychange", programar);
  programar();
})();

// ===== Eventos =====
document.addEventListener("click", (e) => {
  // Filtro por región
  const filtro = e.target.closest(".filtro");
  if (filtro) {
    filtroRegion = filtro.dataset.region;
    renderFiltros();
    renderProductos();
    const panelVisible = document.querySelector(".cat-panel:not([hidden]), .catalogo__extra:not([hidden])");
    centrarPill(panelVisible && panelVisible.querySelector(".region-filtros .activo")); // desliza al centro
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
    const tazaEl = contenedor.querySelector("[data-taza-de]");
    if (tazaEl) tazaEl.textContent = presBtn.dataset.taza || "";
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
  if (e.target.id === "points-code-ok") return confirmarCodigoCanje();
  if (e.target.id === "points-code-resend") return pedirCodigoCanje();
  if (e.target.id === "points-code-cancel") return cancelarCodigoCanje();
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
  canjeVerificando = null; // el código era para el email anterior
  renderCarrito();
});

// Código de canje: se guarda lo tipeado (el carrito se vuelve a dibujar seguido
// y si no se perdería) y Enter confirma.
document.addEventListener("input", (e) => {
  if (e.target.id === "points-code" && canjeVerificando) canjeVerificando.codigo = e.target.value;
});
document.addEventListener("keydown", (e) => {
  if (e.target.id === "points-code" && e.key === "Enter") {
    e.preventDefault();
    confirmarCodigoCanje();
  }
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

// ===== Opinar desde el link del mail =====
// Unos días después de comprar, al cliente le llega un mail con un link
// personal: /?resena=<token> (y &estrellas=N si tocó una estrella del mail).
// Se abre un formulario corto; la reseña queda pendiente hasta que el admin
// la aprueba (backend/functions/resena.js).
let formResena = (() => {
  const qp = new URLSearchParams(location.search);
  const token = qp.get("resena");
  if (!token) return null;
  history.replaceState(null, "", location.pathname);
  const n = Number.parseInt(qp.get("estrellas"), 10);
  return { token, estrellas: n >= 1 && n <= 5 ? n : 0, enviando: false };
})();

async function abrirResenaDeURL() {
  if (!formResena) return;
  try {
    const res = await fetch(`/api/resena?t=${encodeURIComponent(formResena.token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Este link para opinar ya no funciona");
    if (data.yaEnviada) {
      formResena = null;
      mostrarToast("Ya nos dejaste tu opinión por este pedido. ¡Gracias! ☕");
      return;
    }
    Object.assign(formResena, { nombre: data.nombre || "", productos: data.productos || "", numero: data.numero });
    pintarFormResena();
    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
  } catch (err) {
    formResena = null;
    mostrarToast(`⚠️ ${err.message}`);
  }
}

function estrellasFormResena() {
  return Array.from({ length: 5 }, (_, i) => {
    const n = i + 1;
    const elegida = n <= formResena.estrellas;
    return `<button type="button" class="form-resena__estrella${elegida ? " elegida" : ""}" data-estrella="${n}"
        role="radio" aria-checked="${n === formResena.estrellas}" aria-label="${n} de 5 estrellas">${icono("estrella", elegida ? "icono--lleno" : "")}</button>`;
  }).join("");
}

function pintarFormResena() {
  const f = formResena;
  $("#modal-card").classList.add("modal__card--simple");
  $("#modal-card").innerHTML = `
    <form class="modal__body form-resena" id="form-resena" novalidate>
      <button type="button" class="modal__close" aria-label="Cerrar">✕</button>
      <h3>¿Qué te pareció?</h3>
      <p class="form-resena__pedido">Tu pedido ${escaparHtml(numeroPedido(f.numero))}${f.productos ? ` · ${escaparHtml(f.productos)}` : ""}</p>
      <div class="form-resena__estrellas" role="radiogroup" aria-label="Puntaje">${estrellasFormResena()}</div>
      <label class="form-resena__campo">Tu opinión
        <textarea id="fr-texto" rows="4" maxlength="400" placeholder="¿Qué café probaste? ¿Dónde lo tomaste? ¿Lo recomendarías?"></textarea>
      </label>
      <label class="form-resena__campo">Tu nombre
        <input id="fr-nombre" maxlength="60" autocomplete="given-name" placeholder="Ej.: Sofía" value="${escaparAttr(f.nombre)}">
      </label>
      <p class="form-resena__nota">La leemos antes de publicarla en la web, con tu nombre de pila.</p>
      <button type="submit" class="btn btn--primary btn--full" id="fr-enviar">Enviar mi opinión</button>
    </form>`;
}

async function enviarFormResena() {
  const f = formResena;
  if (!f || f.enviando) return;
  const texto = $("#fr-texto").value.trim();
  const nombre = $("#fr-nombre").value.trim();
  if (!f.estrellas) return mostrarToast("Elegí de 1 a 5 estrellas");
  if (texto.length < 3) return mostrarToast("Contanos qué te pareció (aunque sea una frase)");
  if (!nombre) return mostrarToast("Poné tu nombre (alcanza con el de pila)");
  f.enviando = true;
  $("#fr-enviar").disabled = true;
  try {
    const res = await fetch("/api/resena", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: f.token, estrellas: f.estrellas, texto, nombre }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 409) throw new Error(data.error || "No pudimos guardar tu opinión");
    formResena = null;
    $("#modal-card").innerHTML = `
      <div class="modal__body form-resena form-resena--gracias">
        <button type="button" class="modal__close" aria-label="Cerrar">✕</button>
        ${icono("cafe", "icono--grande")}
        <h3>¡Gracias${nombre ? `, ${escaparHtml(nombre.split(" ")[0])}` : ""}!</h3>
        <p>${res.status === 409 ? escaparHtml(data.error) : "Recibimos tu opinión. La vamos a publicar en la web en los próximos días."}</p>
        <button type="button" class="btn btn--primary btn--full modal__close-texto">Seguir mirando cafés</button>
      </div>`;
  } catch (err) {
    f.enviando = false;
    $("#fr-enviar").disabled = false;
    mostrarToast(`⚠️ ${err.message}`);
  }
}

document.addEventListener("click", (e) => {
  const estrella = e.target.closest("[data-estrella]");
  if (estrella && formResena) {
    formResena.estrellas = Number(estrella.dataset.estrella);
    $(".form-resena__estrellas").innerHTML = estrellasFormResena();
    return;
  }
  if (e.target.closest(".modal__close-texto")) cerrarModal();
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "form-resena") return;
  e.preventDefault();
  enviarFormResena();
});

// ===== Visitas (para Insights en /admin) =====
// Una vez por sesión se avisa que alguien entró y de dónde vino (Instagram,
// Google, un mail…). Es anónimo: el servidor solo suma 1 al contador del día,
// no guarda IP, email ni cookies.
(function contarVisita() {
  try {
    if (sessionStorage.getItem("merla-visita")) return;
    sessionStorage.setItem("merla-visita", "1");
  } catch {
    return; // sin sessionStorage no sabemos si ya contó: mejor no contar de más
  }
  const qp = new URLSearchParams(BUSQUEDA_DE_ENTRADA);
  const datos = JSON.stringify({ ref: document.referrer || "", utm: qp.get("utm_source") || "", params: BUSQUEDA_DE_ENTRADA });
  try {
    if (navigator.sendBeacon) navigator.sendBeacon("/api/visita", new Blob([datos], { type: "application/json" }));
    else fetch("/api/visita", { method: "POST", body: datos, keepalive: true, headers: { "Content-Type": "application/json" } });
  } catch { /* contar visitas nunca puede romper la tienda */ }
})();

// ===== Inicio =====
const emailGuardado = emailCliente();
if ($("#club-email") && emailGuardado) $("#club-email").value = emailGuardado;
restaurarDatosEnvio();
cargarTienda();
abrirResenaDeURL();
observarReveals();
