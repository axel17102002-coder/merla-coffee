// Reseña que deja un cliente desde el link del mail (ver backend/lib/resenas.js).
//
//   GET  ?t=<token>                              → { numero, nombre, productos, yaEnviada }
//   POST { t, estrellas, texto, nombre }         → la guarda como "nueva" (sin publicar)
//
// La reseña queda pendiente hasta que el admin la aprueba en /admin → Reseñas.

const { sb } = require("../lib/supabase.js");
const { pedidoDelToken, productosDelPedido } = require("../lib/resenas.js");
const { enviarMail, config } = require("../lib/brevo.js");
const { mailResenaNueva } = require("../lib/mails.js");
const { enviarTelegram, textoResena } = require("../lib/telegram.js");
const { permitir, claveDe } = require("../lib/limite.js");

const LINK_INVALIDO = "Este link para opinar no es válido o ya venció. Escribinos por WhatsApp y te mandamos uno nuevo.";

// El pedido del link, solo si sigue cobrado (uno cancelado no se reseña)
async function pedidoParaOpinar(token) {
  const id = pedidoDelToken(token);
  if (!id) return null;
  const [pedido] = await sb(`pedidos?id=eq.${id}&select=id,numero,estado,items,envio&limit=1`);
  return pedido && pedido.estado === "aprobado" ? pedido : null;
}

async function yaOpino(pedidoId) {
  const filas = await sb(`resenas?select=id&pedido_id=eq.${pedidoId}&limit=1`);
  return filas.length > 0;
}

const limpiar = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const responder = (statusCode, cuerpo) => ({ statusCode, headers, body: JSON.stringify(cuerpo) });

  try {
    if (event.httpMethod === "GET") {
      const pedido = await pedidoParaOpinar((event.queryStringParameters || {}).t);
      if (!pedido) return responder(404, { error: LINK_INVALIDO });
      return responder(200, {
        numero: pedido.numero,
        // Solo el nombre de pila: es lo que se publica
        nombre: String((pedido.envio && pedido.envio.nombre) || "").trim().split(/\s+/)[0] || "",
        productos: productosDelPedido(pedido),
        yaEnviada: await yaOpino(pedido.id),
      });
    }

    if (event.httpMethod === "POST") {
      const tope = permitir(claveDe("resena", event), { max: 10, ventanaMs: 10 * 60 * 1000 });
      if (!tope.ok) {
        return {
          statusCode: 429,
          headers: { ...headers, "Retry-After": String(tope.esperaSegundos) },
          body: JSON.stringify({ error: "Demasiados intentos. Probá de nuevo en unos minutos." }),
        };
      }

      const body = JSON.parse(event.body || "{}");
      const pedido = await pedidoParaOpinar(body.t);
      if (!pedido) return responder(404, { error: LINK_INVALIDO });

      const estrellas = Number.parseInt(body.estrellas, 10);
      if (!(estrellas >= 1 && estrellas <= 5)) return responder(400, { error: "Elegí de 1 a 5 estrellas" });
      const texto = limpiar(body.texto, 400);
      if (texto.length < 3) return responder(400, { error: "Contanos qué te pareció (aunque sea una frase)" });
      const nombre = limpiar(body.nombre, 60);
      if (!nombre) return responder(400, { error: "Poné tu nombre (alcanza con el de pila)" });

      const resena = {
        nombre,
        texto,
        estrellas,
        producto: productosDelPedido(pedido) || null,
        pedido_id: pedido.id,
        verificada: true,
        pendiente: true,
        activo: false, // se publica cuando el admin la aprueba
      };
      try {
        await sb("resenas", { method: "POST", body: resena });
      } catch (err) {
        // 23505 = ya hay una reseña de este pedido (índice único)
        if (/23505|duplicate key/.test(String(err.message))) {
          return responder(409, { error: "Ya nos dejaste tu opinión por este pedido. ¡Gracias!" });
        }
        throw err;
      }

      // Aviso al admin para que la revise (si falla, la reseña igual quedó guardada)
      const avisoTelegram = enviarTelegram(textoResena(resena)); // no lanza
      try {
        const mail = mailResenaNueva(resena);
        await enviarMail({ para: config().admin, asunto: mail.asunto, html: mail.html });
      } catch (err) {
        console.warn("resena: no pude avisar al admin:", err.message);
      }
      await avisoTelegram;
      return responder(201, { ok: true });
    }

    return responder(405, { error: "Método no permitido" });
  } catch (err) {
    console.error("resena:", err);
    return responder(502, { error: "No pudimos guardar tu opinión. Probá de nuevo en un rato." });
  }
};
