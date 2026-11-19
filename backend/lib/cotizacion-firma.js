// Firma HMAC de cotizaciones de envío (mismo patrón stateless que canje.js).
//
// Cuando `/api/cotizar-envio` devuelve las opciones al carrito, cada una lleva
// un `cotizacionToken` firmado por el servidor con TTL de 20 minutos. Al pagar,
// el checkout verifica la firma y que el carrito + destino sigan iguales:
//   - Evita volver a llamar a Zipnova/Andreani/paq.ar durante el click de pagar
//     (checkout mucho más rápido y sin timeouts de correos).
//   - Garantiza que el precio que vio el cliente es exactamente el que cobra MP.
//   - Si el token venció o no viene (ej. carrito viejo), el servidor recotiza
//     normalmente contra el proveedor.

const crypto = require("node:crypto");

const TTL_MS = 20 * 60 * 1000; // 20 minutos

function secreto() {
  const base = process.env.ADMIN_TOKEN || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base) return "";
  return `envio-quote-v1:${base}`;
}

function firmaDe(mensaje) {
  const clave = secreto();
  if (!clave) return "";
  return crypto.createHmac("sha256", clave).update(mensaje).digest("hex");
}

function igualSeguro(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function huellaItems(items) {
  return (items || [])
    .map((i) => `${String(i.presentacion || "")}:${Number.parseInt(i.qty, 10) || 0}`)
    .sort()
    .join(",");
}

function huellaDestino(destino) {
  const limpio = (s) => String(s || "").trim().toLowerCase();
  return `${limpio(destino && destino.cp)}|${limpio(destino && destino.ciudad)}|${limpio(destino && destino.provincia)}`;
}

// Arma un token firmado para una opción ya cotizada por el servidor.
// Devuelve "" si no hay secreto configurado (el flujo sigue funcionando con recotización).
function firmarOpcion(opcion, { items, destino, pesoGramos, ahora = Date.now() }) {
  if (!secreto()) return "";
  const datos = {
    p: opcion.proveedor || "zipnova",
    g: opcion.grupo || "",
    t: opcion.tipo || "domicilio",
    tr: opcion.transportista || "",
    s: opcion.servicio || "",
    pl: opcion.plazo || "",
    pr: Math.max(0, Math.round(Number(opcion.precio) || 0)),
    gr: Boolean(opcion.gratis),
    po: opcion.precioOriginal != null ? Math.round(Number(opcion.precioOriginal)) : null,
    w: Math.round(Number(pesoGramos) || 0),
    hi: huellaItems(items),
    hd: huellaDestino(destino),
    v: ahora + TTL_MS,
  };
  const carga = encodeURIComponent(JSON.stringify(datos));
  const mac = firmaDe(carga);
  return `${carga}.${mac}`;
}

// Verifica el token recibido desde el navegador contra el carrito y destino
// actuales. Devuelve la opción firmada (con `proveedor`, `precio`, etc.) o null
// si no es válido, expiró o cambió algo del carrito/destino.
function verificarOpcion(token, { grupo, items, destino, ahora = Date.now() }) {
  if (!token || typeof token !== "string" || !secreto()) return null;
  const punto = token.lastIndexOf(".");
  if (punto <= 0) return null;
  const carga = token.slice(0, punto);
  const mac = token.slice(punto + 1);
  if (!igualSeguro(mac, firmaDe(carga))) return null;

  let datos;
  try {
    datos = JSON.parse(decodeURIComponent(carga));
  } catch {
    return null;
  }
  if (!datos || typeof datos !== "object") return null;
  if (!(Number(datos.v) > ahora)) return null; // venció
  if (datos.g !== String(grupo || "")) return null;
  if (datos.hi !== huellaItems(items)) return null;
  if (datos.hd !== huellaDestino(destino)) return null;

  return {
    proveedor: datos.p,
    opcion: {
      grupo: datos.g,
      proveedor: datos.p,
      tipo: datos.t,
      transportista: datos.tr,
      servicio: datos.s,
      plazo: datos.pl,
      precio: datos.pr,
      gratis: datos.gr,
      precioOriginal: datos.po,
    },
    pesoGramos: datos.w,
  };
}

module.exports = { firmarOpcion, verificarOpcion, huellaItems, huellaDestino, TTL_MS };
