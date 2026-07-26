// Cliente mínimo de la API de Zipnova (cotización de envíos a domicilio y a
// sucursal). Docs: https://docs.zipnova.com/envios/recursos-api/envios/cotizar-envios
//
// Autenticación Basic (usuario = token, contraseña = secret): es el modo
// pensado para integrar UNA cuenta propia, sin el flujo OAuth con redirect
// que usan las apps multi-cuenta (marketplaces, plataformas de ecommerce).
//
// Sin ZIPNOVA_TOKEN/ZIPNOVA_SECRET/ZIPNOVA_ACCOUNT_ID no se rompe nada: el
// envío a domicilio queda deshabilitado (avisa con un mensaje claro) hasta
// que se carguen las credenciales, igual que Brevo con los mails.

function credenciales() {
  const token = process.env.ZIPNOVA_TOKEN;
  const secret = process.env.ZIPNOVA_SECRET;
  const accountId = process.env.ZIPNOVA_ACCOUNT_ID;
  if (!token || !secret || !accountId) return null;
  return { token, secret, accountId };
}

function disponible() {
  return credenciales() !== null;
}

// Caja genérica para pedidos de café/merch: liviano y chico, entra cualquier
// combinación de drip bags, bolsas de 1/4 y alguna taza. En centímetros.
const PAQUETE_CM = { height: 10, width: 20, length: 25 };

// Clasificación de producto de Zipnova (docs/envios/referencia/clasificaciones-de-producto):
// 1 = "General", la que corresponde a café envasado, tazas y mercadería sin
// categoría especial (no es colchón, sanitario, electro, vidrio, etc.).
const CLASIFICACION_GENERAL = 1;

// Cuánto esperamos la cotización antes de darla por perdida.
const ESPERA_MAX_MS = 12000;

// Solo mostramos transportistas conocidos: Zipnova conecta con muchos
// (Chazki, Toparco, Cabify Logistics, etc.) y elegir entre tantos abruma
// más de lo que ayuda. Comparación case-insensitive y por substring, para
// tolerar variantes de nombre ("Correo Argentino S.A.", etc.).
const TRANSPORTISTAS_PERMITIDOS = ["andreani", "correo argentino", "oca"];

function transportistaPermitido(nombre) {
  const n = (nombre || "").toLowerCase();
  return TRANSPORTISTAS_PERMITIDOS.some((t) => n.includes(t));
}

// Zipnova puede devolver el mismo carrier+servicio dos veces con precios
// distintos (tarifas/condiciones que no se diferencian en estos campos), así
// que "carrier+servicio" identifica un GRUPO, no una fila única. `clave`
// distingue cada fila dentro de ESTA cotización (para el selector del
// carrito); `grupo` es lo que se manda al checkout para volver a cotizar y
// elegir, de ese mismo grupo, la opción más barata disponible en ese momento
// (nunca cobramos de más si el pedido de nuevo trae precios distintos).
function grupoOpcion(o) {
  return `${o.carrier && o.carrier.id}:${o.service_type && o.service_type.code}`;
}

// Un resultado de Zipnova → la forma que usa el resto de la app. Las
// sucursales (service_type.code === "pickup_point") traen su propia lista de
// puntos cercanos al destino; a domicilio no tiene sucursales.
function normalizarOpcion(o, indice) {
  const esSucursal = o.service_type && o.service_type.code === "pickup_point";
  return {
    clave: `${grupoOpcion(o)}:${indice}`,
    grupo: grupoOpcion(o),
    tipo: esSucursal ? "sucursal" : "domicilio",
    transportista: (o.carrier && o.carrier.name) || "Transportista",
    precio: Math.round(o.amounts.price_incl_tax),
    sucursales: esSucursal
      ? (o.pickup_points || []).slice(0, 5).map((p) => ({
          id: p.point_id,
          descripcion: p.description || "",
          direccion: [p.location && p.location.street, p.location && p.location.street_number]
            .filter(Boolean).join(" "),
        }))
      : null,
  };
}

async function pedirCotizacion({ cred, cp, ciudad, provincia, pesoGramos, valorDeclarado }) {
  const auth = Buffer.from(`${cred.token}:${cred.secret}`).toString("base64");
  const cuerpo = {
    account_id: Number(cred.accountId),
    source: "merla-coffee-web",
    declared_value: Math.max(1, Math.round(Number(valorDeclarado) || 0)),
    destination: {
      zipcode: String(cp || "").trim(),
      city: String(ciudad || "").trim(),
      state: String(provincia || "").trim(),
    },
    packages: [{
      ...PAQUETE_CM,
      weight: Math.max(1, Math.round(Number(pesoGramos) || 0)),
      classification_id: CLASIFICACION_GENERAL,
    }],
    sort_by: "price",
  };

  // Cortamos nosotros a los 12 s: cuando la cotización de Zipnova se cuelga,
  // su gateway recién responde 500 (con cuerpo vacío) a los ~30 s, y el
  // cliente se queda mirando el spinner todo ese tiempo para nada.
  const corte = AbortSignal.timeout ? AbortSignal.timeout(ESPERA_MAX_MS) : undefined;
  let res;
  try {
    res = await fetch("https://api.zipnova.com.ar/v2/shipments/quote", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(cuerpo),
      signal: corte,
    });
  } catch (e) {
    const err = new Error("cotizacion_sin_respuesta");
    err.sinRespuesta = true;
    err.causa = e.name === "TimeoutError" ? `no respondió en ${ESPERA_MAX_MS / 1000}s` : e.message;
    throw err;
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const err = new Error("cotizacion_fallida");
    err.status = res.status;
    err.data = data;
    // 5xx = problema del lado de Zipnova, no de la dirección que cargó el cliente
    err.sinRespuesta = res.status >= 500;
    throw err;
  }
  return (data.all_results || data.results || []).filter((o) => o && o.selectable !== false && o.amounts);
}

// Todas las opciones de envío disponibles (a domicilio y a sucursal, de
// todos los transportistas), ordenadas de más barata a más cara.
// Devuelve { ok:true, opciones } o { ok:false, error } — nunca tira.
async function cotizarOpciones({ cp, ciudad, provincia, pesoGramos, valorDeclarado }) {
  const cred = credenciales();
  if (!cred) {
    return { ok: false, error: "El envío no está disponible en este momento. Probá con retiro o escribinos por WhatsApp." };
  }

  let crudas;
  try {
    crudas = await pedirCotizacion({ cred, cp, ciudad, provincia, pesoGramos, valorDeclarado });
  } catch (err) {
    console.error("zipnova: la cotización falló:", err.status || "", err.causa || JSON.stringify(err.data || err.message));
    // Distinguimos las dos causas: si el servicio no responde, mandar al
    // cliente a revisar su dirección lo hace perder el tiempo.
    return {
      ok: false,
      error: err.sinRespuesta
        ? "El cálculo de envío no está respondiendo. Probá de nuevo en unos minutos, o elegí retiro y coordinamos el envío por WhatsApp."
        : "No pudimos calcular el envío para esa dirección.",
    };
  }

  if (!crudas.length) {
    return { ok: false, error: "No hay opciones de envío disponibles para esa dirección." };
  }

  const opciones = crudas
    .map(normalizarOpcion)
    .filter((o) => transportistaPermitido(o.transportista))
    .sort((a, b) => a.precio - b.precio);
  if (!opciones.length) {
    return { ok: false, error: "No hay opciones de envío disponibles para esa dirección." };
  }
  return { ok: true, opciones };
}

// Vuelve a cotizar y busca, dentro del mismo grupo (carrier+servicio) que
// eligió el cliente, la opción más barata disponible en ese momento — nunca
// se confía en el precio que vio en el carrito. Si el grupo ya no está
// disponible, hay que elegir de nuevo.
async function precioDeOpcion({ grupo, cp, ciudad, provincia, pesoGramos, valorDeclarado }) {
  const resultado = await cotizarOpciones({ cp, ciudad, provincia, pesoGramos, valorDeclarado });
  if (!resultado.ok) return resultado;
  const opcion = resultado.opciones.find((o) => o.grupo === grupo); // ya vienen ordenadas de más barata a más cara
  if (!opcion) {
    return { ok: false, error: "Esa opción de envío ya no está disponible. Volvé a elegir en el carrito." };
  }
  return { ok: true, opcion };
}

module.exports = { disponible, cotizarOpciones, precioDeOpcion };
