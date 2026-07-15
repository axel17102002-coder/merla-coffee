-- ============================================================
-- Merla Coffee — Migración: costo del café por producto
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
--
-- A partir de ahora el admin carga UN solo número por café (lo que cuesta la
-- bolsa de 250 g) y el sistema calcula el precio de la unidad y del pack.
-- ============================================================

alter table productos add column if not exists costo_250g numeric;

comment on column productos.costo_250g is
  'Costo de la bolsa de café en grano de 250 g. El precio de venta se calcula con motor.js (CONFIG.costos).';

-- Backfill: para los cafés que ya tenían precio cargado, se deduce el costo que
-- lo explica, así los precios actuales no cambian ni un peso.
--   precio_unidad = (fijoUnidad + costo_250g/250*12) / (1 - margen)
--   ⇒ costo_250g  = (precio_unidad * (1 - margen) - fijoUnidad) / 12 * 250
-- Las constantes replican CONFIG.costos de public/motor.js:
--   margenUnidad = 40%  → (1 - 0,40) = 0,6
--   fijoUnidad   = 462,62
--   gramosPorUnidad = 12 · gramosBolsa = 250
update productos p
set costo_250g = round(((pr.precio * 0.6 - 462.62) / 12 * 250)::numeric, 2)
from presentaciones pr
where pr.producto_id = p.id
  and pr.unidades_stock = 1
  and pr.precio > 0
  and p.costo_250g is null;
