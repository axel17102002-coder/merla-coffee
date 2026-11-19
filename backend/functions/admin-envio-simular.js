// Simulador protegido de cotizaciones de envío para /admin → Gestión → Envío.
//
//   POST { cp, ciudad, provincia, pesoGramos?, valorDeclarado? }
//
// Consulta TODOS los proveedores activos en paralelo, mide el tiempo de
// respuesta de cada uno y devuelve tanto el diagnóstico por proveedor (ok, ms,
// opciones o error) como la lista final deduplicada/bonificada que vería el
// cliente en el carrito.

const { esAdmin, respuestaNoAutorizado } = require("../lib/admin.js");
const { obtenerCostos } = require("../lib/costos.js");
const { CAJAS } = require("../lib/empaque.js");
const {
  proveedoresActivos,
  deduplicarOpciones,
  aplicarEnvioGratis,
} = require("../lib/envio-costo.js");
const envioLocal = require("../lib/envio-local.js");
const zipnova = require("../lib/zipnova.js");
const andreani = require("../lib/andreani.js");
const paqar = require("../lib/paqar.js");

const PROVEEDORES = { local: envioLocal, zipnova, andreani, paqar };

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!esAdmin(event)) return respuestaNoAutorizado();
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const cp = String(body.cp || "").trim();
    const ciudad = String(body.ciudad || "").trim();
    const provincia = String(body.provincia || "").trim();
    if (!cp || !ciudad || !provincia) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Completá código postal, ciudad y provincia" }) };
    }

    const { cfg } = await obtenerCostos();
    const pesoGramos = Math.max(50, Math.round(Number(body.pesoGramos) || (cfg.pesoDripBagG * 10 + cfg.pesoCajaG)));
    const valorDeclarado = Math.max(100, Math.round(Number(body.valorDeclarado) || 20000));
    const caja = CAJAS.find((c) => pesoGramos <= c.hastaGramos) || CAJAS[CAJAS.length - 1];
    const paquete = { pesoGramos, alto: caja.alto, ancho: caja.ancho, largo: caja.largo, caja: caja.nombre };

    const activos = proveedoresActivos(cfg);
    if (!activos.length) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ paquete, valorDeclarado, porProveedor: [], opcionesCliente: [] }),
      };
    }

    const consulta = { cp, ciudad, provincia, pesoGramos, paquete, valorDeclarado, cfg };
    const porProveedor = await Promise.all(
      activos.map(async (id) => {
        const inicio = Date.now();
        try {
          const r = await PROVEEDORES[id].cotizarOpciones(consulta);
          const ms = Date.now() - inicio;
          if (r && r.ok) {
            const opciones = (r.opciones || []).map((o) => ({ ...o, proveedor: o.proveedor || id }));
            return { id, ok: true, ms, cantidad: opciones.length, opciones };
          }
          return { id, ok: false, ms, cantidad: 0, opciones: [], error: (r && r.error) || "Sin tarifas" };
        } catch (err) {
          return { id, ok: false, ms: Date.now() - inicio, cantidad: 0, opciones: [], error: err.message };
        }
      })
    );

    const crudas = porProveedor.flatMap((p) => p.opciones);
    const opcionesCliente = aplicarEnvioGratis(deduplicarOpciones(crudas), valorDeclarado, cfg).map((o) => ({
      proveedor: o.proveedor,
      tipo: o.tipo,
      transportista: o.transportista,
      servicio: o.servicio || "",
      plazo: o.plazo || "",
      precio: o.precio,
      precioOriginal: o.precioOriginal != null ? o.precioOriginal : null,
      gratis: Boolean(o.gratis),
      local: Boolean(o.local),
      sucursales: Array.isArray(o.sucursales) ? o.sucursales.length : 0,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        paquete,
        valorDeclarado,
        porProveedor: porProveedor.map(({ opciones, ...resumen }) => resumen),
        opcionesCliente,
      }),
    };
  } catch (err) {
    console.error("admin-envio-simular:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "No pudimos simular el envío" }) };
  }
};
