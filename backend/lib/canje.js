// Verificación del email para canjear puntos Club Merla.
//
// Los puntos se identifican solo por el email (no hay cuentas ni contraseñas),
// así que sin esto cualquiera que supiera el email de un cliente podía gastarle
// los puntos en un pedido propio. Para canjear hay que demostrar que el email
// es de uno: se manda un código de 6 dígitos a esa casilla y, al ingresarlo, el
// navegador recibe un pase firmado que lo deja canjear por unos días.
//
// No guarda nada en la base: el código sale de firmar (HMAC) el email y el
// momento con un secreto del servidor, y el pase es una fecha de vencimiento
// firmada. Solo el servidor puede generar o validar cualquiera de los dos.

const crypto = require("node:crypto");

const MINUTOS_CODIGO = 10; // el código vale entre 10 y 20 minutos
const DIAS_PASE = 30; // cuánto dura la verificación en ese navegador

// Secreto para firmar. Se reusa la clave de Supabase (que el navegador nunca
// ve) para no sumar una variable más; CANJE_SECRET permite separarlo si hiciera
// falta. Rotar el secreto solo obliga a los clientes a verificarse de nuevo.
function secreto() {
  const s = process.env.CANJE_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Falta un secreto para firmar los códigos de canje");
  return s;
}

const firmar = (texto) => crypto.createHmac("sha256", secreto()).update(`merla-canje-v1|${texto}`).digest("hex");
const normalizar = (email) => String(email || "").trim().toLowerCase();
const ventana = (ahora) => Math.floor(ahora / (MINUTOS_CODIGO * 60 * 1000));

// Comparación que tarda lo mismo acierte o no (no filtra por tiempo cuántos
// caracteres coinciden)
function iguales(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

function codigoDe(email, v) {
  const n = Number.parseInt(firmar(`codigo|${normalizar(email)}|${v}`).slice(0, 12), 16) % 1000000;
  return String(n).padStart(6, "0");
}

// Código vigente para un email (el que se manda por mail)
function codigoActual(email, ahora = Date.now()) {
  return codigoDe(email, ventana(ahora));
}

// ¿Es el código que le mandamos a ese email? Vale el de la ventana actual y el
// de la anterior, para que no venza justo mientras lo está tipeando.
function codigoValido(email, codigo, ahora = Date.now()) {
  const limpio = String(codigo == null ? "" : codigo).replace(/\D/g, "");
  if (limpio.length !== 6 || !normalizar(email)) return false;
  const v = ventana(ahora);
  // Se evalúan los dos siempre (sin cortocircuito) por la misma razón que `iguales`
  const actual = iguales(limpio, codigoDe(email, v));
  const anterior = iguales(limpio, codigoDe(email, v - 1));
  return actual || anterior;
}

// Pase que recibe el navegador al verificar: "<vencimiento>.<firma>". Está
// atado al email: no sirve para canjear los puntos de otro.
function crearPase(email, ahora = Date.now()) {
  const vence = ahora + DIAS_PASE * 24 * 3600 * 1000;
  return `${vence}.${firmar(`pase|${normalizar(email)}|${vence}`)}`;
}

function paseValido(pase, email, ahora = Date.now()) {
  const [vence, firma] = String(pase || "").split(".");
  if (!/^\d{10,16}$/.test(vence || "") || !firma || !normalizar(email)) return false;
  if (Number(vence) <= ahora) return false;
  return iguales(firma, firmar(`pase|${normalizar(email)}|${vence}`));
}

// Respuesta de los checkouts cuando se pide canjear sin haber verificado
const ERROR_SIN_VERIFICAR = {
  error: "Para canjear puntos confirmá tu email con el código que te mandamos por mail.",
  codigo: "canje_sin_verificar",
};

module.exports = { codigoActual, codigoValido, crearPase, paseValido, MINUTOS_CODIGO, DIAS_PASE, ERROR_SIN_VERIFICAR };
