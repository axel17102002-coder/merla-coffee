# Merla Coffee — Sitio web

Tienda de café de especialidad en drip bags: carrito, packs, cupones ocultos, puntos Club Merla, **stock automático** y pago online con MODO. Los datos viven en **Supabase**; el sitio y las funciones corren en **Netlify**.

## Arquitectura

```
Navegador ──> Funciones Netlify ──> Supabase (productos, stock, cupones, clientes, pedidos)
                    │
                    └──> API de MODO (pagos)  ──webhook──> descuenta stock + acredita puntos
```

- El navegador **nunca** toca Supabase directo: todo pasa por las funciones.
- Los precios/descuentos se calculan con `motor.js` tanto en la web (para mostrar) como en el servidor (para cobrar): no se puede pagar un monto adulterado.
- El stock se descuenta **solo cuando se confirma el pago**: MODO lo hace por webhook y WhatsApp desde la interfaz de administración privada.

## Archivos

- `public/` — la web (HTML, CSS, JS, imágenes)
- `src/worker.js` + `functions/_adaptador.js` — entrada de Cloudflare (reusa el backend de `netlify/functions/`)
- `wrangler.toml` — configuración de Cloudflare

- `index.html` / `styles.css` / `app.js` — la web
- `motor.js` — reglas de precios compartidas (descuentos, mínimos, puntos)
- `netlify/lib/` — clientes de Supabase y MODO
- `netlify/functions/` — el backend (compartido por ambos hostings)
  - `tienda.js` — catálogo con stock (lo que carga la web)
  - `validar-cupon.js` — valida códigos sin exponer la lista
  - `puntos.js` — saldo Club Merla por email
  - `modo-checkout.js` — crea el pago + registra el pedido
  - `modo-webhook.js` — MODO avisa el resultado → aprueba el pedido
  - `confirmar-pedido.js` — respaldo del webhook desde el navegador
  - `whatsapp-pedido.js` — registra el pedido manual como pendiente
  - `admin-pedidos.js` — lista y aprueba/rechaza pedidos de WhatsApp
- `supabase/schema.sql` — tablas, seguridad y datos iniciales

## Puesta en marcha (una sola vez)

1. **Crear las tablas**: en [Supabase](https://supabase.com) → tu proyecto → **SQL Editor** → pegá todo el contenido de `supabase/schema.sql` → **Run**. Eso crea las tablas con los 7 cafés, las presentaciones y 2 cupones de ejemplo.
2. **Claves locales**: copiá `.env.example` a `.env` y completá `SUPABASE_URL` (la **Project URL**, no la URL del Dashboard), `SUPABASE_SECRET_KEY` (la clave `sb_secret_...`) y `ADMIN_TOKEN` (una clave larga para administrar pedidos). Están en Supabase → **Connect** o **Settings → API Keys**. Si tu proyecto todavía usa claves legacy, podés usar `SUPABASE_SERVICE_ROLE_KEY`. El `.env` está gitignoreado: nunca se sube. Para probar con Cloudflare local también: `cp .env .dev.vars`.
3. **Probar local**: `npx wrangler dev --port 8788` y abrir http://localhost:8788

## Publicar en Cloudflare (hosting principal)

1. Entrá a [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Import a repository** y elegí `merla-coffee`.
2. Build command: `echo listo` (no hay build). Deploy command: `npx wrangler deploy` (el default). Toda la configuración real está en `wrangler.toml`.
3. En el proyecto → **Settings → Variables and Secrets** cargá: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (o `SUPABASE_SERVICE_ROLE_KEY`) y `ADMIN_TOKEN`. Después **Retry deployment**.
4. Cada push a `main` publica solo. La URL queda tipo `https://merla-coffee.<tu-cuenta>.workers.dev` (el webhook de MODO la usa automáticamente).

La web llama al backend por `/api/<funcion>`: en Cloudflare lo rutea `src/worker.js` y en Netlify un redirect de `netlify.toml` — el mismo código sirve en las dos plataformas (Netlify queda como plan B).

## Administración diaria (sin tocar código)

Todo desde Supabase → **Table Editor**:

- **Stock**: tabla `productos`, columna `stock`. Se descuenta al aprobar pagos por MODO o WhatsApp. `stock = 0` muestra "Agotado".
- **Precios**: tabla `presentaciones` (unidad y pack por separado).
- **Cupones**: tabla `cupones`. Crear fila = cupón nuevo; `activo = false` lo apaga. **No se muestran en la web**: pasalos por Instagram/WhatsApp.
- **Clientes y puntos**: tabla `clientes`. Podés regalar puntos editando el número.
- **Pedidos MODO**: se aprueban automáticamente al confirmarse el pago.
- **Pedidos WhatsApp**: entrá a `/admin.html`, ingresá `ADMIN_TOKEN` y usá **Marcar cobrado**; eso descuenta stock y actualiza puntos. **Rechazar** no toca el stock.
- **Pausar un café**: `productos.activo = false` (desaparece de la web sin borrar nada).

## Club Merla

1 punto por cada $100 al confirmar un pago (MODO o WhatsApp; el cliente deja su email al comprar, sin registro). Con 300 puntos canjea $1.500 desde el carrito. La config está en `motor.js` (`CONFIG.fidelidad`).

## Reglas de precios (en `motor.js`)

- 5% OFF llevando 5+ unidades sueltas (los packs no cuentan: ya tienen su descuento).
- El % de ahorro del pack se calcula solo comparando el precio del pack vs. las unidades.
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

## Notas

- `supabase-import/` fueron los CSV para la carga inicial; el `schema.sql` ya incluye esos datos, así que la carpeta se puede borrar.
- El número de WhatsApp está en `WHATSAPP` al inicio de `app.js`.
