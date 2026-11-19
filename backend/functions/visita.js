// POST /api/visita  { ref, utm, params }
// La tienda avisa una vez por sesión que alguien entró (navigator.sendBeacon).
// Se suma al contador del día y al de su fuente (Instagram, Google, directo…).
// No se guarda nada de la persona: ni IP, ni cookies, solo los totales.
// Siempre responde 204: no hay nada que mostrarle al navegador.

const { sumarMetrica, fuenteDeVisita } = require("../lib/metricas.js");
const { permitir, claveDe } = require("../lib/limite.js");

// Robots que ejecutan JavaScript (y nuestras propias pruebas automáticas)
const ROBOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|python|curl|wget/i;

const nada = { statusCode: 204, headers: { "Cache-Control": "no-store" }, body: "" };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: {}, body: "" };
  try {
    const ua = String((event.headers || {})["user-agent"] || "");
    if (!ua || ROBOT.test(ua)) return nada;
    // Tope por IP (en memoria, no se guarda): una recarga compulsiva o un script no inflan las visitas
    if (!permitir(claveDe("visita", event), { max: 20, ventanaMs: 60 * 60 * 1000 }).ok) return nada;

    let datos = {};
    try { datos = JSON.parse(event.body || "{}"); } catch { datos = {}; }
    const fuente = fuenteDeVisita({
      ref: String(datos.ref || "").slice(0, 300),
      utm: String(datos.utm || "").slice(0, 60),
      params: String(datos.params || "").slice(0, 300),
    });
    await Promise.all([sumarMetrica("visitas"), sumarMetrica(`visitas:${fuente}`)]);
  } catch (err) {
    console.warn("visita:", err.message);
  }
  return nada;
};
