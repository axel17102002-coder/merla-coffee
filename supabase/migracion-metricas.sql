-- ============================================================
-- Merla Coffee — Migración: métricas diarias (visitas y carritos)
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
-- ============================================================
--
-- Contadores por día, para Insights en /admin:
--   visitas, visitas:<fuente>        → cada visita a la tienda (una por sesión)
--   carritos_vencidos[_monto]        → pendientes que borró el cron a las 48 h
--   carritos_recuperados             → de esos, los que igual terminaron comprando
-- No se guarda nada de las personas (ni IP, ni email): solo los totales del día.

create table if not exists metricas_dia (
  fecha date not null,
  clave text not null check (char_length(clave) between 1 and 60),
  valor numeric not null default 0,
  primary key (fecha, clave)
);
alter table metricas_dia enable row level security;

-- Suma `p_valor` al contador de hoy (hora de Argentina). Atómico: dos visitas
-- al mismo tiempo no se pisan.
create or replace function sumar_metrica(p_clave text, p_valor numeric default 1)
returns void
language sql
security definer
set search_path = public
as $$
  insert into metricas_dia (fecha, clave, valor)
  values ((now() at time zone 'America/Argentina/Buenos_Aires')::date, p_clave, p_valor)
  on conflict (fecha, clave) do update set valor = metricas_dia.valor + excluded.valor;
$$;

revoke execute on function sumar_metrica(text, numeric) from public, anon, authenticated;
grant execute on function sumar_metrica(text, numeric) to service_role;
