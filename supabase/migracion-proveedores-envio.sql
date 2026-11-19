-- Merla Coffee — Migración: prender y apagar cada API de envío
--
-- Antes, una API de envío cotizaba con solo tener las credenciales cargadas:
-- para dejar de usar una había que borrar sus secretos y desplegar. Ahora se
-- prende y apaga desde /admin → Precios → Envío, sin tocar nada más.
--
-- Van a `configuracion` (misma tabla que gramos_por_bag, pack_unidades, etc.).
-- La columna `valor` es numérica, así que el interruptor se guarda como 1/0.
--
-- Correr una vez en Supabase → SQL Editor. Es idempotente. Sin esto no se rompe
-- nada: el backend asume las tres prendidas, como venía funcionando.

insert into configuracion (clave, valor, descripcion) values
  ('envio_zipnova',  1, '1 = se le piden tarifas de envío a Zipnova, 0 = apagada'),
  ('envio_andreani', 1, '1 = se le piden tarifas de envío a Andreani, 0 = apagada'),
  ('envio_paqar',    1, '1 = se le piden tarifas de envío a Paqar, 0 = apagada')
on conflict (clave) do nothing;
