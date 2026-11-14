// Tests de la dirección de la tienda y del envío de mails.
//
//   node --test
//
// Convención: cada test dice QUÉ regla protege, no cómo está escrita.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { urlCanonica } = require("../backend/lib/dominio.js");
const { enviarMail } = require("../backend/lib/brevo.js");

// Sin depender de la clase URL (el arnés sin Node no la tiene)
function url(texto) {
  const [, hostname, resto = "/"] = texto.match(/^https?:\/\/([^/?#]+)(.*)$/);
  const [pathname, search = ""] = resto.split(/(?=\?)/);
  return { hostname, pathname: pathname || "/", search };
}

// ===== Una sola dirección para Google =====

test("www y workers.dev mandan al dominio, conservando la página y los parámetros", () => {
  assert.equal(urlCanonica(url("https://www.merlacoffee.com.ar/"), "GET"), "https://merlacoffee.com.ar/");
  assert.equal(
    urlCanonica(url("https://merla-coffee.merlacoffee.workers.dev/?producto=andino"), "GET"),
    "https://merlacoffee.com.ar/?producto=andino"
  );
  assert.equal(urlCanonica(url("https://www.merlacoffee.com.ar/admin"), "HEAD"), "https://merlacoffee.com.ar/admin");
});

test("el dominio principal se sirve tal cual (sin redirigirse a sí mismo)", () => {
  assert.equal(urlCanonica(url("https://merlacoffee.com.ar/"), "GET"), null);
  assert.equal(urlCanonica(url("http://localhost:8788/"), "GET"), null);
});

test("la API nunca se redirige: un aviso de Mercado Pago a la dirección vieja tiene que llegar", () => {
  assert.equal(urlCanonica(url("https://merla-coffee.merlacoffee.workers.dev/api/mercadopago-webhook"), "POST"), null);
  assert.equal(urlCanonica(url("https://merla-coffee.merlacoffee.workers.dev/api/tienda"), "GET"), null);
  // y ningún POST, aunque no sea de la API (perdería el cuerpo)
  assert.equal(urlCanonica(url("https://www.merlacoffee.com.ar/"), "POST"), null);
});

// ===== Remitente de los mails =====

function simularBrevo(responder) {
  const enviados = [];
  globalThis.fetch = async (_url, opciones) => {
    const cuerpo = JSON.parse(opciones.body);
    enviados.push(cuerpo);
    const { status, texto } = responder(cuerpo);
    return { ok: status < 400, status, text: async () => texto || "", json: async () => ({}) };
  };
  return enviados;
}

function conVariables(variables, fn) {
  const antes = { ...process.env };
  Object.assign(process.env, { BREVO_API_KEY: "clave", MAIL_REMITENTE: "merlacoffee@gmail.com", MAIL_ADMIN: "merlacoffee@gmail.com" }, variables);
  return fn().finally(() => { process.env = antes; });
}

const mail = { para: "ana@test.com", asunto: "Tu pedido", html: "<p>hola</p>" };

test("sin el remitente del dominio configurado, los mails salen como siempre", () =>
  conVariables({ MAIL_REMITENTE_DOMINIO: "" }, async () => {
    const enviados = simularBrevo(() => ({ status: 201 }));
    assert.equal(await enviarMail(mail), true);
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].sender.email, "merlacoffee@gmail.com");
  }));

test("con el dominio configurado, salen desde el dominio y las respuestas van a la casilla del admin", () =>
  conVariables({ MAIL_REMITENTE_DOMINIO: "hola@merlacoffee.com.ar" }, async () => {
    const enviados = simularBrevo(() => ({ status: 201 }));
    assert.equal(await enviarMail(mail), true);
    assert.equal(enviados[0].sender.email, "hola@merlacoffee.com.ar");
    assert.equal(enviados[0].replyTo.email, "merlacoffee@gmail.com");
  }));

test("si Brevo rechaza el remitente del dominio, el mail sale igual desde el de respaldo", () =>
  conVariables({ MAIL_REMITENTE_DOMINIO: "hola@merlacoffee.com.ar" }, async () => {
    const enviados = simularBrevo((c) =>
      c.sender.email === "hola@merlacoffee.com.ar"
        ? { status: 400, texto: '{"code":"invalid_parameter","message":"Sender is invalid / inactive"}' }
        : { status: 201 }
    );
    assert.equal(await enviarMail(mail), true);
    assert.deepEqual(enviados.map((c) => c.sender.email), ["hola@merlacoffee.com.ar", "merlacoffee@gmail.com"]);
  }));

test("un error que no es del remitente no se reintenta (no duplica mails)", () =>
  conVariables({ MAIL_REMITENTE_DOMINIO: "hola@merlacoffee.com.ar" }, async () => {
    const enviados = simularBrevo(() => ({ status: 400, texto: '{"code":"invalid_parameter","message":"email is not valid in to"}' }));
    assert.equal(await enviarMail(mail), false);
    assert.equal(enviados.length, 1);
  }));
