-- ============================================================
-- Merla Coffee — Migración: notificaciones en el celular y presupuestos
-- Pegar en: Supabase → SQL Editor → New query → Run
-- Se puede correr más de una vez sin romper nada.
-- ============================================================

-- Notificaciones del panel (Web Push): las claves con las que el servidor se
-- identifica ante Apple/Google (se generan solas, una sola fila) y un
-- registro por cada celular o compu donde se activaron.
create table if not exists push_claves (
  id integer primary key default 1 check (id = 1),
  publica text not null,
  privada_jwk jsonb not null,
  creado timestamptz not null default now()
);
create table if not exists push_suscripciones (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  dispositivo text,
  creado timestamptz not null default now()
);
alter table push_claves enable row level security;
alter table push_suscripciones enable row level security;

-- Presupuestos para clientes (mayoristas, cafeterías): se arman en /admin y
-- el cliente los ve en /presupuesto/<token>, donde puede aceptarlos.
create sequence if not exists presupuestos_numero_seq;
create table if not exists presupuestos (
  id uuid primary key default gen_random_uuid(),
  numero integer not null default nextval('presupuestos_numero_seq'),
  token text not null unique,
  cliente_nombre text not null,
  cliente_email text,
  cliente_telefono text,
  items jsonb not null default '[]'::jsonb,
  descuento_porcentaje numeric not null default 0 check (descuento_porcentaje >= 0 and descuento_porcentaje <= 100),
  subtotal integer not null default 0,
  descuento integer not null default 0,
  total integer not null default 0,
  notas text,
  validez_dias integer not null default 15 check (validez_dias between 1 and 365),
  estado text not null default 'borrador' check (estado in ('borrador', 'enviado', 'aceptado', 'rechazado')),
  aceptado_en timestamptz,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists presupuestos_creado_idx on presupuestos (creado desc);
alter table presupuestos enable row level security;
