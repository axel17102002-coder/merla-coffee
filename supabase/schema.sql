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
  -- 'cafe': precio calculado por fórmula desde costo_kg (motor.js).
  -- 'simple': precio fijo, cargado a mano (tazas, cafés en bolsa 1/4, etc.)
  tipo text not null default 'cafe' check (tipo in ('cafe', 'simple')),
  -- Solo para 'simple': 'cafe_bolsa' o 'merch'. Null en los cafés.
  categoria text check (categoria is null or categoria in ('cafe_bolsa', 'merch')),
  origen text,
  region text,
  variedad text,
  proceso text,
  sca text,
  tostador text,
  notas text,          -- separadas por "; "
  descripcion text,
  imagen text,
  -- Perfil de sabor de 1 a 5 (migracion-perfil.sql): barritas en la tienda y "¿Cuál es para vos?"
  perfil_dulzor smallint check (perfil_dulzor is null or perfil_dulzor between 1 and 5),
  perfil_acidez smallint check (perfil_acidez is null or perfil_acidez between 1 and 5),
  perfil_cuerpo smallint check (perfil_cuerpo is null or perfil_cuerpo between 1 and 5),
  creado timestamptz not null default now()
);
alter table productos add column if not exists perfil_dulzor smallint;
alter table productos add column if not exists perfil_acidez smallint;
alter table productos add column if not exists perfil_cuerpo smallint;

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
  tipo text not null check (tipo in ('porcentaje', 'monto', '2x1_drip')),
  valor integer not null check (valor > 0),
  minimo integer not null default 0,
  activo boolean not null default true,
  descripcion text,
  creado timestamptz not null default now()
);
alter table cupones drop constraint if exists cupones_tipo_check;
alter table cupones add constraint cupones_tipo_check
  check (tipo in ('porcentaje', 'monto', '2x1_drip'));

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
  numero integer,                    -- número de pedido secuencial (#0001); ver secuencia abajo
  envio jsonb,                       -- { metodo:'retiro'|'envio', nombre, direccion, ciudad, provincia, cp, telefono, notas }
  envio_costo integer not null default 0, -- cotizado con Zipnova; 0 si es retiro
  origen text not null default 'mercadopago' check (origen in ('modo', 'whatsapp', 'mercadopago', 'mayorista', 'directa')),
  metodo_pago text,                  -- pedidos manuales: con qué pagó (ver METODOS_PAGO_MANUAL en motor.js)
  descuento_pago integer not null default 0, -- pedidos manuales: descuento por transferencia
  mp_metodo text,                    -- método con que se pagó en MP (dinero/debito/credito/prepaga/cuotas_sin_tarjeta/otros), para su comisión
  recordatorio_enviado timestamptz,  -- cuándo se mandó el mail de carrito abandonado (para no repetirlo)
  confirmacion_enviada timestamptz,  -- última vez que se envió el mail de confirmación
  mp_pago_id text,                   -- payment_id de Mercado Pago, para cruzar con su panel
  resena_pedida timestamptz,         -- cuándo se le pidió al cliente que opine (mail del cron)
  estado_entrega text not null default 'pendiente'
    check (estado_entrega in ('pendiente', 'preparando', 'listo_retiro', 'despachado', 'entregado')),
  tracking_codigo text,              -- código de seguimiento del correo
  tracking_url text,                 -- link directo de seguimiento
  despachado_en timestamptz,         -- cuándo se despachó o quedó listo para retirar
  envio_costo_real integer,          -- lo que salió realmente el envío (opcional, para margen)
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aprobado', 'rechazado', 'cancelado')),
  creado timestamptz not null default now(),
  actualizado timestamptz
);

create index if not exists pedidos_modo_id_idx on pedidos (modo_id);
create index if not exists pedidos_estado_idx on pedidos (estado);

-- Migración para proyectos donde la tabla pedidos ya había sido creada.
alter table pedidos add column if not exists origen text not null default 'mercadopago';
alter table pedidos alter column origen set default 'mercadopago';
alter table pedidos drop constraint if exists pedidos_origen_check;
alter table pedidos add constraint pedidos_origen_check check (origen in ('modo', 'whatsapp', 'mercadopago', 'mayorista', 'directa'));
alter table pedidos add column if not exists numero integer;
alter table pedidos add column if not exists envio jsonb;
alter table pedidos add column if not exists mp_metodo text;
alter table pedidos add column if not exists metodo_pago text;
alter table pedidos add column if not exists descuento_pago integer not null default 0;
alter table pedidos add column if not exists recordatorio_enviado timestamptz;
alter table pedidos add column if not exists mp_pago_id text;
alter table pedidos add column if not exists resena_pedida timestamptz;
alter table pedidos add column if not exists estado_entrega text not null default 'pendiente';
alter table pedidos drop constraint if exists pedidos_estado_entrega_check;
alter table pedidos add constraint pedidos_estado_entrega_check
  check (estado_entrega in ('pendiente', 'preparando', 'listo_retiro', 'despachado', 'entregado'));
alter table pedidos add column if not exists tracking_codigo text;
alter table pedidos add column if not exists tracking_url text;
alter table pedidos add column if not exists despachado_en timestamptz;
alter table pedidos add column if not exists envio_costo_real integer;
create index if not exists pedidos_despacho_idx on pedidos (estado, estado_entrega);
alter table pedidos drop constraint if exists pedidos_estado_check;
alter table pedidos add constraint pedidos_estado_check
  check (estado in ('pendiente', 'aprobado', 'rechazado', 'cancelado'));

-- Números de pedido secuenciales (#0001). Backfill por orden de creación + secuencia.
with ordenados as (
  select id, row_number() over (order by creado) as n from pedidos where numero is null
)
update pedidos p set numero = o.n from ordenados o where p.id = o.id;
create sequence if not exists pedidos_numero_seq owned by pedidos.numero;
select setval('pedidos_numero_seq', coalesce((select max(numero) from pedidos), 0) + 1, false);
alter table pedidos alter column numero set default nextval('pedidos_numero_seq');
create unique index if not exists pedidos_numero_idx on pedidos (numero);

-- Cupones ya usados: un cupón no se puede reutilizar con el mismo email.
create table if not exists cupones_usados (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  email text not null,
  pedido_id uuid references pedidos(id) on delete set null,
  usado timestamptz not null default now(),
  unique (codigo, email)
);

-- Reseñas de clientes para la tienda (se cargan desde /admin → Reseñas)
create table if not exists resenas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 1 and 60),
  texto text not null check (char_length(texto) between 1 and 400),
  detalle text check (detalle is null or char_length(detalle) <= 60),
  estrellas smallint not null default 5 check (estrellas between 1 and 5),
  activo boolean not null default true,
  creado timestamptz not null default now(),
  -- Reseñas que deja el cliente desde el link del mail (migracion-resenas-clientes.sql)
  pedido_id uuid references pedidos(id) on delete set null,
  producto text check (producto is null or char_length(producto) <= 120),
  verificada boolean not null default false,
  pendiente boolean not null default false
);
create unique index if not exists resenas_pedido_idx on resenas (pedido_id) where pedido_id is not null;

-- ---------- Seguridad ----------
-- RLS activado sin políticas públicas: solo la service_role key (las funciones
-- de Netlify) puede leer/escribir. El navegador nunca toca la base directo.

alter table productos enable row level security;
alter table presentaciones enable row level security;
alter table cupones enable row level security;
alter table cupones_usados enable row level security;
alter table clientes enable row level security;
alter table pedidos enable row level security;
alter table resenas enable row level security;

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

    if v_pedido.cupon is not null and v_pedido.cupon <> '' then
      insert into cupones_usados (codigo, email, pedido_id)
        values (upper(v_pedido.cupon), v_email, v_pedido.id)
        on conflict (codigo, email) do nothing;
    end if;
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
    where id = p_pedido_id and origen in ('whatsapp', 'mayorista', 'directa')
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

    if v_pedido.cupon is not null and v_pedido.cupon <> '' then
      insert into cupones_usados (codigo, email, pedido_id)
        values (upper(v_pedido.cupon), v_email, v_pedido.id)
        on conflict (codigo, email) do nothing;
    end if;
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
    where id = p_pedido_id and origen in ('whatsapp', 'mayorista', 'directa') and estado = 'pendiente';
  return jsonb_build_object('ok', true);
end;
$$;

-- Cancelar un pedido ya cobrado (botón "Cancelar pedido" de /admin): revierte
-- puntos, libera el cupón y, si se pide, devuelve el stock. No devuelve la plata.
create or replace function cancelar_pedido(p_pedido_id uuid, p_devolver_stock boolean default true)
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
  select * into v_pedido from pedidos where id = p_pedido_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pedido no encontrado');
  end if;
  -- Idempotente: cancelar dos veces no devuelve el stock ni los puntos dos veces
  if v_pedido.estado = 'cancelado' then
    return jsonb_build_object('ok', true, 'ya_procesado', true);
  end if;
  -- Un pendiente o rechazado nunca descontó stock ni movió puntos: no hay nada que revertir
  if v_pedido.estado <> 'aprobado' then
    return jsonb_build_object('ok', false, 'error', 'Solo se puede cancelar un pedido cobrado');
  end if;

  -- Stock: opcional, porque a veces el café ya se entregó o se perdió
  if p_devolver_stock then
    for v_item in select * from jsonb_array_elements(v_pedido.items) loop
      update productos
        set stock = stock + coalesce((v_item->>'unidades')::integer, 0)
        where id = v_item->>'producto_id';
    end loop;
  end if;

  -- Puntos y cupón: la cuenta inversa a la de aprobar. Si el cliente ya gastó
  -- los puntos que había ganado, el saldo queda en 0 (nunca negativo).
  if v_pedido.cliente_email is not null and v_pedido.cliente_email <> '' then
    v_email := lower(trim(v_pedido.cliente_email));
    update clientes
      set puntos = greatest(puntos - v_pedido.puntos_ganados, 0) + v_pedido.puntos_canjeados
      where email = v_email
      returning puntos into v_puntos;

    -- Solo el uso que registró ESTE pedido: si el cupón figuraba usado por otro
    -- pedido del mismo email, sigue usado.
    delete from cupones_usados where pedido_id = v_pedido.id;
  end if;

  update pedidos set estado = 'cancelado', actualizado = now() where id = v_pedido.id;

  return jsonb_build_object('ok', true, 'puntos', coalesce(v_puntos, 0), 'stock_devuelto', p_devolver_stock);
end;
$$;

-- Solo el backend puede ejecutar las funciones de pedidos.
-- Por defecto Postgres deja ejecutar una función a cualquier rol, incluido el
-- `anon` de Supabase (el de la clave pública). El sitio nunca usa esa clave,
-- pero si alguien la consiguiera podría aprobar o cancelar pedidos llamando a
-- estas funciones directo. Se les quita el permiso a todos menos al backend
-- (`service_role`, el de SUPABASE_SECRET_KEY).
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('aprobar_pedido', 'rechazar_pedido', 'aprobar_pedido_manual',
                        'rechazar_pedido_manual', 'cancelar_pedido')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.firma);
    execute format('grant execute on function %s to service_role', f.firma);
  end loop;
end;
$$;

-- Nota: la limpieza de carritos abandonados (pendientes > 48 h) la hace el cron
-- del Worker (src/worker.js → backend/lib/mantenimiento.js), no un RPC.

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
