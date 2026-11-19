-- ============================================================
-- Merla Coffee — Migración: Cupón 2×1 en drip bag (la más barata)
-- Pegar en: Supabase → SQL Editor → New query → Run
-- Se puede correr más de una vez sin romper nada.
-- ============================================================

alter table cupones drop constraint if exists cupones_tipo_check;
alter table cupones add constraint cupones_tipo_check
  check (tipo in ('porcentaje', 'monto', '2x1_drip'));
