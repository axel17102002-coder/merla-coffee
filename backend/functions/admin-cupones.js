// Administración protegida de cupones.
//
//   GET                                  → { cupones: [...] }  (todos)
//   POST { codigo, tipo, valor, minimo, descripcion } → crea o edita un cupón
//   PATCH { codigo, activo }             → activa / desactiva un cupón

const { sb } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "GET") {
      const cupones = await sb("cupones?select=*&order=codigo.asc");
      return { statusCode: 200, headers, body: JSON.stringify({ cupones }) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const codigo = String(body.codigo || "").trim().toUpperCase();
      const tipo = String(body.tipo || "").trim();
      const valor = Number(body.valor);
      const minimo = Number(body.minimo) || 0;

      if (!/^[A-Z0-9_-]{2,40}$/.test(codigo)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Código inválido (2-40 letras, números, - o _)" }) };
      }
      if (!["porcentaje", "monto"].includes(tipo)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Tipo inválido (porcentaje o monto)" }) };
      }
      if (!(valor > 0)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "El valor debe ser mayor a 0" }) };
      }
      if (tipo === "porcentaje" && valor > 100) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Un porcentaje no puede ser mayor a 100" }) };
      }

      // Upsert: si el código ya existe, se edita; si no, se crea.
      const [cupon] = await sb("cupones", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: {
          codigo,
          tipo,
          valor: Math.round(valor),
          minimo: Math.max(0, Math.round(minimo)),
          descripcion: String(body.descripcion || "").trim() || null,
          activo: body.activo === undefined ? true : Boolean(body.activo),
        },
      });
      return { statusCode: 200, headers, body: JSON.stringify({ cupon }) };
    }

    if (event.httpMethod === "PATCH") {
      const body = JSON.parse(event.body || "{}");
      const codigo = String(body.codigo || "").trim().toUpperCase();
      if (!codigo) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Falta el código" }) };
      }
      const [cupon] = await sb(`cupones?codigo=eq.${encodeURIComponent(codigo)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { activo: Boolean(body.activo) },
      });
      if (!cupon) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "Cupón inexistente" }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ cupon }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  } catch (err) {
    console.error("admin-cupones:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No se pudieron gestionar los cupones" }) };
  }
};
