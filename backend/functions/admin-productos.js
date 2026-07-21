// Administración protegida de productos (alta, publicación y baja).
// Dos tipos de producto:
//  - 'cafe' (por defecto): al crearlo se generan solas sus dos presentaciones
//    (unidad y pack x5) con los precios calculados a partir del costo del kilo.
//  - 'simple': sin fórmula. Se carga el precio de venta a mano (tazas, cafés
//    en bolsa de 1/4 kilo, etc.) y nace con una sola presentación "Unidad".
//    Si la categoría es 'cafe_bolsa' (café en bolsa 1/4), acepta los mismos
//    campos descriptivos que el café (origen, variedad, notas, etc.): es el
//    mismo café en otra presentación, así que conviene que muestre la misma
//    info en la tienda.
// En ambos casos nace DESACTIVADO: se publica desde el panel cuando esté listo.
//
//   GET                              → { productos: [...] }
//   POST { tipo, nombre, ... }       → crea producto + presentaciones
//   PATCH { id, activo }             → publica / despublica
//   DELETE ?id=<id>                  → borra el producto (y sus presentaciones)

const { sb } = require("../lib/supabase.js");
const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");
const { obtenerCostos } = require("../lib/costos.js");
const { precioPack, precioUnidadDesdeCosto } = require("../../public/motor.js");

// "Café en Grano ☕" → "cafe-en-grano"
function idDesdeNombre(nombre) {
  return String(nombre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // saca acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const texto = (v, max = 400) => {
  const s = String(v || "").trim();
  return s ? s.slice(0, max) : null;
};

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();

  try {
    if (event.httpMethod === "GET") {
      let productos;
      try {
        productos = await sb("productos?select=id,nombre,activo,stock,origen,imagen,tipo,categoria,descontinuado&order=nombre.asc");
      } catch (err) {
        console.warn("admin-productos: sin columna categoria/descontinuado todavía (correr migraciones):", err.message);
        try {
          productos = await sb("productos?select=id,nombre,activo,stock,origen,imagen,tipo&order=nombre.asc");
        } catch (err2) {
          console.warn("admin-productos: sin columna tipo todavía (correr migracion-productos-simples.sql):", err2.message);
          productos = await sb("productos?select=id,nombre,activo,stock,origen,imagen&order=nombre.asc");
        }
      }
      return { statusCode: 200, headers, body: JSON.stringify({ productos }) };
    }

    if (event.httpMethod === "POST") {
      const b = JSON.parse(event.body || "{}");
      const esSimple = b.tipo === "simple";
      const nombre = texto(b.nombre, 60);
      if (!nombre) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Poné el nombre del ${esSimple ? "producto" : "café"}` }) };
      }
      const id = idDesdeNombre(nombre);
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "El nombre no tiene letras ni números" }) };
      }

      const [existe] = await sb(`productos?id=eq.${encodeURIComponent(id)}&select=id`);
      if (existe) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: `Ya existe un producto con el id "${id}"` }) };
      }

      const crear = (cuerpo) =>
        sb("productos", { method: "POST", headers: { Prefer: "return=representation" }, body: cuerpo });
      const stock = Math.max(0, Math.round(Number(b.stock) || 0));

      // ---- Producto simple: precio fijo a mano, una sola presentación ----
      if (esSimple) {
        const precio = Math.round(Number(b.precio));
        if (!(precio > 0)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Poné el precio de venta" }) };
        }
        const categoria = b.categoria === "cafe_bolsa" ? "cafe_bolsa" : "merch";
        const fila = {
          id,
          nombre,
          activo: false,
          stock,
          tipo: "simple",
          categoria,
          // El café en bolsa es el mismo café que las drip bags en otra
          // presentación: acepta la misma info descriptiva (queda vacía/null
          // en tazas y otros, que no la necesitan).
          origen: texto(b.origen, 60),
          region: texto(b.region, 80),
          variedad: texto(b.variedad, 80),
          proceso: texto(b.proceso, 60),
          sca: texto(b.sca, 10),
          tostador: texto(b.tostador, 60),
          notas: texto(b.notas, 200),
          descripcion: texto(b.descripcion, 600),
          imagen: texto(b.imagen, 400),
        };
        let producto;
        try {
          [producto] = await crear(fila);
        } catch (err) {
          console.warn("admin-productos: reintento sin categoria (correr migracion-categoria-productos.sql):", err.message);
          const { categoria: _categoria, ...sinCategoria } = fila;
          try {
            [producto] = await crear(sinCategoria);
          } catch (err2) {
            console.warn("admin-productos: reintento sin tipo (correr migracion-productos-simples.sql):", err2.message);
            const { tipo, ...sinTipo } = sinCategoria;
            [producto] = await crear(sinTipo);
          }
        }
        await sb("presentaciones", {
          method: "POST",
          body: [{ id: `${id}-unidad`, producto_id: id, nombre: "Unidad", precio, unidades_stock: 1, activo: true }],
        });
        return { statusCode: 201, headers, body: JSON.stringify({ producto, precio }) };
      }

      // ---- Café: precio calculado desde el costo del kilo ----
      const costo = Number(b.costo_kg);
      if (!(costo > 0)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Poné el costo del kilo de café" }) };
      }

      const { cfg } = await obtenerCostos();
      const precio = precioUnidadDesdeCosto(costo, cfg);
      const pack = precioPack(precio, cfg);

      // El producto nace desactivado: se publica cuando esté listo
      const fila = {
        id,
        nombre,
        activo: false,
        stock,
        tipo: "cafe",
        costo_kg: costo,
        origen: texto(b.origen, 60),
        region: texto(b.region, 80),
        variedad: texto(b.variedad, 80),
        proceso: texto(b.proceso, 60),
        sca: texto(b.sca, 10),
        tostador: texto(b.tostador, 60),
        notas: texto(b.notas, 200), // separadas por "; "
        descripcion: texto(b.descripcion, 600),
        imagen: texto(b.imagen, 400),
      };

      let producto;
      try {
        [producto] = await crear(fila);
      } catch (err) {
        // Si la migración del costo o del tipo todavía no se corrió, creamos
        // igual: el costo se deduce del precio hasta que exista la columna.
        console.warn("admin-productos: reintento sin costo_kg/tipo:", err.message);
        const { costo_kg, tipo, ...sinExtras } = fila;
        [producto] = await crear(sinExtras);
      }

      // Presentaciones: unidad + pack, con los precios ya calculados
      await sb("presentaciones", {
        method: "POST",
        body: [
          { id: `${id}-unidad`, producto_id: id, nombre: "Unidad", precio, unidades_stock: 1, activo: true },
          { id: `${id}-pack${cfg.packUnidades}`, producto_id: id, nombre: `Pack x${cfg.packUnidades}`, precio: pack, unidades_stock: cfg.packUnidades, activo: true },
        ],
      });

      return { statusCode: 201, headers, body: JSON.stringify({ producto, precio, precioPack: pack }) };
    }

    if (event.httpMethod === "PATCH") {
      const body = JSON.parse(event.body || "{}");
      const { id } = body;
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Falta el producto" }) };
      }
      // Actualización parcial: publicar/ocultar (activo) y/o marcar sin
      // reposición (descontinuado). Solo se tocan los campos que vengan.
      const cambios = {};
      if (body.activo !== undefined) cambios.activo = Boolean(body.activo);
      if (body.descontinuado !== undefined) cambios.descontinuado = Boolean(body.descontinuado);
      if (!Object.keys(cambios).length) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "No hay nada para actualizar" }) };
      }
      const [producto] = await sb(`productos?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: cambios,
      });
      if (!producto) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "Producto inexistente" }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ producto }) };
    }

    if (event.httpMethod === "DELETE") {
      const id = (event.queryStringParameters || {}).id;
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Falta el producto" }) };
      }
      // Las presentaciones se borran solas (on delete cascade); los pedidos ya
      // hechos no se tocan: guardan nombre/precio propios, no una referencia viva.
      await sb(`productos?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  } catch (err) {
    console.error("admin-productos:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No se pudo completar la operación" }) };
  }
};
