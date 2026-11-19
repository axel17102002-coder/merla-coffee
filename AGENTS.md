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
wrangler.toml      config de Cloudflare (assets, cron cada hora, vars)
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
- **Tests**: `node --test` corre `test/*.test.js` (reglas de precio, cobro y
  envío), sin dependencias ni red. Si la máquina no tiene Node, se corren con el
  JavaScriptCore de macOS: ver `test/arnes-jsc.js`. Si tocás plata (motor,
  webhook, cron, cancelación), corrélos y sumá el caso nuevo.
- **No hay tests de UI.** Para verificar cambios de UI, conducí el navegador
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
- **Pedidos cargados a mano** (`/admin → + Nuevo pedido`, canales en
  `ORIGENES_MANUALES`): el precio lo fija el admin, no el motor, y suman puntos
  solo si tienen email. Los descuentos son opcionales (`calcularDescuentosManual`). El cron no los borra ni les manda recordatorio aunque estén pendientes.
- **No existe tabla de "carritos"**: el carrito vive en `localStorage` del cliente
  hasta que confirma. Lo más parecido a un carrito abandonado son los pedidos
  `pendiente`, que un cron (cada hora, `wrangler.toml` → `[triggers]`) borra a las 48 h.
  A las 2 h (Mercado Pago) o 24 h (WhatsApp) les manda un mail con un link que
  rearma el carrito (`?retomar=`, lo lee `retomarPedidoDeURL` en `app.js`).
- **Un pendiente de Mercado Pago puede estar pago.** Si el aviso de MP no llegó,
  el pedido queda `pendiente` con la plata cobrada. Por eso el cron primero
  concilia contra la API de MP (`conciliarPagosMp`) y solo recuerda o borra los
  que MP confirmó sin pago. No agregues otro borrado de pendientes que se saltee eso.
- **Tres caminos acreditan un pago de MP** (webhook, `confirmar-pedido` y el
  cron) y los tres pasan por `backend/lib/cobro.js` → `acreditarPagoMp`. El
  webhook responde 500 a propósito cuando algo nuestro falla: así MP reintenta.
- **Cancelar ≠ eliminar.** `cancelar_pedido` (SQL, botón "Cancelar" del panel)
  revierte puntos, cupón y, si se pide, stock de un pedido cobrado y lo deja
  `cancelado`. `DELETE` solo borra la fila. Ninguno devuelve la plata.
- **Una sola dirección**: `www.` y `merla-coffee.merlacoffee.workers.dev` redirigen
  (301) a `merlacoffee.com.ar` (`backend/lib/dominio.js`, lo aplica `src/worker.js`).
  `/api/*` y los POST **nunca** se redirigen: MP guarda la URL del webhook al
  crear cada pago y un aviso redirigido llegaría sin cuerpo.
- **Los archivos de `public/` no pasan por el Worker**: Cloudflare los sirve
  directo. Solo las rutas de `run_worker_first` (`wrangler.toml` → `[assets]`)
  y las que no son un archivo ejecutan `src/worker.js`. Si agregás lógica que
  tiene que correr al abrir una página nueva, sumá esa ruta ahí.
- **Canjear puntos exige verificar el email**: código de 6 dígitos por mail →
  "pase" firmado en `localStorage` (`backend/lib/canje.js`, sin tablas: todo sale
  de un HMAC). Los tres checkouts rechazan `canjePuntos` sin `canjePase` válido.
  Si agregás otro lugar donde se gasten puntos, tiene que pedir el pase.
- **`/?producto=<id>` se reescribe en el Worker** (`backend/lib/pagina.js`): título,
  `og:`, precio y stock del producto en el HTML, para Google Merchant, Meta y las
  vistas previas de links. Si cambiás las etiquetas del `<head>` de `index.html`,
  revisá que los selectores de `paginaTienda` (`src/worker.js`) sigan encontrándolas.
- **Agotados en la tienda**: la grilla muestra solo productos con stock; los
  agotados van en la fila "Vuelven pronto" (`renderGrilla` en `app.js`) y los
  agotados marcados `descontinuado` no se muestran. Para que un café agotado
  desaparezca de la tienda, marcarlo descontinuado en el panel.
- **Reseñas**: tabla `resenas` (migraciones `migracion-resenas.sql` y
  `migracion-resenas-clientes.sql`). Llegan por dos caminos: el admin las carga
  a mano en `/admin → Reseñas`, o las deja el cliente desde el link que le manda
  el cron 5-14 días después de comprar (`pedirResenas`, `backend/lib/resenas.js`,
  endpoint `/api/resena`). Las de clientes entran `pendiente` + `verificada`, no
  se publican hasta que el admin las aprueba y no se editan. Son opiniones
  reales: no cargues texto de ejemplo en producción.
- **Perfil de sabor**: `productos.perfil_dulzor/acidez/cuerpo` (1 a 5, migración
  `migracion-perfil.sql`), se editan en el panel. La tienda los usa para las
  barritas y para "¿Cuál es para vos?" (`GUSTOS` en `app.js`); un café sin los
  tres valores no muestra perfil ni entra en la recomendación.
- **Foto de producto desde la etiqueta**: en el panel (Productos → Editar) se
  sube el PDF o PNG de la etiqueta y `public/etiqueta.js` la monta en el
  navegador sobre `img/maestra/bolsa-limpia.jpg` usando `calibracion.json`
  (posición, color, luz y reflejo). Si cambia la foto maestra, se regeneran
  los dos con `herramientas/calibrar-maestra.swift`. pdf.js se carga de cdnjs
  junto con su worker en la misma página (un Worker de otro dominio se cuelga).
- **Íconos**: sprite SVG al principio de `index.html` (`<symbol id="i-...">`),
  se usan con `icono("nombre")` en `app.js`. Para uno nuevo, sumá el `<symbol>`.
- **Pasarelas de pago**: se prenden/apagan en `motor.js` → `CONFIG.pagos`. Hoy
  Mercado Pago activo, MODO implementado pero apagado.
- **APIs de envío**: se prenden/apagan desde `/admin → Precios → Envío` (claves
  `envio_zipnova` / `envio_andreani` / `envio_paqar` en `configuracion`, 1/0).
  Cotizan solo si tienen credenciales **y** están prendidas; el filtro se aplica
  en `envio-costo.js`, también al recobrar, así un carrito viejo no puede pagar
  por una API apagada. Es distinto del interruptor de **transportistas** (qué
  correo se muestra, tabla `transportistas`): uno elige a quién le preguntamos
  la tarifa, el otro cuál de las tarifas se ofrece.
- **Sin credenciales de un servicio no se rompe nada**: mails (Brevo) y envío a
  domicilio (Zipnova) se degradan con aviso; el resto sigue funcionando.
