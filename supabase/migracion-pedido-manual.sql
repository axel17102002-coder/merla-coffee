-- ============================================================
-- Merla Coffee — Migración: pedidos cargados a mano desde /admin
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
--
-- Agrega los canales 'mayorista' y 'directa' y deja que "Marcar cobrado" y
-- "Rechazar" funcionen con ellos.
-- ============================================================

alter table pedidos drop constraint if exists pedidos_origen_check;
alter table pedidos add constraint pedidos_origen_check
  check (origen in ('modo', 'whatsapp', 'mercadopago', 'mayorista', 'directa'));

-- Se parte de la definición que está en la base, y no de una copia, para no
-- pisar ningún ajuste que tenga la función: solo cambia a qué canales aplica.
do $$
declare
  funcion text;
  definicion text;
begin
  foreach funcion in array array['aprobar_pedido_manual(uuid)', 'rechazar_pedido_manual(uuid)'] loop
    definicion := pg_get_functiondef(funcion::regprocedure);
    definicion := replace(definicion, $t$origen = 'whatsapp'$t$, $t$origen in ('whatsapp', 'mayorista', 'directa')$t$);
    if position('mayorista' in definicion) = 0 then
      raise exception 'No se pudo actualizar %: no tiene el filtro esperado', funcion;
    end if;
    execute definicion;
  end loop;
end $$;
