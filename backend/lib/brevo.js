// Cliente mínimo de Brevo (mails transaccionales).
// Necesita BREVO_API_KEY. El remitente tiene que estar habilitado en Brevo →
// Senders: MAIL_REMITENTE_DOMINIO (hola@merlacoffee.com.ar, con el dominio
// autenticado) o, mientras tanto, MAIL_REMITENTE (la casilla de Gmail).
// MAIL_ADMIN es la casilla que recibe los avisos y las respuestas de clientes.
// Sin API key no se rompe nada: los envíos se saltean y se loguea el motivo.

const API = "https://api.brevo.com/v3/smtp/email";

function config() {
  return {
    apiKey: process.env.BREVO_API_KEY,
    // Remitente: la casilla del dominio propio (MAIL_REMITENTE_DOMINIO, en
    // wrangler.toml) una vez que el dominio está autenticado en Brevo. Mientras
    // esté vacío se usa el de siempre (MAIL_REMITENTE, la casilla de Gmail).
    remitente: process.env.MAIL_REMITENTE_DOMINIO || process.env.MAIL_REMITENTE || "merlacoffee@gmail.com",
    // Si Brevo rechaza el remitente del dominio (por ejemplo, se desautenticó),
    // se reintenta con este: un mail de confirmación nunca deja de salir.
    respaldo: process.env.MAIL_REMITENTE || "merlacoffee@gmail.com",
    admin: process.env.MAIL_ADMIN || process.env.MAIL_REMITENTE || "merlacoffee@gmail.com",
  };
}

// Envía un mail. Devuelve true si salió, false si no había API key o falló.
// Nunca lanza: un mail que no sale no puede tumbar un pago ni un pedido.
// Las respuestas del cliente van a la casilla del admin (replyTo): así llegan
// aunque el remitente sea una dirección del dominio.
async function enviarMail({ para, nombrePara, asunto, html }) {
  const { apiKey, remitente, respaldo, admin } = config();
  if (!apiKey) {
    console.warn("brevo: falta BREVO_API_KEY, no se envía el mail:", asunto);
    return false;
  }
  if (!para) return false;

  const enviar = (desde) =>
    fetch(API, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: desde, name: "Merla Coffee" },
        replyTo: { email: admin, name: "Merla Coffee" },
        to: [{ email: para, ...(nombrePara ? { name: nombrePara } : {}) }],
        subject: asunto,
        htmlContent: html,
      }),
    });

  try {
    let res = await enviar(remitente);
    if (!res.ok && res.status === 400 && respaldo !== remitente) {
      const detalle = await res.text();
      if (!/sender/i.test(detalle)) {
        console.error("brevo: HTTP", res.status, detalle.slice(0, 300));
        return false;
      }
      console.warn("brevo: Brevo rechazó el remitente del dominio, uso el de respaldo:", detalle.slice(0, 200));
      res = await enviar(respaldo);
    }
    if (!res.ok) {
      console.error("brevo: HTTP", res.status, (await res.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error("brevo:", err.message);
    return false;
  }
}

module.exports = { enviarMail, config };
