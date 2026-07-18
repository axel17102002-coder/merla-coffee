-- ============================================================
-- Merla Coffee — Migración: categoría de productos simples
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
-- Requiere haber corrido antes migracion-productos-simples.sql.
--
-- POR QUÉ: 'tazas' y 'café en bolsa de 1/4' son ambos productos 'simple'
-- (precio fijo, sin fórmula), pero se muestran en secciones separadas tanto
-- en el panel como en la tienda. `categoria` distingue uno del otro; en los
-- cafés ('tipo' = 'cafe') queda en null, no aplica.
-- ============================================================

alter table productos add column if not exists categoria text;
alter table productos drop constraint if exists productos_categoria_check;
alter table productos add constraint productos_categoria_check
  check (categoria is null or categoria in ('cafe_bolsa', 'merch'));

comment on column productos.categoria is
  'Solo para productos ''simple'': ''cafe_bolsa'' (café en bolsa de 1/4) o ''merch'' (tazas y otros). Null en los cafés (''tipo'' = ''cafe'').';
