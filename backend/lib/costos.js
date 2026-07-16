// Configuración de costos: vive en la base (tablas `insumos` y `configuracion`)
// y NUNCA se manda al navegador salvo al panel autenticado. Antes estaba en
// public/motor.js, que se descarga con la web: cualquiera veía los costos.

const { sb } = require("./supabase.js");

// Valores de respaldo por si la migración todavía no se corrió. Son los que
// tenía el código antes, así los precios no cambian mientras tanto.
const RESPALDO = {
  fijoUnidad: 462.62,
  fijoPack: 828.65,
  margenUnidad: 40,
  gramosPorBag: 12,
  packUnidades: 5,
  packDescuento: 10,
};

const CLAVES = {
  margen_unidad: "margenUnidad",
  gramos_por_bag: "gramosPorBag",
  pack_unidades: "packUnidades",
  pack_descuento: "packDescuento",
};

// Arma el `cfg` que esperan las funciones de motor.js: suma los insumos por
// tipo y traduce las claves de configuración. Si algo falla, usa el respaldo.
async function obtenerCostos() {
  try {
    const [insumos, config] = await Promise.all([
      sb("insumos?select=nombre,costo,aplica&order=creado.asc"),
      sb("configuracion?select=clave,valor"),
    ]);

    const suma = (aplica) =>
      insumos.filter((i) => i.aplica === aplica).reduce((t, i) => t + Number(i.costo || 0), 0);

    const cfg = { ...RESPALDO, fijoUnidad: suma("unidad"), fijoPack: suma("pack") };
    for (const fila of config) {
      const nombre = CLAVES[fila.clave];
      if (nombre) cfg[nombre] = Number(fila.valor);
    }
    return { cfg, insumos, desdeLaBase: true };
  } catch (err) {
    console.warn("costos: uso los valores de respaldo:", err.message);
    return { cfg: { ...RESPALDO }, insumos: [], desdeLaBase: false };
  }
}

module.exports = { obtenerCostos, RESPALDO };
