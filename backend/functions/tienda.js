// GET /.netlify/functions/tienda
// Catálogo público: productos activos con stock y presentaciones, más la
// configuración de descuentos y Club Merla. Es lo que carga la web al abrir.

const { obtenerCatalogo } = require("../lib/supabase.js");
const { ambienteMp } = require("../lib/mercadopago.js");
const { CONFIG } = require("../../public/motor.js");

exports.handler = async () => {
  try {
    const productos = await obtenerCatalogo();
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30",
      },
      body: JSON.stringify({
        productos,
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
