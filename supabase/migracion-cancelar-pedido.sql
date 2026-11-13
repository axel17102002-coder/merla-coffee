-- ============================================================
-- Merla Coffee — Migración: cancelar un pedido ya cobrado
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
-- ============================================================
--
-- Qué agrega:
--   1. El estado 'cancelado' en pedidos.
--   2. La función cancelar_pedido(), que usa el botón "Cancelar pedido" de
--      /admin: en una sola transacción revierte los puntos, libera el cupón y,
--      si se pide, devuelve el stock. No devuelve la plata (eso va aparte).
--   3. Cierra el acceso a las funciones de pedidos para que solo las pueda
--      ejecutar el backend (ver el punto 3 más abajo).

-- ---------- 1. Estado nuevo ----------
alter table pedidos drop constraint if exists pedidos_estado_check;
alter table pedidos add constraint pedidos_estado_check
  check (estado in ('pendiente', 'aprobado', 'rechazado', 'cancelado'));

-- ---------- 2. Función ----------
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

-- ---------- 3. Solo el backend puede ejecutar las funciones de pedidos ----------
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
