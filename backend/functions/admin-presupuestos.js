// Presupuestos (admin → Presupuestos). Solo admin.
//
//   GET                         → { presupuestos } (los últimos 100)
//   POST { cliente_nombre, cliente_email?, cliente_telefono?, items, descuento_porcentaje?, notas?, validez_dias? }
//   PATCH { id, ...los mismos campos }   → edita (recalcula los totales)
//   PATCH { id, estado }                 → borrador / enviado / aceptado / rechazado
//   DELETE ?id=<uuid>

const { sb } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");
const { calcularPresupuesto, tokenNuevo } = require("../lib/presupuestos.js");

const ESTADOS = ["borrador", "enviado", "aceptado", "rechazado"];
const FALTA = "Falta correr supabase/migracion-push-presupuestos.sql en Supabase";
const sinTabla = (err) => /PGRST205|presupuestos|does not exist/.test(String(err && err.message));
const texto = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

// Campos de cliente y condiciones, validados; con los totales recalculados
function camposDe(body) {
  const nombre = texto(body.cliente_nombre, 120);
  if (!nombre) return { error: "Poné el nombre del cliente" };
  const calc = calcularPresupuesto(body.items, body.descuento_porcentaje);
  if (!calc.ok) return { error: calc.error };
  const validez = Math.floor(Number(body.validez_dias) || 15);
  if (!(validez >= 1 && validez <= 365)) return { error: "La validez va de 1 a 365 días" };
  return {
    campos: {
      cliente_nombre: nombre,
      cliente_email: texto(body.cliente_email, 160) || null,
      cliente_telefono: texto(body.cliente_telefono, 40) || null,
      items: calc.items,
      descuento_porcentaje: calc.descuento_porcentaje,
      subtotal: calc.subtotal,
      descuento: calc.descuento,
      total: calc.total,
      notas: texto(body.notas, 2000) || null,
      validez_dias: validez,
    },
  };
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const responder = (statusCode, datos) => ({ statusCode, headers, body: JSON.stringify(datos) });
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "GET") {
      const presupuestos = await sb("presupuestos?select=*&order=creado.desc&limit=100");
      return responder(200, { presupuestos });
    }

    if (event.httpMethod === "POST") {
      const { campos, error } = camposDe(JSON.parse(event.body || "{}"));
      if (error) return responder(400, { error });
      const [presupuesto] = await sb("presupuestos", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: { ...campos, token: tokenNuevo() },
      });
      return responder(201, { presupuesto });
    }

    if (event.httpMethod === "PATCH") {
      const body = JSON.parse(event.body || "{}");
      if (!body.id) return responder(400, { error: "Falta el presupuesto" });
      let cambios;
      if (body.estado !== undefined && Object.keys(body).length === 2) {
        if (!ESTADOS.includes(body.estado)) return responder(400, { error: "Estado inválido" });
        cambios = { estado: body.estado, aceptado_en: body.estado === "aceptado" ? new Date().toISOString() : null };
      } else {
        const { campos, error } = camposDe(body);
        if (error) return responder(400, { error });
        cambios = campos;
      }
      const [presupuesto] = await sb(`presupuestos?id=eq.${encodeURIComponent(body.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { ...cambios, actualizado: new Date().toISOString() },
      });
      if (!presupuesto) return responder(404, { error: "Presupuesto inexistente" });
      return responder(200, { presupuesto });
    }

    if (event.httpMethod === "DELETE") {
      const id = (event.queryStringParameters || {}).id;
      if (!id) return responder(400, { error: "Falta el presupuesto" });
      await sb(`presupuestos?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      return responder(200, { ok: true });
    }

    return responder(405, { error: "Método no permitido" });
  } catch (err) {
    if (sinTabla(err)) return responder(409, { error: FALTA, falta: "migracion-push-presupuestos.sql" });
    console.error("admin-presupuestos:", err.message);
    return responder(500, { error: "No se pudo completar. Probá de nuevo." });
  }
};
