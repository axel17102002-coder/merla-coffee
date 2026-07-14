const crypto = require("crypto");

// La pantalla /admin.html nunca recibe esta clave: el administrador la ingresa
// y cada llamada la envía en un header. Sin ADMIN_TOKEN no hay administración.
function esAdmin(event) {
  const esperado = process.env.ADMIN_TOKEN;
  const recibido = event.headers["x-admin-token"] || event.headers["X-Admin-Token"] || "";
  if (!esperado || !recibido || esperado.length !== recibido.length) return false;
  return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recibido));
}

function respuestaNoAutorizado() {
  return {
    statusCode: 401,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: "Acceso de administración no autorizado" }),
  };
}

module.exports = { esAdmin, respuestaNoAutorizado };
