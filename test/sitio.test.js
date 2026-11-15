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

// ===== Ficha de producto para Google, Meta y las vistas previas de links =====

const { etiquetasVerificacion, fichaProducto, etiquetasProducto, reemplazosProducto } = require("../backend/lib/pagina.js");
const { itemXml, baseUrl } = require("../backend/functions/feed.js");

function cafe(extra = {}) {
  return {
    id: "andino", nombre: "Andino", tipo: "cafe", origen: "Colombia", stock: 30, activo: true,
    descripcion: "Cultivado entre 1500 y 2000 m de altitud.", notas: ["Caramelo"], imagen: "img/andino.webp",
    presentaciones: [
      { id: "andino-pack5", nombre: "Pack x5", precio: 10350, unidades_stock: 5, activo: true },
      { id: "andino-unidad", nombre: "Unidad", precio: 2300, unidades_stock: 1, activo: true },
    ],
    ...extra,
  };
}

test("la ficha de un producto lleva su nombre, su precio por unidad y su stock", () => {
  const f = fichaProducto(cafe());
  assert.equal(f.url, "https://merlacoffee.com.ar/?producto=andino");
  assert.equal(f.precio, 2300); // la unidad, no el pack
  assert.equal(f.hayStock, true);
  assert.match(f.titulo, /^Andino · Café de especialidad/);
  const html = etiquetasProducto(f);
  assert.match(html, /product:price:amount" content="2300\.00"/);
  assert.match(html, /product:availability" content="in stock"/);
  const ld = JSON.parse(html.match(/<script[^>]*>(.*)<\/script>/)[1]);
  assert.equal(ld.offers.price, 2300);
  assert.equal(ld.offers.priceCurrency, "ARS");
  assert.equal(ld.offers.availability, "https://schema.org/InStock");
});

test("la ficha y el feed dicen lo mismo: es lo que Google y Meta comparan", () => {
  const p = cafe();
  const f = fichaProducto(p);
  const xml = itemXml(p, "https://merlacoffee.com.ar");
  assert.ok(xml.includes(`<link>${f.url}</link>`));
  assert.ok(xml.includes(`<g:price>${f.precio.toFixed(2)} ARS</g:price>`));
  assert.ok(xml.includes(`<g:image_link>${f.imagen}</g:image_link>`));
  assert.ok(xml.includes("<g:availability>in stock</g:availability>"));
  assert.ok(xml.includes("<g:id>andino</g:id>")); // el mismo id que manda el Pixel
});

test("un producto agotado figura agotado en la ficha y en el feed", () => {
  const p = cafe({ stock: 0 });
  assert.equal(fichaProducto(p).hayStock, false);
  assert.match(etiquetasProducto(fichaProducto(p)), /OutOfStock/);
  assert.ok(itemXml(p, "https://merlacoffee.com.ar").includes("<g:availability>out of stock</g:availability>"));
});

test("las fotos sembradas van en JPG (Meta no toma WebP) y las subidas, tal cual", () => {
  assert.equal(fichaProducto(cafe()).imagen, "https://merlacoffee.com.ar/img/andino_web.jpg");
  const subida = "https://x.supabase.co/storage/v1/object/public/productos/foto.webp";
  assert.equal(fichaProducto(cafe({ imagen: subida })).imagen, subida);
});

test("un producto sin foto no va al feed (sería un error en el catálogo), pero tiene ficha", () => {
  const p = cafe({ imagen: null });
  assert.equal(itemXml(p, "https://merlacoffee.com.ar"), "");
  const f = fichaProducto(p);
  assert.equal(f.imagen, "");
  assert.equal(reemplazosProducto(f)["og:image"], undefined); // queda la del logo
});

test("un producto que no existe o no tiene nada para vender no tiene ficha", () => {
  assert.equal(fichaProducto(undefined), null);
  assert.equal(fichaProducto(cafe({ presentaciones: [] })), null);
});

test("un nombre con HTML no puede romper la página", () => {
  const html = etiquetasProducto(fichaProducto(cafe({ id: 'a"b', nombre: "Café </script><script>alert(1)</script>" })));
  assert.equal((html.match(/<script/g) || []).length, 1);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.ok(html.includes('content="a&quot;b"'));
});

test("el feed pedido por workers.dev o www igual apunta al dominio principal", () => {
  assert.equal(baseUrl({ headers: { host: "merla-coffee.merlacoffee.workers.dev" } }), "https://merlacoffee.com.ar");
  assert.equal(baseUrl({ headers: { host: "www.merlacoffee.com.ar" } }), "https://merlacoffee.com.ar");
  assert.equal(baseUrl({ headers: { host: "merlacoffee.com.ar" } }), "https://merlacoffee.com.ar");
});

test("las etiquetas de verificación solo salen con un código cargado y bien formado", () => {
  assert.equal(etiquetasVerificacion({}), "");
  assert.equal(etiquetasVerificacion({ GOOGLE_SITE_VERIFICATION: "", META_DOMAIN_VERIFICATION: "" }), "");
  const html = etiquetasVerificacion({ GOOGLE_SITE_VERIFICATION: "abcDEF123_-xyz", META_DOMAIN_VERIFICATION: "k3j4h5g6f7d8s9a0q1w2e3" });
  assert.match(html, /<meta name="google-site-verification" content="abcDEF123_-xyz">/);
  assert.match(html, /<meta name="facebook-domain-verification" content="k3j4h5g6f7d8s9a0q1w2e3">/);
  // algo que no parece un código (HTML pegado entero, por ejemplo) no se inyecta
  assert.equal(etiquetasVerificacion({ GOOGLE_SITE_VERIFICATION: '<meta name="x" content="y">' }), "");
});
