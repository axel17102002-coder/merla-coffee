// GET /.netlify/functions/tienda
// Catálogo público: productos activos con stock y presentaciones, más la
// configuración de descuentos y Club Merla. Es lo que carga la web al abrir.

const { obtenerCatalogo } = require("../lib/supabase.js");
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
      body: JSON.stringify({ productos, config: CONFIG }),
    };
  } catch (err) {
    console.error("tienda:", err);
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "No pudimos cargar la tienda. Probá de nuevo.",
        // Diagnóstico temporal (sin valores sensibles) — quitar cuando ande
        diag: {
          hayUrl: Boolean(process.env.SUPABASE_URL),
          haySecretKey: Boolean(process.env.SUPABASE_SECRET_KEY),
          hayLegacyKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
          hayAdminToken: Boolean(process.env.ADMIN_TOKEN),
          motivo: String(err.message || err).slice(0, 120),
        },
      }),
    };
  }
};
