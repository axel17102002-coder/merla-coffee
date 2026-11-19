// Sanitiza los datos de entrega que llegan del navegador antes de guardarlos.
// Devuelve { metodo:'retiro' } o { metodo:'envio', ... } con strings acotados,
// o null si el objeto es inválido. Nunca se confía en lo que manda el cliente.
//
// `opcionGrupo` identifica el grupo de la opción de envío elegida
// (transportista + servicio, a domicilio o a sucursal): el precio NUNCA sale
// de acá, se vuelve a cotizar en el servidor y se busca, dentro de ese mismo
// grupo, la más barata disponible (ver lib/envio-costo.js). `sucursal` solo
// aplica cuando la opción es a sucursal: es solo informativo (a qué punto va
// el paquete), no afecta el precio.

function sanitizarEnvio(envio) {
  if (!envio || typeof envio !== "object") return null;
  if (envio.metodo === "retiro") {
    const nombre = String(envio.nombre || "").trim().slice(0, 200);
    return nombre ? { metodo: "retiro", nombre } : { metodo: "retiro" };
  }
  if (envio.metodo !== "envio") return null;
  const s = (v, max = 200) => String(v || "").trim().slice(0, max);

  const esSucursal = envio.opcionTipo === "sucursal";
  const sucursal = esSucursal && envio.sucursal && typeof envio.sucursal === "object"
    ? {
        id: s(envio.sucursal.id, 60),
        descripcion: s(envio.sucursal.descripcion, 200),
        direccion: s(envio.sucursal.direccion, 200),
      }
    : null;

  return {
    metodo: "envio",
    nombre: s(envio.nombre),
    // La dirección solo aplica a domicilio; a sucursal el destino es el punto elegido.
    direccion: esSucursal ? "" : s(envio.direccion),
    ciudad: s(envio.ciudad),
    provincia: s(envio.provincia),
    cp: s(envio.cp),
    telefono: s(envio.telefono),
    notas: s(envio.notas),
    opcionGrupo: s(envio.opcionGrupo, 80),
    opcionTipo: esSucursal ? "sucursal" : "domicilio",
    transportista: s(envio.transportista, 60),
    sucursal,
  };
}

// Valida en el servidor que los datos de entrega estén completos para despachar.
// Devuelve null si está OK o un mensaje legible si falta algún dato.
function validarEnvio(envio) {
  if (!envio || envio.metodo !== "envio") return null;
  if (!envio.nombre) return "Ingresá tu nombre y apellido para el envío";
  if (!envio.ciudad || !envio.provincia || !envio.cp) {
    return "Ingresá tu ciudad, provincia y código postal";
  }
  if (!envio.telefono) return "Ingresá un teléfono de contacto";
  if (!envio.opcionGrupo) return "Elegí una opción de envío";
  if (envio.opcionTipo === "sucursal") {
    if (!envio.sucursal || !envio.sucursal.id) {
      return "Elegí la sucursal donde retirar el pedido";
    }
  } else if (!envio.direccion) {
    return "Ingresá la dirección de envío";
  }
  return null;
}

// Completa el objeto de envío con los datos autoritativos que resolvió el
// servidor (proveedor, transportista real, servicio, plazo y modalidad) para
// que queden guardados en Supabase y se vean bien en /admin y en los mails.
function enriquecerEnvio(envio, resultadoEnvio) {
  if (!envio || envio.metodo !== "envio" || !resultadoEnvio || !resultadoEnvio.opcion) {
    return envio;
  }
  const op = resultadoEnvio.opcion;
  const esSucursal = op.tipo === "sucursal";
  return {
    ...envio,
    proveedor: resultadoEnvio.proveedor || envio.proveedor || "",
    opcionTipo: esSucursal ? "sucursal" : "domicilio",
    transportista: op.transportista || envio.transportista || "",
    servicio: op.servicio || "",
    plazo: op.plazo || "",
    direccion: esSucursal ? "" : envio.direccion,
    sucursal: esSucursal ? envio.sucursal : null,
  };
}

module.exports = { sanitizarEnvio, validarEnvio, enriquecerEnvio };
