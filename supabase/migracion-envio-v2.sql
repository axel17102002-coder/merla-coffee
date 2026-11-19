-- ============================================================
-- Merla Coffee — Migración: Envío v2 (local en La Plata, envío gratis y tara de caja)
-- Pegar en: Supabase → SQL Editor → New query → Run
-- Se puede correr más de una vez sin pisar valores ya cambiados desde /admin.
-- ============================================================

insert into configuracion (clave, valor) values
  ('envio_local', 1),
  ('envio_local_precio', 1500),
  ('envio_gratis_desde', 0),
  ('peso_caja_g', 80)
on conflict (clave) do nothing;
