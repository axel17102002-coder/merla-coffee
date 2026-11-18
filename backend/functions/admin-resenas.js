// Administración protegida de las reseñas que se muestran en la tienda.
//
//   GET                                          → { resenas: [...] } (todas)
//   POST { id?, nombre, texto, detalle?, estrellas } → crea (o edita, con id)
//   PATCH { id, activo }                         → publica / oculta
//   DELETE ?id=<uuid>                            → borra
//
// Solo opiniones reales: se cargan a mano, copiadas de lo que mandan los
// clientes (WhatsApp, Instagram, mail).

const { sb } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");

const LIMITES = { nombre: 60, texto: 400, detalle: 60 };
const ID = /^[0-9a-f-]{36}$/i;

const texto = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const responder = (statusCode, cuerpo) => ({ statusCode, headers, body: JSON.stringify(cuerpo) });
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "GET") {
      const resenas = await sb("resenas?select=*&order=creado.desc");
      return responder(200, { resenas });
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const fila = {
        nombre: texto(body.nombre, LIMITES.nombre),
        texto: texto(body.texto, LIMITES.texto),
        detalle: texto(body.detalle, LIMITES.detalle) || null,
        estrellas: Math.max(1, Math.min(5, Number.parseInt(body.estrellas, 10) || 5)),
      };
      if (!fila.nombre) return responder(400, { error: "Poné el nombre de quien opina (alcanza con el nombre de pila)" });
      if (!fila.texto) return responder(400, { error: "Falta el texto de la reseña" });

      if (body.id) {
        if (!ID.test(String(body.id))) return responder(400, { error: "Reseña inválida" });
        const [resena] = await sb(`resenas?id=eq.${encodeURIComponent(body.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: fila,
        });
        if (!resena) return responder(404, { error: "Esa reseña ya no existe" });
        return responder(200, { resena });
      }
      const [resena] = await sb("resenas", { method: "POST", headers: { Prefer: "return=representation" }, body: fila });
      return responder(201, { resena });
    }

    if (event.httpMethod === "PATCH") {
      const { id, activo } = JSON.parse(event.body || "{}");
      if (!ID.test(String(id || ""))) return responder(400, { error: "Reseña inválida" });
      const [resena] = await sb(`resenas?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { activo: Boolean(activo) },
      });
      if (!resena) return responder(404, { error: "Esa reseña ya no existe" });
      return responder(200, { resena });
    }

    if (event.httpMethod === "DELETE") {
      const id = String((event.queryStringParameters || {}).id || "");
      if (!ID.test(id)) return responder(400, { error: "Reseña inválida" });
      await sb(`resenas?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      return responder(200, { ok: true });
    }

    return responder(405, { error: "Método no permitido" });
  } catch (err) {
    console.error("admin-resenas:", err);
    // PGRST205 / 42P01 = la tabla no existe todavía
    if (/PGRST205|42P01|resenas/.test(String(err.message)) && /does not exist|Could not find/.test(String(err.message))) {
      return responder(409, { error: "Falta correr supabase/migracion-resenas.sql en Supabase" });
    }
    return responder(502, { error: "No se pudieron gestionar las reseñas" });
  }
};
