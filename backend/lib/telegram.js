// Avisos al celular por Telegram: cada venta, cada pedido de WhatsApp y los
// pagos raros llegan como mensaje de un bot propio.
//
// Configuración (una vez):
//   1. En Telegram, @BotFather → /newbot → copia el token.
//   2. Cloudflare → Worker → Settings → Variables and Secrets → Secret
//      TELEGRAM_BOT_TOKEN = ese token.
//   3. Escribirle cualquier cosa al bot (o sumarlo a un grupo y escribir ahí).
//   4. Panel → 🔔 Avisos → "Conectar": busca ese chat y lo guarda en
//      `configuracion` (clave telegram_chat_id). TELEGRAM_CHAT_ID, si está,
//      manda sobre lo guardado.
//
// Todo es "best effort": sin token, sin chat o si Telegram falla, no pasa nada
// (el mail al admin sale igual). `enviarTelegram` nunca lanza.

const { sb } = require("./supabase.js");
const { numeroPedido } = require("../../public/motor.js");

const API = "https://api.telegram.org/bot";
const CLAVE_CHAT = "telegram_chat_id";
const PANEL = "https://merlacoffee.com.ar/admin";

const token = () => String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const disponible = () => Boolean(token());

const pesos = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });
// Telegram en modo HTML solo pide escapar estos tres
const escapar = (v) => String(v == null ? "" : v).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

async function llamar(metodo, cuerpo = {}) {
  const r = await fetch(`${API}${token()}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  let d = null;
  try { d = await r.json(); } catch { /* respuesta vacía */ }
  if (!d || !d.ok) throw new Error((d && d.description) || `Telegram HTTP ${r.status}`);
  return d.result;
}

async function chatGuardado() {
  const env = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  if (env) return env;
  const filas = await sb(`configuracion?clave=eq.${CLAVE_CHAT}&select=valor&limit=1`);
  return filas && filas[0] ? String(filas[0].valor) : "";
}

async function enviarTelegram(texto) {
  if (!disponible()) return false;
  try {
    const chat = await chatGuardado();
    if (!chat) return false;
    await llamar("sendMessage", { chat_id: chat, text: texto, parse_mode: "HTML", disable_web_page_preview: true });
    return true;
  } catch (err) {
    console.warn("telegram:", err.message);
    return false;
  }
}

// El chat más reciente que le escribió al bot (privado o grupo)
async function buscarChat() {
  const novedades = await llamar("getUpdates", { limit: 100 });
  for (let i = novedades.length - 1; i >= 0; i--) {
    const u = novedades[i];
    const m = u.message || u.edited_message || u.channel_post || u.my_chat_member;
    const chat = m && m.chat;
    if (!chat) continue;
    const nombre = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "";
    return { id: chat.id, nombre, tipo: chat.type };
  }
  return null;
}

async function guardarChat(id) {
  await sb("configuracion", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: { clave: CLAVE_CHAT, valor: Number(id), descripcion: "Chat de Telegram que recibe los avisos de ventas" },
  });
}

async function borrarChat() {
  await sb(`configuracion?clave=eq.${CLAVE_CHAT}`, { method: "DELETE" });
}

// ===== Textos =====

const CANALES = { mercadopago: "Mercado Pago", whatsapp: "WhatsApp", modo: "MODO", mayorista: "Mayorista", directa: "Venta directa" };

function lineaEntrega(envio) {
  if (!envio || !envio.metodo) return "";
  if (envio.metodo === "retiro") return "🏪 Retira en La Plata";
  const correo = [envio.transportista, envio.servicio].filter(Boolean).join(" · ");
  const lugar = [envio.ciudad, envio.provincia].filter(Boolean).join(", ");
  if (envio.opcionTipo === "sucursal") return `🏤 Envío a sucursal${correo ? ` (${correo})` : ""}${lugar ? ` · ${lugar}` : ""}`;
  const esLocal = envio.proveedor === "local" || envio.opcionGrupo === "local:laplata";
  if (esLocal) return `🛵 Envío en La Plata${envio.direccion ? ` · ${envio.direccion}` : ""}`;
  return `📦 Envío a domicilio${correo ? ` (${correo})` : ""}${lugar ? ` · ${lugar}` : ""}`;
}

function textoPedido(pedido) {
  const cobrado = pedido.estado === "aprobado";
  const canal = CANALES[pedido.origen] || pedido.origen || "";
  const nombre = String((pedido.envio && pedido.envio.nombre) || "").trim();
  const cabecera = [
    `${cobrado ? "💰 <b>Venta cobrada" : "🧾 <b>Pedido nuevo"} ${escapar(numeroPedido(pedido.numero))}</b> · ${pesos(pedido.total)}`,
    [canal, cobrado ? "" : "sin cobrar todavía", nombre].filter(Boolean).map(escapar).join(" · "),
  ];
  const detalle = [
    ...(pedido.items || []).map((i) => `• ${i.qty}× ${escapar(i.nombre)}`),
    pedido.cupon ? `🎟 Cupón ${escapar(pedido.cupon)}` : "",
    Number(pedido.descuento_puntos) > 0 ? `⭐ Canjeó puntos (-${pesos(pedido.descuento_puntos)})` : "",
    escapar(lineaEntrega(pedido.envio)),
  ];
  return [cabecera, detalle, [`<a href="${PANEL}">Abrir el panel</a>`]]
    .map((bloque) => bloque.filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");
}

function textoPagoRaro(motivo, pago, pedido) {
  const monto = pesos(pago && pago.transaction_amount);
  const titulo = motivo === "duplicado"
    ? `⚠️ <b>Pagaron dos veces el pedido ${escapar(pedido ? numeroPedido(pedido.numero) : "")}</b> · ${monto}`
    : `⚠️ <b>Entró un pago sin pedido</b> · ${monto}`;
  return `${titulo}\nPago N° ${escapar(pago && pago.id)}. El detalle está en el mail de aviso y en Mercado Pago.`;
}

function textoResena(resena) {
  const n = Math.max(0, Math.min(5, Number(resena.estrellas) || 0));
  return `⭐ <b>Reseña nueva para aprobar</b> ${"★".repeat(n)}${"☆".repeat(5 - n)}\n` +
    `${escapar(resena.nombre)}: “${escapar(String(resena.texto || "").slice(0, 200))}”\n\n` +
    `<a href="${PANEL}">Revisarla en el panel</a>`;
}

module.exports = {
  disponible, enviarTelegram, buscarChat, guardarChat, borrarChat, chatGuardado, llamar,
  textoPedido, textoPagoRaro, textoResena,
};
