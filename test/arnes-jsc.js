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

const pruebas = [];
let archivoActual = "";
const integrados = {
  "node:test": { test: (nombre, fn) => pruebas.push({ nombre, fn, archivo: archivoActual }) },
  "node:assert/strict": assert,
  "node:crypto": { timingSafeEqual: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]) },
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
