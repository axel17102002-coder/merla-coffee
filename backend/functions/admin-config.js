// Administración protegida de la estructura de costos: insumos desglosados y
// margen objetivo. Es información sensible: solo sale de acá con ADMIN_TOKEN.
//
//   GET                                   → { cfg, insumos, totales }
//   POST { nombre, costo, aplica }        → agrega un insumo
//   PATCH { id, nombre?, costo? }         → edita un insumo
//   PATCH { clave, valor }                → cambia un valor de configuración
//   DELETE ?id=<uuid>                     → borra un insumo
//   POST { accion: "recalcular" }         → reaplica el margen a TODOS los cafés

const { sb } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");
const { obtenerCostos } = require("../lib/costos.js");
const { precioPack, precioUnidadDesdeCosto } = require("../../public/motor.js");
const zipnova = require("../lib/zipnova.js");

const CLAVES_VALIDAS = [
  "margen_unidad", "gramos_por_bag", "pack_unidades", "pack_descuento",
  "peso_drip_bag_g", "peso_cafe_bolsa_g", "peso_merch_g", "comision_mercadopago",
  "comision_mp_dinero", "comision_mp_debito", "comision_mp_credito",
  "comision_mp_prepaga", "comision_mp_cuotas_sin_tarjeta",
];

// Reaplica el margen objetivo a todos los cafés que tengan costo cargado.
// Se usa cuando cambian los insumos o el margen: evita ir uno por uno.
async function recalcularTodos(cfg, modo) {
  const productos = await sb("productos?select=id,nombre,costo_kg&order=nombre.asc");
  const presentaciones = modo === "packs"
    ? await sb("presentaciones?select=producto_id,precio&unidades_stock=eq.1")
    : [];
  const cambios = [];
  for (const p of productos) {
    if (p.costo_kg == null) continue;
    // modo "packs": mantiene el precio de unidad actual y solo re-deriva el pack
    const unidadActual = presentaciones.find((x) => x.producto_id === p.id);
    const precio = modo === "packs"
      ? (unidadActual ? unidadActual.precio : null)
      : precioUnidadDesdeCosto(Number(p.costo_kg), cfg);
    if (precio == null) continue;
    const pack = precioPack(precio, cfg);
    const filtro = `producto_id=eq.${encodeURIComponent(p.id)}`;
    await sb(`presentaciones?${filtro}&unidades_stock=eq.1`, { method: "PATCH", body: { precio } });
    await sb(`presentaciones?${filtro}&unidades_stock=eq.${cfg.packUnidades}`, { method: "PATCH", body: { precio: pack } });
    cambios.push({ nombre: p.nombre, precio, precioPack: pack });
  }
  return cambios;
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "GET") {
      const { cfg, insumos, desdeLaBase } = await obtenerCostos();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          cfg,
          insumos,
          desdeLaBase, // false = falta correr la migración (se usan los valores viejos)
          totales: { unidad: cfg.fijoUnidad, pack: cfg.fijoPack },
          zipnovaDisponible: zipnova.disponible(),
        }),
      };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");

      if (body.accion === "recalcular") {
        const { cfg } = await obtenerCostos();
        const cambios = await recalcularTodos(cfg, body.modo);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, cambios }) };
      }

      const nombre = String(body.nombre || "").trim().slice(0, 60);
      const costo = Number(body.costo);
      const cantU = Number(body.cant_unidad);
      const cantP = Number(body.cant_pack);
      if (!nombre) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Poné el nombre del insumo" }) };
      }
      if (!(costo >= 0)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "El costo no puede ser negativo" }) };
      }
      if (!(cantU >= 0) || !(cantP >= 0) || (cantU === 0 && cantP === 0)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Indicá cuántas veces entra en la unidad y/o en el pack" }) };
      }
      let insumo;
      try {
        [insumo] = await sb("insumos", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: { nombre, costo, cant_unidad: cantU, cant_pack: cantP },
        });
      } catch (err) {
        // Esquema viejo (falta re-correr migracion-insumos.sql): se guarda con
        // `aplica` aproximando las cantidades a 1.
        console.warn("admin-config: alta con esquema viejo:", err.message);
        [insumo] = await sb("insumos", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: { nombre, costo, aplica: cantU > 0 ? "unidad" : "pack" },
        });
      }
      return { statusCode: 201, headers, body: JSON.stringify({ insumo }) };
    }

    if (event.httpMethod === "PATCH") {
      const body = JSON.parse(event.body || "{}");

      // Cambiar un valor de configuración (margen, gramos por bag, etc.)
      if (body.clave) {
        if (!CLAVES_VALIDAS.includes(body.clave)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Configuración desconocida" }) };
        }
        const valor = Number(body.valor);
        if (!Number.isFinite(valor) || valor < 0) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Valor inválido" }) };
        }
        if (body.clave === "margen_unidad" && valor >= 100) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "El margen tiene que ser menor a 100%" }) };
        }
        await sb("configuracion", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: { clave: body.clave, valor },
        });
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, clave: body.clave, valor }) };
      }

      // Editar un insumo
      if (!body.id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Falta el insumo" }) };
      }
      const cambios = {};
      if (body.nombre !== undefined) cambios.nombre = String(body.nombre).trim().slice(0, 60);
      for (const campo of ["costo", "cant_unidad", "cant_pack"]) {
        if (body[campo] !== undefined) {
          const v = Number(body[campo]);
          if (!(v >= 0)) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: `${campo} no puede ser negativo` }) };
          }
          cambios[campo] = v;
        }
      }
      const [insumo] = await sb(`insumos?id=eq.${encodeURIComponent(body.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: cambios,
      });
      if (!insumo) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "Insumo inexistente" }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ insumo }) };
    }

    if (event.httpMethod === "DELETE") {
      const id = (event.queryStringParameters || {}).id;
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Falta el insumo" }) };
      }
      await sb(`insumos?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  } catch (err) {
    console.error("admin-config:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No se pudo completar la operación" }) };
  }
};
