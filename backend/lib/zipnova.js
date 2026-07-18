// Cliente mínimo de la API de Zipnova (cotización de envíos a domicilio).
// Docs: https://docs.zipnova.com/envios/recursos-api/envios/cotizar-envios
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

// Cotiza un envío a domicilio con los datos ya calculados del pedido.
//   cp: código postal de destino
//   pesoGramos: peso total estimado del paquete
//   valorDeclarado: valor de la mercadería (el subtotal del pedido)
// Devuelve { ok:true, precio, servicio } o { ok:false, error } — nunca tira.
async function cotizar({ cp, pesoGramos, valorDeclarado }) {
  const cred = credenciales();
  if (!cred) {
    return { ok: false, error: "El envío a domicilio no está disponible en este momento. Probá con retiro o escribinos por WhatsApp." };
  }

  const auth = Buffer.from(`${cred.token}:${cred.secret}`).toString("base64");
  const cuerpo = {
    account_id: Number(cred.accountId),
    source: "merla-coffee-web",
    declared_value: Math.max(1, Math.round(Number(valorDeclarado) || 0)),
    destination: { zip_code: String(cp || "").trim() },
    items: [{ weight: Math.max(1, Math.round(Number(pesoGramos) || 0)), quantity: 1 }],
    sort_by: "price",
  };

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
    });
  } catch (err) {
    console.error("zipnova: error de red al cotizar:", err.message);
    return { ok: false, error: "No pudimos calcular el envío. Probá de nuevo en unos minutos." };
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    console.error("zipnova: la cotización falló:", res.status, JSON.stringify(data));
    return { ok: false, error: "No pudimos calcular el envío para ese código postal." };
  }

  const opciones = (data.all_results || data.results || []).filter((o) => o && o.selectable !== false && o.amounts);
  if (!opciones.length) {
    return { ok: false, error: "No hay opciones de envío disponibles para ese código postal." };
  }

  const mejor = opciones.reduce((min, o) =>
    o.amounts.price_incl_tax < min.amounts.price_incl_tax ? o : min
  );

  return {
    ok: true,
    precio: Math.round(mejor.amounts.price_incl_tax),
    servicio: (mejor.service_type && mejor.service_type.name) || null,
  };
}

module.exports = { disponible, cotizar };
