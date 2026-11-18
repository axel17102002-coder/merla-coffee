// GET /.netlify/functions/tienda
// Catálogo público: productos activos con stock y presentaciones, más la
// configuración de descuentos y Club Merla. Es lo que carga la web al abrir.

const { obtenerCatalogo, sb } = require("../lib/supabase.js");
const { ambienteMp } = require("../lib/mercadopago.js");
const { CONFIG } = require("../../public/motor.js");

// `obtenerCatalogo()` trae la fila entera de productos (la usan también el
// checkout y el panel, que sí necesitan los costos). Acá sale al navegador:
// con costo_kg a la vista, y las fórmulas de motor.js siendo públicas,
// cualquiera calcula el margen exacto de cada café.
const CAMPOS_SENSIBLES = ["costo_kg", "costo"];

function sinCostos(producto) {
  const limpio = { ...producto };
  for (const campo of CAMPOS_SENSIBLES) delete limpio[campo];
  return limpio;
}

// Reseñas publicadas, las más nuevas primero. Si la tabla todavía no existe
// (falta migracion-resenas.sql) o falla, la tienda carga igual, sin reseñas.
// Primero con los datos de "compra verificada"; si esas columnas todavía no
// existen (falta migracion-resenas-clientes.sql), con las básicas.
async function resenasPublicadas() {
  const campos = ["nombre,texto,detalle,estrellas,producto,verificada", "nombre,texto,detalle,estrellas"];
  for (const select of campos) {
    try {
      return await sb(`resenas?select=${select}&activo=is.true&order=creado.desc&limit=12`);
    } catch (err) {
      console.warn("tienda: no pude leer las reseñas con", select, "→", err.message);
    }
  }
  return [];
}

exports.handler = async () => {
  try {
    const [catalogo, resenas] = await Promise.all([obtenerCatalogo(), resenasPublicadas()]);
    const productos = catalogo.map(sinCostos);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30",
      },
      body: JSON.stringify({
        productos,
        resenas,
        // pagoAmbiente le avisa al frontend si el cobro online es de prueba
        // Lista explícita: NO mandamos todo CONFIG para no filtrar nada
        // sensible sin querer (los costos y márgenes viven en la base y son
        // solo del panel).
        config: {
          pagos: CONFIG.pagos,
          descuentoCantidad: CONFIG.descuentoCantidad,
          descuentoPorcentaje: CONFIG.descuentoPorcentaje,
          transferencia: CONFIG.transferencia,
          pack: CONFIG.pack,
          fidelidad: CONFIG.fidelidad,
          pagoAmbiente: CONFIG.pagos.mercadopago ? await ambienteMp() : process.env.MODO_ENV || "test",
        },
      }),
    };
  } catch (err) {
    console.error("tienda:", err);
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "No pudimos cargar la tienda. Probá de nuevo." }),
    };
  }
};
