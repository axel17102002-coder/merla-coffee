-- ============================================================
-- Merla Coffee — Migración: método de pago y su descuento en pedidos manuales
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
-- ============================================================

alter table pedidos add column if not exists metodo_pago text;
alter table pedidos add column if not exists descuento_pago integer not null default 0;
