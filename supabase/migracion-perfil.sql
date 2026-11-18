-- ============================================================
-- Merla Coffee — Migración: perfil de sabor de cada café
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
-- ============================================================
--
-- Dulzor, acidez y cuerpo de 1 a 5. Se cargan desde /admin → Productos →
-- Editar y la tienda los muestra como barritas (para elegir sin saber de café)
-- y los usa en "¿Cuál es para vos?". Vacíos = no se muestran.

alter table productos add column if not exists perfil_dulzor smallint;
alter table productos add column if not exists perfil_acidez smallint;
alter table productos add column if not exists perfil_cuerpo smallint;

alter table productos drop constraint if exists productos_perfil_check;
alter table productos add constraint productos_perfil_check check (
  (perfil_dulzor is null or perfil_dulzor between 1 and 5) and
  (perfil_acidez is null or perfil_acidez between 1 and 5) and
  (perfil_cuerpo is null or perfil_cuerpo between 1 and 5)
);
