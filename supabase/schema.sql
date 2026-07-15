-- ============================================================
-- Merla Coffee — Schema de Supabase
-- Pegar TODO este archivo en: Supabase → SQL Editor → New query → Run
-- Se puede correr más de una vez sin romper nada.
-- ============================================================

-- ---------- Tablas ----------

create table if not exists productos (
  id text primary key,
  nombre text not null,
  stock integer not null default 0 check (stock >= 0),
  activo boolean not null default true,
  origen text,
  region text,
  variedad text,
  proceso text,
  sca text,
  tostador text,
  notas text,          -- separadas por "; "
  descripcion text,
  imagen text,
  creado timestamptz not null default now()
);

create table if not exists presentaciones (
  id text primary key,
  producto_id text not null references productos(id) on delete cascade,
  nombre text not null,
  precio integer not null check (precio > 0),
  unidades_stock integer not null default 1 check (unidades_stock > 0),
  activo boolean not null default true
);

create table if not exists cupones (
  codigo text primary key,
  tipo text not null check (tipo in ('porcentaje', 'monto')),
  valor integer not null check (valor > 0),
  minimo integer not null default 0,
  activo boolean not null default true,
  descripcion text,
  creado timestamptz not null default now()
);

create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  puntos integer not null default 0 check (puntos >= 0),
  creado timestamptz not null default now()
);

create table if not exists pedidos (
  id uuid primary key default gen_random_uuid(),
  external_intention_id text not null unique,
  modo_id text unique,               -- id de la payment request en MODO
  items jsonb not null,              -- [{producto_id, presentacion_id, nombre, qty, unidades, precio_unitario}]
  subtotal integer not null,
  descuento_cantidad integer not null default 0,
  cupon text,
  descuento_cupon integer not null default 0,
  puntos_canjeados integer not null default 0,
  descuento_puntos integer not null default 0,
  total integer not null,
  puntos_ganados integer not null default 0,
  cliente_email text,
  origen text not null default 'mercadopago' check (origen in ('modo', 'whatsapp', 'mercadopago')),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aprobado', 'rechazado')),
  creado timestamptz not null default now(),
  actualizado timestamptz
);

create index if not exists pedidos_modo_id_idx on pedidos (modo_id);
create index if not exists pedidos_estado_idx on pedidos (estado);

-- Migración para proyectos donde la tabla pedidos ya había sido creada.
alter table pedidos add column if not exists origen text not null default 'mercadopago';
alter table pedidos drop constraint if exists pedidos_origen_check;
alter table pedidos add constraint pedidos_origen_check check (origen in ('modo', 'whatsapp', 'mercadopago'));

-- ---------- Seguridad ----------
-- RLS activado sin políticas públicas: solo la service_role key (las funciones
-- de Netlify) puede leer/escribir. El navegador nunca toca la base directo.

alter table productos enable row level security;
alter table presentaciones enable row level security;
alter table cupones enable row level security;
alter table clientes enable row level security;
alter table pedidos enable row level security;

-- ---------- Función atómica: aprobar pedido ----------
-- La llama el webhook de MODO (o la confirmación del navegador) cuando el pago
-- está ACCEPTED. En una sola transacción: descuenta stock, mueve puntos y marca
-- el pedido aprobado. Es idempotente: si ya se procesó, no hace nada.

create or replace function aprobar_pedido(p_modo_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido pedidos%rowtype;
  v_item jsonb;
  v_email text;
  v_puntos integer;
begin
  select * into v_pedido from pedidos where modo_id = p_modo_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pedido no encontrado');
  end if;

  if v_pedido.estado <> 'pendiente' then
    return jsonb_build_object('ok', true, 'ya_procesado', true, 'estado', v_pedido.estado);
  end if;

  -- Descontar stock línea por línea. Si por una carrera el stock quedó corto,
  -- el pago ya está hecho: se deja en 0 en lugar de fallar.
  for v_item in select * from jsonb_array_elements(v_pedido.items) loop
    update productos
      set stock = greatest(stock - (v_item->>'unidades')::integer, 0)
      where id = v_item->>'producto_id';
  end loop;

  -- Puntos Club Merla
  if v_pedido.cliente_email is not null and v_pedido.cliente_email <> '' then
    v_email := lower(trim(v_pedido.cliente_email));
    insert into clientes (email) values (v_email)
      on conflict (email) do nothing;
    update clientes
      set puntos = greatest(puntos - v_pedido.puntos_canjeados, 0) + v_pedido.puntos_ganados
      where email = v_email
      returning puntos into v_puntos;
  end if;

  update pedidos set estado = 'aprobado', actualizado = now() where id = v_pedido.id;

  return jsonb_build_object('ok', true, 'puntos', coalesce(v_puntos, 0));
end;
$$;

-- Marcar pedido rechazado (solo si sigue pendiente)
create or replace function rechazar_pedido(p_modo_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update pedidos set estado = 'rechazado', actualizado = now()
    where modo_id = p_modo_id and estado = 'pendiente';
  return jsonb_build_object('ok', true);
end;
$$;

-- Los pedidos por WhatsApp se crean como pendientes. Desde la interfaz privada
-- de administración se confirma el cobro: recién ahí se descuenta el stock y
-- se acreditan/descuentan los puntos.
create or replace function aprobar_pedido_manual(p_pedido_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido pedidos%rowtype;
  v_item jsonb;
  v_email text;
  v_puntos integer;
begin
  select * into v_pedido
    from pedidos
    where id = p_pedido_id and origen = 'whatsapp'
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pedido de WhatsApp no encontrado');
  end if;
  if v_pedido.estado <> 'pendiente' then
    return jsonb_build_object('ok', true, 'ya_procesado', true, 'estado', v_pedido.estado);
  end if;

  -- No permite confirmar una venta manual si otro pedido ya agotó el stock.
  if exists (
    select 1
    from (
      select valor->>'producto_id' as producto_id,
             sum((valor->>'unidades')::integer) as unidades
      from jsonb_array_elements(v_pedido.items) as valor
      group by valor->>'producto_id'
    ) requerido
    join productos p on p.id = requerido.producto_id
    where p.stock < requerido.unidades
  ) then
    return jsonb_build_object('ok', false, 'error', 'Stock insuficiente para confirmar este pedido');
  end if;

  for v_item in select * from jsonb_array_elements(v_pedido.items) loop
    update productos
      set stock = stock - (v_item->>'unidades')::integer
      where id = v_item->>'producto_id';
  end loop;

  if v_pedido.cliente_email is not null and v_pedido.cliente_email <> '' then
    v_email := lower(trim(v_pedido.cliente_email));
    insert into clientes (email) values (v_email) on conflict (email) do nothing;
    update clientes
      set puntos = greatest(puntos - v_pedido.puntos_canjeados, 0) + v_pedido.puntos_ganados
      where email = v_email
      returning puntos into v_puntos;
  end if;

  update pedidos set estado = 'aprobado', actualizado = now() where id = v_pedido.id;
  return jsonb_build_object('ok', true, 'puntos', coalesce(v_puntos, 0));
end;
$$;

create or replace function rechazar_pedido_manual(p_pedido_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update pedidos set estado = 'rechazado', actualizado = now()
    where id = p_pedido_id and origen = 'whatsapp' and estado = 'pendiente';
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- Datos iniciales ----------
-- Productos (mismos datos que supabase-import/productos.csv)

insert into productos (id, nombre, stock, activo, origen, region, variedad, proceso, sca, tostador, notas, descripcion, imagen) values
('brasil-honey', 'Brasil Honey Cup', 0, true, 'Brasil', 'Alta Mogiana, Brasil', 'Caturra', 'Semi lavado', '83,5', 'Rito Tostadores', 'Azúcar morena; Almendras; Frambuesas', 'Un café brasileño de la región Alta Mogiana, cultivado entre 1000 y 1200 m y procesado mediante método semi lavado, que realza su dulzura natural. Proveniente de cooperativas locales, destaca por su cuerpo equilibrado. Una taza suave, dulce y persistente, perfecta para disfrutar en cualquier momento.', 'img/brasil-honey.webp'),
('oldfashion', 'Oldfashion', 24, true, 'Colombia', 'Huila, Pitalito (Colombia)', 'Bourbon y Caturra', 'Lavado', '84,5', 'La Motofeca', 'Especias; Chocolate; Pasas de uva', 'Cultivado entre 1650 y 2100 m de altitud, destaca por su cuerpo medio, acidez equilibrada y una complejidad aromática que recuerda al clásico cóctel que le da nombre. Con una dulzura sutil y persistente, es un café redondo y aromático, ideal para quienes disfrutan de perfiles intensos y elegantes.', 'img/oldfashion.webp'),
('peru', 'Perú', 4, true, 'Perú', 'Rodríguez de Mendoza, Perú', 'Blend de variedades', 'Lavado, secado en camas africanas', null, 'Jack Flash', 'Naranja; Toffee; Avellanas', 'Crece entre 1650 y 2100 m de altitud, donde el clima templado favorece una maduración lenta del grano. Ofrece una taza limpia y balanceada con acidez media melosa y un final dulce y persistente. Un café elegante y complejo, ideal para quienes disfrutan de matices cítricos y dulces.', 'img/peru.webp'),
('volcanico', 'Volcánico', 20, true, 'Colombia', 'Tolima, Chaparral (Colombia)', 'Caturra, Colombia y Castillo', 'Lavado', null, 'Momo Tostadores', 'Miel; Toffee; Frutas amarillas', 'Cultivado entre 1500 y 2000 m de altitud, destaca por su buen cuerpo, una acidez media vibrante y un perfil que evoca el clásico café colombiano. Con un dulzor equilibrado y toques cítricos, es un café amable y balanceado, dulce, fresco y reconfortante.', 'img/volcanico.webp'),
('brasil', 'Brasil', 12, true, 'Brasil', 'Espíritu Santo, Brasil', 'Catuaí Amarillo y Rojo', 'Natural', '87', 'Familia Cabrales', 'Caramelo; Frutos rojos; Cítricos dulces', 'Microlote cultivado entre 750 y 900 m de altitud por Wallace Junior Schneider. Su proceso natural potencia la dulzura y una acidez brillante y jugosa. Cuerpo medio y aroma intenso: ideal para quienes disfrutan de perfiles frutales y balanceados.', 'img/brasil.webp'),
('silverio-nina', 'Silverio Nina', 16, true, 'Bolivia', 'Los Yungas, Bolivia', 'Caturra', 'Lavado', null, 'Momo Tostadores', 'Caramelo; Cítricos; Ciruela', 'Cultivado a más de 1550 m de altitud, destaca por su cuerpo agradable, una acidez refrescante y un perfil notablemente limpio, con un dulzor llamativo y persistente. Un café elegante y fresco, ideal para una taza frutal a cualquier hora del día.', 'img/silverio-nina.webp'),
('andino', 'Andino', 30, true, 'Colombia', 'Quindío, Colombia', 'Caturra, Colombia, Catimor y Castillo', 'Lavado', null, 'Momo Tostadores', 'Caramelo; Frutos rojos; Cítrico', 'Cultivado entre 1500 y 2000 m de altitud, destaca por su buen cuerpo, acidez media vibrante y un perfil clásico irresistible, con una dulzura fresca y balanceada. Un café amable, ideal para quienes disfrutan de la elegancia de un tradicional café colombiano.', 'img/andino.webp')
on conflict (id) do nothing;

-- Presentaciones (mismos datos que supabase-import/presentaciones.csv)

insert into presentaciones (id, producto_id, nombre, precio, unidades_stock, activo) values
('brasil-honey-unidad', 'brasil-honey', 'Unidad', 1720, 1, true),
('brasil-honey-pack5', 'brasil-honey', 'Pack x5', 7740, 5, true),
('oldfashion-unidad', 'oldfashion', 'Unidad', 2360, 1, true),
('oldfashion-pack5', 'oldfashion', 'Pack x5', 10620, 5, true),
('peru-unidad', 'peru', 'Unidad', 2270, 1, true),
('peru-pack5', 'peru', 'Pack x5', 10215, 5, true),
('volcanico-unidad', 'volcanico', 'Unidad', 2100, 1, true),
('volcanico-pack5', 'volcanico', 'Pack x5', 9450, 5, true),
('brasil-unidad', 'brasil', 'Unidad', 2100, 1, true),
('brasil-pack5', 'brasil', 'Pack x5', 9450, 5, true),
('silverio-nina-unidad', 'silverio-nina', 'Unidad', 2100, 1, true),
('silverio-nina-pack5', 'silverio-nina', 'Pack x5', 9450, 5, true),
('andino-unidad', 'andino', 'Unidad', 2100, 1, true),
('andino-pack5', 'andino', 'Pack x5', 9450, 5, true)
on conflict (id) do nothing;

-- Cupones (ahora OCULTOS: viven solo acá; crear/desactivar desde el Table Editor)

insert into cupones (codigo, tipo, valor, minimo, activo, descripcion) values
('BIENVENIDA10', 'porcentaje', 10, 0, true, '10% OFF en tu primer pedido'),
('CAFETERO', 'monto', 2000, 15000, true, '$2.000 OFF en pedidos desde $15.000')
on conflict (codigo) do nothing;
