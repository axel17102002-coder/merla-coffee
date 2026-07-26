// Límite de intentos por IP, en memoria del Worker.
//
// Para qué: `validar-cupon` es público y responde distinto con un código válido
// que con uno inválido, así que un script puede probar diccionarios hasta dar
// con los cupones ocultos. Esto lo frena.
//
// OJO con el alcance: Cloudflare corre varios isolates y los recicla, así que
// el contador NO es global ni perfectamente exacto — un atacante distribuido
// puede pasar. Alcanza contra el caso real (un script desde una IP) y no
// agrega latencia ni una tabla más. Si algún día hace falta algo serio, va con
// Rate Limiting de Cloudflare o un KV.

const contadores = new Map();

// Se limpia solo: sin esto, un Worker de larga vida acumularía una entrada por
// IP para siempre.
function purgar(ahora) {
  for (const [clave, datos] of contadores) {
    if (datos.hasta <= ahora) contadores.delete(clave);
  }
}

// ¿Se permite este intento? Devuelve { ok } o { ok:false, esperaSegundos }.
function permitir(clave, { max = 10, ventanaMs = 60000 } = {}) {
  if (!clave) return { ok: true }; // sin IP no hay a quién limitar
  const ahora = Date.now();
  if (contadores.size > 5000) purgar(ahora);

  const actual = contadores.get(clave);
  if (!actual || actual.hasta <= ahora) {
    contadores.set(clave, { intentos: 1, hasta: ahora + ventanaMs });
    return { ok: true };
  }
  actual.intentos++;
  if (actual.intentos > max) {
    return { ok: false, esperaSegundos: Math.ceil((actual.hasta - ahora) / 1000) };
  }
  return { ok: true };
}

// IP del visitante según los headers de Cloudflare (cf-connecting-ip es el que
// pone el proxy y el navegador no puede falsear).
function ipDe(event) {
  const h = (event && event.headers) || {};
  return h["cf-connecting-ip"] || h["x-real-ip"] || (h["x-forwarded-for"] || "").split(",")[0].trim() || "";
}

module.exports = { permitir, ipDe };
