# Merla Coffee — Sitio web

Tienda de café de especialidad en drip bags, con carrito, **stock**, **packs**, **cupones**, **puntos Club Merla**, **pago online con MODO** y pedido por WhatsApp.

## Archivos

- `index.html` — estructura de la página
- `styles.css` — estilos (colores de marca: crema y verde oscuro; fuentes Baloo 2 + Figtree)
- `productos.js` — **acá se edita TODO**: productos, precios, stock, packs, cupones y puntos (lo usan la web y el pago con MODO)
- `app.js` — carrito, cupones, puntos y checkouts (WhatsApp + MODO)
- `netlify/functions/modo-checkout.js` — función que crea el pago contra la API de MODO
- `netlify.toml` — configuración de Netlify
- `img/` — fotos de productos y logo

## Qué se configura en `productos.js`

| Qué | Dónde | Hoy |
|---|---|---|
| Precio de cada café | campo `precio` | según producto |
| **Stock** (drip bags disponibles) | campo `stock` (0 = "Agotado") | ⚠️ números de ejemplo, poné los reales |
| Descuento por cantidad | `DESCUENTO_CANTIDAD` / `DESCUENTO_PORCENTAJE` | 5% llevando 5+ unidades sueltas |
| **Pack x5** | `PACK_X5` | 10% OFF vs. 5 sueltas (se calcula solo) |
| **Cupones** | lista `CUPONES` | BIENVENIDA10 (10%) y CAFETERO ($2.000, mín $15.000) |
| **Club Merla** (puntos) | `FIDELIDAD` | 1 punto por $100; 300 puntos = $1.500 OFF |

Notas:
- El stock **no se descuenta solo** al vender (no hay base de datos): cuando vendés, actualizá el número y volvé a publicar. El stock sí impide que un cliente compre más de lo disponible.
- Un pack x5 consume 5 de stock. Si un café tiene menos de 5, el pack se deshabilita solo.
- Cupones con `publico: true` se muestran en la sección "Cupones y Club Merla"; los que no, son códigos secretos para compartir donde quieras (ojo: alguien con conocimientos técnicos puede verlos en el código de la página).
- Los puntos del Club Merla se guardan **en el navegador del cliente** y se suman solo pagando con MODO. Es simple y sin cuentas de usuario; si el cliente cambia de dispositivo, no se transfieren.
- El descuento por cantidad (5%) aplica solo a unidades sueltas: los packs ya traen su 10%.

El número de WhatsApp está en `WHATSAPP` al inicio de `app.js`.

## Cómo verlo en tu compu

```bash
cd merla-coffee
npx netlify-cli dev --port 8888
```

y abrí http://localhost:8888 (con esto también funciona el botón de MODO en modo prueba).

## Cómo publicarlo

Como hay una función de pago (no solo archivos estáticos), conviene **Netlify**:

```bash
npm install -g netlify-cli
cd merla-coffee
netlify deploy --prod
```

(También funciona Netlify Drop arrastrando la carpeta en https://app.netlify.com/drop; si el botón de MODO no anduviera con ese método, usá la CLI.)

## Pago con MODO

### Cómo funciona

El cliente toca "Pagar con MODO" → la función `modo-checkout` recalcula el pedido completo con el motor de `productos.js` (precios, stock, packs, cupones y canje de puntos — nunca confía en el navegador), crea la intención de pago en MODO y devuelve un QR → se abre el modal oficial de MODO → el cliente paga desde su app bancaria. Al aprobarse, se acreditan los puntos Club Merla.

### Estado actual: MODO DE PRUEBA

El sitio usa las **credenciales de test públicas** de MODO: todo el flujo funciona pero **no se cobra de verdad** (el carrito lo avisa). Para probar pagos completos existe la app "MODO Testing" (sección "apk MODO Testing" en https://merchants.modo.com.ar/docs).

### Para cobrar de verdad

1. **Alta en un gateway de pagos**: si no tenés uno, MODO recomienda Decidir Plus de **Payway Ventas Online** (https://www.payway.com.ar).
2. **Pedir credenciales productivas de MODO**: formulario en https://www.modo.com.ar/comercios/tiendas-online. En ~48 hs hábiles llegan por mail: `username`, `password` y `processor_code`.
3. **Cargar las credenciales en Netlify** (Site settings → Environment variables — NUNCA en el código):
   - `MODO_ENV` = `produccion`
   - `MODO_USERNAME` / `MODO_PASSWORD` / `MODO_PROCESSOR_CODE` = (los que te llegaron)
   - `MODO_CC_CODE` = `1CSI` (1 cuota sin interés; hay más opciones en la doc)
4. **En `app.js`**: cambiar `MODO_AMBIENTE` de `"test"` a `"produccion"`.
5. Volver a publicar.

Documentación oficial: https://merchants.modo.com.ar/docs (Botón de Pago SDK v2).
