-- Merla Coffee — Migración: recordatorio de carrito abandonado
--
-- Marca cuándo se le mandó al cliente el mail de "te quedó el pedido sin
-- confirmar". El cron (cada 6 h) recorre los pendientes de entre 24 y 48 h con
-- email cargado y sin recordatorio, manda el mail y completa esta columna, así
-- no repite en la corrida siguiente. A las 48 h el pedido se borra igual.
--
-- Correr una vez en Supabase → SQL Editor. Sin esto, el cron avisa por log y
-- sigue funcionando (solo no manda recordatorios).

alter table pedidos add column if not exists recordatorio_enviado timestamptz;

comment on column pedidos.recordatorio_enviado is
  'Cuándo se envió el mail de carrito abandonado, para no repetirlo en cada corrida del cron.';

-- Los pendientes que ya existen quedan en null: si todavía están dentro de la
-- ventana de 24-48 h, van a recibir el recordatorio en la próxima corrida.
create index if not exists pedidos_recordatorio_idx
  on pedidos (estado, recordatorio_enviado)
  where estado = 'pendiente';
