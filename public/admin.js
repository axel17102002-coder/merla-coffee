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

// ===== Precios (desde el costo del kilo, con precio ajustable a mano) =====
// `cfgPrecios` trae los insumos y el margen desde la base: no están en el
// código porque este archivo lo descarga cualquiera.
let cfgPrecios = null;

// Vista previa de la cadena de precios. Si se fija un precio a mano, se usa ese.
function previewPrecios(costo, precioAMano) {
  const precio = precioAMano > 0 ? Math.round(precioAMano) : precioUnidadDesdeCosto(costo, cfgPrecios);
  const pack = precioPack(precio, cfgPrecios);
  return {
    precio,
    pack,
    margen: margenPack(costo, pack, cfgPrecios),
    margenU: margenUnidadReal(costo, precio, cfgPrecios),
  };
}

function renderPrecios(productos) {
  const contenedor = $("#precios");
  if (!productos) return;
  contenedor.innerHTML = productos.map((p) => `<article class="fila fila--precio${p.activo ? "" : " fila--inactivo"}" data-producto="${escapar(p.id)}">
      <div class="fila__info">
        <strong>${escapar(p.nombre || p.id)}</strong>
        <span class="fila__dato">
          Unidad <b data-precio-de="${escapar(p.id)}">${formato.format(p.precio || 0)}</b>
          ${p.tienePack ? ` · Pack <b data-pack-de="${escapar(p.id)}">${formato.format(p.precioPack || 0)}</b>` : ""}
          ${p.margenUnidad != null ? ` · margen <b data-margenu-de="${escapar(p.id)}">${p.margenUnidad}%</b>` : ""}
          ${p.margenPack != null ? ` / pack <b data-margen-de="${escapar(p.id)}">${p.margenPack}%</b>` : ""}
        </span>
      </div>
      <div class="fila__form fila__form--precio">
        <label class="mini">Costo por kilo
          <input type="number" min="0" step="1" inputmode="numeric" placeholder="68000"
                 value="${p.costo_kg != null ? Math.round(p.costo_kg) : ""}"
                 data-costo aria-label="Costo del kilo de ${escapar(p.nombre || p.id)}">
        </label>
        <label class="mini">Precio unidad
          <span class="mini__campo">
            <input type="number" min="0" step="1" inputmode="numeric" placeholder="auto"
                   value="${p.precio != null ? p.precio : ""}"
                   data-precio aria-label="Precio de venta de ${escapar(p.nombre || p.id)}">
            <button type="button" class="mini__btn" data-redondear title="Redondear a $50">≈</button>
          </span>
        </label>
        <button data-precio-action="guardar">Guardar</button>
      </div>
      <p class="fila__preview" data-preview></p>
    </article>`).join("");
}

// Muestra a cuánto queda todo y avisa si el margen se aleja del objetivo
function refrescarPreview(fila) {
  const costo = Number(fila.querySelector("[data-costo]").value) || 0;
  const aMano = Number(fila.querySelector("[data-precio]").value) || 0;
  const prev = fila.querySelector("[data-preview]");
  if (costo <= 0) { prev.textContent = ""; prev.className = "fila__preview"; return; }

  const { precio, pack, margen, margenU } = previewPrecios(costo, aMano);
  const objetivo = cfgPrecios ? cfgPrecios.margenUnidad : 40;
  const sugerido = precioUnidadDesdeCosto(costo, cfgPrecios);
  const bajo = margenU < objetivo - 1;

  prev.className = "fila__preview" + (bajo ? " fila__preview--ojo" : "");
  prev.innerHTML = `Unidad <b>${formato.format(precio)}</b> (margen ${margenU}%) · Pack x5 <b>${formato.format(pack)}</b> (margen ${margen}%)` +
    (aMano > 0 && precio !== sugerido ? ` · sugerido ${formato.format(sugerido)}` : "");
}

async function cargarPrecios() {
  mensaje("#precio-message", "Cargando precios…");
  try {
    const data = await api("/api/admin-precios");
    cfgPrecios = data.cfg;
    renderPrecios(data.productos);
    mensaje("#precio-message", "");
  } catch (err) {
    mensaje("#precio-message", `⚠️ ${err.message}`);
  }
}

$("#precios").addEventListener("input", (e) => {
  const fila = e.target.closest(".fila--precio");
  if (!fila) return;
  // Al cambiar el COSTO, proponemos el precio calculado (se puede pisar a mano)
  if (e.target.matches("[data-costo]")) {
    const costo = Number(e.target.value) || 0;
    const campoPrecio = fila.querySelector("[data-precio]");
    if (costo > 0 && !campoPrecio.dataset.tocado) {
      campoPrecio.value = precioUnidadDesdeCosto(costo, cfgPrecios);
    }
  }
  // Si tocan el precio a mano, dejamos de pisarlo
  if (e.target.matches("[data-precio]")) e.target.dataset.tocado = "1";
  refrescarPreview(fila);
});

// Botón ≈ : redondea el precio a múltiplos de $50
$("#precios").addEventListener("click", (e) => {
  const boton = e.target.closest("[data-redondear]");
  if (!boton) return;
  const fila = boton.closest(".fila--precio");
  const campo = fila.querySelector("[data-precio]");
  const actual = Number(campo.value) || Number(precioUnidadDesdeCosto(Number(fila.querySelector("[data-costo]").value) || 0, cfgPrecios));
  if (!actual) return;
  campo.value = redondearPrecio(actual, 50);
  campo.dataset.tocado = "1";
  refrescarPreview(fila);
});

$("#precios").addEventListener("click", async (e) => {
  const boton = e.target.closest("[data-precio-action]");
  if (!boton) return;
  const fila = boton.closest(".fila");
  const costo = Number(fila.querySelector("[data-costo]").value);
  if (!costo || costo <= 0) {
    mensaje("#precio-message", "⚠️ Cargá el costo del kilo");
    return;
  }
  const aMano = Number(fila.querySelector("[data-precio]").value) || 0;
  const nombre = fila.querySelector("strong").textContent;
  const { precio, pack, margen, margenU } = previewPrecios(costo, aMano);
  const sugerido = precioUnidadDesdeCosto(costo, cfgPrecios);
  const nota = precio !== sugerido ? `\n(el calculado era ${formato.format(sugerido)})` : "";
  if (!confirm(`${nombre}\n\nCosto por kilo: ${formato.format(costo)}\n→ Unidad: ${formato.format(precio)} · margen ${margenU}%${nota}\n→ Pack x5: ${formato.format(pack)} · margen ${margen}%\n\n¿Guardar estos precios?`)) return;

  fila.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const r = await api("/api/admin-precios", {
      method: "POST",
      body: JSON.stringify({ producto_id: fila.dataset.producto, costo_kg: costo, precio: aMano || undefined }),
    });
    fila.querySelector("[data-precio-de]").textContent = formato.format(r.precio);
    const elPack = fila.querySelector("[data-pack-de]");
    if (elPack) elPack.textContent = formato.format(r.precioPack);
    const elMargenU = fila.querySelector("[data-margenu-de]");
    if (elMargenU) elMargenU.textContent = `${r.margenUnidad}%`;
    const elMargen = fila.querySelector("[data-margen-de]");
    if (elMargen) elMargen.textContent = `${r.margenPack}%`;
    fila.querySelector("[data-precio]").value = r.precio;
    mensaje("#precio-message", `✅ ${nombre}: unidad ${formato.format(r.precio)} · pack ${formato.format(r.precioPack)}`, true);
  } catch (err) {
    // El error se muestra JUNTO A LA FILA: el mensaje de arriba queda fuera de
    // la vista cuando se está trabajando sobre un producto del final de la lista.
    const prev = fila.querySelector("[data-preview]");
    prev.className = "fila__preview fila__preview--ojo";
    prev.textContent = `⚠️ ${err.message}`;
    mensaje("#precio-message", `⚠️ ${nombre}: ${err.message}`);
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
    // La vista previa de precios necesita la config (insumos + margen)
    if (!cfgPrecios) { try { cfgPrecios = (await api("/api/admin-config")).cfg; } catch {} }
    const { productos } = await api("/api/admin-productos");
    renderProductos(productos);
    mensaje("#producto-message", "");
  } catch (err) {
    mensaje("#producto-message", `⚠️ ${err.message}`);
  }
}

// Vista previa del precio mientras se escribe el costo
$("#prod-costo").addEventListener("input", () => {
  const costo = Number($("#prod-costo").value) || 0;
  if (costo <= 0) { $("#prod-preview").textContent = ""; return; }
  const { precio, pack, margen } = previewPrecios(costo);
  $("#prod-preview").textContent = `→ Unidad ${formato.format(precio)} · Pack x5 ${formato.format(pack)} (margen ${margen}%)`;
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
// ===== Costos (insumos + margen) — información privada =====
function renderInsumos(insumos) {
  const contenedor = $("#insumos");
  const porU = insumos.filter((i) => i.aplica === "unidad");
  const porP = insumos.filter((i) => i.aplica === "pack");
  const totU = porU.reduce((t, i) => t + Number(i.costo), 0);
  const totP = porP.reduce((t, i) => t + Number(i.costo), 0);
  $("#cfg-total-unidad").textContent = `· ${formato.format(totU)}/bag + ${formato.format(totP)}/pack`;

  const fila = (i) => `<article class="fila" data-insumo="${escapar(i.id)}">
      <div class="fila__info">
        <strong>${escapar(i.nombre)}</strong>
        <span class="fila__dato">${i.aplica === "unidad" ? "por cada drip bag" : "una vez por pack"}</span>
      </div>
      <div class="fila__form">
        <input type="number" min="0" step="0.01" inputmode="decimal" value="${Number(i.costo)}" data-insumo-costo aria-label="Costo de ${escapar(i.nombre)}">
        <button data-insumo-accion="guardar">Guardar</button>
        <button class="sec" data-insumo-accion="borrar" title="Borrar insumo">🗑</button>
      </div>
    </article>`;

  contenedor.innerHTML =
    (insumos.length ? insumos.map(fila).join("") : `<div class="vacio">No hay insumos cargados.</div>`);
}

async function cargarConfig() {
  mensaje("#config-message", "Cargando…");
  try {
    const data = await api("/api/admin-config");
    $("#cfg-margen").value = data.cfg.margenUnidad;
    $("#cfg-gramos").value = data.cfg.gramosPorBag;
    renderInsumos(data.insumos || []);
    mensaje("#config-message", data.desdeLaBase ? "" : "⚠️ Falta correr la migración: se usan los valores por defecto.");
  } catch (err) {
    mensaje("#config-message", `⚠️ ${err.message}`);
  }
}

// Guardar margen / gramos
$("#vista-config").addEventListener("click", async (e) => {
  const boton = e.target.closest("[data-cfg-guardar]");
  if (!boton) return;
  const clave = boton.dataset.cfgGuardar;
  const valor = Number(clave === "margen_unidad" ? $("#cfg-margen").value : $("#cfg-gramos").value);
  boton.disabled = true;
  try {
    await api("/api/admin-config", { method: "PATCH", body: JSON.stringify({ clave, valor }) });
    mensaje("#config-message", "✅ Guardado. Acordate de recalcular los precios para aplicarlo.", true);
    cfgPrecios = null; // forzar recarga de la config en la tab Precios
    TABS["tab-precios"].cargado = false;
  } catch (err) {
    mensaje("#config-message", `⚠️ ${err.message}`);
  } finally {
    boton.disabled = false;
  }
});

// Agregar insumo
$("#insumo-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/admin-config", {
      method: "POST",
      body: JSON.stringify({
        nombre: $("#insumo-nombre").value,
        costo: Number($("#insumo-costo").value),
        aplica: $("#insumo-aplica").value,
      }),
    });
    $("#insumo-form").reset();
    mensaje("#config-message", "✅ Insumo agregado. Recalculá los precios para aplicarlo.", true);
    cargarConfig();
  } catch (err) {
    mensaje("#config-message", `⚠️ ${err.message}`);
  }
});

// Editar / borrar insumo
$("#insumos").addEventListener("click", async (e) => {
  const boton = e.target.closest("[data-insumo-accion]");
  if (!boton) return;
  const fila = boton.closest("[data-insumo]");
  const id = fila.dataset.insumo;
  boton.disabled = true;
  try {
    if (boton.dataset.insumoAccion === "borrar") {
      if (!confirm("¿Borrar este insumo?")) { boton.disabled = false; return; }
      await api(`/api/admin-config?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } else {
      const costo = Number(fila.querySelector("[data-insumo-costo]").value);
      await api("/api/admin-config", { method: "PATCH", body: JSON.stringify({ id, costo }) });
    }
    mensaje("#config-message", "✅ Guardado. Recalculá los precios para aplicarlo.", true);
    cargarConfig();
  } catch (err) {
    mensaje("#config-message", `⚠️ ${err.message}`);
    boton.disabled = false;
  }
});

// Recalcular todos los precios
$("#recalcular").addEventListener("click", async () => {
  if (!confirm("¿Reaplicar el margen a TODOS los cafés? Pisa los precios redondeados a mano.")) return;
  const boton = $("#recalcular");
  boton.disabled = true;
  mensaje("#config-message", "Recalculando…");
  try {
    const r = await api("/api/admin-config", { method: "POST", body: JSON.stringify({ accion: "recalcular" }) });
    mensaje("#config-message", `✅ ${r.cambios.length} cafés actualizados.`, true);
    TABS["tab-precios"].cargado = false;
  } catch (err) {
    mensaje("#config-message", `⚠️ ${err.message}`);
  } finally {
    boton.disabled = false;
  }
});

// ===== Tabs de gestión =====
const TABS = {
  "tab-stock": { vista: "vista-stock", cargar: cargarStock, cargado: false },
  "tab-precios": { vista: "vista-precios", cargar: cargarPrecios, cargado: false },
  "tab-cupones": { vista: "vista-cupones", cargar: cargarCupones, cargado: false },
  "tab-productos": { vista: "vista-productos", cargar: cargarProductos, cargado: false },
  "tab-config": { vista: "vista-config", cargar: cargarConfig, cargado: false },
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
