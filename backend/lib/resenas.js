// Reseñas que dejan los clientes.
//
// Unos días después de cada compra cobrada, el cron (mantenimiento.js) le manda
// al cliente un mail con un link personal: /?resena=<token>. El token dice de
// qué pedido es y hasta cuándo vale, firmado con un secreto del servidor (HMAC,
// como el pase de canje de puntos): nadie puede armar un link para un pedido
// ajeno ni opinar sin haber comprado. Lo que escribe llega a /admin → Reseñas
// como "nueva" y se publica recién cuando el admin la aprueba.

const crypto = require("node:crypto");
const { DOMINIO } = require("./dominio.js");

const DIAS_LINK = 60; // cuánto vale el link del mail
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secreto() {
  const s = process.env.CANJE_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Falta un secreto para firmar los links de reseña");
  return s;
}

const firmar = (texto) =>
  crypto.createHmac("sha256", secreto()).update(`merla-resena-v1|${texto}`).digest("hex").slice(0, 40);

function iguales(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

// Token del link: "<pedido>.<vencimiento>.<firma>"
function crearToken(pedidoId, ahora = Date.now()) {
  const vence = ahora + DIAS_LINK * 24 * 3600 * 1000;
  return `${pedidoId}.${vence}.${firmar(`${String(pedidoId).toLowerCase()}|${vence}`)}`;
}

// Id del pedido si el token es auténtico y no venció; si no, null
function pedidoDelToken(token, ahora = Date.now()) {
  const [id, vence, firma] = String(token || "").split(".");
  if (!UUID.test(id || "") || !/^\d{10,16}$/.test(vence || "") || !firma) return null;
  if (Number(vence) <= ahora) return null;
  return iguales(firma, firmar(`${id.toLowerCase()}|${vence}`)) ? id.toLowerCase() : null;
}

// Link del mail. Con `estrellas`, el formulario abre con ese puntaje elegido.
function enlaceResena(pedidoId, estrellas = 0, ahora = Date.now()) {
  const n = Number(estrellas);
  return `https://${DOMINIO}/?resena=${crearToken(pedidoId, ahora)}${n >= 1 && n <= 5 ? `&estrellas=${n}` : ""}`;
}

// "Brasil Sertão - Unidad" → "Brasil Sertão". Lo que compró, para mostrar
// junto a la reseña: "Brasil Sertão y Volcánico".
function productosDelPedido(pedido) {
  const nombres = [...new Set((pedido && pedido.items || [])
    .map((i) => String(i.nombre || "").split(" - ")[0].trim())
    .filter(Boolean))];
  if (nombres.length <= 1) return nombres[0] || "";
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`.slice(0, 120);
}

// Cuándo pedir la reseña: entre 5 y 14 días después de cobrado el pedido (lo
// recibió y lo probó; más tarde ya no se acuerda).
const DIAS_DESDE = 5;
const DIAS_HASTA = 14;
// A un mismo cliente no se le pide más de una vez cada 60 días, compre lo que compre
const DIAS_ENTRE_PEDIDOS = 60;

// De los pedidos candidatos (aprobados, con email, sin reseña pedida, dentro de
// la ventana), elige a cuáles mandarles el mail. Función pura, para probarla.
//   pedidasRecientes: emails a los que ya se les pidió en los últimos 60 días
function elegirPedidosParaResena(pedidos, pedidasRecientes = new Set()) {
  const vistos = new Set();
  const elegidos = [];
  const ordenados = [...pedidos].sort((a, b) => new Date(a.actualizado) - new Date(b.actualizado));
  for (const p of ordenados) {
    const email = String(p.cliente_email || "").trim().toLowerCase();
    if (!email || p.origen === "mayorista") continue; // a un mayorista no se le pide reseña de la tienda
    if (pedidasRecientes.has(email) || vistos.has(email)) continue;
    vistos.add(email);
    elegidos.push(p);
  }
  return elegidos;
}

module.exports = {
  crearToken,
  pedidoDelToken,
  enlaceResena,
  productosDelPedido,
  elegirPedidosParaResena,
  DIAS_LINK,
  DIAS_DESDE,
  DIAS_HASTA,
  DIAS_ENTRE_PEDIDOS,
};
