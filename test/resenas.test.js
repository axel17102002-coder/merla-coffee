// Tests de las reseñas de clientes que se muestran en la tienda.
//
//   node --test
//
// Convención: cada test dice QUÉ regla protege, no cómo está escrita.

const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://base.test";
process.env.SUPABASE_SECRET_KEY = "clave-de-prueba";
process.env.ADMIN_TOKEN = "token-admin-de-prueba";

const tienda = require("../backend/functions/tienda.js").handler;
const adminResenas = require("../backend/functions/admin-resenas.js").handler;

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

const catalogo = [
  [/GET .*productos\?/, { json: [{ id: "andino", nombre: "Andino", stock: 3, activo: true, tipo: "cafe", costo_kg: 45000 }] }],
  [/GET .*presentaciones\?/, { json: [{ id: "andino-unidad", producto_id: "andino", nombre: "Unidad", precio: 2300, unidades_stock: 1, activo: true }] }],
  [/GET .*users\/me/, { json: { tags: [] } }],
];

test("la tienda manda solo las reseñas publicadas, sin datos internos", async () => {
  const llamadas = simularRed([
    ...catalogo,
    [/GET .*resenas\?/, { json: [{ nombre: "Sofía", texto: "Riquísimo", detalle: "La Plata", estrellas: 5 }] }],
  ]);
  const r = await tienda({ httpMethod: "GET", headers: {} });
  assert.equal(r.statusCode, 200);
  const cuerpo = JSON.parse(r.body);
  assert.deepEqual(cuerpo.resenas, [{ nombre: "Sofía", texto: "Riquísimo", detalle: "La Plata", estrellas: 5 }]);
  const pedido = decodeURIComponent(llamadas.find((l) => l.url.includes("/resenas?")).url);
  assert.match(pedido, /activo=is\.true/);
  assert.match(pedido, /select=nombre,texto,detalle,estrellas,producto,verificada&/); // ni id, ni fecha, ni pedido
  // y los costos siguen sin salir
  assert.equal(cuerpo.productos[0].costo_kg, undefined);
});

test("sin la segunda migración, la tienda igual muestra las reseñas (con los datos básicos)", async () => {
  simularRed([
    ...catalogo,
    [/GET .*resenas\?select=nombre,texto,detalle,estrellas,producto/, { status: 400, json: { code: "42703", message: "column resenas.producto does not exist" } }],
    [/GET .*resenas\?select=nombre,texto,detalle,estrellas&/, { json: [{ nombre: "Sofía", texto: "Rico", detalle: null, estrellas: 5 }] }],
  ]);
  const r = await tienda({ httpMethod: "GET", headers: {} });
  assert.deepEqual(JSON.parse(r.body).resenas, [{ nombre: "Sofía", texto: "Rico", detalle: null, estrellas: 5 }]);
});

test("si la tabla de reseñas no existe todavía, la tienda carga igual", async () => {
  simularRed([
    ...catalogo,
    [/GET .*resenas\?/, { status: 404, json: { code: "PGRST205", message: "Could not find the table 'public.resenas'" } }],
  ]);
  const r = await tienda({ httpMethod: "GET", headers: {} });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body).resenas, []);
  assert.equal(JSON.parse(r.body).productos.length, 1);
});

const admin = (metodo, cuerpo, extra = {}) =>
  adminResenas({
    httpMethod: metodo,
    headers: { "x-admin-token": extra.token || "token-admin-de-prueba" },
    queryStringParameters: extra.query || {},
    body: cuerpo ? JSON.stringify(cuerpo) : null,
  });

test("cargar reseñas exige ser admin", async () => {
  const llamadas = simularRed([]);
  assert.equal((await admin("POST", { nombre: "X", texto: "Y" }, { token: "otro-token-de-prueba!" })).statusCode, 401);
  assert.equal(llamadas.length, 0);
});

test("una reseña se guarda limpia: sin espacios de más, recortada y con estrellas entre 1 y 5", async () => {
  const llamadas = simularRed([[/POST .*\/resenas$/, (l) => ({ json: [{ id: "x", ...l.body }] })]]);
  const r = await admin("POST", { nombre: "  Sofía  ", texto: "Muy   rico\n\n el Sertão", detalle: "", estrellas: 9 });
  assert.equal(r.statusCode, 201);
  const fila = llamadas[0].body;
  assert.equal(fila.nombre, "Sofía");
  assert.equal(fila.texto, "Muy rico el Sertão");
  assert.equal(fila.detalle, null);
  assert.equal(fila.estrellas, 5);
  // texto larguísimo: se corta al máximo de la columna (400)
  await admin("POST", { nombre: "Ana", texto: "a".repeat(900) });
  assert.equal(llamadas[1].body.texto.length, 400);
});

test("sin nombre o sin texto no se guarda nada", async () => {
  const llamadas = simularRed([]);
  assert.equal((await admin("POST", { nombre: "", texto: "Rico" })).statusCode, 400);
  assert.equal((await admin("POST", { nombre: "Ana", texto: "   " })).statusCode, 400);
  assert.equal(llamadas.length, 0);
});

test("ocultar, editar y borrar actúan sobre una sola reseña, identificada por su id", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const llamadas = simularRed([
    [/PATCH .*resenas\?id=eq\./, (l) => ({ json: [{ id, ...l.body }] })],
    [/DELETE .*resenas\?id=eq\./, { json: null }],
  ]);
  assert.equal((await admin("PATCH", { id, activo: false })).statusCode, 200);
  assert.equal((await admin("POST", { id, nombre: "Ana", texto: "Corregido" })).statusCode, 200);
  assert.equal((await admin("DELETE", null, { query: { id } })).statusCode, 200);
  assert.deepEqual(llamadas.map((l) => l.metodo), ["PATCH", "PATCH", "DELETE"]);
  for (const l of llamadas) assert.match(l.url, new RegExp(`resenas\\?id=eq\\.${id}(&verificada=is\\.false)?$`));
  // un id que no es un uuid ni siquiera llega a la base (no puede armar un filtro raro)
  const antes = llamadas.length;
  assert.equal((await admin("DELETE", null, { query: { id: "x&activo=is.true" } })).statusCode, 400);
  assert.equal((await admin("PATCH", { id: "*", activo: true })).statusCode, 400);
  assert.equal(llamadas.length, antes);
});

// ===== Reseñas que dejan los clientes desde el link del mail =====

process.env.BREVO_API_KEY = "brevo-de-prueba";
process.env.MAIL_ADMIN = "admin@merla.test";
const { crearToken, pedidoDelToken, enlaceResena, productosDelPedido, elegirPedidosParaResena } = require("../backend/lib/resenas.js");
const opinar = require("../backend/functions/resena.js").handler;
const { pedirResenas } = require("../backend/lib/mantenimiento.js");

const PEDIDO = "22222222-2222-4222-8222-222222222222";
const DIA = 24 * 3600 * 1000;
const pedidoCobrado = (extra = {}) => ({
  id: PEDIDO, numero: 15, estado: "aprobado",
  items: [{ nombre: "Brasil Sertão - Unidad", qty: 2 }, { nombre: "Volcánico - Pack x5", qty: 1 }, { nombre: "Brasil Sertão - Pack x5", qty: 1 }],
  envio: { metodo: "retiro", nombre: "Sofía Pérez" },
  ...extra,
});

test("el link para opinar es de un solo pedido, no se puede falsificar y vence", () => {
  const ahora = Date.parse("2026-11-18T12:00:00Z");
  const token = crearToken(PEDIDO, ahora);
  assert.equal(pedidoDelToken(token, ahora + 30 * DIA), PEDIDO);
  assert.equal(pedidoDelToken(token, ahora + 61 * DIA), null); // vencido
  const [, vence, firma] = token.split(".");
  // cambiarle el pedido o estirarle el vencimiento invalida la firma
  assert.equal(pedidoDelToken(`33333333-3333-4333-8333-333333333333.${vence}.${firma}`, ahora), null);
  assert.equal(pedidoDelToken(`${PEDIDO}.${Number(vence) + DIA}.${firma}`, ahora), null);
  for (const basura of ["", null, "hola", `${PEDIDO}..`, "x.1.2"]) assert.equal(pedidoDelToken(basura, ahora), null);
});

test("las estrellas del mail abren el formulario con ese puntaje", () => {
  assert.match(enlaceResena(PEDIDO, 4), /^https:\/\/merlacoffee\.com\.ar\/\?resena=[^&]+&estrellas=4$/);
  assert.doesNotMatch(enlaceResena(PEDIDO, 0), /estrellas/);
});

test("lo que compró se resume sin repetir ni la presentación", () => {
  assert.equal(productosDelPedido(pedidoCobrado()), "Brasil Sertão y Volcánico");
  assert.equal(productosDelPedido({ items: [{ nombre: "Andino - Unidad" }] }), "Andino");
});

function redDeOpinion({ pedido = pedidoCobrado(), yaOpino = false, insertar } = {}) {
  return [
    [/GET .*pedidos\?id=eq\./, { json: pedido ? [pedido] : [] }],
    [/GET .*resenas\?select=id&pedido_id=eq\./, { json: yaOpino ? [{ id: "x" }] : [] }],
    [/POST .*\/resenas$/, insertar || { json: null }],
    [/POST .*brevo\.com/, { json: {} }],
  ];
}
const tokenValido = () => crearToken(PEDIDO);

test("el formulario abre con el nombre de pila y lo que compró", async () => {
  simularRed(redDeOpinion());
  const r = await opinar({ httpMethod: "GET", headers: {}, queryStringParameters: { t: tokenValido() } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body), { numero: 15, nombre: "Sofía", productos: "Brasil Sertão y Volcánico", yaEnviada: false });
});

test("un pedido cancelado o un link trucho no abren el formulario", async () => {
  simularRed(redDeOpinion({ pedido: pedidoCobrado({ estado: "cancelado" }) }));
  assert.equal((await opinar({ httpMethod: "GET", headers: {}, queryStringParameters: { t: tokenValido() } })).statusCode, 404);
  const llamadas = simularRed([]);
  assert.equal((await opinar({ httpMethod: "GET", headers: {}, queryStringParameters: { t: "inventado" } })).statusCode, 404);
  assert.equal(llamadas.length, 0); // ni consulta la base
});

const enviarOpinion = (cuerpo) => opinar({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify({ t: tokenValido(), ...cuerpo }) });

test("la opinión del cliente queda guardada como nueva y sin publicar, y se avisa al admin", async () => {
  const llamadas = simularRed(redDeOpinion());
  const r = await enviarOpinion({ estrellas: 5, texto: "  Riquísimo,   lo tomé en la oficina ", nombre: "Sofía" });
  assert.equal(r.statusCode, 201);
  const fila = llamadas.find((l) => l.metodo === "POST" && l.url.endsWith("/resenas")).body;
  assert.deepEqual(fila, {
    nombre: "Sofía", texto: "Riquísimo, lo tomé en la oficina", estrellas: 5, producto: "Brasil Sertão y Volcánico",
    pedido_id: PEDIDO, verificada: true, pendiente: true, activo: false,
  });
  const aviso = llamadas.find((l) => l.url.includes("brevo.com")).body;
  assert.equal(aviso.to[0].email, "admin@merla.test");
  assert.match(aviso.subject, /Nueva reseña de Sofía \(5\/5\)/);
});

test("una sola opinión por pedido", async () => {
  simularRed(redDeOpinion({ insertar: { status: 409, json: { code: "23505", message: "duplicate key value violates unique constraint" } } }));
  const r = await enviarOpinion({ estrellas: 4, texto: "Otra vez", nombre: "Sofía" });
  assert.equal(r.statusCode, 409);
  assert.match(JSON.parse(r.body).error, /Ya nos dejaste tu opinión/);
});

test("sin estrellas, sin texto o sin nombre no se guarda nada", async () => {
  for (const cuerpo of [{ texto: "Rico", nombre: "Ana" }, { estrellas: 9, texto: "Rico", nombre: "Ana" }, { estrellas: 5, texto: "", nombre: "Ana" }, { estrellas: 5, texto: "Rico", nombre: " " }]) {
    const llamadas = simularRed(redDeOpinion());
    assert.equal((await enviarOpinion(cuerpo)).statusCode, 400);
    assert.equal(llamadas.filter((l) => l.metodo === "POST").length, 0);
  }
});

test("se le pide la reseña una vez por cliente y nunca a un mayorista", () => {
  const p = (id, email, dias, origen = "mercadopago") => ({ id, cliente_email: email, origen, actualizado: new Date(Date.now() - dias * DIA).toISOString() });
  const elegidos = elegirPedidosParaResena(
    [p("a", "ana@test.com", 6), p("b", "ANA@test.com", 9), p("c", "bar@test.com", 7, "mayorista"), p("d", "beto@test.com", 8), p("e", "caro@test.com", 6)],
    new Set(["caro@test.com"]) // ya se le pidió hace poco
  );
  assert.deepEqual(elegidos.map((x) => x.id), ["b", "d"]); // de Ana, solo su pedido más viejo
});

test("el cron manda el mail con un link que funciona y no lo repite", async () => {
  const llamadas = simularRed([
    [/GET .*pedidos\?select=id,numero,origen,cliente_email,items,envio,actualizado&estado=eq\.aprobado/, { json: [
      { ...pedidoCobrado(), cliente_email: "sofia@test.com", origen: "mercadopago", actualizado: new Date(Date.now() - 6 * DIA).toISOString() },
    ] }],
    [/GET .*pedidos\?select=cliente_email&resena_pedida=gt\./, { json: [] }],
    [/POST .*brevo\.com/, { json: {} }],
    [/PATCH .*pedidos\?id=eq\./, { json: null }],
  ]);
  assert.equal(await pedirResenas(), 1);
  const consulta = decodeURIComponent(llamadas[0].url);
  assert.match(consulta, /resena_pedida=is\.null/); // nunca a quien ya se le pidió
  assert.match(consulta, /estado=eq\.aprobado/); // ni a pedidos cancelados o sin cobrar
  const mail = llamadas.find((l) => l.url.includes("brevo.com")).body;
  assert.equal(mail.to[0].email, "sofia@test.com");
  const token = decodeURIComponent(mail.htmlContent.match(/\?resena=([^&"]+)/)[1]);
  assert.equal(pedidoDelToken(token), PEDIDO);
  assert.ok(llamadas.some((l) => l.metodo === "PATCH" && l.body.resena_pedida));
});

test("aprobar o descartar una reseña nueva la saca de las nuevas", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const llamadas = simularRed([[/PATCH .*resenas\?id=eq\./, (l) => ({ json: [{ id, ...l.body }] })]]);
  await admin("PATCH", { id, activo: true });
  await admin("PATCH", { id, activo: false });
  assert.deepEqual(llamadas.map((l) => l.body), [{ activo: true, pendiente: false }, { activo: false, pendiente: false }]);
});

test("las palabras de un cliente no se editan desde el panel", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const llamadas = simularRed([[/PATCH .*resenas\?id=eq\./, { json: [] }]]);
  const r = await admin("POST", { id, nombre: "Ana", texto: "Cambiado" });
  assert.equal(r.statusCode, 404);
  assert.match(llamadas[0].url, /&verificada=is\.false$/);
});
