-- Merla Coffee — Migración: id del pago de Mercado Pago
--
-- Guarda el `payment_id` que devuelve la API de MP al acreditarse el cobro.
-- Sirve para cruzar un pedido con el panel de Mercado Pago: auditar un cobro,
-- seguir un contracargo o rehacer el método de pago si quedó mal cargado.
-- Hasta ahora solo guardábamos nuestra propia referencia (modo_id), que en el
-- panel de MP figura como "referencia externa" pero no permite ir al revés.
--
-- Solo se completa en pedidos NUEVOS. Correr una vez en el SQL Editor; sin
-- esto el cobro funciona igual (se avisa por log y se guarda solo el método).

alter table pedidos add column if not exists mp_pago_id text;

comment on column pedidos.mp_pago_id is
  'payment_id de Mercado Pago, para cruzar el pedido con el panel de MP.';

create index if not exists pedidos_mp_pago_id_idx on pedidos (mp_pago_id);
