// Configuración de costos: vive en la base (tablas `insumos` y `configuracion`)
// y NUNCA se manda al navegador salvo al panel autenticado.
//
// Modelo de insumos (calcado de la planilla del negocio): cada insumo tiene el
// costo de UNA pieza y cuántas piezas entran en la unidad y en el pack.
//   fijoUnidad = Σ costo × cant_unidad     fijoPack = Σ costo × cant_pack
// Ej.: la drip bag filtrante entra 1 vez en la unidad y 5 en el pack; el
// doypack y los stickers, 1 y 1.

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
  // Peso estimado por tipo de producto (gramos), para cotizar el envío con Zipnova
  pesoDripBagG: 18,
  pesoCafeBolsaG: 270,
  pesoMerchG: 350,
};

const CLAVES = {
  margen_unidad: "margenUnidad",
  gramos_por_bag: "gramosPorBag",
  pack_unidades: "packUnidades",
  pack_descuento: "packDescuento",
  peso_drip_bag_g: "pesoDripBagG",
  peso_cafe_bolsa_g: "pesoCafeBolsaG",
  peso_merch_g: "pesoMerchG",
};

// Trae los insumos tolerando el esquema viejo (columna `aplica` en vez de
// cantidades), para que el panel siga andando hasta re-correr la migración.
async function traerInsumos() {
  try {
    return await sb("insumos?select=id,nombre,costo,cant_unidad,cant_pack&order=creado.asc");
  } catch (err) {
    console.warn("costos: esquema viejo de insumos (re-correr migracion-insumos.sql):", err.message);
    const viejos = await sb("insumos?select=id,nombre,costo,aplica&order=creado.asc");
    return viejos.map((i) => ({
      id: i.id,
      nombre: i.nombre,
      costo: i.costo,
      cant_unidad: i.aplica === "unidad" ? 1 : 0,
      cant_pack: i.aplica === "pack" ? 1 : 0,
    }));
  }
}

// Arma el `cfg` que esperan las funciones de motor.js. Si algo falla (la
// migración base no se corrió), usa el respaldo.
async function obtenerCostos() {
  try {
    const [insumos, config] = await Promise.all([
      traerInsumos(),
      sb("configuracion?select=clave,valor"),
    ]);

    const suma = (campo) =>
      Math.round(insumos.reduce((t, i) => t + Number(i.costo || 0) * Number(i[campo] || 0), 0) * 100) / 100;

    const cfg = { ...RESPALDO, fijoUnidad: suma("cant_unidad"), fijoPack: suma("cant_pack") };
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
