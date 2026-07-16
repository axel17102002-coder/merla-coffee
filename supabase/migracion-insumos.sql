-- ============================================================
-- Merla Coffee — Migración: insumos y configuración de costos
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
--
-- POR QUÉ: los costos y el margen estaban en public/motor.js, un archivo que
-- se descarga al navegador → cualquiera veía la estructura de costos en
-- /api/tienda. Ahora viven acá y solo los lee el panel (con ADMIN_TOKEN).
-- Además se pueden editar sin tocar código, que es lo que hace falta cuando
-- aumentan los insumos.
-- ============================================================

-- ---------- Insumos: lo que cuesta armar una drip bag / un pack ----------
-- `aplica`: 'unidad' = por cada drip bag · 'pack' = una vez por pack x5
create table if not exists insumos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  costo numeric not null check (costo >= 0),
  aplica text not null check (aplica in ('unidad', 'pack')),
  creado timestamptz not null default now()
);
alter table insumos enable row level security;

-- ---------- Configuración general (clave → valor) ----------
create table if not exists configuracion (
  clave text primary key,
  valor numeric not null,
  descripcion text
);
alter table configuracion enable row level security;

-- Valores actuales (los mismos que estaban en motor.js, así nada cambia de precio)
insert into configuracion (clave, valor, descripcion) values
  ('margen_unidad',  40, '% de margen objetivo sobre el precio de venta de la unidad'),
  ('gramos_por_bag', 12, 'gramos de café por drip bag'),
  ('pack_unidades',   5, 'drip bags que trae el pack'),
  ('pack_descuento', 10, '% OFF del pack respecto de las unidades sueltas')
on conflict (clave) do nothing;

-- Insumos iniciales: se cargan SIN desglosar para que las cuentas den igual
-- que antes (462,62 por bag y 828,65 por pack). Desde el panel se pueden
-- separar en filtro, sachet, etiqueta, etc. sin que cambie ningún precio.
insert into insumos (nombre, costo, aplica)
select 'Insumos por drip bag (sin desglosar)', 462.62, 'unidad'
where not exists (select 1 from insumos where aplica = 'unidad');

insert into insumos (nombre, costo, aplica)
select 'Insumos del pack (sin desglosar)', 828.65, 'pack'
where not exists (select 1 from insumos where aplica = 'pack');

-- ---------- Costo del café: pasa de la bolsa de 250 g al KILO ----------
-- Es más estándar para comparar proveedores. La conversión es exacta (×4), así
-- que no cambia ningún precio.
alter table productos add column if not exists costo_kg numeric;

update productos
  set costo_kg = round((costo_250g * 4)::numeric, 2)
  where costo_kg is null and costo_250g is not null;

alter table productos drop column if exists costo_250g;

comment on column productos.costo_kg is
  'Costo del kilo de café en grano. El precio de venta se calcula con las tablas insumos y configuracion.';
