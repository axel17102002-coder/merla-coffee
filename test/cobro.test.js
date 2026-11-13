// Tests del cobro — lo que pasa DESPUÉS de calcular el precio: el aviso de
// Mercado Pago, la conciliación del cron, el recordatorio de carrito abandonado
// y la cancelación de un pedido cobrado.
//
// No tocan la red: `simularRed` reemplaza `fetch` y responde como lo harían
// Supabase, Mercado Pago y Brevo. Se corren igual que los demás:
//
//   node --test
//
// Convención: cada test dice QUÉ regla protege, no cómo está escrita.

const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://base.test";
process.env.SUPABASE_SECRET_KEY = "clave-de-prueba";
process.env.MP_ACCESS_TOKEN = "token-de-prueba";
process.env.BREVO_API_KEY = "brevo-de-prueba";
process.env.MAIL_ADMIN = "admin@merla.test";
process.env.ADMIN_TOKEN = "token-admin-de-prueba";

const webhook = require("../backend/functions/mercadopago-webhook.js").handler;
const adminPedidos = require("../backend/functions/admin-pedidos.js").handler;
const {
  conciliarPagosMp,
  limpiarPedidosPendientes,
  elegirRecordatorios,
} = require("../backend/lib/mantenimiento.js");
const { enlaceRetomar, mailCarritoAbandonado } = require("../backend/lib/mails.js");

// Reemplaza `fetch`. `reglas` es una lista de [patrón, respuesta]: gana la
// primera cuyo patrón coincide con "MÉTODO url". La respuesta es { status, json }
// o una función que la devuelve. Una llamada que nadie previó hace fallar el test.
function simularRed(reglas) {
  const llamadas = [];
  globalThis.fetch = async (url, opciones = {}) => {
    const llamada = {
      metodo: opciones.method || "GET",
      url: String(url),
      body: opciones.body ? JSON.parse(opciones.body) : undefined,
    };
    llamadas.push(llamada);
    for (const [patron, respuesta] of reglas) {
      if (!patron.test(`${llamada.metodo} ${llamada.url}`)) continue;
      const { status = 200, json = null } = (typeof respuesta === "function" ? respuesta(llamada) : respuesta) || {};
      return {
        ok: status < 400,
        status,
        json: async () => json,
        text: async () => (json === null ? "" : JSON.stringify(json)),
      };
    }
    throw new Error(`llamada no prevista: ${llamada.metodo} ${llamada.url}`);
  };
  return llamadas;
}

const cuantas = (llamadas, patron) => llamadas.filter((l) => patron.test(`${l.metodo} ${l.url}`)).length;
const mails = (llamadas) => llamadas.filter((l) => l.url.includes("brevo.com")).map((l) => l.body);

// Un pedido como lo devuelve Supabase
function pedido(extra = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    numero: 12,
    origen: "mercadopago",
    estado: "pendiente",
    modo_id: "merla-ref-1",
    cliente_email: "ana@test.com",
    items: [{ presentacion_id: "andino-unidad", nombre: "Andino - Unidad", qty: 2, unidades: 2, precio_unitario: 2000 }],
    subtotal: 4000,
    total: 4000,
    puntos_ganados: 40,
    creado: new Date().toISOString(),
    ...extra,
  };
}

const avisoMp = (id) => ({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify({ type: "payment", data: { id } }) });
const pagoMp = (extra = {}) => ({ id: 555, status: "approved", external_reference: "merla-ref-1", transaction_amount: 4000, payment_type_id: "debit_card", payer: { email: "ana@test.com" }, ...extra });

// Reglas comunes a un pago que se acredita bien
function redDeAcreditacion({ pago = pagoMp(), previo = pedido(), rpc = { ok: true, puntos: 40 } } = {}) {
  return [
    [/GET .*mercadopago\.com\/v1\/payments\/\d+$/, { json: pago }],
    [/GET .*pedidos\?modo_id=.*select=id,numero,estado,mp_pago_id/, { json: previo ? [previo] : [] }],
    [/PATCH .*pedidos\?modo_id=/, { json: null }],
    [/POST .*rpc\/aprobar_pedido/, { json: rpc }],
    [/GET .*pedidos\?modo_id=.*select=\*/, { json: [pedido({ estado: "aprobado" })] }],
    [/GET .*clientes\?/, { json: [{ puntos: 40 }] }],
    [/PATCH .*pedidos\?id=/, { json: null }],
    [/POST .*brevo\.com/, { json: {} }],
  ];
}

// ===== Aviso de Mercado Pago (webhook) =====

test("un pago aprobado aprueba el pedido y avisa al admin y al cliente", async () => {
  const llamadas = simularRed(redDeAcreditacion());
  const r = await webhook(avisoMp(555));
  assert.equal(r.statusCode, 200);
  assert.equal(cuantas(llamadas, /rpc\/aprobar_pedido/), 1);
  assert.equal(mails(llamadas).length, 2);
});

test("el mismo aviso repetido no vuelve a avisar (MP manda cada aviso varias veces)", async () => {
  const ya = pedido({ estado: "aprobado", mp_pago_id: "555" });
  const llamadas = simularRed(redDeAcreditacion({ previo: ya, rpc: { ok: true, ya_procesado: true, estado: "aprobado" } }));
  const r = await webhook(avisoMp(555));
  assert.equal(r.statusCode, 200);
  assert.equal(mails(llamadas).length, 0);
});

test("si falla la base, el webhook NO da el aviso por recibido: MP tiene que reintentar", async () => {
  simularRed([
    [/GET .*mercadopago\.com\/v1\/payments/, { json: pagoMp() }],
    [/GET .*pedidos\?modo_id=/, { json: [pedido()] }],
    [/PATCH .*pedidos\?modo_id=/, { json: null }],
    [/POST .*rpc\/aprobar_pedido/, { status: 503, json: { message: "caída" } }],
  ]);
  const r = await webhook(avisoMp(555));
  assert.equal(r.statusCode, 500);
});

test("si Mercado Pago no responde, tampoco se da por recibido", async () => {
  simularRed([[/GET .*mercadopago\.com/, { status: 502, json: {} }]]);
  assert.equal((await webhook(avisoMp(555))).statusCode, 500);
});

test("un id de pago que MP no conoce se responde 200: reintentar no lo arregla", async () => {
  const llamadas = simularRed([[/GET .*mercadopago\.com/, { status: 404, json: { message: "not found" } }]]);
  assert.equal((await webhook(avisoMp(123456))).statusCode, 200);
  assert.equal(llamadas.length, 1); // no tocó la base
});

test("un pago rechazado o pendiente no toca el pedido", async () => {
  const llamadas = simularRed([[/GET .*mercadopago\.com/, { json: pagoMp({ status: "rejected" }) }]]);
  assert.equal((await webhook(avisoMp(555))).statusCode, 200);
  assert.equal(cuantas(llamadas, /rpc\//), 0);
});

test("un pago aprobado cuyo pedido ya no existe le avisa al admin (la plata entró)", async () => {
  const llamadas = simularRed(redDeAcreditacion({
    pago: pagoMp({ id: 777 }), previo: null, rpc: { ok: false, error: "Pedido no encontrado" },
  }));
  assert.equal((await webhook(avisoMp(777))).statusCode, 200);
  const enviados = mails(llamadas);
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].subject, /Pago sin pedido/);
  assert.equal(enviados[0].to[0].email, "admin@merla.test");
});

test("un segundo pago sobre un pedido ya cobrado no lo aprueba de nuevo y avisa", async () => {
  const cobrado = pedido({ estado: "aprobado", mp_pago_id: "555" });
  const llamadas = simularRed(redDeAcreditacion({ pago: pagoMp({ id: 888 }), previo: cobrado }));
  assert.equal((await webhook(avisoMp(888))).statusCode, 200);
  assert.equal(cuantas(llamadas, /rpc\//), 0);
  assert.equal(cuantas(llamadas, /PATCH/), 0); // no pisa el id del pago original
  assert.match(mails(llamadas)[0].subject, /Pago duplicado del pedido #0012/);
});

// ===== Conciliación del cron =====

const ID_PAGADO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_SIN_PAGO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID_EN_REVISION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ID_MP_CAIDO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function redDeConciliacion() {
  return [
    [/GET .*pedidos\?select=id,numero,modo_id&estado=eq\.pendiente&origen=eq\.mercadopago/, { json: [
      { id: ID_PAGADO, numero: 1, modo_id: "ref-pagado" },
      { id: ID_SIN_PAGO, numero: 2, modo_id: "ref-sin-pago" },
      { id: ID_EN_REVISION, numero: 3, modo_id: "ref-revision" },
      { id: ID_MP_CAIDO, numero: 4, modo_id: "ref-caido" },
    ] }],
    [/GET .*payments\/search\?external_reference=ref-pagado/, { json: { results: [
      pagoMp({ id: 1, status: "rejected", external_reference: "ref-pagado" }),
      pagoMp({ id: 2, status: "approved", external_reference: "ref-pagado" }),
    ] } }],
    // MP devuelve además un pago ajeno: no puede servir para aprobar nada
    [/GET .*payments\/search\?external_reference=ref-sin-pago/, { json: { results: [pagoMp({ id: 9, external_reference: "otra-cosa" })] } }],
    [/GET .*payments\/search\?external_reference=ref-revision/, { json: { results: [pagoMp({ id: 3, status: "in_process", external_reference: "ref-revision" })] } }],
    [/GET .*payments\/search\?external_reference=ref-caido/, { status: 500, json: {} }],
    ...redDeAcreditacion({ previo: pedido({ id: ID_PAGADO, modo_id: "ref-pagado" }) }).slice(1),
    [/DELETE /, { json: [{ id: "x" }] }],
  ];
}

test("un pedido pendiente que en MP figura pagado se aprueba en vez de darse por abandonado", async () => {
  const llamadas = simularRed(redDeConciliacion());
  const c = await conciliarPagosMp();
  assert.equal(c.aprobados, 1);
  assert.equal(cuantas(llamadas, /rpc\/aprobar_pedido/), 1);
  assert.equal(llamadas.find((l) => /rpc\/aprobar_pedido/.test(l.url)).body.p_modo_id, "ref-pagado");
});

test("solo se da por abandonado el pedido que MP confirmó sin pago", async () => {
  simularRed(redDeConciliacion());
  const c = await conciliarPagosMp();
  // ni el pagado, ni el que está en revisión, ni el que no se pudo consultar
  assert.deepEqual([...c.sinPago], [ID_SIN_PAGO]);
});

test("la limpieza nunca borra un pedido de Mercado Pago sin haber confirmado que no se pagó", async () => {
  const llamadas = simularRed(redDeConciliacion());
  const c = await conciliarPagosMp();
  await limpiarPedidosPendientes(c);
  const borrados = llamadas.filter((l) => l.metodo === "DELETE").map((l) => decodeURIComponent(l.url));
  assert.equal(borrados.length, 2);
  for (const url of borrados) assert.match(url, /estado=eq\.pendiente&creado=lt\./);
  // uno borra lo que no es de Mercado Pago (ni cargado a mano)…
  assert.match(borrados[0], /origen=not\.in\.\(mayorista,directa,mercadopago\)/);
  // …y el otro, de Mercado Pago, solo el id confirmado sin pago
  assert.match(borrados[1], new RegExp(`origen=eq\\.mercadopago&id=in\\.\\(${ID_SIN_PAGO}\\)$`));
});

test("si la conciliación no pudo confirmar ninguno, no se borra ningún pedido de Mercado Pago", async () => {
  const llamadas = simularRed([[/DELETE /, { json: [] }]]);
  await limpiarPedidosPendientes({ aprobados: 0, sinPago: new Set() });
  const borrados = llamadas.filter((l) => l.metodo === "DELETE");
  assert.equal(borrados.length, 1);
  assert.match(decodeURIComponent(borrados[0].url), /origen=not\.in\.\(mayorista,directa,mercadopago\)/);
});

test("los pedidos cargados a mano nunca se borran por viejos", async () => {
  const llamadas = simularRed([[/DELETE /, { json: [] }]]);
  await limpiarPedidosPendientes(null); // sin Mercado Pago configurado
  assert.match(decodeURIComponent(llamadas[0].url), /origen=not\.in\.\(mayorista,directa\)/);
});

// ===== Recordatorio de carrito abandonado =====

const AHORA = Date.parse("2026-11-13T15:00:00Z");
const hace = (horas) => new Date(AHORA - horas * 3600 * 1000).toISOString();
const sinPago = (...ids) => ({ aprobados: 0, sinPago: new Set(ids) });
const elegidos = (pedidos, conciliacion) => elegirRecordatorios(pedidos, conciliacion, AHORA).map((p) => p.id);

test("a un carrito de Mercado Pago se le recuerda a las 2 horas, no antes", () => {
  const reciente = pedido({ id: "a", creado: hace(1) });
  const maduro = pedido({ id: "b", cliente_email: "beto@test.com", creado: hace(3) });
  assert.deepEqual(elegidos([reciente, maduro], sinPago("a", "b")), ["b"]);
});

test("a un pedido de WhatsApp se le recuerda recién a las 24 horas", () => {
  const p = (id, email, horas) => pedido({ id, origen: "whatsapp", cliente_email: email, creado: hace(horas) });
  assert.deepEqual(elegidos([p("a", "a@test.com", 5), p("b", "b@test.com", 25)], sinPago()), ["b"]);
});

test("no se le recuerda a quien pagó: sin confirmación de MP no sale el mail", () => {
  const p = pedido({ id: "a", creado: hace(3) });
  assert.deepEqual(elegidos([p], sinPago()), []);
  assert.deepEqual(elegidos([p], sinPago("a")), ["a"]);
});

test("si después de abandonar terminó comprando, no se lo molesta", () => {
  const abandonado = pedido({ id: "a", creado: hace(5) });
  const comprado = pedido({ id: "b", estado: "aprobado", creado: hace(4) });
  assert.deepEqual(elegidos([abandonado, comprado], sinPago("a")), []);
});

test("si está reintentando ahora mismo, no se le recuerda el intento anterior", () => {
  const anterior = pedido({ id: "a", creado: hace(3) });
  const enCurso = pedido({ id: "b", creado: hace(0.2) });
  assert.deepEqual(elegidos([anterior, enCurso], sinPago("a", "b")), []);
});

test("un solo recordatorio por persona, aunque haya dejado varios pedidos", () => {
  const avisado = pedido({ id: "a", creado: hace(30), recordatorio_enviado: hace(28) });
  const otro = pedido({ id: "b", creado: hace(3) });
  assert.deepEqual(elegidos([avisado, otro], sinPago("a", "b")), []);
  // sin aviso previo, sale uno solo: el del pedido más nuevo
  const viejo = pedido({ id: "c", creado: hace(30) });
  assert.deepEqual(elegidos([viejo, otro], sinPago("b", "c")), ["b"]);
});

test("los pedidos cargados a mano no reciben recordatorio", () => {
  const manual = pedido({ id: "a", origen: "mayorista", creado: hace(30) });
  assert.deepEqual(elegidos([manual], sinPago("a")), []);
});

test("el botón del mail lleva el carrito armado y funciona sin el pedido", () => {
  const p = pedido({ items: [
    { presentacion_id: "andino-unidad", qty: 2 },
    { presentacion_id: "peru-pack5", qty: 1 },
  ] });
  assert.equal(enlaceRetomar(p), "https://merlacoffee.com.ar/?retomar=andino-unidad%3A2%2Cperu-pack5%3A1");
  assert.match(enlaceRetomar(p, "VOLVE10"), /&cupon=VOLVE10$/);
  // un pedido sin presentaciones reconocibles cae en la tienda, no en un link roto
  assert.equal(enlaceRetomar(pedido({ items: [{ nombre: "viejo", qty: 1 }] })), "https://merlacoffee.com.ar/#cafes");
});

test("el mail ofrece el cupón de regalo solo cuando hay uno, y conserva el que ya tenía", () => {
  const sinRegalo = mailCarritoAbandonado(pedido({ cupon: "CAFETERO" })).html;
  assert.match(sinRegalo, /Retomar mi pedido/);
  assert.match(sinRegalo, /cupon=CAFETERO/);
  assert.doesNotMatch(sinRegalo, /te dejamos/);

  const conRegalo = mailCarritoAbandonado(pedido(), { codigo: "VOLVE10", tipo: "porcentaje", valor: 10 }).html;
  assert.match(conRegalo, /10% OFF/);
  assert.match(conRegalo, /cupon=VOLVE10/);
});

// ===== Pedido cargado a mano (/admin → + Nuevo pedido) =====

function redDePedidoManual() {
  return [
    [/GET .*productos\?/, { json: [{ id: "sertao", nombre: "Brasil Sertão", stock: 166, activo: true, tipo: "cafe", costo_kg: 45320 }] }],
    [/GET .*presentaciones\?/, { json: [{ id: "sertao-unidad", producto_id: "sertao", nombre: "Unidad", precio: 2050, unidades_stock: 1, activo: true }] }],
    [/GET .*(insumos|configuracion)\?/, { json: [] }],
    [/POST .*\/pedidos$/, (llamada) => ({ json: [{ id: "11111111-1111-4111-8111-111111111111", numero: 11, ...llamada.body }] })],
  ];
}
const cargarPedido = (items) =>
  adminPedidos({ httpMethod: "POST", headers: { "x-admin-token": "token-admin-de-prueba" }, queryStringParameters: {}, body: JSON.stringify({ accion: "crear", origen: "mayorista", metodo: "retiro", items }) });

test("un pedido mayorista acepta un precio con centavos y guarda el total en pesos", async () => {
  const llamadas = simularRed(redDePedidoManual());
  const r = await cargarPedido([{ presentacion: "sertao-unidad", qty: 83, precio: 1166.67 }]);
  assert.equal(r.statusCode, 201);
  assert.equal(JSON.parse(r.body).total, 96834);
  const fila = llamadas.find((l) => l.metodo === "POST").body;
  assert.equal(fila.items[0].precio_unitario, 1166.67); // el precio acordado no se pierde
  assert.equal(fila.subtotal, 96834);
  for (const campo of ["subtotal", "total", "descuento_cantidad", "descuento_cupon"]) {
    assert.ok(Number.isInteger(fila[campo]), `${campo} va a una columna entera`);
  }
});

test("un pedido manual con precio cero, negativo o que no es un número se rechaza", async () => {
  for (const precio of [0, -5, "abc", null]) {
    const llamadas = simularRed(redDePedidoManual());
    const r = await cargarPedido([{ presentacion: "sertao-unidad", qty: 1, precio }]);
    assert.equal(r.statusCode, 400);
    assert.equal(cuantas(llamadas, /POST/), 0);
  }
});

test("un pedido manual no puede llevar más unidades que el stock", async () => {
  simularRed(redDePedidoManual());
  const r = await cargarPedido([{ presentacion: "sertao-unidad", qty: 167, precio: 1170 }]);
  assert.equal(r.statusCode, 409);
  assert.match(JSON.parse(r.body).error, /hay 166 y pediste 167/);
});

// ===== Cancelar un pedido cobrado (/admin) =====

const ID_PEDIDO = "11111111-1111-4111-8111-111111111111";
const pedirCancelar = (cuerpo, token = "token-admin-de-prueba") =>
  adminPedidos({ httpMethod: "POST", headers: { "x-admin-token": token }, queryStringParameters: {}, body: JSON.stringify({ accion: "cancelar", ...cuerpo }) });

test("cancelar devuelve el stock salvo que se pida lo contrario", async () => {
  const llamadas = simularRed([[/POST .*rpc\/cancelar_pedido/, { json: { ok: true, puntos: 0 } }]]);
  assert.equal((await pedirCancelar({ id: ID_PEDIDO })).statusCode, 200);
  assert.equal((await pedirCancelar({ id: ID_PEDIDO, devolverStock: false })).statusCode, 200);
  assert.deepEqual(llamadas.map((l) => l.body.p_devolver_stock), [true, false]);
});

test("cancelar exige ser admin", async () => {
  const llamadas = simularRed([]);
  assert.equal((await pedirCancelar({ id: ID_PEDIDO }, "otro-token-cualquiera!")).statusCode, 401);
  assert.equal(llamadas.length, 0);
});

test("si falta la migración, cancelar dice cuál correr en vez de fallar mudo", async () => {
  simularRed([[/POST .*rpc\/cancelar_pedido/, { status: 404, json: { code: "PGRST202", message: "Could not find the function" } }]]);
  const r = await pedirCancelar({ id: ID_PEDIDO });
  assert.equal(r.statusCode, 409);
  assert.match(JSON.parse(r.body).error, /migracion-cancelar-pedido\.sql/);
});

test("lo que la base rechaza (un pedido sin cobrar) llega como error claro", async () => {
  simularRed([[/POST .*rpc\/cancelar_pedido/, { json: { ok: false, error: "Solo se puede cancelar un pedido cobrado" } }]]);
  const r = await pedirCancelar({ id: ID_PEDIDO });
  assert.equal(r.statusCode, 409);
  assert.match(JSON.parse(r.body).error, /pedido cobrado/);
});
