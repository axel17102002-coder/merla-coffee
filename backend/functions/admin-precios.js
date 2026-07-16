// Administración protegida de precios, a partir del COSTO DEL KILO de café.
// Los insumos y el margen viven en la base (ver lib/costos.js) y se editan
// desde la tab Configuración: acá solo se aplican.
//
//   GET                                     → { productos: [...], cfg }
//   POST { producto_id, costo_kg, precio? } → guarda; `precio` es opcional
//        (si no viene, se calcula con el margen objetivo)

const { sb } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");
const { obtenerCostos } = require("../lib/costos.js");
const {
  precioPack, precioUnidadDesdeCosto, costoKiloDesdePrecio,
  costoUnidad, costoPack, margenPack, margenUnidadReal,
} = require("../../public/motor.js");

// Lee productos tolerando que la migración a costo_kg no se haya corrido
async function traerProductos() {
  try {
    return await sb("productos?select=id,nombre,activo,costo_kg&order=nombre.asc");
  } catch (err) {
    console.warn("admin-precios: sin columna costo_kg todavía:", err.message);
    return await sb("productos?select=id,nombre,activo&order=nombre.asc");
  }
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    const { cfg } = await obtenerCostos();

    if (event.httpMethod === "GET") {
      const [productos, presentaciones] = await Promise.all([
        traerProductos(),
        sb("presentaciones?select=producto_id,precio,unidades_stock"),
      ]);

      const lista = productos.map((p) => {
        const unidad = presentaciones.find((x) => x.producto_id === p.id && x.unidades_stock === 1);
        const pack = presentaciones.find((x) => x.producto_id === p.id && x.unidades_stock === cfg.packUnidades);
        // Si el costo todavía no está cargado, lo deducimos del precio actual
        const costo = p.costo_kg != null
          ? Number(p.costo_kg)
          : (unidad ? costoKiloDesdePrecio(unidad.precio, cfg) : null);
        return {
          id: p.id,
          nombre: p.nombre,
          activo: p.activo,
          costo_kg: costo,
          costoUnidad: costo != null ? Math.round(costoUnidad(costo, cfg)) : null,
          costoPack: costo != null ? Math.round(costoPack(costo, cfg)) : null,
          precio: unidad ? unidad.precio : null,
          precioPack: pack ? pack.precio : null,
          precioSugerido: costo != null ? precioUnidadDesdeCosto(costo, cfg) : null,
          margenUnidad: costo != null && unidad ? margenUnidadReal(costo, unidad.precio, cfg) : null,
          margenPack: costo != null && pack ? margenPack(costo, pack.precio, cfg) : null,
          tienePack: Boolean(pack),
        };
      });

      return { statusCode: 200, headers, body: JSON.stringify({ productos: lista, cfg }) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { producto_id } = body;
      const costo = Number(body.costo_kg);
      if (!producto_id || !(costo > 0)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Ingresá el costo del kilo (mayor a 0)" }) };
      }

      // El precio se puede fijar a mano (para redondearlo); si no viene, se
      // calcula desde el costo con el margen objetivo.
      const aMano = Number(body.precio);
      const precio = aMano > 0 ? Math.round(aMano) : precioUnidadDesdeCosto(costo, cfg);
      const piso = Math.round(costoUnidad(costo, cfg));
      if (precio < piso) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Ese precio (${precio}) es menor al costo (${piso}): perderías plata` }),
        };
      }
      const pack = precioPack(precio, cfg);
      const filtro = `producto_id=eq.${encodeURIComponent(producto_id)}`;

      const actualizadas = await sb(`presentaciones?${filtro}&unidades_stock=eq.1`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { precio },
      });
      if (!actualizadas || !actualizadas.length) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "El producto no tiene presentación de unidad" }) };
      }

      // El pack se deriva del precio unitario (si el producto tiene pack)
      await sb(`presentaciones?${filtro}&unidades_stock=eq.${cfg.packUnidades}`, {
        method: "PATCH",
        body: { precio: pack },
      });

      // Guardamos el costo: es la fuente de verdad para recalcular después
      try {
        await sb(`productos?id=eq.${encodeURIComponent(producto_id)}`, {
          method: "PATCH",
          body: { costo_kg: costo },
        });
      } catch (err) {
        console.warn("admin-precios: no se pudo guardar costo_kg:", err.message);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          costo_kg: costo,
          costoUnidad: piso,
          costoPack: Math.round(costoPack(costo, cfg)),
          precio,
          precioPack: pack,
          margenUnidad: margenUnidadReal(costo, precio, cfg),
          margenPack: margenPack(costo, pack, cfg),
        }),
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  } catch (err) {
    console.error("admin-precios:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No se pudo completar la operación de precios" }) };
  }
};
