// Corre los tests (los mismos de `node --test`) SIN Node, con el JavaScriptCore
// que trae macOS. Sirve en una máquina donde no hay Node instalado.
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC test/arnes-jsc.js -- "$PWD" test/motor.test.js test/cobro.test.js test/envio.test.js
//
// Imita lo mínimo de Node que usan los tests: require() de archivos, node:test,
// node:assert/strict y node:crypto. No es Node: si un test nuevo usa algo que
// acá no existe, falla con un mensaje claro y hay que sumarlo abajo.

var RAIZ = arguments[0];
var console = { log() {}, warn() {}, error() {}, info() {} };
globalThis.console = console;
globalThis.process = { env: {} };
globalThis.Buffer = { from: (s) => Array.from(String(s)).map((c) => c.charCodeAt(0)) };
if (typeof URLSearchParams === "undefined") {
  globalThis.URLSearchParams = class {
    constructor(inicial = {}) { this.pares = Object.entries(inicial).map(([k, v]) => [k, String(v)]); }
    append(k, v) { this.pares.push([k, String(v)]); }
    set(k, v) { this.pares = this.pares.filter(([c]) => c !== k); this.pares.push([k, String(v)]); }
    get(k) { const par = this.pares.find(([c]) => c === k); return par ? par[1] : null; }
    has(k) { return this.pares.some(([c]) => c === k); }
    toString() { return this.pares.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&"); }
  };
}

function igual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => igual(a[k], b[k]));
}
const mostrar = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };
const assert = {
  equal(a, b, m) { if (!Object.is(a, b)) throw new Error(m || `esperaba ${mostrar(b)}, hay ${mostrar(a)}`); },
  notEqual(a, b, m) { if (Object.is(a, b)) throw new Error(m || `no debía ser ${mostrar(a)}`); },
  ok(v, m) { if (!v) throw new Error(m || `esperaba verdadero, hay ${mostrar(v)}`); },
  match(s, re, m) { if (!re.test(s)) throw new Error(m || `${mostrar(String(s).slice(0, 300))} no coincide con ${re}`); },
  doesNotMatch(s, re, m) { if (re.test(s)) throw new Error(m || `no debía coincidir con ${re}`); },
  deepEqual(a, b, m) { if (!igual(a, b)) throw new Error(m || `esperaba ${mostrar(b)}, hay ${mostrar(a)}`); },
};

// HMAC-SHA256 en JS puro, para `crypto.createHmac("sha256", clave)`: JavaScriptCore
// no trae crypto. Solo para tests; en producción firma el crypto de verdad.
const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const rotr = (x, n) => (x >>> n) | (x << (32 - n));
function sha256(bytes) {
  const m = bytes.slice();
  const bits = bytes.length * 8;
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);
  for (let i = 7; i >= 0; i--) m.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 0xff);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array(64);
  for (let o = 0; o < m.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i] + v) | 0; });
  }
  return h.flatMap((v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}
const utf8 = (s) => Array.from(unescape(encodeURIComponent(String(s)))).map((c) => c.charCodeAt(0));
function hmacSha256Hex(clave, mensaje) {
  let k = utf8(clave);
  if (k.length > 64) k = sha256(k);
  while (k.length < 64) k.push(0);
  const interno = sha256(k.map((b) => b ^ 0x36).concat(utf8(mensaje)));
  return sha256(k.map((b) => b ^ 0x5c).concat(interno)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
if (hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog") !== "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8") {
  throw new Error("arnés: el HMAC-SHA256 propio no da el valor de referencia");
}

const pruebas = [];
let archivoActual = "";
const integrados = {
  "node:test": { test: (nombre, fn) => pruebas.push({ nombre, fn, archivo: archivoActual }) },
  "node:assert/strict": assert,
  "node:crypto": {
    timingSafeEqual: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]),
    createHmac(algoritmo, clave) {
      if (algoritmo !== "sha256") throw new Error(`el arnés solo sabe HMAC sha256, no ${algoritmo}`);
      let mensaje = "";
      return {
        update(dato) { mensaje += String(dato); return this; },
        digest(formato) {
          if (formato !== "hex") throw new Error("el arnés solo sabe digest('hex')");
          return hmacSha256Hex(clave, mensaje);
        },
      };
    },
  },
};

const cargados = {};
function normalizar(ruta) {
  const partes = [];
  for (const p of ruta.split("/")) {
    if (p === "..") partes.pop();
    else if (p !== "." && p !== "") partes.push(p);
  }
  return "/" + partes.join("/");
}
function requerir(desde, nombre) {
  if (integrados[nombre]) return integrados[nombre];
  if (!nombre.startsWith(".")) throw new Error(`el arnés no conoce el módulo "${nombre}" (sumalo en test/arnes-jsc.js)`);
  const ruta = normalizar(desde.replace(/\/[^/]*$/, "") + "/" + nombre);
  if (cargados[ruta]) return cargados[ruta].exports;
  const modulo = (cargados[ruta] = { exports: {} });
  const fn = new Function("require", "module", "exports", readFile(ruta) + "\n//# sourceURL=" + ruta);
  fn((n) => requerir(ruta, n), modulo, modulo.exports);
  return modulo.exports;
}

(async () => {
  for (const archivo of arguments.slice(1)) {
    archivoActual = archivo;
    requerir(RAIZ + "/x", "./" + archivo);
  }
  let fallas = 0;
  for (const p of pruebas) {
    try {
      await p.fn();
    } catch (err) {
      fallas++;
      print(`FALLA [${p.archivo}] ${p.nombre}\n   ${err && err.message}`);
    }
  }
  print(`${pruebas.length - fallas} de ${pruebas.length} tests pasan` + (fallas ? `  (${fallas} FALLAN)` : ""));
  if (fallas) quit(1);
})().catch((e) => { print("ARNÉS ROTO: " + e + "\n" + e.stack); quit(1); });
