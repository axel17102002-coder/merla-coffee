// Notificaciones del panel en el celular (Web Push), sin servicios de terceros.
//
// El panel instalado en la pantalla de inicio se suscribe desde
// /admin → Ajustes → Avisos (cada dispositivo es una fila de
// `push_suscripciones`). Al entrar una venta, avisos.js llama a `enviarPush` y
// el Worker le manda el aviso, cifrado, al servicio de push de cada navegador
// (Apple, Google, Mozilla), que lo entrega aunque el panel esté cerrado.
//
// Las claves VAPID (con las que nos identificamos ante esos servicios) se
// generan solas la primera vez y viven en `push_claves`: no hay que cargar
// ningún secreto en Cloudflare. Todo es "best effort": `enviarPush` nunca lanza.
//
// Protocolos: RFC 8292 (VAPID, firma ES256) y RFC 8291 (cifrado aes128gcm).

const { sb } = require("./supabase.js");

const CONTACTO = "mailto:hola@merlacoffee.com.ar"; // lo piden Apple y Google en la firma

const utf8 = (t) => new TextEncoder().encode(t);

function unir(...partes) {
  const total = partes.reduce((t, p) => t + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
}

function aBase64Url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64Url(texto) {
  const b64 = String(texto).replace(/-/g, "+").replace(/_/g, "/");
  const s = atob(b64 + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// HKDF-SHA-256 de un solo bloque (alcanza: nunca pedimos más de 32 bytes)
async function hkdf(sal, ikm, info, largo) {
  const k1 = await crypto.subtle.importKey("raw", sal, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", k1, ikm));
  const k2 = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const t = new Uint8Array(await crypto.subtle.sign("HMAC", k2, unir(info, new Uint8Array([1]))));
  return t.slice(0, largo);
}

// Cifra el contenido para una suscripción (RFC 8291, un solo registro).
// `fijo` ({ claves, sal }) es solo para probar contra el ejemplo del RFC.
async function cifrar(contenido, p256dh, auth, fijo = null) {
  const publicaCliente = deBase64Url(p256dh);
  const secretoAuth = deBase64Url(auth);
  const propias = fijo ? fijo.claves : await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicaPropia = new Uint8Array(await crypto.subtle.exportKey("raw", propias.publicKey));
  const claveCliente = await crypto.subtle.importKey("raw", publicaCliente, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secretoEcdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: claveCliente }, propias.privateKey, 256));

  const ikm = await hkdf(secretoAuth, secretoEcdh, unir(utf8("WebPush: info\0"), publicaCliente, publicaPropia), 32);
  const sal = fijo ? fijo.sal : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sal, ikm, utf8("Content-Encoding: nonce\0"), 12);

  const clave = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, clave, unir(contenido, new Uint8Array([2]))));
  // Encabezado: sal (16) · tamaño de registro (4 bytes, 4096) · largo de la clave (1) · clave pública
  return unir(sal, new Uint8Array([0, 0, 16, 0]), new Uint8Array([publicaPropia.length]), publicaPropia, cifrado);
}

// Firma VAPID: un JWT ES256 para el servidor de push de esa suscripción
async function firmaVapid(endpoint, jwk) {
  const aud = String(endpoint).match(/^https?:\/\/[^/]+/)[0];
  const cabeza = aBase64Url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const cuerpo = aBase64Url(utf8(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACTO })));
  const { key_ops, ext, ...limpia } = jwk;
  const clave = await crypto.subtle.importKey("jwk", limpia, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, clave, utf8(`${cabeza}.${cuerpo}`)));
  return `${cabeza}.${cuerpo}.${aBase64Url(firma)}`;
}

// Claves VAPID: se crean la primera vez y quedan guardadas
let clavesEnMemoria = null;
async function clavesVapid() {
  if (clavesEnMemoria) return clavesEnMemoria;
  const leer = async () => (await sb("push_claves?id=eq.1&select=publica,privada_jwk&limit=1"))[0] || null;
  let fila = await leer();
  if (!fila) {
    const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const privada = await crypto.subtle.exportKey("jwk", par.privateKey);
    const publica = aBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey)));
    // Si dos pedidos llegan juntos, gana el primero y el otro lee esa
    await sb("push_claves", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: { id: 1, publica, privada_jwk: privada },
    });
    fila = await leer();
  }
  clavesEnMemoria = fila;
  return fila;
}

async function enviarA(suscripcion, contenido, claves) {
  const cuerpo = await cifrar(utf8(JSON.stringify(contenido)), suscripcion.p256dh, suscripcion.auth);
  const firma = await firmaVapid(suscripcion.endpoint, claves.privada_jwk);
  const r = await fetch(suscripcion.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "high",
      Authorization: `vapid t=${firma}, k=${claves.publica}`,
    },
    body: cuerpo,
  });
  // 404/410: el dispositivo se dio de baja (desinstaló el panel o sacó el permiso)
  if (r.status === 404 || r.status === 410) {
    await sb(`push_suscripciones?endpoint=eq.${encodeURIComponent(suscripcion.endpoint)}`, { method: "DELETE" }).catch(() => {});
    return false;
  }
  if (!r.ok) throw new Error(`push HTTP ${r.status}`);
  return true;
}

// { titulo, cuerpo, url, etiqueta } → a todos los dispositivos. Devuelve cuántos lo recibieron.
async function enviarPush(aviso) {
  try {
    const suscripciones = await sb("push_suscripciones?select=endpoint,p256dh,auth");
    if (!suscripciones || !suscripciones.length) return 0;
    const claves = await clavesVapid();
    const resultados = await Promise.allSettled(suscripciones.map((s) => enviarA(s, aviso, claves)));
    resultados.forEach((r) => { if (r.status === "rejected") console.warn("push:", r.reason && r.reason.message); });
    return resultados.filter((r) => r.status === "fulfilled" && r.value).length;
  } catch (err) {
    console.warn("push (sin enviar):", err.message);
    return 0;
  }
}

// ===== Textos =====
const pesos = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });
const CANALES = { mercadopago: "Mercado Pago", whatsapp: "WhatsApp", modo: "MODO", mayorista: "Mayorista", directa: "Venta directa" };

function avisoPedido(pedido) {
  const cobrado = pedido.estado === "aprobado";
  const numero = pedido.numero ? `#${String(pedido.numero).padStart(4, "0")}` : "";
  const items = pedido.items || [];
  const resumen = items.length ? `${items[0].qty}× ${items[0].nombre}${items.length > 1 ? ` +${items.length - 1} más` : ""}` : "";
  const nombre = (pedido.envio && pedido.envio.nombre) || pedido.cliente_email || "";
  const entrega = !pedido.envio || pedido.envio.metodo !== "envio" ? "Retiro" : (pedido.envio.transportista || "Envío");
  return {
    titulo: `${cobrado ? "💰 Venta cobrada" : `🧾 Pedido nuevo (${CANALES[pedido.origen] || pedido.origen})`} ${numero} · ${pesos(pedido.total)}`,
    cuerpo: [nombre, resumen, entrega].filter(Boolean).join(" · "),
    url: "/admin#pedidos",
    etiqueta: `pedido-${pedido.id}`,
  };
}

module.exports = { enviarPush, clavesVapid, avisoPedido, cifrar, firmaVapid, aBase64Url, deBase64Url };
