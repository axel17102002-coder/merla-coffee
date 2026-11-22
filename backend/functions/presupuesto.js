// El cliente acepta su presupuesto desde el link (/presupuesto/<token>).
//   POST { token, accion: "aceptar" }
// Se avisa al admin (mail no: notificación y Telegram, que son al instante).

const { sb } = require("../lib/supabase.js");
const { estadoPublico, numeroPresupuesto } = require("../lib/presupuestos.js");
const { enviarPush } = require("../lib/push.js");
const { enviarTelegram } = require("../lib/telegram.js");
const { permitir, claveDe } = require("../lib/limite.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const responder = (statusCode, datos) => ({ statusCode, headers, body: JSON.stringify(datos) });
  if (event.httpMethod !== "POST") return responder(405, { error: "Método no permitido" });
  if (!permitir(claveDe("presupuesto", event), { max: 10, ventanaMs: 10 * 60 * 1000 }).ok) {
    return responder(429, { error: "Demasiados intentos. Probá en unos minutos." });
  }
  try {
    const { token, accion } = JSON.parse(event.body || "{}");
    if (accion !== "aceptar" || !/^[A-Za-z0-9_-]{16,64}$/.test(String(token || ""))) return responder(400, { error: "Pedido inválido" });
    const [p] = await sb(`presupuestos?token=eq.${encodeURIComponent(token)}&select=*&limit=1`);
    if (!p) return responder(404, { error: "Este presupuesto no existe" });
    const estado = estadoPublico(p);
    if (estado === "aceptado") return responder(200, { ok: true });
    if (estado !== "abierto") return responder(409, { error: estado === "vencido" ? "Este presupuesto venció. Escribinos y te lo actualizamos." : "Este presupuesto ya está cerrado." });

    await sb(`presupuestos?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      body: { estado: "aceptado", aceptado_en: new Date().toISOString(), actualizado: new Date().toISOString() },
    });
    const total = "$ " + Number(p.total || 0).toLocaleString("es-AR");
    await Promise.all([
      enviarPush({ titulo: `✅ Aceptaron el presupuesto ${numeroPresupuesto(p.numero)} · ${total}`, cuerpo: `${p.cliente_nombre} lo aceptó desde el link. Escribile para coordinar.`, url: "/admin#presupuestos", etiqueta: `presupuesto-${p.id}` }),
      enviarTelegram(`✅ <b>Aceptaron el presupuesto ${numeroPresupuesto(p.numero)}</b> · ${total}\n${String(p.cliente_nombre).replace(/[&<>]/g, "")} lo aceptó desde el link.`),
    ]);
    return responder(200, { ok: true });
  } catch (err) {
    console.error("presupuesto:", err.message);
    return responder(500, { error: "No se pudo enviar. Probá de nuevo." });
  }
};
