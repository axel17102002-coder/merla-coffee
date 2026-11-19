// Plantillas de los mails de Merla Coffee (HTML inline: los clientes de correo
// no cargan hojas de estilo externas).

const { CONFIG, METODOS_PAGO_MANUAL, numeroPedido, urlTracking } = require("../../public/motor.js");

const VERDE = "#2f4a36";
const CREMA = "#f2ead8";
const CARAMELO = "#b07a42";
const GRIS = "#66705f";
const SITIO = "https://merlacoffee.com.ar";
const WHATSAPP = "5492216803376"; // mismo número que public/app.js

const pesos = (n) =>
  "$ " + Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });

function filasItems(items) {
  return (items || [])
    .map(
      (i) => `<tr>
        <td style="padding:6px 0;color:#22301f;">${i.qty}× ${escapar(i.nombre)}</td>
        <td style="padding:6px 0;text-align:right;color:#22301f;">${pesos(i.precio_unitario * i.qty)}</td>
      </tr>`
    )
    .join("");
}

function escapar(v) {
  return String(v || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

const nombreCliente = (pedido) => String((pedido.envio && pedido.envio.nombre) || "").trim();

function bloqueEntrega(envio) {
  if (!envio || !envio.metodo) return "";
  if (envio.metodo === "retiro") {
    return `<p style="margin:14px 0 0;color:${GRIS};">🏪 <strong style="color:${VERDE};">Retiro sin cargo en La Plata</strong> (zona centro) — cuando esté listo te escribimos para coordinar día y horario.</p>`;
  }
  const correo = [envio.transportista, envio.servicio].filter(Boolean).map(escapar).join(" · ");
  const detalleCorreo = [correo, envio.plazo && escapar(envio.plazo)].filter(Boolean).join(" — ");

  if (envio.opcionTipo === "sucursal") {
    const suc = envio.sucursal || {};
    const punto = [suc.descripcion, suc.direccion].filter(Boolean).map(escapar).join(" — ");
    const loc = [envio.ciudad, envio.provincia, envio.cp && `CP ${envio.cp}`].filter(Boolean).map(escapar).join(", ");
    return `<p style="margin:14px 0 0;color:${GRIS};">🏤 <strong style="color:${VERDE};">Envío a sucursal${correo ? ` (${correo})` : ""}</strong>${envio.plazo ? ` · ${escapar(envio.plazo)}` : ""}<br>
      ${punto ? `<strong>${punto}</strong><br>` : ""}${loc ? `${loc}<br>` : ""}Retira: ${escapar(envio.nombre)}${envio.telefono ? `<br>Tel: ${escapar(envio.telefono)}` : ""}${envio.notas ? `<br>${escapar(envio.notas)}` : ""}</p>`;
  }

  const esLocal = envio.proveedor === "local" || envio.opcionGrupo === "local:laplata";
  const iconoTitulo = esLocal ? "🛵" : "📦";
  const titulo = esLocal ? "Envío en La Plata" : "Envío a domicilio";
  const dir = [envio.direccion, envio.ciudad, envio.provincia, envio.cp && `CP ${envio.cp}`]
    .filter(Boolean).map(escapar).join(", ");
  return `<p style="margin:14px 0 0;color:${GRIS};">${iconoTitulo} <strong style="color:${VERDE};">${titulo}${detalleCorreo && !esLocal ? ` (${detalleCorreo})` : esLocal && envio.plazo ? ` (${escapar(envio.plazo)})` : ""}</strong><br>
    ${escapar(envio.nombre)}${dir ? ` — ${dir}` : ""}${envio.telefono ? `<br>Tel: ${escapar(envio.telefono)}` : ""}${envio.notas ? `<br>${escapar(envio.notas)}` : ""}</p>`;
}

// Documento completo: el <meta charset> es imprescindible para que los acentos
// y emojis lleguen bien, y `color-scheme` le pide a Apple Mail que no oscurezca el
// mail en modo oscuro. Maquetado con tablas porque es lo que respetan todos los
// clientes de correo. `titulo` tiene que venir ya escapado.
function envoltorio(titulo, cuerpo) {
  return `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<style>:root { color-scheme: light only; }</style>
<title>${titulo}</title>
</head>
<body style="margin:0;padding:0;background:${CREMA};font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREMA};">
    <tr><td align="center" style="padding:28px 16px;">
      <a href="${SITIO}"><img src="${SITIO}/img/logo_green.png" width="140" height="56" alt="Merla Coffee" style="display:block;border:0;margin:0 auto 20px;"></a>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdf8;border:1px solid #ded2b5;border-radius:16px;">
        <tr><td style="padding:28px;text-align:left;">
          <h1 style="margin:0 0 16px;color:${VERDE};font-size:24px;line-height:1.25;">${titulo}</h1>
          ${cuerpo}
        </td></tr>
      </table>
      <p style="max-width:520px;margin:16px auto 0;color:${GRIS};font-size:12px;line-height:1.5;">
        Merla Coffee · Café de especialidad en drip bags · La Plata, Argentina<br>
        <a href="${SITIO}" style="color:${VERDE};">Visitá la tienda</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function resumen(pedido) {
  const desc = [];
  if (pedido.descuento_cantidad) desc.push(`<tr><td style="padding:4px 0;color:${CARAMELO};">Descuento por cantidad</td><td style="padding:4px 0;text-align:right;color:${CARAMELO};">-${pesos(pedido.descuento_cantidad)}</td></tr>`);
  if (pedido.descuento_cupon) desc.push(`<tr><td style="padding:4px 0;color:${CARAMELO};">Cupón ${escapar(pedido.cupon)}</td><td style="padding:4px 0;text-align:right;color:${CARAMELO};">-${pesos(pedido.descuento_cupon)}</td></tr>`);
  if (pedido.descuento_pago) desc.push(`<tr><td style="padding:4px 0;color:${CARAMELO};">Descuento por transferencia</td><td style="padding:4px 0;text-align:right;color:${CARAMELO};">-${pesos(pedido.descuento_pago)}</td></tr>`);
  if (pedido.descuento_puntos) desc.push(`<tr><td style="padding:4px 0;color:${CARAMELO};">Canje de puntos</td><td style="padding:4px 0;text-align:right;color:${CARAMELO};">-${pesos(pedido.descuento_puntos)}</td></tr>`);
  if (Number(pedido.envio_costo) > 0) {
    const labelEnvio = pedido.envio && pedido.envio.transportista
      ? `Envío (${escapar(pedido.envio.transportista)})`
      : "Envío";
    desc.push(`<tr><td style="padding:4px 0;color:${GRIS};">${labelEnvio}</td><td style="padding:4px 0;text-align:right;color:#22301f;">${pesos(pedido.envio_costo)}</td></tr>`);
  } else if (pedido.envio && pedido.envio.metodo === "envio" && pedido.envio.gratis) {
    desc.push(`<tr><td style="padding:4px 0;color:${CARAMELO};">Envío${pedido.envio.transportista ? ` (${escapar(pedido.envio.transportista)})` : ""}</td><td style="padding:4px 0;text-align:right;color:${CARAMELO};font-weight:bold;">Gratis</td></tr>`);
  }
  return `<table style="width:100%;border-collapse:collapse;">
    ${filasItems(pedido.items)}
    ${desc.join("")}
    <tr><td colspan="2" style="border-top:1px solid #ded2b5;padding-top:8px;"></td></tr>
    <tr>
      <td style="padding:4px 0;font-weight:bold;color:${VERDE};font-size:18px;">Total</td>
      <td style="padding:4px 0;text-align:right;font-weight:bold;color:${VERDE};font-size:18px;">${pesos(pedido.total)}</td>
    </tr>
  </table>`;
}

// Aviso para el administrador: entró un pedido
function mailAvisoAdmin(pedido) {
  const canal = { mercadopago: "Mercado Pago", whatsapp: "WhatsApp", modo: "MODO", mayorista: "Mayorista", directa: "Venta directa" }[pedido.origen] || pedido.origen;
  const cobrado = pedido.estado === "aprobado";
  const metodoPago = METODOS_PAGO_MANUAL.find((m) => m.clave === pedido.metodo_pago);
  return {
    asunto: `${cobrado ? "💰 Venta cobrada" : "🧾 Pedido nuevo"} ${numeroPedido(pedido.numero)} · ${pesos(pedido.total)}`,
    html: envoltorio(
      `${cobrado ? "¡Venta cobrada!" : "Pedido nuevo"} ${numeroPedido(pedido.numero)}`,
      `<p style="margin:0 0 14px;color:${GRIS};">Canal: <strong style="color:${VERDE};">${escapar(canal)}</strong> · Estado: <strong style="color:${VERDE};">${escapar(pedido.estado)}</strong>${metodoPago ? ` · Pago: <strong style="color:${VERDE};">${escapar(metodoPago.etiqueta)}</strong>` : ""}</p>
       ${resumen(pedido)}
       <p style="margin:14px 0 0;color:${GRIS};">Cliente: ${nombreCliente(pedido) ? `${escapar(nombreCliente(pedido))} · ` : ""}${escapar(pedido.cliente_email || "sin email")}</p>
       ${bloqueEntrega(pedido.envio)}
       <p style="margin:20px 0 0;"><a href="https://merlacoffee.com.ar/admin" style="background:${VERDE};color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;font-weight:bold;display:inline-block;">Ver en el panel</a></p>`
    ),
  };
}

// Bloque Club Merla. Los puntos se acreditan al cobrar: en un pedido pendiente
// todavía no están en el saldo. `saldo` = null si no se pudo leer o no aplica.
function bloquePuntos(pedido, saldo) {
  const ganados = Number(pedido.puntos_ganados) || 0;
  const n = (v) => Number(v).toLocaleString("es-AR");
  const fuerte = (t) => `<strong style="color:${VERDE};">${t}</strong>`;
  const { canjePuntos, canjeDescuento } = CONFIG.fidelidad;

  const lineas = [];
  if (pedido.estado === "pendiente") {
    if (ganados) lineas.push(`⭐ Vas a sumar ${fuerte(`${n(ganados)} puntos`)} al confirmarse el pago.`);
  } else {
    if (ganados) lineas.push(`⭐ Sumaste ${fuerte(`${n(ganados)} puntos`)}.`);
    if (saldo != null && (ganados || saldo > 0)) {
      lineas.push(`Tu saldo: ${fuerte(`${n(saldo)} puntos`)}.`);
      lineas.push(saldo >= canjePuntos
        ? `¡Ya podés canjear ${fuerte(pesos(canjeDescuento))} de descuento en tu próxima compra!`
        : `Sumá más ${n(canjePuntos - saldo)} para canjear ${pesos(canjeDescuento)} de descuento.`);
    }
  }
  return lineas.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;background:#f6f0e2;border-radius:12px;">
        <tr><td style="padding:14px 16px;color:${GRIS};line-height:1.5;">${lineas.join("<br>")}</td></tr>
      </table>`
    : "";
}

// Confirmación para el cliente
function mailConfirmacionCliente(pedido, saldo = null) {
  const puntos = bloquePuntos(pedido, saldo);
  const nombre = nombreCliente(pedido);
  const numero = numeroPedido(pedido.numero);
  return {
    asunto: `Tu pedido ${numero} en Merla Coffee ☕`,
    html: envoltorio(
      nombre ? `¡Gracias por tu compra, ${escapar(nombre)}!` : "¡Gracias por tu compra!",
      `<p style="margin:0 0 14px;color:${GRIS};">Confirmamos tu pedido <strong style="color:${VERDE};">${numero}</strong>. Acá va el detalle:</p>
       ${resumen(pedido)}
       ${bloqueEntrega(pedido.envio)}
       ${puntos}
       <p style="margin:20px 0 12px;color:${GRIS};">¿Alguna duda? Escribinos o respondé este mail. ¡Que lo disfrutes! ☕</p>
       <a href="https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`¡Hola Merla Coffee! Te escribo por mi pedido ${numero}`)}" style="display:block;background:#25d366;color:#0b3d20;font-weight:bold;text-align:center;text-decoration:none;padding:13px 18px;border-radius:10px;">Escribinos por WhatsApp</a>`
    ),
  };
}

// Link que rearma el carrito en la tienda con lo que tenía el pedido. Lleva solo
// presentaciones y cantidades (nada sensible: el precio se recalcula al cobrar),
// así funciona aunque abra el mail en otro dispositivo o el pedido ya se haya
// borrado. app.js lo lee en `retomarPedidoDeURL`.
function enlaceRetomar(pedido, codigoCupon) {
  const items = (pedido.items || [])
    .filter((i) => /^[A-Za-z0-9_-]{1,80}$/.test(String(i.presentacion_id || "")) && Number(i.qty) >= 1)
    .map((i) => `${i.presentacion_id}:${Math.floor(Number(i.qty))}`);
  if (!items.length) return `${SITIO}/#cafes`;
  const cupon = /^[A-Z0-9_-]{2,40}$/.test(String(codigoCupon || "")) ? `&cupon=${codigoCupon}` : "";
  return `${SITIO}/?retomar=${encodeURIComponent(items.join(","))}${cupon}`;
}

// Recordatorio de carrito abandonado: el pedido quedó pendiente y el cron lo
// va a borrar. Sin urgencias falsas: el detalle de lo que eligió y un botón que
// le devuelve el carrito armado. `cuponRegalo` (opcional) es un cupón de la base
// para tentarlo a terminar; se aplica solo al entrar desde el botón.
function mailCarritoAbandonado(pedido, cuponRegalo = null) {
  const regalo = cuponRegalo
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;background:#f6f0e2;border-radius:12px;">
        <tr><td style="padding:14px 16px;color:${GRIS};line-height:1.5;">🎁 Para que lo termines, te dejamos <strong style="color:${VERDE};">${
          cuponRegalo.tipo === "porcentaje" ? `${Number(cuponRegalo.valor)}% OFF` : `${pesos(cuponRegalo.valor)} OFF`
        }</strong>. Se aplica solo al entrar desde el botón (cupón ${escapar(cuponRegalo.codigo)}).</td></tr>
      </table>`
    : "";
  const enlace = enlaceRetomar(pedido, cuponRegalo ? cuponRegalo.codigo : pedido.cupon);
  return {
    asunto: `¿Seguimos con tu pedido? ☕`,
    html: envoltorio(
      "Te quedó un café a medio camino",
      `<p style="margin:0 0 14px;color:${GRIS};">Empezaste un pedido en Merla Coffee y quedó sin confirmar. Te lo guardamos tal cual lo dejaste:</p>
       ${resumen(pedido)}
       ${regalo}
       <p style="margin:20px 0 0;"><a href="${escapar(enlace)}" style="background:${VERDE};color:#fff;text-decoration:none;padding:13px 20px;border-radius:9px;font-weight:bold;display:inline-block;">Retomar mi pedido</a></p>
       <p style="margin:18px 0 0;color:${GRIS};">Si ya no te interesa, ignorá este mail: el pedido se cancela solo.</p>`
    ),
  };
}

// Código para canjear puntos Club Merla (backend/lib/canje.js). Corto y sin
// links: lo único que tiene que hacer el cliente es copiar seis números.
function mailCodigoCanje(codigo, minutos) {
  const separado = `${String(codigo).slice(0, 3)} ${String(codigo).slice(3)}`;
  return {
    asunto: `${separado} es tu código para canjear puntos ☕`,
    html: envoltorio(
      "Tu código para canjear puntos",
      `<p style="margin:0 0 14px;color:${GRIS};">Ingresalo en el carrito de Merla Coffee para usar tus puntos Club Merla:</p>
       <p style="margin:0 0 14px;font-size:34px;font-weight:bold;letter-spacing:6px;color:${VERDE};text-align:center;background:#f6f0e2;border-radius:12px;padding:16px 8px;">${escapar(separado)}</p>
       <p style="margin:0 0 14px;color:${GRIS};">Vence en ${Number(minutos) || 10} minutos.</p>
       <p style="margin:0;color:${GRIS};">Si no lo pediste vos, ignorá este mail: sin este código nadie puede usar tus puntos.</p>`
    ),
  };
}

// Pedido de reseña, unos días después de la compra. Las estrellas son links:
// tocar una abre el formulario en la web con ese puntaje ya elegido.
//   enlace(n) → URL del formulario con n estrellas (0 = sin elegir)
function mailPedidoResena(pedido, enlace) {
  const productos = [...new Set((pedido.items || []).map((i) => String(i.nombre || "").split(" - ")[0].trim()).filter(Boolean))];
  const que = productos.length ? `<strong style="color:${VERDE};">${escapar(productos.join(", "))}</strong>` : "tu café";
  const nombre = String((pedido.envio && pedido.envio.nombre) || "").trim().split(/\s+/)[0];
  const estrellas = [1, 2, 3, 4, 5]
    .map((n) => `<a href="${escapar(enlace(n))}" style="color:${CARAMELO};text-decoration:none;font-size:34px;line-height:1;padding:0 3px;" aria-label="${n} de 5 estrellas">★</a>`)
    .join("");
  return {
    asunto: `¿Qué te pareció tu café? ☕`,
    html: envoltorio(
      nombre ? `¿Qué te pareció, ${escapar(nombre)}?` : "¿Qué te pareció tu café?",
      `<p style="margin:0 0 14px;color:${GRIS};">Hace unos días te llegó tu pedido ${numeroPedido(pedido.numero)} con ${que}. Nos ayudaría mucho saber qué te pareció: es un minuto.</p>
       <p style="margin:18px 0 6px;text-align:center;">${estrellas}</p>
       <p style="margin:0 0 18px;text-align:center;color:${GRIS};font-size:13px;">Tocá las estrellas para empezar</p>
       <p style="margin:0 0 16px;text-align:center;"><a href="${escapar(enlace(0))}" style="background:${VERDE};color:#fff;text-decoration:none;padding:13px 20px;border-radius:9px;font-weight:bold;display:inline-block;">Dejar mi opinión</a></p>
       <p style="margin:0;color:${GRIS};font-size:13px;">Leemos cada opinión antes de publicarla en la web, con tu nombre de pila. Si algo no estuvo bien, contanos: queremos saberlo.</p>`
    ),
  };
}

// Aviso al admin: un cliente dejó una reseña y está esperando aprobación
function mailResenaNueva(resena) {
  const estrellas = "★".repeat(resena.estrellas) + "☆".repeat(5 - resena.estrellas);
  return {
    asunto: `⭐ Nueva reseña de ${resena.nombre} (${resena.estrellas}/5) para aprobar`,
    html: envoltorio(
      "Te dejaron una reseña",
      `<p style="margin:0 0 6px;color:${CARAMELO};font-size:22px;letter-spacing:2px;">${estrellas}</p>
       <p style="margin:0 0 14px;color:#22301f;font-size:16px;line-height:1.5;">“${escapar(resena.texto)}”</p>
       <p style="margin:0 0 18px;color:${GRIS};">${escapar(resena.nombre)}${resena.producto ? ` · compró ${escapar(resena.producto)}` : ""}</p>
       <p style="margin:0 0 14px;color:${GRIS};">No se publica hasta que la apruebes.</p>
       <p style="margin:0;"><a href="${SITIO}/admin" style="background:${VERDE};color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;font-weight:bold;display:inline-block;">Revisarla en el panel</a></p>`
    ),
  };
}

// Aviso al administrador de un pago que necesita que alguien lo mire:
//   "sin-pedido": entró plata y el pedido ya no existe en la base.
//   "duplicado":  segundo pago sobre un pedido que ya estaba cobrado.
// `pago` es el objeto de la API de Mercado Pago.
function mailPagoRaro(motivo, pago, pedido) {
  const monto = pesos(pago.transaction_amount);
  const duplicado = motivo === "duplicado";
  const numero = pedido ? numeroPedido(pedido.numero) : "";
  const fila = (etiqueta, valor) =>
    valor ? `<tr><td style="padding:5px 0;color:${GRIS};">${etiqueta}</td><td style="padding:5px 0;text-align:right;color:#22301f;">${escapar(valor)}</td></tr>` : "";
  const fecha = pago.date_approved || pago.date_created;
  return {
    asunto: duplicado ? `⚠️ Pago duplicado del pedido ${numero} · ${monto}` : `⚠️ Pago sin pedido · ${monto}`,
    html: envoltorio(
      duplicado ? `Pagaron dos veces el pedido ${numero}` : "Entró un pago sin pedido",
      `<p style="margin:0 0 14px;color:${GRIS};">${duplicado
        ? "Mercado Pago aprobó un segundo pago sobre un pedido que ya estaba cobrado. El pedido no se tocó: falta devolver este pago."
        : "Mercado Pago aprobó un pago, pero su pedido ya no está en el panel (lo más probable: pagó un link viejo, cuando el pedido pendiente ya se había borrado). La plata entró y no hay pedido que la respalde."}</p>
       <table style="width:100%;border-collapse:collapse;">
         ${fila("Pago N°", pago.id)}
         ${fila("Monto", monto)}
         ${fila("Pagó", pago.payer && pago.payer.email)}
         ${fila("Fecha", fecha ? new Date(fecha).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "")}
         ${fila("Referencia", pago.external_reference)}
       </table>
       <p style="margin:16px 0 0;color:${GRIS};">Buscalo por su número en Mercado Pago → Actividad. ${duplicado
        ? "Desde ahí podés devolverle la plata."
        : "Escribile al cliente: podés cargarle el pedido a mano desde el panel (+ Nuevo pedido) o devolverle la plata."}</p>`
    ),
  };
}

// Aviso al cliente de que su pedido ya fue despachado (con tracking) o está
// listo para retirar en La Plata. Se dispara desde /admin → Pedidos.
function mailDespachoCliente(pedido) {
  const nombre = nombreCliente(pedido);
  const numero = numeroPedido(pedido.numero);
  const envio = pedido.envio || {};
  const esRetiro = envio.metodo === "retiro" || pedido.estado_entrega === "listo_retiro";
  const esLocal = envio.proveedor === "local" || envio.opcionGrupo === "local:laplata";
  const codigo = String(pedido.tracking_codigo || "").trim();
  const link = String(pedido.tracking_url || "").trim() || urlTracking(envio.transportista, codigo);
  const saludo = nombre ? `, ${escapar(nombre.split(/\s+/)[0])}` : "";

  if (esRetiro) {
    return {
      asunto: `¡Tu pedido ${numero} está listo para retirar! ☕`,
      html: envoltorio(
        `¡Tu pedido ${numero} está listo${saludo}!`,
        `<p style="margin:0 0 14px;color:${GRIS};">Ya preparamos tu café en <strong style="color:${VERDE};">La Plata (zona centro)</strong>. Escribinos por WhatsApp para coordinar el horario de retiro.</p>
         <a href="https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`¡Hola Merla Coffee! Ya me llegó el aviso de que mi pedido ${numero} está listo para retirar. ¿Cuándo puedo pasar?`)}" style="display:block;background:#25d366;color:#0b3d20;font-weight:bold;text-align:center;text-decoration:none;padding:13px 18px;border-radius:10px;margin:16px 0;">Coordinar retiro por WhatsApp</a>
         ${resumen(pedido)}`
      ),
    };
  }

  if (esLocal) {
    return {
      asunto: `¡Tu pedido ${numero} salió en camino! 🛵`,
      html: envoltorio(
        `¡Tu pedido ${numero} está en camino${saludo}!`,
        `<p style="margin:0 0 14px;color:${GRIS};">Ya despachamos tu pedido con nuestra cadetería en La Plata. Si necesitamos coordinar la entrega, te escribimos al teléfono que dejaste.</p>
         ${bloqueEntrega(envio)}
         <p style="margin:18px 0 0;"><a href="https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`¡Hola Merla Coffee! Te escribo por el envío de mi pedido ${numero}`)}" style="display:block;background:#25d366;color:#0b3d20;font-weight:bold;text-align:center;text-decoration:none;padding:13px 18px;border-radius:10px;">Escribinos por WhatsApp</a></p>`
      ),
    };
  }

  const correo = [envio.transportista, envio.servicio].filter(Boolean).join(" · ") || "el correo";
  const cajaTracking = codigo
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background:#f6f0e2;border-radius:12px;">
         <tr><td style="padding:14px 16px;text-align:center;">
           <span style="display:block;font-size:12px;color:${GRIS};margin-bottom:4px;">Código de seguimiento (${escapar(correo)})</span>
           <strong style="font-size:20px;letter-spacing:1.5px;color:${VERDE};">${escapar(codigo)}</strong>
         </td></tr>
       </table>`
    : "";
  const botonTracking = link
    ? `<p style="margin:16px 0;"><a href="${escapar(link)}" style="display:block;background:${VERDE};color:#fff;font-weight:bold;text-align:center;text-decoration:none;padding:13px 18px;border-radius:10px;">Seguir mi envío</a></p>`
    : "";

  return {
    asunto: `¡Despachamos tu pedido ${numero}! 📦`,
    html: envoltorio(
      `¡Tu pedido ${numero} está en camino${saludo}!`,
      `<p style="margin:0 0 12px;color:${GRIS};">Ya despachamos tu compra por <strong style="color:${VERDE};">${escapar(correo)}</strong>.${codigo ? " Podés seguir el recorrido con este código:" : ""}</p>
       ${cajaTracking}
       ${botonTracking}
       ${bloqueEntrega(envio)}
       <p style="margin:20px 0 10px;color:${GRIS};font-size:13px;">El seguimiento puede demorar unas horas en actualizarse en la web del correo. ¿Alguna duda? Respondé este mail o escribinos por WhatsApp.</p>`
    ),
  };
}

module.exports = { mailAvisoAdmin, mailConfirmacionCliente, mailDespachoCliente, mailCarritoAbandonado, mailPagoRaro, mailCodigoCanje, mailPedidoResena, mailResenaNueva, enlaceRetomar };
