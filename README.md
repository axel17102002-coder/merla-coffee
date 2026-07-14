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
- El stock se descuenta **solo cuando MODO confirma el pago** (webhook + verificación contra la API). Los pedidos por WhatsApp se descuentan a mano en Supabase.

## Archivos

- `index.html` / `styles.css` / `app.js` — la web
- `motor.js` — reglas de precios compartidas (descuentos, mínimos, puntos)
- `netlify/lib/` — clientes de Supabase y MODO
- `netlify/functions/`
  - `tienda.js` — catálogo con stock (lo que carga la web)
  - `validar-cupon.js` — valida códigos sin exponer la lista
  - `puntos.js` — saldo Club Merla por email
  - `modo-checkout.js` — crea el pago + registra el pedido
  - `modo-webhook.js` — MODO avisa el resultado → aprueba el pedido
  - `confirmar-pedido.js` — respaldo del webhook desde el navegador
- `supabase/schema.sql` — tablas, seguridad y datos iniciales

## Puesta en marcha (una sola vez)

1. **Crear las tablas**: en [Supabase](https://supabase.com) → tu proyecto → **SQL Editor** → pegá todo el contenido de `supabase/schema.sql` → **Run**. Eso crea las tablas con los 7 cafés, las presentaciones y 2 cupones de ejemplo.
2. **Claves locales**: copiá `.env.example` a `.env` y completá `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (están en Supabase → Settings → API). El `.env` está gitignoreado: nunca se sube.
3. **Probar local**: `npx netlify-cli dev --port 8888` y abrir http://localhost:8888
4. **Publicar**: `netlify deploy --prod` y cargar las mismas 2 variables en Netlify → Site settings → **Environment variables**. El webhook de MODO solo funciona con el sitio publicado.

## Administración diaria (sin tocar código)

Todo desde Supabase → **Table Editor**:

- **Stock**: tabla `productos`, columna `stock`. Se descuenta solo con cada venta por MODO; las ventas por WhatsApp restalas a mano. `stock = 0` muestra "Agotado".
- **Precios**: tabla `presentaciones` (unidad y pack por separado).
- **Cupones**: tabla `cupones`. Crear fila = cupón nuevo; `activo = false` lo apaga. **No se muestran en la web**: pasalos por Instagram/WhatsApp.
- **Clientes y puntos**: tabla `clientes`. Podés regalar puntos editando el número.
- **Pedidos**: tabla `pedidos` — historial completo con estado (pendiente/aprobado/rechazado).
- **Pausar un café**: `productos.activo = false` (desaparece de la web sin borrar nada).

## Club Merla

1 punto por cada $100 pagando con MODO (el cliente deja su email al comprar; sin registro). Con 300 puntos canjea $1.500 desde el carrito. La config está en `motor.js` (`CONFIG.fidelidad`).

## Reglas de precios (en `motor.js`)

- 5% OFF llevando 5+ unidades sueltas (los packs no cuentan: ya tienen su descuento).
- El % de ahorro del pack se calcula solo comparando el precio del pack vs. las unidades.
- Canje de puntos: requiere pedido de al menos 2× el descuento.

## Pago con MODO

Hoy está en **modo de prueba** (credenciales públicas de test — no cobra de verdad, el carrito lo avisa). Para cobrar en serio:

1. Alta en un gateway (recomendado: Decidir Plus de [Payway](https://www.payway.com.ar)).
2. Pedir credenciales productivas en [modo.com.ar/comercios/tiendas-online](https://www.modo.com.ar/comercios/tiendas-online) (~48 hs hábiles).
3. En Netlify → Environment variables: `MODO_ENV=produccion`, `MODO_USERNAME`, `MODO_PASSWORD`, `MODO_PROCESSOR_CODE`, `MODO_CC_CODE=1CSI`.
4. En `app.js`: `MODO_AMBIENTE = "produccion"`. Volver a publicar.

Docs: https://merchants.modo.com.ar/docs

## Notas

- `supabase-import/` fueron los CSV para la carga inicial; el `schema.sql` ya incluye esos datos, así que la carpeta se puede borrar.
- El número de WhatsApp está en `WHATSAPP` al inicio de `app.js`.
