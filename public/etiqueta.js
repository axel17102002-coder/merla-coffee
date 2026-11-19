// ===== Foto de producto a partir de la etiqueta =====
// Monta la etiqueta de un café (el PDF o PNG que sale de Canva) sobre la foto
// maestra de la bolsa y devuelve la foto del producto lista para subir. Lo usa
// el panel (/admin → Productos → Editar → "Crear la foto desde la etiqueta").
//
// La foto maestra (img/maestra/bolsa-limpia.jpg) es la bolsa sin etiqueta, y
// img/maestra/calibracion.json dice cómo se ve una etiqueta en esa foto. Se
// calcularon una sola vez comparando la foto de Andino con su PDF:
//   - dónde va la etiqueta y de qué tamaño (todas miden 6 × 8,33 cm);
//   - el color: en la foto, cada canal ≈ a·archivo + b (la cámara apaga y
//     corre un poco los colores del archivo);
//   - la luz: una grilla de ganancia con las sombras y degradés de la foto;
//   - el reflejo en el mármol: eje, suavizado y fuerza por franja.
// Todo corre en el navegador, sin servidor.

(function () {
  const BASE = "/img/maestra/";
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const SALIDA = { ancho: 1200, alto: 1500, calidad: 0.88 }; // como las fotos actuales de la tienda
  const PROPORCION = 6 / 8.33; // ancho ÷ alto de la etiqueta impresa

  let recursos = null; // { cal, limpia: ImageData }

  function cargarImagen(src) {
    return new Promise((resolver, rechazar) => {
      const img = new Image();
      img.onload = () => resolver(img);
      img.onerror = () => rechazar(new Error("No se pudo cargar " + src));
      img.src = src;
    });
  }

  function lienzo(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  async function cargarRecursos() {
    if (recursos) return recursos;
    const [cal, img] = await Promise.all([
      fetch(BASE + "calibracion.json").then((r) => {
        if (!r.ok) throw new Error("No se pudo cargar la calibración de la foto maestra");
        return r.json();
      }),
      cargarImagen(BASE + "bolsa-limpia.jpg"),
    ]);
    const c = lienzo(cal.imagen.ancho, cal.imagen.alto);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    recursos = { cal, limpia: ctx.getImageData(0, 0, c.width, c.height) };
    return recursos;
  }

  // pdf.js se carga solo si hace falta (cuando suben un PDF). Se cargan los dos
  // scripts (el lector y su "worker") en la página: con el worker cargado así,
  // pdf.js trabaja en el mismo hilo, sin crear un Worker aparte. Un Worker
  // desde otro dominio (cdnjs) lo bloquea el navegador y pdf.js tardaba en
  // rendirse; para un PDF chico como una etiqueta, el mismo hilo sobra.
  let pdfjs = null;
  function cargarScript(src) {
    return new Promise((resolver, rechazar) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolver;
      s.onerror = () => rechazar(new Error("No se pudo cargar el lector de PDF"));
      document.head.appendChild(s);
    });
  }
  function cargarPdfJs() {
    if (!pdfjs) {
      pdfjs = cargarScript(PDFJS + "pdf.min.js")
        .then(() => cargarScript(PDFJS + "pdf.worker.min.js"))
        .then(() => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
          return window.pdfjsLib;
        })
        .catch((err) => { pdfjs = null; throw err; });
    }
    return pdfjs;
  }

  // La etiqueta como imagen de w×h (se estira a ese tamaño: todas tienen la
  // misma proporción). Avisa si el archivo no parece una etiqueta.
  async function etiquetaComoImagen(archivo, w, h) {
    const c = lienzo(w, h);
    const ctx = c.getContext("2d");
    let ancho, alto;
    if (/pdf$/i.test(archivo.type) || /\.pdf$/i.test(archivo.name)) {
      const lib = await cargarPdfJs();
      const doc = await lib.getDocument({ data: await archivo.arrayBuffer() }).promise;
      const pagina = await doc.getPage(1); // la 1 es la individual; la 2, la del pack
      const v1 = pagina.getViewport({ scale: 1 });
      ancho = v1.width;
      alto = v1.height;
      // Se dibuja al doble y se reduce: bordes más limpios
      const v = pagina.getViewport({ scale: (w * 2) / v1.width });
      const grande = lienzo(Math.round(v.width), Math.round(v.height));
      await pagina.render({ canvasContext: grande.getContext("2d"), viewport: v }).promise;
      ctx.drawImage(grande, 0, 0, w, h);
    } else {
      const bmp = await createImageBitmap(archivo);
      ancho = bmp.width;
      alto = bmp.height;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, w, h);
    }
    const proporcion = ancho / alto;
    if (Math.abs(proporcion - PROPORCION) > 0.04) {
      throw new Error(
        `El archivo no tiene la forma de la etiqueta (6 × 8,33 cm): mide ${Math.round(ancho)}×${Math.round(alto)}. ` +
        "Exportá solo la etiqueta, sin márgenes."
      );
    }
    return ctx.getImageData(0, 0, w, h);
  }

  // Desenfoque de caja separable, dos pasadas (≈ gaussiano). Igual al de la calibración.
  function desenfocar(v, w, h, r) {
    if (r <= 0) return v;
    let a = Float32Array.from(v);
    const b = new Float32Array(v.length);
    for (let pasada = 0; pasada < 2; pasada++) {
      for (let y = 0; y < h; y++) {
        let s = 0, n = 0;
        for (let x = -r; x <= r; x++) if (x >= 0 && x < w) { s += a[y * w + x]; n++; }
        for (let x = 0; x < w; x++) {
          b[y * w + x] = s / n;
          const sale = x - r, entra = x + r + 1;
          if (sale >= 0) { s -= a[y * w + sale]; n--; }
          if (entra < w) { s += a[y * w + entra]; n++; }
        }
      }
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let y = -r; y <= r; y++) if (y >= 0 && y < h) { s += b[y * w + x]; n++; }
        for (let y = 0; y < h; y++) {
          a[y * w + x] = s / n;
          const sale = y - r, entra = y + r + 1;
          if (sale >= 0) { s -= b[sale * w + x]; n--; }
          if (entra < h) { s += b[entra * w + x]; n++; }
        }
      }
    }
    return a;
  }

  // Suavidad de cámara: núcleo [1 2 1]/4 en x y en y (la foto no es tan nítida como el archivo)
  function suavizarCamara(datos, w, h) {
    const p = datos.data;
    const tmp = new Float32Array(p.length);
    for (let i = 0; i < p.length; i++) tmp[i] = p[i];
    const tmp2 = Float32Array.from(tmp);
    for (let y = 0; y < h; y++) for (let x = 1; x < w - 1; x++) for (let c = 0; c < 3; c++) {
      const i = (y * w + x) * 4 + c;
      tmp2[i] = (p[i - 4] + 2 * p[i] + p[i + 4]) / 4;
    }
    for (let y = 1; y < h - 1; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      const i = (y * w + x) * 4 + c;
      tmp[i] = (tmp2[i - w * 4] + 2 * tmp2[i] + tmp2[i + w * 4]) / 4;
    }
    return tmp; // RGBA en Float32 (el alfa queda como estaba)
  }

  // Grano de la foto: ruido determinístico suave
  function ruido(x, y, c) {
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h & 0xffff) / 65535 - 0.5) * 5;
  }

  // Monta la etiqueta (ImageData del tamaño de la etiqueta) y devuelve el lienzo de la foto
  function componer(rec, etiqueta) {
    const { cal, limpia } = rec;
    const W = cal.imagen.ancho, H = cal.imagen.alto;
    const { x: X0, y: Y0, ancho: EW, alto: EH, radio: R, anillo } = cal.etiqueta;
    const A = cal.color.a, B = cal.color.b;
    const G = cal.ganancia.valores, PASO = cal.ganancia.paso, GC = cal.ganancia.columnas, GF = cal.ganancia.filas;
    const { eje: EJE, suavizado: RAD, banda: BANDA, fuerza: FZ } = cal.reflejo;

    const salida = new ImageData(new Uint8ClampedArray(limpia.data), W, H);
    const out = salida.data, base = limpia.data;
    const etq = suavizarCamara(etiqueta, EW, EH);

    const ganancia = (x, y) => {
      const fx = x / PASO, fy = y / PASO;
      const x0 = Math.min(GC - 2, Math.floor(fx)), y0 = Math.min(GF - 2, Math.floor(fy));
      const tx = fx - x0, ty = fy - y0;
      const g = (cx, cy) => G[cy * GC + cx];
      return (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
    };
    // Cobertura de un rectángulo con esquinas redondeadas (antialias de 1 px)
    const cobertura = (x, y) => {
      const px = x + 0.5, py = y + 0.5;
      const cx = Math.min(Math.max(px, R), EW - R), cy = Math.min(Math.max(py, R), EH - R);
      return Math.max(0, Math.min(1, R - Math.hypot(px - cx, py - cy) + 0.5));
    };

    // 1. La etiqueta, con el color y la luz de la foto
    for (let y = 0; y < EH; y++) {
      for (let x = 0; x < EW; x++) {
        const j = (y * EW + x) * 4;
        const m = cobertura(x, y) * (etq[j + 3] / 255);
        if (m <= 0) continue;
        const g = ganancia(x, y);
        const i = ((Y0 + y) * W + X0 + x) * 4;
        for (let c = 0; c < 3; c++) {
          const pred = Math.max(0, Math.min(255, g * (A[c] * etq[j + c] + B[c]) + ruido(x, y, c)));
          out[i + c] = m * pred + (1 - m) * base[i + c];
        }
      }
    }

    // 2. Su reflejo en el mármol: lo que cambió en la bolsa, espejado bajo el
    //    eje, suavizado y atenuado por franjas
    const RX0 = X0 - anillo, RW = EW + 2 * anillo, HE = EH + 2 * anillo;
    for (let c = 0; c < 3; c++) {
      const d = new Float32Array(RW * HE);
      for (let y = 0; y < HE; y++) for (let x = 0; x < RW; x++) {
        const i = ((Y0 - anillo + y) * W + RX0 + x) * 4 + c;
        d[y * RW + x] = out[i] - base[i];
      }
      const ds = desenfocar(d, RW, HE, RAD);
      for (let y = EJE + 1; y < H; y++) {
        const yo = 2 * EJE - y - (Y0 - anillo);
        if (yo < 0 || yo >= HE) continue;
        const k = FZ[Math.floor((y - EJE - 1) / BANDA)] || 0;
        if (!k) continue;
        for (let x = 0; x < RW; x++) {
          const i = (y * W + RX0 + x) * 4 + c;
          out[i] = Math.max(0, Math.min(255, out[i] + k * ds[yo * RW + x]));
        }
      }
    }

    const c = lienzo(W, H);
    c.getContext("2d").putImageData(salida, 0, 0);
    return c;
  }

  // API: archivo de la etiqueta (PDF, PNG o JPG) → Blob JPG de la foto del producto
  async function fotoDesdeEtiqueta(archivo) {
    const rec = await cargarRecursos();
    const etiqueta = await etiquetaComoImagen(archivo, rec.cal.etiqueta.ancho, rec.cal.etiqueta.alto);
    const completa = componer(rec, etiqueta);
    const chica = lienzo(SALIDA.ancho, SALIDA.alto);
    const ctx = chica.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(completa, 0, 0, SALIDA.ancho, SALIDA.alto);
    return new Promise((resolver, rechazar) =>
      chica.toBlob((b) => (b ? resolver(b) : rechazar(new Error("No se pudo generar la foto"))), "image/jpeg", SALIDA.calidad)
    );
  }

  window.MerlaEtiqueta = { fotoDesdeEtiqueta };
})();
