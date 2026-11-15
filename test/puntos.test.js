// Tests del canje de puntos Club Merla: para gastar puntos hay que demostrar
// que el email es propio (código por mail → pase firmado).
//
//   node --test
//
// Convención: cada test dice QUÉ regla protege, no cómo está escrita.

const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://base.test";
process.env.SUPABASE_SECRET_KEY = "clave-de-prueba";
process.env.BREVO_API_KEY = "brevo-de-prueba";
process.env.MAIL_ADMIN = "admin@merla.test";

const { codigoActual, codigoValido, crearPase, paseValido } = require("../backend/lib/canje.js");
const pedirCodigo = require("../backend/functions/canje-codigo.js").handler;
const verificar = require("../backend/functions/canje-verificar.js").handler;
const pedidoWhatsapp = require("../backend/functions/whatsapp-pedido.js").handler;
const { CONFIG } = require("../public/motor.js");

const MIN = 60 * 1000;
const AHORA = Date.parse("2026-11-15T15:03:00Z");

function simularRed(reglas) {
  const llamadas = [];
  globalThis.fetch = async (url, opciones = {}) => {
    const llamada = { metodo: opciones.method || "GET", url: String(url), body: opciones.body ? JSON.parse(opciones.body) : undefined };
    llamadas.push(llamada);
    for (const [patron, respuesta] of reglas) {
      if (!patron.test(`${llamada.metodo} ${llamada.url}`)) continue;
      const { status = 200, json = null } = (typeof respuesta === "function" ? respuesta(llamada) : respuesta) || {};
      return { ok: status < 400, status, json: async () => json, text: async () => (json === null ? "" : JSON.stringify(json)) };
    }
    throw new Error(`llamada no prevista: ${llamada.metodo} ${llamada.url}`);
  };
  return llamadas;
}
const mails = (llamadas) => llamadas.filter((l) => l.url.includes("brevo.com")).map((l) => l.body);
const post = (handler, cuerpo) => handler({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(cuerpo) });
const conPuntos = (puntos) => [
  [/GET .*clientes\?/, { json: [{ puntos }] }],
  [/POST .*brevo\.com/, { json: {} }],
];

// ===== El código =====

test("el código son 6 dígitos y es el mismo mientras dura su ventana", () => {
  const codigo = codigoActual("ana@test.com", AHORA);
  assert.match(codigo, /^\d{6}$/);
  assert.equal(codigoActual("Ana@Test.com ", AHORA + 2 * MIN), codigo); // mismo email, escrito distinto
});

test("el código sirve unos minutos y después vence", () => {
  const codigo = codigoActual("ana@test.com", AHORA);
  assert.equal(codigoValido("ana@test.com", codigo, AHORA + 9 * MIN), true);
  assert.equal(codigoValido("ana@test.com", codigo, AHORA + 25 * MIN), false);
});

test("el código de un email no sirve para otro", () => {
  const codigo = codigoActual("ana@test.com", AHORA);
  assert.equal(codigoValido("beto@test.com", codigo, AHORA), false);
});

test("se acepta el código como lo muestra el mail (con espacio) y se rechaza lo que no son 6 dígitos", () => {
  const codigo = codigoActual("ana@test.com", AHORA);
  assert.equal(codigoValido("ana@test.com", `${codigo.slice(0, 3)} ${codigo.slice(3)}`, AHORA), true);
  for (const basura of ["", null, "12345", "1234567", "abcdef", undefined]) {
    assert.equal(codigoValido("ana@test.com", basura, AHORA), false);
  }
});

// ===== El pase =====

test("el pase deja canjear solo al email que se verificó, y vence", () => {
  const pase = crearPase("ana@test.com", AHORA);
  assert.equal(paseValido(pase, "ana@test.com", AHORA + 24 * 60 * MIN), true);
  assert.equal(paseValido(pase, "beto@test.com", AHORA), false);
  assert.equal(paseValido(pase, "ana@test.com", AHORA + 40 * 24 * 60 * MIN), false);
});

test("un pase inventado o retocado no sirve", () => {
  const pase = crearPase("ana@test.com", AHORA);
  const [vence, firma] = pase.split(".");
  // estirarle el vencimiento sin poder rehacer la firma
  assert.equal(paseValido(`${Number(vence) + 999999999}.${firma}`, "ana@test.com", AHORA), false);
  for (const falso of ["", null, "hola", `${vence}.`, `${vence}.${"0".repeat(64)}`, "1"]) {
    assert.equal(paseValido(falso, "ana@test.com", AHORA), false);
  }
});

// ===== Pedir y confirmar el código =====

test("el código se manda a la casilla del cliente, no a quien lo pide", async () => {
  const llamadas = simularRed(conPuntos(400));
  const r = await post(pedirCodigo, { email: "Carla@Test.com" });
  assert.equal(r.statusCode, 200);
  const [mail] = mails(llamadas);
  assert.equal(mail.to[0].email, "carla@test.com");
  // el código va en el mail y NO en la respuesta al navegador
  const codigo = codigoActual("carla@test.com");
  assert.ok(mail.htmlContent.includes(`${codigo.slice(0, 3)} ${codigo.slice(3)}`));
  assert.ok(!r.body.includes(codigo));
});

test("a quien no tiene puntos para canjear no se le manda ningún mail", async () => {
  const llamadas = simularRed(conPuntos(CONFIG.fidelidad.canjePuntos - 1));
  assert.equal((await post(pedirCodigo, { email: "dario@test.com" })).statusCode, 400);
  assert.equal(mails(llamadas).length, 0);
  // ni a un email que no es cliente
  simularRed([[/GET .*clientes\?/, { json: [] }]]);
  assert.equal((await post(pedirCodigo, { email: "nadie@test.com" })).statusCode, 400);
});

test("no se pueden pedir códigos sin parar para la misma casilla", async () => {
  const llamadas = simularRed(conPuntos(400));
  const estados = [];
  for (let i = 0; i < 5; i++) estados.push((await post(pedirCodigo, { email: "elsa@test.com" })).statusCode);
  assert.deepEqual(estados, [200, 200, 200, 429, 429]);
  assert.equal(mails(llamadas).length, 3);
});

test("con el código correcto se obtiene un pase válido para ese email", async () => {
  const r = await post(verificar, { email: "fede@test.com", codigo: codigoActual("fede@test.com") });
  assert.equal(r.statusCode, 200);
  assert.equal(paseValido(JSON.parse(r.body).pase, "fede@test.com"), true);
});

test("con un código equivocado no hay pase, y los intentos se cortan", async () => {
  const bueno = codigoActual("gabi@test.com");
  const malo = bueno === "000000" ? "111111" : "000000";
  const estados = [];
  for (let i = 0; i < 8; i++) estados.push((await post(verificar, { email: "gabi@test.com", codigo: malo })).statusCode);
  assert.deepEqual(estados, [400, 400, 400, 400, 400, 400, 429, 429]);
  // agotados los intentos, ni el código bueno pasa hasta que venza la espera
  assert.equal((await post(verificar, { email: "gabi@test.com", codigo: bueno })).statusCode, 429);
});

// ===== El canje en el pedido =====

function redDePedido(puntos = 400) {
  return [
    [/GET .*productos\?/, { json: [{ id: "taza", nombre: "Taza", stock: 10, activo: true, tipo: "simple", costo: 5000 }] }],
    [/GET .*presentaciones\?/, { json: [{ id: "taza-u", producto_id: "taza", nombre: "Taza", precio: 12000, unidades_stock: 1, activo: true }] }],
    [/GET .*clientes\?/, { json: [{ puntos }] }],
    [/GET .*(insumos|configuracion)\?/, { json: [] }],
    [/POST .*\/pedidos$/, (llamada) => ({ json: [{ id: "11111111-1111-4111-8111-111111111111", numero: 20, ...llamada.body }] })],
    [/GET .*pedidos\?id=/, { json: [] }],
  ];
}
const pedir = (extra) => post(pedidoWhatsapp, { items: [{ presentacion: "taza-u", qty: 1 }], envio: { metodo: "retiro" }, ...extra });

test("saber el email de un cliente ya no alcanza para gastarle los puntos", async () => {
  const llamadas = simularRed(redDePedido());
  const r = await pedir({ email: "victima@test.com", canjePuntos: true });
  assert.equal(r.statusCode, 403);
  assert.equal(JSON.parse(r.body).codigo, "canje_sin_verificar");
  assert.equal(llamadas.filter((l) => l.metodo === "POST").length, 0); // no se creó ningún pedido
});

test("un pase de otro email no sirve para canjear los puntos de este", async () => {
  simularRed(redDePedido());
  const r = await pedir({ email: "victima@test.com", canjePuntos: true, canjePase: crearPase("atacante@test.com") });
  assert.equal(r.statusCode, 403);
});

test("con el email verificado, el canje se aplica", async () => {
  const llamadas = simularRed(redDePedido());
  const r = await pedir({ email: "hugo@test.com", canjePuntos: true, canjePase: crearPase("hugo@test.com") });
  assert.equal(r.statusCode, 201);
  const fila = llamadas.find((l) => l.metodo === "POST" && /\/pedidos$/.test(l.url)).body;
  assert.equal(fila.puntos_canjeados, CONFIG.fidelidad.canjePuntos);
  assert.equal(fila.descuento_puntos, CONFIG.fidelidad.canjeDescuento);
  assert.equal(fila.total, 12000 - CONFIG.fidelidad.canjeDescuento);
});

test("comprar sin canjear sigue sin pedir ninguna verificación", async () => {
  simularRed(redDePedido());
  assert.equal((await pedir({ email: "ines@test.com" })).statusCode, 201);
});
