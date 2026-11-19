// Métricas diarias para Insights (tabla `metricas_dia`, migracion-metricas.sql).
// Solo contadores del día: visitas por fuente y carritos vencidos/recuperados.
// "Best effort": si falla (o falta la migración) se loguea y nada más.

const { sbRpc } = require("./supabase.js");

async function sumarMetrica(clave, valor = 1) {
  try {
    await sbRpc("sumar_metrica", { p_clave: clave, p_valor: valor });
    return true;
  } catch (err) {
    console.warn("metricas: no pude sumar", clave, "(¿falta migracion-metricas.sql?):", err.message);
    return false;
  }
}

// De dónde viene una visita, a partir de la URL de entrada y el referrer.
// Fuentes: instagram, facebook, google (buscadores), whatsapp, mail, otros, directo.
const FUENTES = ["directo", "instagram", "facebook", "google", "whatsapp", "mail", "otros"];

function fuenteDeVisita({ ref = "", utm = "", params = "" } = {}) {
  const u = String(utm || "").toLowerCase();
  if (u) {
    if (/insta|^ig$/.test(u)) return "instagram";
    if (/face|^fb$|meta/.test(u)) return "facebook";
    if (/google|bing/.test(u)) return "google";
    if (/whats|^wa$/.test(u)) return "whatsapp";
    if (/mail|brevo|newsletter/.test(u)) return "mail";
    return "otros";
  }
  // Links de nuestros mails: retomar el carrito o dejar una reseña
  if (/(^|[?&])(retomar|resena)=/.test(String(params || ""))) return "mail";

  // Dominio del referrer (sin depender de URL, que no existe en todos lados)
  const m = String(ref || "").match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i);
  const host = m ? m[1].toLowerCase() : "";
  if (!host) return "directo";
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)(facebook\.com|fb\.com|messenger\.com)$/.test(host)) return "facebook";
  if (/(^|\.)google\.[a-z.]+$|(^|\.)(bing\.com|duckduckgo\.com|search\.yahoo\.com)$/.test(host)) return "google";
  if (/(^|\.)(whatsapp\.com|wa\.me)$/.test(host)) return "whatsapp";
  if (/mail\.|outlook\.|(^|\.)gmail\.com$/.test(host)) return "mail";
  if (/(^|\.)merlacoffee\.com\.ar$|workers\.dev$/.test(host)) return "directo";
  return "otros";
}

module.exports = { sumarMetrica, fuenteDeVisita, FUENTES };
