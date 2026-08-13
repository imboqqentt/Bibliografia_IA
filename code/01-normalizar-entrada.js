/**
 * NODO: "Normalizar entrada"
 * Tipo: Code (n8n-nodes-base.code) — Modo: Run Once for All Items
 *
 * QUE HACE
 *   Toma el mensaje de Telegram y lo convierte en un "estado" limpio que
 *   viaja por el resto del flujo. No consulta nada externo.
 *
 *   1. Extrae el texto del mensaje (text o caption).
 *   2. Busca una URL y/o un DOI dentro del texto.
 *   3. Si el DOI viene embebido en la URL (doi.org/..., ?doi=..., /doi/10.xxxx/...)
 *      lo desentierra y lo limpia de basura de tracking.
 *   4. Construye una url_normalizada estable, que se usa como clave de
 *      deduplicacion cuando la fuente NO tiene DOI.
 *   5. Permite pasar un titulo a mano con la sintaxis:  <url> | <titulo>
 *      (util para PDFs de fabricante o normas donde no hay metadatos).
 *
 * ENTRADA:  item del Telegram Trigger
 * SALIDA:   1 item con el objeto de estado completo
 */

// ---------------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------------

// Zona horaria para el campo fecha_ingreso y para "Consultado el ..." del .bib
const ZONA_HORARIA = 'America/Santiago';

// Parametros de tracking que se eliminan al normalizar la URL (para dedupe)
const PARAMS_BASURA = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'via', 'ref', 'rss', 'fbclid', 'gclid', 'mc_cid', 'mc_eid', 's', 'sk',
];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Limpia un DOI candidato: saca puntuacion final, sufijos de plataforma y
 * fragmentos que a veces quedan pegados al copiar el link.
 */
function limpiarDoi(bruto) {
  if (!bruto) return null;
  let doi = String(bruto).trim();

  // A veces llega percent-encoded: 10.1016%2Fj.applthermaleng...
  try {
    if (doi.includes('%2F') || doi.includes('%2f')) doi = decodeURIComponent(doi);
  } catch (e) { /* si el decode falla, seguimos con el original */ }

  // Corta en el primer caracter que nunca forma parte de un DOI
  doi = doi.split(/[\s<>"'()\[\]]/)[0];

  // Corta query string / fragmento
  doi = doi.split('?')[0].split('#')[0];

  // Sufijos que agregan las plataformas al final del path
  doi = doi.replace(/\/(full|abstract|pdf|epdf|meta|html)$/i, '');

  // Puntuacion final tipica de "pegue el link en una frase."
  doi = doi.replace(/[.,;:)\]}]+$/, '');

  // Validacion final del prefijo registrante
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

/**
 * Busca un DOI en cualquier texto (mensaje crudo o URL).
 * Cubre los patrones comunes: doi.org/10.x, /doi/10.x, ?doi=10.x, 10.x suelto.
 */
function buscarDoi(texto) {
  if (!texto) return null;

  // Se prueba sobre la cadena cruda y sobre la decodificada, porque hay sitios
  // que pasan el DOI percent-encoded:  ?doi=10.5194%2Fgmd-14-1-2021
  const variantes = [String(texto)];
  try {
    const decodificada = decodeURIComponent(String(texto));
    if (decodificada !== variantes[0]) variantes.push(decodificada);
  } catch (e) { /* URL mal formada: seguimos solo con la cruda */ }

  // Orden importa: primero los patrones anclados, despues el DOI suelto.
  const patrones = [
    /(?:doi\.org\/|dx\.doi\.org\/)(10\.\d{4,9}\/[^\s"'<>]+)/i,
    /[?&]doi=(10\.\d{4,9}\/[^\s"'<>&]+)/i,
    /\/doi\/(?:abs\/|full\/|pdf\/|epdf\/)?(10\.\d{4,9}\/[^\s"'<>]+)/i,
    /\bdoi:\s*(10\.\d{4,9}\/[^\s"'<>]+)/i,
    /(10\.\d{4,9}\/[^\s"'<>]+)/i,
  ];

  for (const re of patrones) {
    for (const v of variantes) {
      const m = v.match(re);
      if (m) {
        const doi = limpiarDoi(m[1]);
        if (doi) return doi;
      }
    }
  }
  return null;
}

/**
 * URL canonica para deduplicar: sin protocolo variable, sin www, sin
 * parametros de tracking, sin barra final, sin fragmento, en minusculas.
 */
function normalizarUrl(url) {
  if (!url) return '';
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

    // Ordena los parametros que quedan para que el orden no genere falsos negativos
    const params = [...u.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    u.search = '';
    for (const [k, v] of params) u.searchParams.append(k, v);

    let salida = u.toString();
    salida = salida.replace(/\/$/, '');
    return salida.toLowerCase();
  } catch (e) {
    return String(url).trim().toLowerCase().replace(/\/$/, '');
  }
}

// ---------------------------------------------------------------------------
// Proceso
// ---------------------------------------------------------------------------

const entrada = $input.first().json;
const msg = entrada.message || entrada.edited_message || entrada.channel_post || {};
const textoOriginal = String(msg.text || msg.caption || '').trim();

if (!textoOriginal) {
  throw new Error('El mensaje de Telegram no contiene texto ni caption.');
}

// Sintaxis opcional "<url o doi> | <titulo a mano>"
let parteLink = textoOriginal;
let tituloManual = '';
const corte = textoOriginal.indexOf('|');
if (corte !== -1) {
  parteLink = textoOriginal.slice(0, corte).trim();
  tituloManual = textoOriginal.slice(corte + 1).trim();
}

// Primera URL http(s) que aparezca
const mUrl = parteLink.match(/https?:\/\/[^\s<>"']+/i);
let url = mUrl ? mUrl[0].replace(/[.,;:)\]}]+$/, '') : '';

// DOI: primero desde la URL (mas confiable), despues desde el texto completo
const doi = buscarDoi(url) || buscarDoi(parteLink);

// Si mandaron un DOI suelto sin link, construimos la URL de resolucion
let urlDescarga = url;
if (!urlDescarga && doi) urlDescarga = `https://doi.org/${doi}`;

// Pista de titulo: la que se escribio a mano, o el texto si no habia link ni DOI
let tituloHint = tituloManual;
if (!tituloHint && !url && !doi) tituloHint = parteLink;

const ahora = $now.setZone(ZONA_HORARIA);

return [{
  json: {
    // --- trazabilidad ---
    fecha_ingreso: ahora.toFormat('yyyy-LL-dd'),
    fecha_consulta_legible: ahora.toFormat('dd/LL/yyyy'),
    telegram_chat_id: msg.chat ? msg.chat.id : null,
    texto_original: textoOriginal,

    // --- identificadores ---
    doi: doi || '',
    tiene_doi: Boolean(doi),
    url: url || '',
    url_descarga: urlDescarga || '',
    url_normalizada: normalizarUrl(urlDescarga || parteLink),
    hay_url_descarga: Boolean(urlDescarga),

    // --- pistas para Crossref / LLM ---
    titulo_hint: tituloHint || '',

    // Se marca en SI mas adelante si Crossref no devuelve metadatos utilizables
    metadatos_manuales: 'NO',
  },
}];
