-- ============================================================
-- Merla Coffee — Migración: productos simples (sin fórmula de café)
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
--
-- POR QUÉ: hasta ahora todo producto era un café vendido en drip bags, con
-- su precio calculado desde el costo del kilo (ver motor.js). Para vender
-- ítems que no siguen esa fórmula (tazas, cafés en bolsa de 1/4 kilo, etc.)
-- se suma `productos.tipo`: 'cafe' (el flujo de siempre) o 'simple' (precio
-- fijo a mano, stock en unidades planas, sin campos de origen/variedad).
-- ============================================================

alter table productos add column if not exists tipo text not null default 'cafe';
alter table productos drop constraint if exists productos_tipo_check;
alter table productos add constraint productos_tipo_check check (tipo in ('cafe', 'simple'));

comment on column productos.tipo is
  '''cafe'': precio calculado por fórmula desde costo_kg (motor.js). ''simple'': precio fijo, cargado a mano.';
