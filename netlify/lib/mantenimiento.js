// Mantenimiento de la base: tareas que corren solas por cron (no las llama el
// navegador). Ver el handler `scheduled` en src/worker.js.

const { sb } = require("./supabase.js");

// Horas que un pedido puede quedar "pendiente" antes de considerarse un
// carrito abandonado y borrarse. Solo afecta pendientes: los aprobados y
// rechazados quedan siempre para poder analizar los canales de venta.
const HORAS_PENDIENTE = 48;

// Borra los pedidos pendientes más viejos que HORAS_PENDIENTE.
// Devuelve cuántos borró.
async function limpiarPedidosPendientes() {
  const limite = new Date(Date.now() - HORAS_PENDIENTE * 3600 * 1000).toISOString();
  const borrados = await sb(
    `pedidos?estado=eq.pendiente&creado=lt.${encodeURIComponent(limite)}`,
    { method: "DELETE", headers: { Prefer: "return=representation" } }
  );
  return Array.isArray(borrados) ? borrados.length : 0;
}

module.exports = { limpiarPedidosPendientes, HORAS_PENDIENTE };
