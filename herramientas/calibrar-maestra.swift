// Calibración de la foto maestra para montar etiquetas (public/etiqueta.js).
//
// Se corre UNA vez, cuando cambia la foto maestra de la bolsa. Necesita una
// foto de la bolsa con una etiqueta pegada (de frente) y el PDF de esa misma
// etiqueta. Genera:
//   - bolsa-limpia.jpg: la foto sin la etiqueta ni su reflejo en el mármol;
//   - calibracion.json: posición y tamaño de la etiqueta, color, luz y reflejo.
// Los dos van a public/img/maestra/.
//
// Uso (macOS, con las herramientas de Xcode):
//   swiftc -O -o /tmp/calibrar herramientas/calibrar-maestra.swift
//   /tmp/calibrar foto-con-etiqueta.jpg etiqueta.pdf public/img/maestra
//
// La primera versión (nov 2026) se hizo con la foto de Andino y "Momo Andino-2.pdf".

import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// ===== Imagen RGBA en Float (0..255), sin premultiplicar =====
struct Img { var w: Int; var h: Int; var p: [Float] }

func desdeCG(_ img: CGImage, w: Int, h: Int) -> Img {
  var px = [UInt8](repeating: 0, count: w * h * 4)
  let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.interpolationQuality = .high
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  var f = [Float](repeating: 0, count: w * h * 4)
  for i in 0..<(w * h) {
    let a = Float(px[i * 4 + 3])
    f[i * 4 + 3] = a
    for c in 0..<3 { f[i * 4 + c] = a > 0 ? min(255, Float(px[i * 4 + c]) * 255 / a) : 0 }
  }
  return Img(w: w, h: h, p: f)
}
func cargar(_ ruta: String, w: Int? = nil, h: Int? = nil) -> Img {
  let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: ruta) as CFURL, nil)!
  let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
  return desdeCG(img, w: w ?? img.width, h: h ?? img.height)
}
func renderPDF(_ ruta: String, pagina: Int, w: Int, h: Int) -> Img {
  let doc = CGPDFDocument(URL(fileURLWithPath: ruta) as CFURL)!
  let pag = doc.page(at: pagina)!
  let caja = pag.getBoxRect(.cropBox)
  // Se dibuja al doble y se reduce: bordes más limpios
  let W = w * 2, H = h * 2
  let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.interpolationQuality = .high
  ctx.scaleBy(x: CGFloat(W) / caja.width, y: CGFloat(H) / caja.height)
  ctx.translateBy(x: -caja.origin.x, y: -caja.origin.y)
  ctx.drawPDFPage(pag)
  return desdeCG(ctx.makeImage()!, w: w, h: h)
}
func guardar(_ img: Img, _ ruta: String, calidad: Double = 0.9) {
  var px = [UInt8](repeating: 0, count: img.w * img.h * 4)
  for i in 0..<(img.w * img.h) {
    let a = img.p[i * 4 + 3] / 255
    for c in 0..<3 { px[i * 4 + c] = UInt8(max(0, min(255, (img.p[i * 4 + c] * a).rounded()))) }
    px[i * 4 + 3] = UInt8(max(0, min(255, img.p[i * 4 + 3].rounded())))
  }
  let ctx = CGContext(data: &px, width: img.w, height: img.h, bitsPerComponent: 8, bytesPerRow: img.w * 4,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  let jpg = ruta.hasSuffix(".jpg")
  let d = CGImageDestinationCreateWithURL(URL(fileURLWithPath: ruta) as CFURL, (jpg ? UTType.jpeg : UTType.png).identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(d, ctx.makeImage()!, jpg ? [kCGImageDestinationLossyCompressionQuality: calidad] as CFDictionary : nil)
  CGImageDestinationFinalize(d)
}

// Desenfoque de caja separable (2 pasadas ≈ gaussiano), con peso opcional
func desenfocar(_ v: [Float], _ w: Int, _ h: Int, _ r: Int) -> [Float] {
  if r <= 0 { return v }
  var a = v, b = [Float](repeating: 0, count: v.count)
  for _ in 0..<2 {
    for y in 0..<h {
      var s: Float = 0; var n: Float = 0
      for x in -r...r { if x >= 0 && x < w { s += a[y * w + x]; n += 1 } }
      for x in 0..<w {
        b[y * w + x] = s / n
        let sale = x - r, entra = x + r + 1
        if sale >= 0 { s -= a[y * w + sale]; n -= 1 }
        if entra < w { s += a[y * w + entra]; n += 1 }
      }
    }
    for x in 0..<w {
      var s: Float = 0; var n: Float = 0
      for y in -r...r { if y >= 0 && y < h { s += b[y * w + x]; n += 1 } }
      for y in 0..<h {
        a[y * w + x] = s / n
        let sale = y - r, entra = y + r + 1
        if sale >= 0 { s -= b[sale * w + x]; n -= 1 }
        if entra < h { s += b[entra * w + x]; n += 1 }
      }
    }
  }
  return a
}
func canal(_ img: Img, _ c: Int) -> [Float] { (0..<(img.w * img.h)).map { img.p[$0 * 4 + c] } }

// ===== 1. Foto y rectángulo de la etiqueta =====
let foto = cargar(CommandLine.arguments[1])
let pdfAndino = CommandLine.arguments[2]
let salida = CommandLine.arguments[3]
let W = foto.w, H = foto.h
func pix(_ x: Int, _ y: Int, _ c: Int) -> Float { foto.p[(y * W + x) * 4 + c] }
func saturado(_ x: Int, _ y: Int) -> Bool {
  let r = pix(x, y, 0), g = pix(x, y, 1), b = pix(x, y, 2)
  return max(r, g, b) > 110 && max(r, g, b) - min(r, g, b) > 60
}
var filas = [Int](repeating: 0, count: H), cols = [Int](repeating: 0, count: W)
for y in 0..<Int(Double(H) * 0.78) { for x in 0..<W where saturado(x, y) { filas[y] += 1; cols[x] += 1 } }
let uf = filas.max()! / 3, uc = cols.max()! / 3
var X0 = cols.firstIndex { $0 > uc }!, X1 = cols.lastIndex { $0 > uc }!
var Y0 = filas.firstIndex { $0 > uf }!, Y1 = filas.lastIndex { $0 > uf }!
var EW = X1 - X0 + 1, EH = Y1 - Y0 + 1

// Ajuste fino: probar corrimientos y tamaños y quedarse con el que mejor calza con el PDF
func luminancia(_ img: Img) -> [Float] { (0..<(img.w * img.h)).map { 0.299 * img.p[$0 * 4] + 0.587 * img.p[$0 * 4 + 1] + 0.114 * img.p[$0 * 4 + 2] } }
func correlacion(_ x0: Int, _ y0: Int, _ w: Int, _ h: Int) -> Double {
  let ref = luminancia(renderPDF(pdfAndino, pagina: 1, w: w, h: h))
  var sa = 0.0, sb = 0.0, saa = 0.0, sbb = 0.0, sab = 0.0, n = 0.0
  let m = 8
  for y in stride(from: m, to: h - m, by: 2) { for x in stride(from: m, to: w - m, by: 2) {
    let a = Double(ref[y * w + x])
    let px = x0 + x, py = y0 + y
    let b = 0.299 * Double(pix(px, py, 0)) + 0.587 * Double(pix(px, py, 1)) + 0.114 * Double(pix(px, py, 2))
    sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; n += 1
  } }
  let cov = sab / n - sa / n * sb / n, va = saa / n - pow(sa / n, 2), vb = sbb / n - pow(sb / n, 2)
  return cov / sqrt(va * vb)
}
var mejor = (c: correlacion(X0, Y0, EW, EH), x: X0, y: Y0, w: EW, h: EH)
print("detectado: x=\(X0) y=\(Y0) \(EW)x\(EH) corr=\(String(format: "%.4f", mejor.c))")
// En etapas: tamaño, posición y de nuevo tamaño fino
let base = mejor
for dw in -3...10 { for dh in -3...10 {
  let c = correlacion(base.x, base.y, base.w + dw, base.h + dh)
  if c > mejor.c { mejor = (c, base.x, base.y, base.w + dw, base.h + dh) }
} }
let base2 = mejor
for dx in -5...5 { for dy in -5...5 {
  let c = correlacion(base2.x + dx, base2.y + dy, base2.w, base2.h)
  if c > mejor.c { mejor = (c, base2.x + dx, base2.y + dy, base2.w, base2.h) }
} }
let base3 = mejor
for dw in -2...2 { for dh in -2...2 { for dx in -1...1 { for dy in -1...1 {
  let c = correlacion(base3.x + dx, base3.y + dy, base3.w + dw, base3.h + dh)
  if c > mejor.c { mejor = (c, base3.x + dx, base3.y + dy, base3.w + dw, base3.h + dh) }
} } } }
(X0, Y0, EW, EH) = (mejor.x, mejor.y, mejor.w, mejor.h)
print("ajustado:  x=\(X0) y=\(Y0) \(EW)x\(EH) corr=\(String(format: "%.4f", mejor.c))")

// ===== 2. Color: foto ≈ a·PDF + b por canal (sobre versiones suavizadas) =====
let andino = renderPDF(pdfAndino, pagina: 1, w: EW, h: EH)
let margen = 6
var A = [Float](repeating: 1, count: 3), B = [Float](repeating: 0, count: 3)
var errAntes = 0.0, errDespues = 0.0
let fotoEt: Img = {
  var p = [Float](repeating: 0, count: EW * EH * 4)
  for y in 0..<EH { for x in 0..<EW { for c in 0..<4 { p[(y * EW + x) * 4 + c] = c == 3 ? 255 : pix(X0 + x, Y0 + y, c) } } }
  return Img(w: EW, h: EH, p: p)
}()
// Cuántos píxeles hay de cada tono: el fondo de color ocupa casi todo y el
// texto oscuro casi nada; sin ponderar, el ajuste ignoraba el texto.
let lumAndino = luminancia(andino)
var cuentas = [Double](repeating: 0, count: 8)
for y in margen..<(EH - margen) { for x in margen..<(EW - margen) { cuentas[min(7, Int(lumAndino[y * EW + x] / 32))] += 1 } }
for c in 0..<3 {
  // Sin suavizar el texto (si no, el negro se mezcla con el fondo) pero comparando contra la foto
  // suavizada apenas, que es como la ve la cámara
  let r = desenfocar(canal(andino, c), EW, EH, 1), f = desenfocar(canal(fotoEt, c), EW, EH, 1)
  var sx = 0.0, sy = 0.0, sxx = 0.0, sxy = 0.0, n = 0.0
  for y in margen..<(EH - margen) { for x in margen..<(EW - margen) {
    let i = y * EW + x; let xv = Double(r[i]), yv = Double(f[i])
    let peso = 1 / max(1, cuentas[min(7, Int(lumAndino[i] / 32))])
    sx += peso * xv; sy += peso * yv; sxx += peso * xv * xv; sxy += peso * xv * yv; n += peso
  } }
  let a = (n * sxy - sx * sy) / (n * sxx - sx * sx), b = (sy - a * sx) / n
  A[c] = Float(a); B[c] = Float(b)
}
// ===== 3. Ganancia de luz de baja frecuencia (sombras y degradés de la foto) =====
let PASO = 16
let gcols = EW / PASO + 2, gfilas = EH / PASO + 2
var ganancia = [Float](repeating: 1, count: gcols * gfilas)
do {
  var pred = [Float](repeating: 0, count: EW * EH), real = [Float](repeating: 0, count: EW * EH)
  for i in 0..<(EW * EH) {
    var lp: Float = 0, lr: Float = 0
    let pesos: [Float] = [0.299, 0.587, 0.114]
    for c in 0..<3 { lp += pesos[c] * (A[c] * andino.p[i * 4 + c] + B[c]); lr += pesos[c] * fotoEt.p[i * 4 + c] }
    pred[i] = lp; real[i] = lr
  }
  let pd = desenfocar(pred, EW, EH, 24), rd = desenfocar(real, EW, EH, 24)
  for gy in 0..<gfilas { for gx in 0..<gcols {
    let x = min(EW - 1, gx * PASO), y = min(EH - 1, gy * PASO)
    let i = y * EW + x
    ganancia[gy * gcols + gx] = max(0.75, min(1.25, rd[i] / max(1, pd[i])))
  } }
}
func gananciaEn(_ x: Int, _ y: Int) -> Float {
  let fx = Float(x) / Float(PASO), fy = Float(y) / Float(PASO)
  let x0 = min(gcols - 2, Int(fx)), y0 = min(gfilas - 2, Int(fy))
  let tx = fx - Float(x0), ty = fy - Float(y0)
  let g = { (cx: Int, cy: Int) in ganancia[cy * gcols + cx] }
  return (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty
}
// Error del modelo sobre Andino (cuánto se parece la etiqueta "montada" a la fotografiada)
for y in margen..<(EH - margen) { for x in margen..<(EW - margen) { for c in 0..<3 {
  let i = (y * EW + x) * 4 + c
  let real = Double(fotoEt.p[i])
  errAntes += pow(Double(andino.p[i]) - real, 2)
  errDespues += pow(Double(max(0, min(255, gananciaEn(x, y) * (A[c] * andino.p[i] + B[c])))) - real, 2)
} } }
let nErr = Double((EW - 2 * margen) * (EH - 2 * margen) * 3)
print(String(format: "color: a=[%.3f %.3f %.3f] b=[%.1f %.1f %.1f]  error RMS sin ajuste %.1f → con ajuste %.1f", A[0], A[1], A[2], B[0], B[1], B[2], sqrt(errAntes / nErr), sqrt(errDespues / nErr)))

// Radio de las esquinas (del alfa del PDF, sobre la diagonal)
// Radio de la esquina de la etiqueta impresa, medido en la foto: en cada una de las
// cuatro esquinas, primer píxel de la diagonal que ya es etiqueta (saturado)
var radios: [Float] = []
for (sx, sy) in [(1, 1), (-1, 1), (1, -1), (-1, -1)] {
  let cx = sx > 0 ? X0 : X0 + EW - 1, cy = sy > 0 ? Y0 : Y0 + EH - 1
  for i in 0..<30 where saturado(cx + sx * i, cy + sy * i) { radios.append(Float(i) * sqrt(2) / (sqrt(2) - 1)); break }
}
// La medición automática se confunde con el borde claro del papel: el radio real,
// mirado de cerca en la foto, es de unos 6 px. Se deja fijo.
let radio: Float = 6
print("radios medidos en la foto:", radios.map { String(format: "%.1f", $0) }.joined(separator: " "))
print(String(format: "radio de las esquinas: %.1f px", radio))

// ===== 4. Foto "limpia": sin la etiqueta ni su reflejo =====
var limpia = foto
let anillo = 4
for y in (Y0 - anillo)...(Y0 + EH - 1 + anillo) {
  // Color de la bolsa a izquierda y derecha de la etiqueta, interpolado
  var izq = [Float](repeating: 0, count: 3), der = [Float](repeating: 0, count: 3)
  for c in 0..<3 {
    var s: Float = 0; for x in (X0 - 14)...(X0 - 8) { s += pix(x, y, c) }; izq[c] = s / 7
    s = 0; for x in (X0 + EW + 7)...(X0 + EW + 13) { s += pix(x, y, c) }; der[c] = s / 7
  }
  for x in (X0 - anillo)...(X0 + EW - 1 + anillo) {
    let t = Float(x - (X0 - 8)) / Float(EW + 15)
    for c in 0..<3 { limpia.p[(y * W + x) * 4 + c] = izq[c] * (1 - t) + der[c] * t }
  }
}
// Reflejo: diferencia de la etiqueta respecto de la bolsa, espejada bajo el eje y suavizada
let RX0 = X0 - anillo, RW = EW + 2 * anillo
func difEtiqueta(_ img: Img) -> [[Float]] {   // por canal, región (RW x alto de etiqueta)
  let h = EH + 2 * anillo
  return (0..<3).map { c in
    var d = [Float](repeating: 0, count: RW * h)
    for y in 0..<h { for x in 0..<RW {
      let gx = RX0 + x, gy = Y0 - anillo + y
      d[y * RW + x] = img.p[(gy * W + gx) * 4 + c] - limpia.p[(gy * W + gx) * 4 + c]
    } }
    return d
  }
}
let dAndino = difEtiqueta(foto)
// Buscar eje y suavizado que mejor explican el tinte del reflejo (en cromaticidad)
var mejorR = (corr: -1.0, eje: 0, rad: 0, k: [Float]())
let hEt = EH + 2 * anillo
for rad in [4, 8, 12, 18, 26] {
  let suav = dAndino.map { desenfocar($0, RW, hEt, rad) }
  for eje in stride(from: 1570, through: 1660, by: 2) {
    // reflejo en y ↔ objeto en 2·eje − y
    var sp = 0.0, sq = 0.0, spp = 0.0, sqq = 0.0, spq = 0.0, n = 0.0
    for y in (eje + 10)..<H {
      let yo = 2 * eje - y - (Y0 - anillo)
      if yo < 0 || yo >= hEt { continue }
      for x in stride(from: 0, to: RW, by: 2) {
        let gx = RX0 + x
        let obsC = Double(pix(gx, y, 0) - pix(gx, y, 1)) // r - g del observado
        let modC = Double(suav[0][yo * RW + x] - suav[1][yo * RW + x])
        sp += modC; sq += obsC; spp += modC * modC; sqq += obsC * obsC; spq += modC * obsC; n += 1
      }
    }
    if n < 100 { continue }
    let cov = spq / n - sp / n * sq / n, c = cov / sqrt((spp / n - pow(sp / n, 2)) * (sqq / n - pow(sq / n, 2)))
    if c > mejorR.corr { mejorR = (c, eje, rad, []) }
  }
}
// El reflejo real, visto de cerca, está más desenfocado que lo que elige la correlación
let EJE = mejorR.eje, RAD = max(mejorR.rad, 9)
let suavA = dAndino.map { desenfocar($0, RW, hEt, RAD) }
// Fuerza del reflejo por banda de 16 filas (se atenúa con la distancia)
var bandas: [Float] = []
for y0 in stride(from: EJE + 1, to: H, by: 16) {
  var smo = 0.0, smm = 0.0
  for y in y0..<min(H, y0 + 16) {
    let yo = 2 * EJE - y - (Y0 - anillo)
    if yo < 0 || yo >= hEt { continue }
    for x in 0..<RW {
      let gx = RX0 + x
      for (c1, c2) in [(0, 1), (2, 1)] {
        let o = Double(pix(gx, y, c1) - pix(gx, y, c2)), m = Double(suavA[c1][yo * RW + x] - suavA[c2][yo * RW + x])
        smo += m * o; smm += m * m
      }
    }
  }
  bandas.append(smm > 0 ? Float(max(0, min(0.9, smo / smm))) : 0)
}
print(String(format: "reflejo: eje y=%d, suavizado %d px, corr %.3f, fuerza por banda: %@", EJE, RAD, mejorR.corr, bandas.map { String(format: "%.2f", $0) }.joined(separator: " ")))
func fuerzaEn(_ y: Int) -> Float { let b = (y - EJE - 1) / 16; return b >= 0 && b < bandas.count ? bandas[b] : 0 }
// Sacar el tinte del reflejo viejo
for y in (EJE + 1)..<H {
  let yo = 2 * EJE - y - (Y0 - anillo)
  if yo < 0 || yo >= hEt { continue }
  let k = fuerzaEn(y)
  for x in 0..<RW { for c in 0..<3 {
    let i = (y * W + RX0 + x) * 4 + c
    limpia.p[i] = max(0, min(255, foto.p[i] - k * suavA[c][yo * RW + x]))
  } }
}
guardar(limpia, "\(salida)/bolsa-limpia.jpg", calidad: 0.92)

// ===== 5. Calibración en JSON (la usa el panel para montar etiquetas) =====
let cal: [String: Any] = [
  "imagen": ["ancho": W, "alto": H],
  "etiqueta": ["x": X0, "y": Y0, "ancho": EW, "alto": EH, "radio": Double(radio), "anillo": anillo],
  "color": ["a": A.map { Double($0) }, "b": B.map { Double($0) }],
  "ganancia": ["paso": PASO, "columnas": gcols, "filas": gfilas, "valores": ganancia.map { (Double($0) * 1000).rounded() / 1000 }],
  "reflejo": ["eje": EJE, "suavizado": RAD, "banda": 16, "fuerza": bandas.map { (Double($0) * 1000).rounded() / 1000 }],
  "nota": "Calibración de la foto maestra (bolsa-limpia.jpg). La genera herramientas/calibrar-maestra.swift a partir de la foto de la bolsa con una etiqueta y su PDF. La usa public/etiqueta.js. Si se cambia la foto maestra, hay que regenerarla.",
]
let json = try! JSONSerialization.data(withJSONObject: cal, options: [.prettyPrinted, .sortedKeys])
try! json.write(to: URL(fileURLWithPath: "\(salida)/calibracion.json"))
print("listo: bolsa-limpia.jpg y calibracion.json")
