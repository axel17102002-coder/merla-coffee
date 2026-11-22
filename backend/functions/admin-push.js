// Notificaciones del panel en este dispositivo (Ajustes → Avisos). Solo admin.
//
//   GET                                              → { publica, dispositivos }
//   POST { accion: "suscribir", suscripcion, dispositivo }
//   POST { accion: "desuscribir", endpoint }
//   POST { accion: "probar" }                        → manda un aviso de prueba a todos

const { sb } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");
const { clavesVapid, enviarPush } = require("../lib/push.js");

const FALTA = "Falta correr supabase/migracion-push-presupuestos.sql en Supabase";
const sinTabla = (err) => /PGRST205|push_|does not exist/.test(String(err && err.message));

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const responder = (statusCode, datos) => ({ statusCode, headers, body: JSON.stringify(datos) });
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "GET") {
      const [{ publica }, filas] = await Promise.all([clavesVapid(), sb("push_suscripciones?select=endpoint")]);
      return responder(200, { publica, dispositivos: filas.length, endpoints: filas.map((f) => f.endpoint) });
    }
    if (event.httpMethod !== "POST") return responder(405, { error: "Método no permitido" });

    const body = JSON.parse(event.body || "{}");
    if (body.accion === "suscribir") {
      const s = body.suscripcion || {};
      const keys = s.keys || {};
      if (!/^https:\/\//.test(String(s.endpoint || "")) || !keys.p256dh || !keys.auth) {
        return responder(400, { error: "Suscripción inválida" });
      }
      await sb("push_suscripciones", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: { endpoint: s.endpoint, p256dh: keys.p256dh, auth: keys.auth, dispositivo: String(body.dispositivo || "").slice(0, 80) || null },
      });
      return responder(200, { ok: true });
    }
    if (body.accion === "desuscribir") {
      if (body.endpoint) await sb(`push_suscripciones?endpoint=eq.${encodeURIComponent(body.endpoint)}`, { method: "DELETE" });
      return responder(200, { ok: true });
    }
    if (body.accion === "probar") {
      const recibidos = await enviarPush({ titulo: "✅ Notificaciones activadas", cuerpo: "Acá te van a llegar las ventas y los pedidos nuevos de Merla Coffee.", url: "/admin#inicio", etiqueta: "prueba" });
      return responder(200, { ok: true, recibidos });
    }
    return responder(400, { error: "Acción desconocida" });
  } catch (err) {
    if (sinTabla(err)) return responder(409, { error: FALTA, falta: "migracion-push-presupuestos.sql" });
    console.error("admin-push:", err.message);
    return responder(500, { error: "No se pudo completar. Probá de nuevo." });
  }
};
