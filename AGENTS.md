# AGENTS.md

Guía para agentes de IA que trabajan en **Merla Coffee**. El `README.md` cubre
puesta en marcha, deploy e integraciones (Mercado Pago, Brevo, Zipnova) en
detalle — no lo repitas acá. Este archivo es el modelo mental del código, las
convenciones y las trampas.

## Qué es

Tienda de café de especialidad en drip bags: carrito, packs, cupones ocultos,
puntos Club Merla, stock, retiro/envío y pago con Mercado Pago. **Sin build
step**: HTML/CSS/JS plano. Los datos viven en **Supabase**; el sitio y el backend
corren en **Cloudflare Workers**. Todo el texto de cara al código está **en
español** (nombres de variables, funciones, comentarios) — seguí esa convención.

## Arquitectura

```
Navegador ──> Cloudflare Worker (src/worker.js) ──> Supabase (PostgREST)
                                 ├──> Mercado Pago ──webhook──> descuenta stock + puntos
                                 ├──> Brevo (mails)
                                 └──> Zipnova (cotización de envío)
```

- **El navegador nunca toca Supabase directo.** Todo pasa por el Worker, vía
  `/api/<funcion>`.
- **Nunca se confía en montos del navegador.** Precios, descuentos, puntos y
  envío se **recalculan en el servidor** al cobrar. Ver "motor.js" abajo.
- **El stock se descuenta solo al confirmar el pago**: Mercado Pago por webhook;
  los de WhatsApp, al aprobarlos manualmente en `/admin`.

## Mapa de archivos

```
public/            Lo que ve el cliente (assets estáticos servidos por el Worker)
  index.html · app.js          tienda
  admin.html · admin.js · admin.css   panel privado (/admin)
  motor.js                     REGLAS compartidas front/back (precios, packs, puntos)
  styles.css · img/
src/
  worker.js        entrada de Cloudflare: rutea /api/* y sirve public/; handler `scheduled` (cron)
  adaptador.js     convierte Request de Cloudflare ⇄ el `event` estilo Netlify de los handlers
backend/           El servidor (nunca lo ve el navegador)
  functions/       un archivo por endpoint = /api/<nombre>
  lib/             clientes/helpers: supabase, mercadopago, brevo, admin, zipnova, envio-costo…
supabase/          SQL: schema.sql (todo desde cero) + migracion-*.sql
wrangler.toml      config de Cloudflare (assets, cron cada 6 h, vars)
```

### `motor.js` es especial

Vive en `public/` porque lo usan **los dos lados**: el navegador (para mostrar) y
el backend (para cobrar, vía `require("../../public/motor.js")`). Es la **única
fuente de verdad** de precios, packs, puntos y configuración (`CONFIG`). Si tocás
una regla de precio/punto, va acá y aplica en ambos lados a la vez.

## Cómo agregar un endpoint

1. Creá `backend/functions/mi-endpoint.js` que exporte `exports.handler = async (event) => {...}`.
   Devolvé `{ statusCode, headers, body }` (body es string JSON).
2. **Registralo en `src/worker.js`**: agregá el `import` y una entrada en el mapa
   `rutas`. Esto es fácil de olvidar y es lo que hace que `/api/mi-endpoint`
   exista. No hay descubrimiento automático de archivos.
3. Si es de administración, empezá con
   `if (!esAdmin(event)) return respuestaNoAutorizado();` (ver `backend/lib/admin.js`).
4. Para datos, usá los helpers `sb()` / `sbRpc()` de `backend/lib/supabase.js`
   (hablan con PostgREST). No hay ORM ni conexión SQL directa.

## Convenciones

- **Auth de admin**: header `X-Admin-Token` comparado con `ADMIN_TOKEN` por
  `timingSafeEqual`. El front lo guarda en `sessionStorage` y lo manda en cada
  `fetch` (ver `api()` en `admin.js`). No hay sesiones ni cookies.
- **Front sin framework**: vanilla JS con un helper `$ = (s) => document.querySelector(s)`,
  render por `innerHTML` con plantillas, y **siempre `escapar()` los datos del
  usuario** antes de meterlos en HTML.
- **Productos nacen ocultos** (`activo = false`); se publican desde el panel.
  Dos tipos: `cafe` (precio por fórmula desde el costo del kilo) y `simple`
  (tazas, café en bolsa 1/4; precio a mano, stock en unidades directas).
- **Migraciones**: cambios de schema van como `supabase/migracion-*.sql` nuevos y
  también reflejados en `schema.sql` (que recrea todo desde cero). Se corren a
  mano en el SQL Editor de Supabase.
- **Número de pedido** (`#0001`): secuencia de Postgres `pedidos_numero_seq`, no un
  contador en el código. Se reinicia con `setval(...)` en el SQL Editor.

## Desarrollo y pruebas

- **Correr local**: `npx wrangler dev --port 8788` → http://localhost:8788.
  Secretos en `.dev.vars` (gitignoreado; copia de `.env`). **Ojo: apunta al
  Supabase real** — las mutaciones son reales; si probás algo destructivo (bajar
  stock, borrar), restaurá el estado después.
- **Admin de prueba**: entrá a `/admin` con el `ADMIN_TOKEN` de `.dev.vars`.
- **No hay test suite.** Para verificar cambios de UI, conducí el navegador
  headless (Playwright/chromium) contra `wrangler dev`: login con el token,
  navegá la sección y chequeá `console --errors`. Los `confirm()` nativos hay que
  aceptarlos desde el driver (`page.on("dialog", d => d.accept())`).
- **Chequeo de sintaxis rápido**: `node --check <archivo>`.
- **Deploy**: cada push a `main` publica solo en Cloudflare (`keep_vars` conserva
  los secretos). El flujo del repo es commitear directo a `main`.

## Trampas conocidas

- **Insights** (`admin.js`) calcula todo sobre los **últimos 200 pedidos** que
  trae `admin-pedidos`. Un rango de fechas más viejo que esa ventana queda
  incompleto. Si el volumen crece, mover el cálculo a una vista/endpoint de Supabase.
- **No existe tabla de "carritos"**: el carrito vive en `localStorage` del cliente
  hasta que confirma. Lo más parecido a un carrito abandonado son los pedidos
  `pendiente`, que un cron (cada 6 h, `wrangler.toml` → `[triggers]`) borra a las 48 h.
- **Pasarelas de pago**: se prenden/apagan en `motor.js` → `CONFIG.pagos`. Hoy
  Mercado Pago activo, MODO implementado pero apagado.
- **Sin credenciales de un servicio no se rompe nada**: mails (Brevo) y envío a
  domicilio (Zipnova) se degradan con aviso; el resto sigue funcionando.
