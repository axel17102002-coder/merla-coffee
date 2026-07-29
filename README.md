# Merla Coffee — Sitio web

Tienda de café de especialidad en drip bags: carrito, packs, cupones ocultos, puntos Club Merla, **stock automático**, retiro/envío y pago online con **Mercado Pago**. Los datos viven en **Supabase**; el sitio y el backend corren en **Cloudflare Workers**.

## Arquitectura

```
Navegador ──> Cloudflare Worker ──> Supabase (productos, stock, cupones, clientes, pedidos)
              (src/worker.js)   │
                                ├──> API de Mercado Pago ──webhook──> descuenta stock + puntos
                                └──> Brevo (mails de aviso y confirmación)
```

- El navegador **nunca** toca Supabase directo: todo pasa por el Worker.
- Los precios/descuentos se calculan con `motor.js` tanto en la web (para mostrar) como en el servidor (para cobrar): no se puede pagar un monto adulterado.
- El stock se descuenta **solo cuando se confirma el pago**: Mercado Pago lo hace por webhook; los de WhatsApp, al aprobarlos en `/admin`.

## Archivos

```
public/            La web que ve el cliente
  index.html         tienda · admin.html  panel privado
  app.js             lógica de la tienda · admin.js  lógica del panel
  motor.js           REGLAS compartidas (precios, costos, packs, puntos)
  styles.css · admin.css · img/

src/
  worker.js          entrada de Cloudflare: rutea /api/* y sirve public/
  adaptador.js       convierte Request de Cloudflare ⇄ el `event` de los handlers

backend/           El servidor (nunca lo ve el navegador)
  functions/         un archivo por endpoint (= /api/<nombre>)
  lib/               clientes: supabase, mercadopago, brevo, modo, admin…

supabase/          SQL: schema.sql (todo desde cero) + migraciones
wrangler.toml      configuración de Cloudflare (assets, cron, vars)
```

`motor.js` vive en `public/` porque lo usan **los dos lados**: el navegador (para mostrar) y el backend (para cobrar). Es la única fuente de verdad de los precios.

## Puesta en marcha (una sola vez)

1. **Crear las tablas**: en [Supabase](https://supabase.com) → tu proyecto → **SQL Editor** → pegá todo el contenido de `supabase/schema.sql` → **Run**. Eso crea las tablas con los 7 cafés, las presentaciones y 2 cupones de ejemplo.
2. **Claves locales**: copiá `.env.example` a `.env` y completá `SUPABASE_URL` (la **Project URL**, no la URL del Dashboard), `SUPABASE_SECRET_KEY` (la clave `sb_secret_...`) y `ADMIN_TOKEN` (una clave larga para administrar pedidos). Están en Supabase → **Connect** o **Settings → API Keys**. Si tu proyecto todavía usa claves legacy, podés usar `SUPABASE_SERVICE_ROLE_KEY`. El `.env` está gitignoreado: nunca se sube. Para probar con Cloudflare local también: `cp .env .dev.vars`.
3. **Probar local**: `npx wrangler dev --port 8788` y abrir http://localhost:8788

## Publicar en Cloudflare (hosting principal)

1. Entrá a [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Import a repository** y elegí `merla-coffee`.
2. Build command: `echo listo` (no hay build). Deploy command: `npx wrangler deploy` (el default). Toda la configuración real está en `wrangler.toml`.
3. En el proyecto → **Settings → Variables and Secrets** cargá como **Secret**: `SUPABASE_SECRET_KEY`, `ADMIN_TOKEN`, `MP_ACCESS_TOKEN` y `BREVO_API_KEY`. Después **Retry deployment**.
4. Cada push a `main` publica solo. La URL queda tipo `https://merla-coffee.<tu-cuenta>.workers.dev` (el webhook de Mercado Pago la detecta automáticamente).

La web llama al backend por `/api/<funcion>` y `src/worker.js` lo rutea al archivo correspondiente de `backend/functions/`.

## Administración diaria (desde `/admin`)

Entrá a `https://<tu-sitio>/admin` con tu `ADMIN_TOKEN`. Todo se hace desde ahí:

- **Pedidos**: todos los canales, con número (#0001), filtros (Todos / Mercado Pago / WhatsApp), 🗑 para borrar y ✉️ para (re)enviar la confirmación. Los de WhatsApp se aprueban con **Marcar cobrado** (descuenta stock y suma puntos); **Rechazar** no toca el stock.
- **Stock**: cargás los gramos de café en grano y calcula las drip bags (12 g c/u). "Sumar" agrega; "Fijar" reemplaza.
- **Precios**: cargás el costo de la bolsa de 250 g y calcula la unidad y el pack. El precio se puede redondear a mano (botón ≈) y muestra el margen real.
- **Cupones**: crear/editar y activar/desactivar. **No se muestran en la web**: pasalos por Instagram/WhatsApp. Se usan una vez por email.
- **Productos**: alta con foto (se sube a Supabase Storage). Nacen **ocultos**: se publican con un botón cuando hay stock. Dos tipos: **☕ Café** (precio por fórmula desde el costo del kilo, como siempre) o **🏷️ Producto simple** (tazas, cafés en bolsa de 1/4 kilo, etc.): se carga el precio de venta a mano, sin costo ni margen, y el stock es en unidades directas (sin conversión a drip bags).

Los carritos abandonados (pendientes > 48 h) los borra solo un cron cada 6 h (`wrangler.toml` → `[triggers]`).

## Club Merla

1 punto por cada $100 al confirmar un pago (Mercado Pago o WhatsApp; el cliente deja su email al comprar, sin registro). Con 350 puntos canjea $1.500 desde el carrito. La config está en `motor.js` (`CONFIG.fidelidad`).

## Reglas de precios (en `motor.js`)

- 5% OFF llevando 5+ unidades sueltas (los packs no cuentan: ya tienen su descuento).
- El pack x5 sale del precio unitario con 10% OFF (`CONFIG.pack`); el precio unitario sale del costo de los 250 g con 40% de margen (`CONFIG.costos`), y se puede fijar a mano desde el panel.
- Canje de puntos: requiere pedido de al menos 2× el descuento.

## Pago online (Mercado Pago / MODO)

Las pasarelas se prenden y apagan en `public/motor.js` → `CONFIG.pagos`. Hoy: **Mercado Pago activo, MODO apagado** (implementado y listo para reactivar).

### Mercado Pago (Checkout Pro) — pasarela activa

El botón "Pagar con Mercado Pago" redirige al checkout de MP; al aprobarse el pago (webhook `mercadopago-webhook` + respaldo `confirmar-pedido`) se descuenta stock y se acreditan puntos. Solo necesita **una** variable: `MP_ACCESS_TOKEN`.

1. Entrá al [panel de desarrolladores de MP](https://www.mercadopago.com.ar/developers/panel) → **Crear aplicación** (tipo: pagos online, Checkout Pro).
2. En **Credenciales de prueba**: copiá el **Access Token** (`TEST-...`) para sandbox — no cobra de verdad y el carrito lo avisa.
3. Cargalo como `MP_ACCESS_TOKEN` en `.env`/`.dev.vars` (local) y como **Secret** en Cloudflare → Settings → Variables and Secrets.
4. Para cobrar en serio: repetir con el Access Token **productivo** (`APP_USR-...`). Nada más — el ambiente se detecta solo por el prefijo del token.

Tarjetas de prueba y docs: https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards

### MODO — apagado, para reactivar algún día

1. Alta en un gateway (recomendado: Decidir Plus de [Payway](https://www.payway.com.ar)).
2. Pedir credenciales productivas en [modo.com.ar/comercios/tiendas-online](https://www.modo.com.ar/comercios/tiendas-online) (~48 hs hábiles).
3. Variables: `MODO_ENV=produccion`, `MODO_USERNAME`, `MODO_PASSWORD`, `MODO_PROCESSOR_CODE`, `MODO_CC_CODE=1CSI`.
4. En `motor.js`: `CONFIG.pagos.modo = true`. En `app.js`: `MODO_AMBIENTE = "produccion"`. Volver a publicar.

Docs: https://merchants.modo.com.ar/docs

## Mails (Brevo)

Avisos automáticos y confirmaciones al cliente. Se usa **Brevo** (plan gratis: 300 mails/día) porque permite enviar desde una casilla de Gmail verificada, sin dominio propio.

- **Automático**: al cobrarse una venta por Mercado Pago salen dos mails: el aviso a `MAIL_ADMIN` y la confirmación al cliente. Un pedido nuevo de WhatsApp solo avisa al admin (todavía no se cobró).
- **Manual**: en `/admin`, el botón ✉️ de cada pedido (re)envía la confirmación al cliente.

Configuración (una sola vez):

1. En [brevo.com](https://www.brevo.com) → **Settings → Senders** → agregar `merlacoffee@gmail.com` y verificarlo con el link que llega por mail.
2. **Settings → SMTP & API → API Keys** → generar una key.
3. Cargar en `.env`/`.dev.vars` (local) y como **Secret** en Cloudflare: `BREVO_API_KEY`. Opcionales: `MAIL_REMITENTE` y `MAIL_ADMIN` (por defecto `merlacoffee@gmail.com`).

Sin `BREVO_API_KEY` no se rompe nada: los mails simplemente no se envían y queda el aviso en los logs.

## Envío (Zipnova y/o Andreani)

El envío se cotiza **en vivo** según el peso estimado de lo que se compra, y ese costo se suma al total que se cobra (Mercado Pago o WhatsApp): nunca se confía en un monto mandado por el navegador, se vuelve a calcular en el servidor al pagar.

Hay **dos proveedores de tarifas** y se pueden usar juntos:

| | Qué es | Credenciales |
|---|---|---|
| **Zipnova** | Agregador: una integración, muchos transportistas (OCA, Correo Argentino, Andesmar, Chazki…) | Autoservicio |
| **Andreani** | Directo al transportista, sin el margen del agregador | Las da su equipo comercial con el contrato |

Si están los dos configurados, se cotizan **en paralelo** y las opciones se mezclan en una sola lista ordenada por precio — al cliente le da igual de dónde sale la tarifa. Si uno falla o está caído, el otro igual responde. Qué transportistas se muestran se elige en `/admin` → Precios → Envío, y ese interruptor aplica a los dos proveedores por igual.

- **Peso estimado**: cada tipo de producto (drip bag, café en bolsa de 1/4, tazas/otros) tiene un peso configurable en `/admin` → Precios → Envío. Se usa `peso × unidades del carrito` para cotizar.
- **Retiro** no cotiza nada: el envío solo entra en juego cuando el cliente elige "Envío a domicilio" y carga su código postal.
- **Sin credenciales** no se rompe nada: el envío a domicilio queda deshabilitado con un aviso claro (retiro y WhatsApp sin envío siguen funcionando).

### Configurar Zipnova

1. Creá una cuenta en [Zipnova](https://www.zipnova.com/ar/productos/envios) y pedí tus credenciales de integración por **API con autenticación Basic** (token + secret de una cuenta propia; no hace falta el flujo OAuth, que es para apps multi-cuenta).
2. Cargá `ZIPNOVA_TOKEN`, `ZIPNOVA_SECRET` y `ZIPNOVA_ACCOUNT_ID` en `.env`/`.dev.vars` (local) y como **Secrets** en Cloudflare → Settings → Variables and Secrets.

Docs de la API: https://docs.zipnova.com/envios/recursos-api/envios/cotizar-envios

### Configurar Andreani

1. Registrá la cuenta de negocio en [Andreani](https://www.andreani.com/) y pedile a tu ejecutivo comercial las **credenciales de API** y los **números de contrato**. Ojo: Andreani asigna un contrato distinto por modalidad (uno para entrega a domicilio y otro para entrega en sucursal); podés tener uno solo.
2. Cargá en `.env`/`.dev.vars` y como Secrets en Cloudflare:
   - `ANDREANI_USUARIO`, `ANDREANI_PASSWORD` — para el login que devuelve el token
   - `ANDREANI_CLIENTE` — tu número de cliente
   - `ANDREANI_SUCURSAL_ORIGEN` — desde dónde se despacha
   - `ANDREANI_CONTRATO_DOMICILIO` y/o `ANDREANI_CONTRATO_SUCURSAL`
   - `ANDREANI_AMBIENTE=qa` mientras probás (apunta a `apisqa.andreani.com`); vacío = producción
3. **Probá primero en QA**: pedí un envío de prueba desde el carrito con un CP real y mirá en los logs de `wrangler dev` que la cotización vuelva con precio. Recién ahí sacá `ANDREANI_AMBIENTE`.

Endpoints que usa la integración (`backend/lib/andreani.js`): `GET /login` (Basic → token en el header `x-authorization-token`), `GET /v1/tarifas` (cotización) y `GET /v2/sucursales` (puntos de retiro).

En `/admin` → Precios → Envío el aviso de arriba dice con qué proveedores está cotizando y cuáles quedan sin conectar.

## Notas

- El número de WhatsApp está en `WHATSAPP` al inicio de `app.js`.
