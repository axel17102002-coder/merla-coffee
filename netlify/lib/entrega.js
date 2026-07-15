// Sanitiza los datos de entrega que llegan del navegador antes de guardarlos.
// Devuelve { metodo:'retiro' } o { metodo:'envio', ... } con strings acotados,
// o null si el objeto es inválido. Nunca se confía en lo que manda el cliente.

function sanitizarEnvio(envio) {
  if (!envio || typeof envio !== "object") return null;
  if (envio.metodo === "retiro") return { metodo: "retiro" };
  if (envio.metodo !== "envio") return null;
  const s = (v) => String(v || "").trim().slice(0, 200);
  return {
    metodo: "envio",
    nombre: s(envio.nombre),
    direccion: s(envio.direccion),
    ciudad: s(envio.ciudad),
    provincia: s(envio.provincia),
    cp: s(envio.cp),
    telefono: s(envio.telefono),
    notas: s(envio.notas),
  };
}

module.exports = { sanitizarEnvio };
