# Merla Coffee — Sitio web

Tienda estática de café de especialidad en drip bags, con carrito de compras y pedido por WhatsApp. No necesita servidor ni base de datos: son 3 archivos y las imágenes.

## Archivos

- `index.html` — estructura de la página
- `styles.css` — estilos (colores de marca: crema y verde oscuro)
- `app.js` — productos, carrito y checkout por WhatsApp
- `img/` — fotos de productos y logo

## Cómo editar productos y precios

Todo está al principio de `app.js`:

- **Número de WhatsApp**: constante `WHATSAPP` (formato internacional sin `+`, hoy `5492216803376`).
- **Descuento por cantidad**: `DESCUENTO_CANTIDAD` (5 unidades) y `DESCUENTO_PORCENTAJE` (5%).
- **Productos**: lista `PRODUCTOS`. Para cambiar un precio, editá el campo `precio`. Para agregar un café, copiá un bloque, cambiá los datos y poné la foto en `img/`.

## Cómo verlo en tu compu

```bash
cd merla-coffee
python3 -m http.server 8000
```

y abrí http://localhost:8000

## Cómo publicarlo gratis

Opción más simple, **Netlify Drop**: entrá a https://app.netlify.com/drop y arrastrá la carpeta `merla-coffee`. Te da una URL pública al instante (podés conectar un dominio propio después).

Alternativas: Vercel, GitHub Pages o Cloudflare Pages — en todos alcanza con subir esta carpeta tal cual.
