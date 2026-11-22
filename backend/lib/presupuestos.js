// Presupuestos para clientes (cafeterías, mayoristas): cálculo y página pública.
//
// Se arman en /admin → Presupuestos. El cliente los abre en
// /presupuesto/<token> (el token es largo y al azar: es la "llave" del link),
// los puede guardar en PDF desde el navegador y aceptarlos con un botón.
// Las cuentas se hacen siempre acá, nunca con lo que manda el navegador.

const WHATSAPP = "5492216803376"; // mismo número que public/app.js

const limpiar = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const redondear2 = (n) => Math.round(n * 100) / 100;

// Normaliza las líneas y calcula los totales. Devuelve { ok, error } o
// { ok: true, items, subtotal, descuento, total, descuento_porcentaje }.
function calcularPresupuesto(itemsCrudos, descuentoPorcentaje = 0) {
  if (!Array.isArray(itemsCrudos) || !itemsCrudos.length) return { ok: false, error: "Agregá al menos una línea" };
  if (itemsCrudos.length > 60) return { ok: false, error: "Demasiadas líneas" };
  const items = [];
  for (const i of itemsCrudos) {
    const descripcion = limpiar(i && i.descripcion, 160);
    const qty = Math.floor(Number(i && i.qty));
    const precio = Number(i && i.precio_unitario);
    if (!descripcion) return { ok: false, error: "Cada línea necesita una descripción" };
    if (!(qty >= 1 && qty <= 100000)) return { ok: false, error: `Cantidad inválida en «${descripcion}»` };
    if (!(precio >= 0 && precio <= 100000000)) return { ok: false, error: `Precio inválido en «${descripcion}»` };
    const linea = { descripcion, qty, precio_unitario: redondear2(precio) };
    const presentacion = limpiar(i.presentacion, 80);
    if (presentacion) linea.presentacion = presentacion;
    items.push(linea);
  }
  const pct = Number(descuentoPorcentaje) || 0;
  if (!(pct >= 0 && pct <= 100)) return { ok: false, error: "El descuento va de 0 a 100%" };
  const subtotal = items.reduce((t, l) => t + Math.round(l.qty * l.precio_unitario), 0);
  const descuento = Math.round((subtotal * pct) / 100);
  return { ok: true, items, subtotal, descuento, total: subtotal - descuento, descuento_porcentaje: pct };
}

function tokenNuevo() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const numeroPresupuesto = (n) => `#${String(n || 0).padStart(4, "0")}`;

function venceEl(p) {
  return new Date(new Date(p.creado).getTime() + (Number(p.validez_dias) || 15) * 86400000);
}
const vencido = (p, ahora = Date.now()) => venceEl(p).getTime() < ahora;

// Lo que puede hacer el cliente con el link
function estadoPublico(p, ahora = Date.now()) {
  if (p.estado === "aceptado") return "aceptado";
  if (p.estado === "rechazado") return "rechazado";
  if (vencido(p, ahora)) return "vencido";
  return "abierto";
}

// ===== Página pública =====
const escapar = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const pesos = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const fecha = (d) => new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });

function paginaPresupuesto(p) {
  const estado = estadoPublico(p);
  const numero = numeroPresupuesto(p.numero);
  const filas = (p.items || []).map((i) => `<tr><td>${escapar(i.descripcion)}</td><td class="n">${escapar(i.qty)}</td><td class="n">${pesos(i.precio_unitario)}</td><td class="n">${pesos(Math.round(i.qty * i.precio_unitario))}</td></tr>`).join("");
  const consulta = encodeURIComponent(`¡Hola Merla Coffee! Te escribo por el presupuesto ${numero}.`);
  const avisos = {
    aceptado: `<p class="aviso aviso--ok">✅ Aceptado${p.aceptado_en ? ` el ${fecha(p.aceptado_en)}` : ""}. Te escribimos para coordinar.</p>`,
    rechazado: `<p class="aviso">Este presupuesto quedó cerrado. Si querés uno nuevo, escribinos.</p>`,
    vencido: `<p class="aviso">Este presupuesto venció el ${fecha(venceEl(p))}. Escribinos y te lo actualizamos.</p>`,
    abierto: "",
  };
  return `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Presupuesto ${numero} · Merla Coffee</title>
<link rel="icon" type="image/png" href="/img/favicon-32.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Figtree:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root { --verde: #2f4a36; --crema: #f2ead8; --papel: #fffdf8; --borde: #e3d8bd; --tinta: #22301f; --gris: #66705f; --caramelo: #8a5a2b; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--crema); color: var(--tinta); font: 15px/1.5 Figtree, -apple-system, "Segoe UI", sans-serif; }
  .hoja { max-width: 760px; margin: 28px auto; background: var(--papel); border: 1px solid var(--borde); border-radius: 18px; padding: 32px; }
  header { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-start; border-bottom: 1px solid var(--borde); padding-bottom: 18px; margin-bottom: 18px; }
  .marca { font: 800 1.9rem "Baloo 2", sans-serif; color: var(--verde); line-height: 1; }
  .marca small { display: block; font: 600 .8rem Figtree, sans-serif; color: var(--gris); margin-top: 6px; }
  h1 { margin: 0; font: 800 1.4rem "Baloo 2", sans-serif; color: var(--verde); text-align: right; }
  .datos { color: var(--gris); font-size: .9rem; text-align: right; }
  .cliente { margin: 0 0 16px; }
  .cliente strong { font-size: 1.05rem; }
  table { width: 100%; border-collapse: collapse; font-size: .92rem; }
  th { text-align: left; color: var(--gris); font-weight: 600; font-size: .78rem; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid var(--borde); padding: 8px 6px; }
  td { padding: 10px 6px; border-bottom: 1px solid #f0e8d6; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .totales { margin: 14px 0 0 auto; width: min(320px, 100%); display: grid; gap: 4px; font-variant-numeric: tabular-nums; }
  .totales p { margin: 0; display: flex; justify-content: space-between; }
  .totales .total { font: 800 1.35rem "Baloo 2", sans-serif; color: var(--verde); border-top: 1px solid var(--borde); padding-top: 6px; margin-top: 4px; }
  .notas { margin: 20px 0 0; padding: 14px; background: #f8f3e7; border-radius: 12px; white-space: pre-wrap; }
  .letra { color: var(--gris); font-size: .8rem; margin: 18px 0 0; }
  .acciones { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 22px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 48px; padding: 0 22px; border-radius: 999px; border: 1.5px solid var(--borde); background: #fff; color: var(--verde); font: 700 .95rem Figtree, sans-serif; text-decoration: none; cursor: pointer; }
  .btn--pri { background: var(--verde); border-color: var(--verde); color: var(--crema); }
  .btn:active { transform: scale(.97); }
  .btn:disabled { opacity: .6; cursor: wait; }
  .aviso { margin: 0 0 16px; padding: 12px 14px; border-radius: 12px; background: #f5ecd8; color: var(--caramelo); font-weight: 600; }
  .aviso--ok { background: #dcebd6; color: #2f6931; }
  @media (max-width: 600px) { .hoja { margin: 0; border-radius: 0; border: 0; padding: 22px 16px; } h1, .datos { text-align: left; } th:nth-child(3), td:nth-child(3) { display: none; } }
  @media print { body { background: #fff; } .hoja { border: 0; margin: 0; padding: 0; max-width: none; } .acciones { display: none; } }
</style>
</head>
<body>
<main class="hoja">
  <header>
    <div class="marca">Merla Coffee<small>Café de especialidad en drip bags · La Plata</small></div>
    <div><h1>Presupuesto ${numero}</h1><p class="datos">${fecha(p.creado)}<br>Válido hasta el ${fecha(venceEl(p))}</p></div>
  </header>
  ${avisos[estado]}
  <p class="cliente">Para <strong>${escapar(p.cliente_nombre)}</strong></p>
  <table>
    <thead><tr><th>Detalle</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Subtotal</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>
  <div class="totales">
    ${p.descuento ? `<p><span>Subtotal</span><span>${pesos(p.subtotal)}</span></p><p><span>Descuento ${escapar(p.descuento_porcentaje)}%</span><span>-${pesos(p.descuento)}</span></p>` : ""}
    <p class="total"><span>Total</span><span>${pesos(p.total)}</span></p>
  </div>
  ${p.notas ? `<p class="notas">${escapar(p.notas)}</p>` : ""}
  <p class="letra">Precios en pesos argentinos. merlacoffee.com.ar · WhatsApp +54 9 221 680-3376</p>
  <div class="acciones">
    ${estado === "abierto" ? `<button class="btn btn--pri" id="aceptar">Aceptar presupuesto</button>` : ""}
    <button class="btn" onclick="window.print()">Descargar PDF</button>
    <a class="btn" href="https://wa.me/${WHATSAPP}?text=${consulta}" target="_blank" rel="noopener">Consultar por WhatsApp</a>
  </div>
</main>
${estado === "abierto" ? `<script>
  document.getElementById("aceptar").addEventListener("click", async function () {
    var b = this;
    if (!confirm("¿Aceptás el presupuesto ${numero} por ${pesos(p.total)}?")) return;
    b.disabled = true; b.textContent = "Enviando…";
    try {
      var r = await fetch("/api/presupuesto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: ${JSON.stringify(p.token)}, accion: "aceptar" }) });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || "No se pudo enviar");
      location.reload();
    } catch (e) { b.disabled = false; b.textContent = "Aceptar presupuesto"; alert(e.message); }
  });
</script>` : ""}
</body>
</html>`;
}

module.exports = { calcularPresupuesto, tokenNuevo, numeroPresupuesto, venceEl, vencido, estadoPublico, paginaPresupuesto };
