-- ============================================================
-- Merla Coffee — Migración: Ciclo de despacho y seguimiento de envíos
-- Pegar en: Supabase → SQL Editor → New query → Run
-- Se puede correr más de una vez sin romper nada.
-- ============================================================

alter table pedidos
  add column if not exists estado_entrega text not null default 'pendiente';

alter table pedidos drop constraint if exists pedidos_estado_entrega_check;
alter table pedidos add constraint pedidos_estado_entrega_check
  check (estado_entrega in ('pendiente', 'preparando', 'listo_retiro', 'despachado', 'entregado'));

alter table pedidos add column if not exists tracking_codigo text;
alter table pedidos add column if not exists tracking_url text;
alter table pedidos add column if not exists despachado_en timestamptz;
alter table pedidos add column if not exists envio_costo_real integer;

create index if not exists pedidos_despacho_idx on pedidos (estado, estado_entrega);
