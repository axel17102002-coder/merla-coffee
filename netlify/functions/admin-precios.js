// Administración protegida de precios, a partir del COSTO del café.
// Se carga un solo número por café (la bolsa de 250 g) y de ahí sale todo:
// costo por drip bag → precio de la unidad (margen objetivo) → precio del pack
// (5 unidades con 10% OFF). Las reglas viven en motor.js (CONFIG.costos/pack).
//
//   GET                              → { productos: [...], config }
//   POST { producto_id, costo_250g } → { costo_250g, precio, precioPack, margenPack }

const { sb } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");
const {
  CONFIG, precioPack, precioUnidadDesdeCosto, costoBolsaDesdePrecio,
  costoUnidad, costoPack, margenPack, margenUnidadReal,
} = require("../../public/motor.js");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "GET") {
      // Si la migración del costo todavía no se corrió, seguimos andando: el
      // costo se deduce del precio actual (la vuelta es exacta).
      const traerProductos = async () => {
        try {
          return await sb("productos?select=id,nombre,activo,costo_250g&order=nombre.asc");
        } catch (err) {
          console.warn("admin-precios: sin columna costo_250g todavía:", err.message);
          return await sb("productos?select=id,nombre,activo&order=nombre.asc");
        }
      };
      const [productos, presentaciones] = await Promise.all([
        traerProductos(),
        sb("presentaciones?select=producto_id,precio,unidades_stock"),
      ]);

      const lista = productos.map((p) => {
        const unidad = presentaciones.find((x) => x.producto_id === p.id && x.unidades_stock === 1);
        const pack = presentaciones.find((x) => x.producto_id === p.id && x.unidades_stock === CONFIG.pack.unidades);
        // Si el costo todavía no se cargó, lo deducimos del precio actual para
        // que la pantalla muestre algo coherente desde el arranque.
        const costo = p.costo_250g != null
          ? Number(p.costo_250g)
          : (unidad ? costoBolsaDesdePrecio(unidad.precio) : null);
        return {
          id: p.id,
          nombre: p.nombre,
          activo: p.activo,
          costo_250g: costo,
          costoUnidad: costo != null ? Math.round(costoUnidad(costo)) : null,
          costoPack: costo != null ? Math.round(costoPack(costo)) : null,
          precio: unidad ? unidad.precio : null,
          precioPack: pack ? pack.precio : null,
          // Sugerido = el que sale del costo; el real puede estar redondeado a mano
          precioSugerido: costo != null ? precioUnidadDesdeCosto(costo) : null,
          margenUnidad: costo != null && unidad ? margenUnidadReal(costo, unidad.precio) : null,
          margenPack: costo != null && pack ? margenPack(costo, pack.precio) : null,
          tienePack: Boolean(pack),
        };
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ productos: lista, config: { pack: CONFIG.pack, costos: CONFIG.costos, drip: CONFIG.drip } }),
      };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { producto_id } = body;
      const costo = Number(body.costo_250g);
      if (!producto_id || !(costo > 0)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Ingresá el costo de los 250 g (mayor a 0)" }) };
      }

      // El precio se puede fijar a mano (para redondearlo); si no viene, se
      // calcula desde el costo con el margen objetivo.
      const aMano = Number(body.precio);
      const precio = aMano > 0 ? Math.round(aMano) : precioUnidadDesdeCosto(costo);
      if (precio < Math.round(costoUnidad(costo))) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Ese precio (${precio}) es menor al costo (${Math.round(costoUnidad(costo))}): perderías plata` }),
        };
      }
      const pack = precioPack(precio);
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
      await sb(`presentaciones?${filtro}&unidades_stock=eq.${CONFIG.pack.unidades}`, {
        method: "PATCH",
        body: { precio: pack },
      });

      // Guardamos el costo (fuente de verdad para recalcular). Si la columna
      // todavía no existe, los precios ya quedaron bien igual: el costo se
      // deduce del precio hasta que se corra la migración.
      try {
        await sb(`productos?id=eq.${encodeURIComponent(producto_id)}`, {
          method: "PATCH",
          body: { costo_250g: costo },
        });
      } catch (err) {
        console.warn("admin-precios: no se pudo guardar costo_250g:", err.message);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          costo_250g: costo,
          costoUnidad: Math.round(costoUnidad(costo)),
          costoPack: Math.round(costoPack(costo)),
          precio,
          precioPack: pack,
          margenUnidad: margenUnidadReal(costo, precio),
          margenPack: margenPack(costo, pack),
        }),
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  } catch (err) {
    console.error("admin-precios:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No se pudo completar la operación de precios" }) };
  }
};
