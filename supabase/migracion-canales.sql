-- Migración: permitir el canal 'mercadopago' en pedidos.origen
-- (antes solo se aceptaban 'modo' y 'whatsapp').
--
-- Es 100% segura de correr en cualquier momento: solo AMPLÍA los valores
-- permitidos, no rompe nada del código actual. Corré este bloque en Supabase
-- → SQL Editor ANTES de desplegar el código que etiqueta los pagos de
-- Mercado Pago.

alter table pedidos drop constraint if exists pedidos_origen_check;
alter table pedidos add constraint pedidos_origen_check
  check (origen in ('modo', 'whatsapp', 'mercadopago'));

-- OPCIONAL — corregir el canal de los pedidos ya existentes.
-- Como MODO nunca estuvo activo en producción, todos los pedidos guardados
-- como 'modo' fueron en realidad pagos de Mercado Pago. Descomentá para
-- reetiquetarlos y que los reportes por canal queden correctos desde el inicio:
--
-- update pedidos set origen = 'mercadopago' where origen = 'modo';
