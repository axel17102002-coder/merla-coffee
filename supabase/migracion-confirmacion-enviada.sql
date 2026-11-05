-- ============================================================
-- Merla Coffee — Migración: registrar el mail de confirmación
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
-- ============================================================

alter table pedidos add column if not exists confirmacion_enviada timestamptz;

comment on column pedidos.confirmacion_enviada is
  'Última vez que se envió el mail de confirmación al cliente. Null = sin registro de envío.';
