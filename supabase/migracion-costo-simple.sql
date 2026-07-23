-- Merla Coffee — Migración: costo de los productos simples
--
-- Los productos simples (tazas, café en bolsa 1/4, etc.) tenían precio cargado a
-- mano pero SIN costo ni margen. Esta columna guarda el costo de UNA unidad para
-- poder ver el margen igual que en los cafés. Es opcional: si queda null, el
-- producto se comporta como antes (precio a mano, sin margen).
--
-- Correr una sola vez en Supabase → SQL Editor.

alter table productos add column if not exists costo_unidad numeric;

comment on column productos.costo_unidad is
  'Costo de una unidad de un producto simple (tipo=simple). Null en los cafés, que usan costo_kg + insumos.';
