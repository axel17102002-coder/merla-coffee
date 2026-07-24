-- Merla Coffee — Migración: método de pago de Mercado Pago por pedido
--
-- Guarda con qué método se pagó cada pedido de Mercado Pago (lo devuelve la API
-- de MP al confirmar el pago). Se usa para aplicar la comisión correcta por
-- método en la contribución marginal de Insights. Valores normalizados:
-- dinero / debito / credito / prepaga / cuotas_sin_tarjeta / otros.
--
-- Solo se completa en pedidos NUEVOS (de acá en adelante). Los históricos quedan
-- en null y usan la comisión promedio general (`comision_mercadopago`), igual que
-- los métodos que no tengan su % cargado. Correr una vez en el SQL Editor.

alter table pedidos add column if not exists mp_metodo text;

comment on column pedidos.mp_metodo is
  'Método de pago de Mercado Pago normalizado (dinero/debito/credito/prepaga/cuotas_sin_tarjeta/otros), para aplicar su comisión.';

-- Comisión de cada método (%). 0 = usar el promedio general. Se editan desde
-- /admin → Precios → Configuración.
insert into configuracion (clave, valor, descripcion) values
  ('comision_mp_dinero', 0, 'Comisión de Mercado Pago (%) pagando con dinero en cuenta'),
  ('comision_mp_debito', 0, 'Comisión de Mercado Pago (%) pagando con tarjeta de débito'),
  ('comision_mp_credito', 0, 'Comisión de Mercado Pago (%) pagando con tarjeta de crédito'),
  ('comision_mp_prepaga', 0, 'Comisión de Mercado Pago (%) pagando con tarjeta prepaga'),
  ('comision_mp_cuotas_sin_tarjeta', 0, 'Comisión de Mercado Pago (%) pagando en cuotas sin tarjeta')
on conflict (clave) do nothing;
