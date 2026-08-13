/**
 * NODO: "Dedupe y citation key"
 * Tipo: Code (n8n-nodes-base.code) — Modo: Run Once for All Items
 *
 * QUE HACE
 *   Recibe TODAS las filas actuales del consolidado (Google Sheets) y:
 *
 *   1. DEDUPLICA. Si el DOI ya esta registrado -> duplicado.
 *      Si no hay DOI, compara la url_normalizada -> duplicado.
 *      Esto es lo que hace el flujo idempotente: reenviar el mismo link no
 *      escribe nada nuevo en ningun lado.
 *
 *   2. GENERA LA CITATION KEY con la convencion apellidoAAAApalabraclave,
 *      todo en minusculas, sin tildes ni caracteres especiales, y le agrega
 *      sufijo b, c, d... si esa key ya existe en el consolidado.
 *
 *   Se ejecuta ANTES de cualquier escritura y antes de gastar tokens de LLM.
 *
 * ENTRADA:  filas de "Leer consolidado" (puede venir 1 item vacio si la
 *           planilla esta recien creada; el nodo tiene alwaysOutputData=true)
 * SALIDA:   1 item = estado + { duplicado, citation_key }
 */

// ---------------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------------

// Palabras que no sirven como "palabraclave" de la citation key
const VACIAS = new Set([
  'a', 'an', 'the', 'of', 'on', 'in', 'for', 'and', 'or', 'to', 'with', 'by',
  'from', 'at', 'as', 'is', 'are', 'was', 'were', 'using', 'via', 'about',
  'study', 'analysis', 'new', 'towards', 'toward',
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'y', 'o',
  'en', 'para', 'con', 'por', 'sobre', 'mediante', 'estudio', 'analisis',
]);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Deja solo [a-z0-9]: minusculas, sin tildes, sin ñ, sin guiones.
 * "Muñoz-Peña" -> "munozpena" ; "Ávila" -> "avila"
 */
function ascii(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // quita los diacriticos ya separados
    .replace(/ø/gi, 'o')
    .replace(/æ/gi, 'ae')
    .replace(/ß/gi, 'ss')
    .replace(/đ|ð/gi, 'd')
    .replace(/ł/gi, 'l')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Primera palabra significativa del titulo, en ascii. */
function palabraClave(titulo) {
  const palabras = String(titulo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const util = palabras.find((w) => w.length > 3 && !VACIAS.has(w));
  return ascii(util || palabras[0] || 'ref').slice(0, 20);
}

/**
 * Sufijo alfabetico al estilo BibTeX: '', 'b', 'c', ... 'z', 'aa', 'ab'...
 * (el indice 0 no lleva sufijo, que es la key "limpia")
 */
function sufijo(indice) {
  if (indice <= 0) return '';
  let n = indice;            // 1 -> b, 2 -> c ...
  let s = '';
  n += 1;                    // desplaza para que 1 caiga en 'b'
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(97 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Normalizacion de URL identica a la del nodo 01, para comparar peras con peras. */
function normalizarUrl(url) {
  if (!url) return '';
  const PARAMS_BASURA = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
    'utm_content', 'via', 'ref', 'rss', 'fbclid', 'gclid', 'mc_cid', 'mc_eid', 's', 'sk'];
  try {
    const u = new URL(url);
    u.hash = '';
    u.protocol = 'https:';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    // Ojo: "?via%3Dihub" llega como una CLAVE llamada "via=ihub" (el %3D es un '='),
    // asi que no basta con delete('via'): hay que mirar el prefijo de cada clave.
    for (const clave of [...u.searchParams.keys()]) {
      const raiz = clave.toLowerCase().split('=')[0];
      if (PARAMS_BASURA.includes(raiz)) u.searchParams.delete(clave);
    }
    const params = [...u.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    u.search = '';
    for (const [k, v] of params) u.searchParams.append(k, v);
    return u.toString().replace(/\/$/, '').toLowerCase();
  } catch (e) {
    return String(url).trim().toLowerCase().replace(/\/$/, '');
  }
}

// ---------------------------------------------------------------------------
// Proceso
// ---------------------------------------------------------------------------

const estado = { ...$('Normalizar metadatos').first().json };

// Filas existentes. Si la planilla esta vacia llega un unico item {} por
// alwaysOutputData, por eso filtramos por citation_key presente.
const filas = $input.all()
  .map((i) => i.json || {})
  .filter((f) => f && String(f.citation_key || '').trim() !== '');

const doiNuevo = String(estado.doi || '').trim().toLowerCase();
const urlNueva = estado.url_normalizada || normalizarUrl(estado.url_final || estado.url);

// --- 1. Deteccion de duplicado -------------------------------------------
let filaDuplicada = null;

if (doiNuevo) {
  filaDuplicada = filas.find(
    (f) => String(f.doi || '').trim().toLowerCase() === doiNuevo,
  ) || null;
}

if (!filaDuplicada && urlNueva) {
  filaDuplicada = filas.find(
    (f) => normalizarUrl(f.url || '') === urlNueva,
  ) || null;
}

// --- 2. Citation key ------------------------------------------------------
const primerAutor = (estado.autores && estado.autores.length)
  ? estado.autores[0]
  : ((estado.editores && estado.editores.length) ? estado.editores[0] : null);

let base = '';
if (primerAutor) {
  base = ascii(primerAutor.apellido);
} else if (estado.institucion) {
  base = ascii(estado.institucion).slice(0, 14);
} else if (estado.editorial) {
  base = ascii(estado.editorial).slice(0, 14);
} else {
  // ultimo recurso: el dominio del sitio ("nch", "sciencedirect", "skf"...)
  try {
    base = ascii(new URL(estado.url_final || estado.url).hostname.replace(/^www\./, '').split('.')[0]);
  } catch (e) {
    base = 'anon';
  }
}
if (!base) base = 'anon';

// Anio: 'sf' = sin fecha (convencion bibliografica en espanol)
const anio = /^\d{4}$/.test(String(estado.anio || '')) ? String(estado.anio) : 'sf';

const keyBase = `${base}${anio}${palabraClave(estado.titulo)}`;

// Colisiones contra las keys que YA existen en el consolidado
const keysExistentes = new Set(filas.map((f) => String(f.citation_key || '').trim().toLowerCase()));

let indice = 0;
let citationKey = keyBase;
while (keysExistentes.has(citationKey.toLowerCase())) {
  indice += 1;
  citationKey = keyBase + sufijo(indice);
  if (indice > 200) break;   // salvaguarda contra bucle infinito
}

return [{
  json: {
    ...estado,

    duplicado: Boolean(filaDuplicada),
    citation_key_existente: filaDuplicada ? String(filaDuplicada.citation_key || '') : '',
    fila_duplicada_titulo: filaDuplicada ? String(filaDuplicada.titulo || '') : '',
    fila_duplicada_link_nota: filaDuplicada ? String(filaDuplicada.link_nota || '') : '',

    citation_key: citationKey,
    citation_key_base: keyBase,
    citation_key_sufijo_aplicado: indice > 0,

    url_normalizada: urlNueva,
    filas_revisadas: filas.length,
  },
}];
