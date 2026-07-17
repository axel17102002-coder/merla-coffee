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
-- `costo` es el precio de UNA pieza del insumo; `cant_unidad` y `cant_pack`
-- dicen cuántas piezas entran en la unidad y en el pack (ej: la drip bag
-- filtrante entra 1 vez en la unidad y 5 en el pack; el doypack, 1 y 1).
create table if not exists insumos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  costo numeric not null check (costo >= 0),
  cant_unidad numeric not null default 0 check (cant_unidad >= 0),
  cant_pack numeric not null default 0 check (cant_pack >= 0),
  creado timestamptz not null default now()
);
alter table insumos enable row level security;

-- ---------- Cantidades por presentación ----------
-- La planilla real muestra que el pack NO es "5 unidades completas": lleva
-- 5 drip bags pero UN solo doypack/sobre/stickers. Cada insumo dice cuántas
-- veces entra en la unidad y cuántas en el pack.
alter table insumos add column if not exists cant_unidad numeric not null default 0;
alter table insumos add column if not exists cant_pack numeric not null default 0;

-- Backfill desde el modelo viejo (aplica: 'unidad' | 'pack'), si existe
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'insumos' and column_name = 'aplica') then
    update insumos set cant_unidad = 1, cant_pack = 0
      where aplica = 'unidad' and cant_unidad = 0 and cant_pack = 0;
    update insumos set cant_unidad = 0, cant_pack = 1
      where aplica = 'pack' and cant_unidad = 0 and cant_pack = 0;
    alter table insumos drop column aplica;
  end if;
end $$;


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

-- Insumos iniciales: solo si la tabla está vacía (instalación desde cero).
-- Son los totales sin desglosar; desde el panel se separan en filtro, doypack,
-- stickers, etc. sin que cambie ningún precio.
insert into insumos (nombre, costo, cant_unidad, cant_pack)
select 'Insumos por drip bag (sin desglosar)', 462.62, 1, 0
where not exists (select 1 from insumos);

insert into insumos (nombre, costo, cant_unidad, cant_pack)
select 'Insumos del pack (sin desglosar)', 828.65, 0, 1
where not exists (select 1 from insumos where cant_pack > 0);

-- ---------- Costo del café: pasa de la bolsa de 250 g al KILO ----------
-- Es más estándar para comparar proveedores. La conversión es exacta (×4), así
-- que no cambia ningún precio.
alter table productos add column if not exists costo_kg numeric;

-- Backfill solo si la columna vieja todavía existe (si no, ya se migró)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'productos' and column_name = 'costo_250g') then
    update productos
      set costo_kg = round((costo_250g * 4)::numeric, 2)
      where costo_kg is null and costo_250g is not null;
    alter table productos drop column costo_250g;
  end if;
end $$;

comment on column productos.costo_kg is
  'Costo del kilo de café en grano. El precio de venta se calcula con las tablas insumos y configuracion.';
