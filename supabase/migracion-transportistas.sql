-- Merla Coffee — Migración: transportistas habilitados
--
-- Qué correos se le muestran al cliente en el carrito. Antes era una lista
-- fija en el código (backend/lib/zipnova.js): para sumar o sacar uno había que
-- tocar el código y desplegar. Ahora se prende y apaga desde
-- /admin → Precios → Envío.
--
-- La tabla se completa sola: cada vez que Zipnova devuelve un transportista que
-- no está, se agrega APAGADO (nunca aparece en la tienda sin que alguien lo
-- habilite a mano) y queda listo para prenderlo desde el panel.
--
-- Correr una vez en Supabase → SQL Editor. Sin esto no se rompe nada: el
-- backend cae en la lista fija de siempre (OCA, Correo Argentino y Andreani).

create table if not exists transportistas (
  nombre text primary key,          -- tal cual lo devuelve Zipnova
  activo boolean not null default false,
  visto timestamptz not null default now()  -- última vez que apareció en una cotización
);
alter table transportistas enable row level security;

-- Los tres que ya se mostraban quedan prendidos; el resto de los que Zipnova
-- viene devolviendo se cargan apagados para que aparezcan en el panel sin
-- esperar a la próxima cotización.
insert into transportistas (nombre, activo) values
  ('OCA', true),
  ('Correo Argentino', true),
  ('Andreani', true),
  ('Andesmar', false),
  ('Urbano', false),
  ('Cruz del Sur', false),
  ('Chazki', false),
  ('Cabify Logistics', false),
  ('Toparco', false),
  ('QX Logística', false),
  ('Expreso Lancioni', false),
  ('Mostto', false),
  ('Rodriguez Hermanos', false),
  ('Lo Bruno', false),
  ('CCCargas', false),
  ('Malargue', false)
on conflict (nombre) do nothing;
