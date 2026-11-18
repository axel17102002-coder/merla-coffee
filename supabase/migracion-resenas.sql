-- ============================================================
-- Merla Coffee — Migración: reseñas de clientes
-- Pegar TODO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr más de una vez sin romper nada.
-- ============================================================
--
-- Opiniones que se muestran en la tienda ("Lo que dicen de Merla"). Se cargan
-- a mano desde /admin → Reseñas: solo opiniones reales de clientes (por
-- ejemplo, las que llegan por WhatsApp o Instagram, con su permiso).

create table if not exists resenas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 1 and 60),
  texto text not null check (char_length(texto) between 1 and 400),
  detalle text check (detalle is null or char_length(detalle) <= 60), -- ej. "La Plata" o "Compró Brasil Sertão"
  estrellas smallint not null default 5 check (estrellas between 1 and 5),
  activo boolean not null default true,
  creado timestamptz not null default now()
);

-- Solo el backend (service_role) lee y escribe: el navegador nunca toca la base
alter table resenas enable row level security;
