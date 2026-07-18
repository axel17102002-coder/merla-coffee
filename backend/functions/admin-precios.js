// Administración protegida de precios.
// Los cafés ('cafe') se cotizan a partir del COSTO DEL KILO: los insumos y el
// margen viven en la base (ver lib/costos.js) y se editan desde la tab
// Configuración, acá solo se aplican. Los productos simples ('simple': tazas,
// cafés en bolsa de 1/4, etc.) no tienen fórmula: el precio se guarda tal
// cual se carga a mano.
//
//   GET                                     → { productos: [...], cfg }
//   POST { producto_id, precio }                → simple: guarda el precio
//   POST { producto_id, costo_kg, precio? }     → cafe: guarda; `precio` es
//        opcional (si no viene, se calcula con el margen objetivo)

const { sb } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");
const { obtenerCostos } = require("../lib/costos.js");
const {
  precioPack, precioUnidadDesdeCosto, costoKiloDesdePrecio,
  costoUnidad, costoPack, margenPack, margenUnidadReal,
} = require("../../public/motor.js");

// Lee productos tolerando que las migraciones de costo_kg/tipo no se hayan corrido
async function traerProductos() {
  try {
    return await sb("productos?select=id,nombre,activo,costo_kg,tipo&order=nombre.asc");
  } catch (err) {
    console.warn("admin-precios: sin columna tipo todavía:", err.message);
    try {
      return await sb("productos?select=id,nombre,activo,costo_kg&order=nombre.asc");
    } catch (err2) {
      console.warn("admin-precios: sin columna costo_kg todavía:", err2.message);
      return await sb("productos?select=id,nombre,activo&order=nombre.asc");
    }
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

        // Producto simple: sin fórmula, el precio es el que se cargó a mano
        if ((p.tipo || "cafe") === "simple") {
          return {
            id: p.id,
            nombre: p.nombre,
            activo: p.activo,
            tipo: "simple",
            precio: unidad ? unidad.precio : null,
          };
        }

        const pack = presentaciones.find((x) => x.producto_id === p.id && x.unidades_stock === cfg.packUnidades);
        // Si el costo todavía no está cargado, lo deducimos del precio actual
        const costo = p.costo_kg != null
          ? Number(p.costo_kg)
          : (unidad ? costoKiloDesdePrecio(unidad.precio, cfg) : null);
        return {
          id: p.id,
          nombre: p.nombre,
          activo: p.activo,
          tipo: "cafe",
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
      if (!producto_id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Falta el producto" }) };
      }

      const [producto] = await sb(`productos?id=eq.${encodeURIComponent(producto_id)}&select=id,tipo`).catch(() => [null]);

      // ---- Producto simple: sin fórmula, se guarda el precio tal cual ----
      if (producto && producto.tipo === "simple") {
        const precio = Math.round(Number(body.precio));
        if (!(precio > 0)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Ingresá un precio mayor a 0" }) };
        }
        const actualizadas = await sb(
          `presentaciones?producto_id=eq.${encodeURIComponent(producto_id)}&unidades_stock=eq.1`,
          { method: "PATCH", headers: { Prefer: "return=representation" }, body: { precio } }
        );
        if (!actualizadas || !actualizadas.length) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: "El producto no tiene presentación de unidad" }) };
        }
        return { statusCode: 200, headers, body: JSON.stringify({ precio }) };
      }

      // ---- Café: precio calculado desde el costo del kilo ----
      const costo = Number(body.costo_kg);
      if (!(costo > 0)) {
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
      // El pack también se puede fijar a mano (para redondearlo); si no viene,
      // se deriva del precio de la unidad con el % OFF configurado.
      const aManoPack = Number(body.precio_pack);
      const pack = aManoPack > 0 ? Math.round(aManoPack) : precioPack(precio, cfg);
      const pisoPack = Math.round(costoPack(costo, cfg));
      if (aManoPack > 0 && pack < pisoPack) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Ese precio de pack (${pack}) es menor al costo (${pisoPack}): perderías plata` }),
        };
      }
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
