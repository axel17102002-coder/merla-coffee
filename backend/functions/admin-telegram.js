// Avisos por Telegram desde el panel (🔔 Avisos). Solo admin.
//
//   GET                            → { token, chat }  (¿está el secreto? ¿hay chat guardado?)
//   POST { accion: "conectar" }    → busca el último chat que le escribió al bot,
//                                    lo guarda y manda un mensaje de prueba
//   POST { accion: "probar" }      → manda un mensaje de prueba al chat guardado
//   POST { accion: "desconectar" } → borra el chat guardado (dejan de llegar avisos)

const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");
const telegram = require("../lib/telegram.js");

const PRUEBA = "✅ <b>Listo:</b> acá te van a llegar las ventas de Merla Coffee, los pedidos de WhatsApp y las reseñas nuevas.";

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const responder = (statusCode, datos) => ({ statusCode, headers, body: JSON.stringify(datos) });
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "GET") {
      let chat = false;
      try { chat = Boolean(await telegram.chatGuardado()); } catch { /* sin tabla o sin red: queda en false */ }
      return responder(200, { token: telegram.disponible(), chat });
    }
    if (event.httpMethod !== "POST") return responder(405, { error: "Método no permitido" });

    const { accion } = JSON.parse(event.body || "{}");
    if (accion === "desconectar") {
      await telegram.borrarChat();
      return responder(200, { ok: true });
    }
    if (!telegram.disponible()) {
      return responder(409, { error: "Falta cargar TELEGRAM_BOT_TOKEN como Secret en Cloudflare" });
    }

    if (accion === "conectar") {
      let chat;
      try {
        chat = await telegram.buscarChat();
      } catch (err) {
        return responder(502, { error: `Telegram no aceptó el token: ${err.message}` });
      }
      if (!chat) {
        return responder(404, { error: "El bot todavía no recibió ningún mensaje. Abrilo en Telegram, mandale «hola» y volvé a tocar Conectar." });
      }
      await telegram.guardarChat(chat.id);
      const enviado = await telegram.enviarTelegram(PRUEBA);
      return responder(200, { ok: true, nombre: chat.nombre, grupo: chat.tipo !== "private", enviado });
    }

    if (accion === "probar") {
      const enviado = await telegram.enviarTelegram(PRUEBA);
      if (!enviado) return responder(502, { error: "No se pudo mandar. Tocá Conectar de nuevo." });
      return responder(200, { ok: true });
    }

    return responder(400, { error: "Acción desconocida" });
  } catch (err) {
    console.error("admin-telegram:", err.message);
    return responder(500, { error: "No se pudo completar. Probá de nuevo." });
  }
};
