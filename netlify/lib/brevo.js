// Cliente mínimo de Brevo (mails transaccionales).
// Necesita BREVO_API_KEY. El remitente (MAIL_REMITENTE) tiene que estar
// verificado en Brevo → Senders. MAIL_ADMIN es la casilla que recibe los avisos.
// Sin API key no se rompe nada: los envíos se saltean y se loguea el motivo.

const API = "https://api.brevo.com/v3/smtp/email";

function config() {
  return {
    apiKey: process.env.BREVO_API_KEY,
    remitente: process.env.MAIL_REMITENTE || "merlacoffee@gmail.com",
    admin: process.env.MAIL_ADMIN || process.env.MAIL_REMITENTE || "merlacoffee@gmail.com",
  };
}

// Envía un mail. Devuelve true si salió, false si no había API key o falló.
// Nunca lanza: un mail que no sale no puede tumbar un pago ni un pedido.
async function enviarMail({ para, nombrePara, asunto, html }) {
  const { apiKey, remitente } = config();
  if (!apiKey) {
    console.warn("brevo: falta BREVO_API_KEY, no se envía el mail:", asunto);
    return false;
  }
  if (!para) return false;

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: remitente, name: "Merla Coffee" },
        to: [{ email: para, ...(nombrePara ? { name: nombrePara } : {}) }],
        subject: asunto,
        htmlContent: html,
      }),
    });
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
