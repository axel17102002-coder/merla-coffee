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
  // Comisión promedio de Mercado Pago (%). Solo se usa para restarla de la
  // rentabilidad en los pedidos cobrados por ese medio. 0 = no descontar.
  comisionMp: 0,
  // Comisión por método de pago de MP (%). El pedido guarda con qué método se
  // pagó (`mp_metodo`); si su % es 0 se usa el promedio de arriba.
  comisionMpMetodos: {
    dinero: 0,
    debito: 0,
    credito: 0,
    prepaga: 0,
    cuotas_sin_tarjeta: 0,
  },
};

const CLAVES = {
  margen_unidad: "margenUnidad",
  gramos_por_bag: "gramosPorBag",
  pack_unidades: "packUnidades",
  pack_descuento: "packDescuento",
  peso_drip_bag_g: "pesoDripBagG",
  peso_cafe_bolsa_g: "pesoCafeBolsaG",
  peso_merch_g: "pesoMerchG",
  comision_mercadopago: "comisionMp",
};

// Comisiones por método de MP: van anidadas en cfg.comisionMpMetodos, con la
// misma clave que guarda `pedidos.mp_metodo` (ver METODOS_MP en motor.js).
const CLAVES_METODO_MP = {
  comision_mp_dinero: "dinero",
  comision_mp_debito: "debito",
  comision_mp_credito: "credito",
  comision_mp_prepaga: "prepaga",
  comision_mp_cuotas_sin_tarjeta: "cuotas_sin_tarjeta",
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

    const cfg = {
      ...RESPALDO,
      comisionMpMetodos: { ...RESPALDO.comisionMpMetodos },
      fijoUnidad: suma("cant_unidad"),
      fijoPack: suma("cant_pack"),
    };
    for (const fila of config) {
      const nombre = CLAVES[fila.clave];
      if (nombre) cfg[nombre] = Number(fila.valor);
      const metodo = CLAVES_METODO_MP[fila.clave];
      if (metodo) cfg.comisionMpMetodos[metodo] = Number(fila.valor);
    }
    return { cfg, insumos, desdeLaBase: true };
  } catch (err) {
    console.warn("costos: uso los valores de respaldo:", err.message);
    return {
      cfg: { ...RESPALDO, comisionMpMetodos: { ...RESPALDO.comisionMpMetodos } },
      insumos: [],
      desdeLaBase: false,
    };
  }
}

module.exports = { obtenerCostos, RESPALDO };
