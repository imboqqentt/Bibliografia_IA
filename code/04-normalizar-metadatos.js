/**
 * NODO: "Normalizar metadatos"
 * Tipo: Code (n8n-nodes-base.code) — Modo: Run Once for All Items
 *
 * QUE HACE
 *   Traduce la respuesta cruda de Crossref (/works/{doi}) a un conjunto plano
 *   de campos bibliograficos, y mapea el `type` de Crossref al tipo de entrada
 *   BibTeX correcto.
 *
 *   *** ESTE NODO ES LA UNICA FUENTE DE VERDAD BIBLIOGRAFICA. ***
 *   Autores, anio, revista, editorial, volumen, numero, paginas y tipo salen
 *   exclusivamente de aqui. El LLM no toca ninguno de estos campos.
 *
 *   Si no hubo DOI o Crossref no respondio, igual emite un registro valido
 *   con metadatos_manuales = SI, para que la fila quede marcada para revision.
 *
 * ENTRADA:  respuesta de "Crossref metadatos" (o rama sin DOI)
 * SALIDA:   1 item = estado + campos bibliograficos normalizados
 */

// ---------------------------------------------------------------------------
// Mapa Crossref type -> tipo de entrada BibTeX
// ---------------------------------------------------------------------------
const MAPA_TIPO_BIBTEX = {
  'journal-article': 'article',
  'journal-issue': 'misc',
  'journal-volume': 'misc',
  'journal': 'misc',

  'book': 'book',
  'monograph': 'book',
  'edited-book': 'book',
  'reference-book': 'book',

  'book-chapter': 'incollection',
  'book-section': 'incollection',
  'book-part': 'incollection',
  'book-track': 'incollection',
  'reference-entry': 'incollection',

  'proceedings-article': 'inproceedings',
  'proceedings': 'proceedings',

  'report': 'techreport',
  'report-component': 'techreport',
  'report-series': 'techreport',
  'standard': 'techreport',      // normas ISO / NCh / ASME
  'standard-series': 'techreport',

  'dissertation': 'phdthesis',

  'posted-content': 'misc',      // preprints (arXiv, SSRN, bioRxiv...)
  'dataset': 'misc',
  'component': 'misc',
  'peer-review': 'misc',
  'other': 'misc',
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Crossref entrega titulos con etiquetas MathML/HTML incrustadas. */
function limpiarCampo(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Toma el primer elemento util de un campo que Crossref entrega como array. */
function primero(v) {
  if (Array.isArray(v)) return limpiarCampo(v.find((x) => x != null && String(x).trim() !== '') || '');
  return limpiarCampo(v);
}

/**
 * Normaliza la lista de autores.
 * Distingue personas ({given, family}) de organizaciones ({name}), porque en
 * BibTeX las organizaciones se protegen con llaves para que BibTeX no las
 * parta como "Apellido, Nombre".
 */
function normalizarAutores(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .map((a) => {
      if (a && a.name) {
        return { tipo: 'organizacion', nombre: limpiarCampo(a.name), apellido: limpiarCampo(a.name), given: '' };
      }
      const family = limpiarCampo(a && a.family);
      const given = limpiarCampo(a && a.given);
      if (!family && !given) return null;
      return {
        tipo: 'persona',
        apellido: family || given,
        given: family ? given : '',
        nombre: [given, family].filter(Boolean).join(' '),
      };
    })
    .filter(Boolean);
}

/** Crossref guarda las fechas como {'date-parts': [[aaaa, mm, dd]]}. */
function extraerAnio(...candidatos) {
  for (const c of candidatos) {
    const partes = c && c['date-parts'] && c['date-parts'][0];
    if (Array.isArray(partes) && partes[0]) return String(partes[0]);
  }
  return '';
}

// ---------------------------------------------------------------------------
// Proceso
// ---------------------------------------------------------------------------

const estado = { ...$('Preparar texto').first().json };

// El DOI puede haber sido resuelto despues de "Preparar texto" (rama de busqueda
// por titulo). "Unificar DOI" deja el valor vigente en el item que entra aqui.
let doiVigente = estado.doi || '';

const bruto = $input.first() ? $input.first().json : {};
const cr = (bruto && bruto.message && typeof bruto.message === 'object') ? bruto.message : null;

// Si venimos de la rama con DOI, ese item puede traer el estado actualizado
if (!doiVigente && bruto && bruto.doi) doiVigente = String(bruto.doi);
if (cr && cr.DOI) doiVigente = String(cr.DOI).toLowerCase();

let meta;

if (cr) {
  // --------------------------- CON metadatos Crossref ---------------------
  const tipoCrossref = String(cr.type || 'other');
  const autores = normalizarAutores(cr.author);
  const editores = normalizarAutores(cr.editor);

  const anio = extraerAnio(cr.issued, cr['published-print'], cr['published-online'], cr.created);

  // Institucion (tesis, informes tecnicos y normas)
  let institucion = '';
  if (Array.isArray(cr.institution) && cr.institution.length) {
    institucion = limpiarCampo(cr.institution[0].name || cr.institution[0]);
  }

  // Nombre del evento (congresos)
  const evento = cr.event ? limpiarCampo(cr.event.name) : '';

  meta = {
    titulo: primero(cr.title) || estado.titulo_hint || '(sin titulo)',
    subtitulo: primero(cr.subtitle),
    autores,
    editores,
    autores_texto: autores.map((a) => a.nombre).join('; '),
    anio,
    publicacion: primero(cr['container-title']) || evento || institucion || limpiarCampo(cr.publisher),
    publicacion_corta: primero(cr['short-container-title']),
    editorial: limpiarCampo(cr.publisher),
    institucion,
    evento,
    volumen: limpiarCampo(cr.volume),
    numero: limpiarCampo(cr.issue),
    paginas: limpiarCampo(cr.page || cr['article-number']),
    issn: Array.isArray(cr.ISSN) ? cr.ISSN[0] : limpiarCampo(cr.ISSN),
    isbn: Array.isArray(cr.ISBN) ? cr.ISBN[0] : limpiarCampo(cr.ISBN),
    tipo_crossref: tipoCrossref,
    tipo_bibtex: MAPA_TIPO_BIBTEX[tipoCrossref] || 'misc',
    es_preprint: tipoCrossref === 'posted-content',
    url_publicada: limpiarCampo(cr.URL) || (doiVigente ? `https://doi.org/${doiVigente}` : ''),
    metadatos_manuales: 'NO',
    origen_metadatos: 'crossref',
  };
} else {
  // ------------------- SIN metadatos: pagina web, norma, catalogo ---------
  // No inventamos nada. Solo lo que efectivamente sabemos.
  meta = {
    titulo: estado.titulo_hint || estado.titulo_pagina || estado.url || '(sin titulo)',
    subtitulo: '',
    autores: [],
    editores: [],
    autores_texto: '',
    anio: '',
    publicacion: '',
    publicacion_corta: '',
    editorial: '',
    institucion: '',
    evento: '',
    volumen: '',
    numero: '',
    paginas: '',
    issn: '',
    isbn: '',
    tipo_crossref: 'web',
    tipo_bibtex: 'misc',
    es_preprint: false,
    url_publicada: estado.url || estado.url_descarga || '',
    metadatos_manuales: 'SI',
    origen_metadatos: doiVigente ? 'crossref-sin-respuesta' : 'sin-doi',
  };
}

// Si Crossref respondio pero sin autores ni anio, tampoco sirve para citar solo
if (meta.origen_metadatos === 'crossref' && meta.autores.length === 0 && !meta.anio) {
  meta.metadatos_manuales = 'SI';
}

return [{
  json: {
    ...estado,
    ...meta,
    doi: doiVigente,
    tiene_doi: Boolean(doiVigente),
    url_final: estado.url || meta.url_publicada || estado.url_descarga || '',
  },
}];
