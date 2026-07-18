-- ============================================================
-- Merla Coffee — Migración: costo de envío (Zipnova)
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
--
-- POR QUÉ: el envío a domicilio se cotiza en vivo con la API de Zipnova
-- (peso estimado según el tipo de producto × cantidad) y ese costo se suma
-- al total que se cobra por Mercado Pago. `envio_costo` guarda cuánto se
-- cobró de envío en cada pedido; los pesos por tipo de producto se agregan
-- a `configuracion` (misma tabla que ya usa gramos_por_bag, pack_unidades,
-- etc.) para poder editarlos desde el panel sin tocar código.
-- ============================================================

alter table pedidos add column if not exists envio_costo integer not null default 0;

insert into configuracion (clave, valor, descripcion) values
  ('peso_drip_bag_g',   18, 'Peso estimado de una drip bag con empaque, en gramos'),
  ('peso_cafe_bolsa_g', 270, 'Peso estimado de una bolsa de café de 1/4 kilo con empaque, en gramos'),
  ('peso_merch_g',      350, 'Peso estimado de una taza / producto simple, en gramos')
on conflict (clave) do nothing;
