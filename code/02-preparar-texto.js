/**
 * NODO: "Preparar texto"
 * Tipo: Code (n8n-nodes-base.code) — Modo: Run Once for All Items
 *
 * QUE HACE
 *   Recibe lo que haya salido de la descarga (texto de PDF, HTML crudo, o
 *   NADA si no habia URL / la descarga fallo) y produce el texto limpio que
 *   se le pasara al LLM.
 *
 *   Ademas aprovecha el HTML para RESCATAR METADATOS:
 *   muchas editoriales publican <meta name="citation_doi"> y
 *   <meta name="citation_title">, que es la forma mas confiable de sacar el
 *   DOI de un link de ScienceDirect / Springer / Wiley / MDPI, donde el DOI
 *   no aparece en la URL.
 *
 *   NUNCA lanza error: si no hay texto, marca estado_resumen = PENDIENTE y
 *   el flujo sigue igual (requisito: una fuente inaccesible no rompe nada).
 *
 * ENTRADA:  salida de "Extraer texto PDF" | "Extraer texto HTML" | rama sin URL
 * SALIDA:   1 item = estado de "Normalizar entrada" + texto y diagnostico
 */

// ---------------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------------

// Tope de caracteres que se le manda al LLM. ~45k chars ≈ 12k tokens.
const MAX_CHARS = 45000;

// Bajo este umbral asumimos paywall / pagina vacia / captcha.
const MIN_CHARS_UTILES = 600;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Decodifica las entidades HTML mas comunes. */
function decodificarEntidades(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#x?([0-9a-f]+);/gi, (_, cod) =>
      String.fromCharCode(parseInt(cod, /^x/i.test(cod) ? 16 : 10)));
}

/** Lee el content de un <meta name="..."> o <meta property="..."> */
function leerMeta(html, nombre) {
  const escapado = nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patrones = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escapado}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property)=["']${escapado}["']`, 'i'),
  ];
  for (const re of patrones) {
    const m = html.match(re);
    if (m) return decodificarEntidades(m[1]).trim();
  }
  return '';
}

/** Convierte HTML a texto plano legible. */
function htmlATexto(html) {
  let t = String(html);

  // Fuera todo lo que no es contenido
  t = t.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  t = t.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ');
  t = t.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ');
  t = t.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ');
  t = t.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');

  // Saltos de linea donde corresponde semanticamente
  t = t.replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)\s*>/gi, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');

  // Fuera el resto de las etiquetas
  t = t.replace(/<[^>]+>/g, ' ');

  t = decodificarEntidades(t);

  // Compacta espacios sin destruir parrafos
  t = t.replace(/[ \t ]+/g, ' ');
  t = t.replace(/\n[ \t]*/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');

  return t.trim();
}

/** Reutiliza la logica de limpieza de DOI del nodo 01. */
function limpiarDoi(bruto) {
  if (!bruto) return null;
  let doi = String(bruto).trim();
  try {
    if (doi.includes('%2F') || doi.includes('%2f')) doi = decodeURIComponent(doi);
  } catch (e) { /* noop */ }
  doi = doi.split(/[\s<>"'()\[\]]/)[0];
  doi = doi.split('?')[0].split('#')[0];
  doi = doi.replace(/\/(full|abstract|pdf|epdf|meta|html)$/i, '');
  doi = doi.replace(/[.,;:)\]}]+$/, '');
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

// ---------------------------------------------------------------------------
// Proceso
// ---------------------------------------------------------------------------

const estado = { ...$('Normalizar entrada').first().json };
const bruto = $input.first() ? $input.first().json : {};

// De donde puede venir el contenido:
//   - Extract from File / PDF  -> $json.text
//   - Extract from File / Text -> $json.data  (HTML crudo, tal cual se descargo)
//   - rama sin URL             -> nada util
const textoPdf = typeof bruto.text === 'string' ? bruto.text : '';
const textoPlano = typeof bruto.data === 'string' ? bruto.data : '';
const contenido = textoPdf || textoPlano;

const pareceHtml = /<\s*(html|head|body|meta|div|p)\b/i.test(contenido.slice(0, 4000));

let texto = '';
let doiDePagina = null;
let tituloDePagina = '';
let fuenteTexto = 'ninguna';

if (textoPdf) {
  texto = textoPdf;
  fuenteTexto = 'pdf';
} else if (contenido && pareceHtml) {
  fuenteTexto = 'html';

  // --- rescate de metadatos desde las meta tags de la editorial ---
  doiDePagina =
    limpiarDoi(leerMeta(contenido, 'citation_doi')) ||
    limpiarDoi(leerMeta(contenido, 'DC.Identifier')) ||
    limpiarDoi(leerMeta(contenido, 'dc.identifier')) ||
    limpiarDoi(leerMeta(contenido, 'prism.doi')) ||
    null;

  // Ultimo recurso: un doi.org dentro del cuerpo de la pagina
  if (!doiDePagina) {
    const m = contenido.match(/(?:doi\.org\/)(10\.\d{4,9}\/[^\s"'<>]+)/i);
    if (m) doiDePagina = limpiarDoi(m[1]);
  }

  tituloDePagina =
    leerMeta(contenido, 'citation_title') ||
    leerMeta(contenido, 'og:title') ||
    leerMeta(contenido, 'dc.title') ||
    (contenido.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
      ? decodificarEntidades(RegExp.$1).trim()
      : '');

  texto = htmlATexto(contenido);
} else if (contenido) {
  texto = contenido;
  fuenteTexto = 'texto-plano';
}

const longitudBruta = texto.length;
if (longitudBruta > MAX_CHARS) texto = texto.slice(0, MAX_CHARS);

const textoSuficiente = longitudBruta >= MIN_CHARS_UTILES;

// Diagnostico honesto de por que no hay resumen
let motivo = '';
if (!estado.hay_url_descarga) motivo = 'No se recibio URL ni DOI descargable.';
else if (!contenido) motivo = 'La descarga no devolvio contenido (paywall, 403, timeout o binario no soportado).';
else if (!textoSuficiente) motivo = `Texto extraido demasiado corto (${longitudBruta} caracteres); probable paywall o pagina de redireccion.`;

// El DOI de la pagina manda por sobre el que veniamos arrastrando solo si no habia
const doiFinal = estado.doi || doiDePagina || '';

return [{
  json: {
    ...estado,
    doi: doiFinal,
    tiene_doi: Boolean(doiFinal),
    doi_recuperado_de_pagina: Boolean(!estado.doi && doiDePagina),
    titulo_hint: estado.titulo_hint || tituloDePagina || '',
    titulo_pagina: tituloDePagina,

    texto_fuente: texto,
    longitud_texto: longitudBruta,
    fuente_texto: fuenteTexto,
    texto_suficiente: textoSuficiente,
    motivo_sin_texto: motivo,

    // Se confirma en "Consolidar registro"; aqui queda el valor provisorio
    estado_resumen: textoSuficiente ? 'OK' : 'PENDIENTE',
  },
}];
