-- ============================================================
-- Merla Coffee — Migración: marca "sin reposición" por producto
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
--
-- POR QUÉ: en public/app.js los cafés "sin reposición" (los que muestran
-- "🔥 Últimas N unidades" en la tienda) estaban hardcodeados por id
-- (andino, silverio-nina). Cada vez que un café se discontinuaba había que
-- tocar el código y volver a deployar. Ahora es un flag que se edita desde el
-- panel (pestaña "Productos y Stock").
-- ============================================================

alter table productos add column if not exists descontinuado boolean not null default false;

comment on column productos.descontinuado is
  'true = producto sin reposición: la tienda muestra "Últimas N unidades" en vez del stock normal.';

-- Backfill: los dos cafés que hasta ahora estaban hardcodeados en el código.
update productos set descontinuado = true where id in ('andino', 'silverio-nina');
