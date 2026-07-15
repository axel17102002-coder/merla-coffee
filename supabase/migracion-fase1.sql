-- ============================================================
-- Merla Coffee — Migración Fase 1
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
--
-- Incluye: etiqueta de canal (mercadopago) + backfill, números de pedido
-- secuenciales (#0001), cupones de un solo uso por email, y la columna de
-- datos de envío (para retiro/envío del carrito).
-- ============================================================

-- ---------- 1) Canal de venta correcto ----------
-- La base viva quedó con el default viejo 'modo'. Lo corregimos de verdad
-- (add column if not exists no cambia el default de una columna que ya existe).
alter table pedidos drop constraint if exists pedidos_origen_check;
alter table pedidos add constraint pedidos_origen_check
  check (origen in ('modo', 'whatsapp', 'mercadopago'));
alter table pedidos alter column origen set default 'mercadopago';

-- Backfill: los pedidos de Mercado Pago se habían guardado como 'modo'.
-- Se distinguen porque su modo_id es la referencia externa 'merla-...'
-- (los pagos reales de MODO tenían un UUID). MODO nunca cobró en producción.
update pedidos
  set origen = 'mercadopago'
  where origen = 'modo' and modo_id like 'merla-%';

-- ---------- 2) Números de pedido secuenciales ----------
-- Columna `numero` autoincremental. Se muestra como #0001 en la web y el admin.
alter table pedidos add column if not exists numero integer;

-- Backfill de los pedidos existentes, en orden de creación.
with ordenados as (
  select id, row_number() over (order by creado) as n
  from pedidos
  where numero is null
)
update pedidos p set numero = o.n
  from ordenados o where p.id = o.id;

-- Secuencia que arranca después del último número usado.
create sequence if not exists pedidos_numero_seq owned by pedidos.numero;
select setval('pedidos_numero_seq', coalesce((select max(numero) from pedidos), 0) + 1, false);
alter table pedidos alter column numero set default nextval('pedidos_numero_seq');
alter table pedidos alter column numero set not null;
create unique index if not exists pedidos_numero_idx on pedidos (numero);

-- ---------- 3) Cupones de un solo uso por email ----------
create table if not exists cupones_usados (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  email text not null,
  pedido_id uuid references pedidos(id) on delete set null,
  usado timestamptz not null default now(),
  unique (codigo, email)
);
alter table cupones_usados enable row level security;

-- ---------- 4) Datos de envío (retiro o envío a domicilio) ----------
-- jsonb: { metodo: 'retiro'|'envio', nombre, direccion, ciudad, provincia,
--          cp, telefono, notas }. Null = sin definir (pedidos viejos).
alter table pedidos add column if not exists envio jsonb;

-- ---------- 5) RPCs: registrar el uso del cupón al aprobar ----------
-- Se reemplazan aprobar_pedido (MP/MODO) y aprobar_pedido_manual (WhatsApp)
-- para que, además de todo lo anterior, dejen registrado el cupón usado.

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

  for v_item in select * from jsonb_array_elements(v_pedido.items) loop
    update productos
      set stock = greatest(stock - (v_item->>'unidades')::integer, 0)
      where id = v_item->>'producto_id';
  end loop;

  if v_pedido.cliente_email is not null and v_pedido.cliente_email <> '' then
    v_email := lower(trim(v_pedido.cliente_email));
    insert into clientes (email) values (v_email)
      on conflict (email) do nothing;
    update clientes
      set puntos = greatest(puntos - v_pedido.puntos_canjeados, 0) + v_pedido.puntos_ganados
      where email = v_email
      returning puntos into v_puntos;

    -- Registrar el cupón como usado por este email (si hubo)
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

-- Nota: la limpieza de carritos abandonados (pendientes > 48 h) ya la hace el
-- cron del Worker (src/worker.js → netlify/lib/mantenimiento.js), sin RPC.
