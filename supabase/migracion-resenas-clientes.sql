-- ============================================================
-- Merla Coffee — Migración: reseñas que dejan los clientes
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
-- (Va después de migracion-resenas.sql.)
-- ============================================================
--
-- Unos días después de cada compra cobrada, el cron le manda al cliente un
-- mail con un link personal para opinar. Lo que escribe llega a /admin →
-- Reseñas como "nueva" y se publica recién cuando el admin la aprueba.

-- De qué pedido viene la reseña (una sola por pedido) y qué compró
alter table resenas add column if not exists pedido_id uuid references pedidos(id) on delete set null;
alter table resenas add column if not exists producto text;
-- true = la dejó un cliente desde su link de compra ("Compra verificada")
alter table resenas add column if not exists verificada boolean not null default false;
-- true = la dejó un cliente y todavía nadie la revisó
alter table resenas add column if not exists pendiente boolean not null default false;

alter table resenas drop constraint if exists resenas_producto_check;
alter table resenas add constraint resenas_producto_check
  check (producto is null or char_length(producto) <= 120);

create unique index if not exists resenas_pedido_idx on resenas (pedido_id) where pedido_id is not null;

-- Cuándo se le pidió la reseña al cliente (para no pedírsela dos veces)
alter table pedidos add column if not exists resena_pedida timestamptz;
