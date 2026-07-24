-- Merla Coffee — Migración: comisión promedio de Mercado Pago
--
-- Guarda un % promedio de comisión de Mercado Pago. Se usa SOLO para restarla
-- de la contribución marginal en los pedidos cobrados por ese medio (los de
-- WhatsApp no pagan comisión). Es un promedio editable desde /admin → Precios →
-- Configuración. Poné tu comisión real (varía según el plazo de acreditación).
--
-- Correr una sola vez en Supabase → SQL Editor. El 0 inicial no descuenta nada
-- hasta que cargues tu comisión.

insert into configuracion (clave, valor, descripcion) values
  ('comision_mercadopago', 0, 'Comisión promedio de Mercado Pago (%), para restar de la rentabilidad')
on conflict (clave) do nothing;
