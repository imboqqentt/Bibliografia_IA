/**
 * NODO: "Elegir candidato Crossref"
 * Tipo: Code (n8n-nodes-base.code) — Modo: Run Once for All Items
 *
 * QUE HACE
 *   Solo corre cuando NO se pudo determinar el DOI ni desde el link ni desde
 *   las meta tags de la pagina. Recibe la respuesta de la busqueda por titulo
 *   en Crossref (/works?query.bibliographic=...) y decide si alguno de los
 *   candidatos es realmente la misma obra.
 *
 *   Es deliberadamente CONSERVADOR: si la similitud de titulo no supera el
 *   umbral, prefiere quedarse sin DOI y marcar metadatos_manuales = SI antes
 *   que asignar un DOI equivocado. Un DOI incorrecto en una memoria de titulo
 *   es peor que un campo vacio.
 *
 * ENTRADA:  respuesta JSON de Crossref search (o item de error si fallo)
 * SALIDA:   1 item = estado + doi (si hubo match confiable)
 */

// ---------------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------------

// Similitud minima de titulo (0..1) para aceptar el DOI automaticamente.
// 0.72 es estricto a proposito. Bajalo a ~0.60 si ves demasiados falsos negativos.
const UMBRAL_SIMILITUD = 0.72;

// Palabras que no aportan a la comparacion de titulos
const VACIAS = new Set([
  'a', 'an', 'the', 'of', 'on', 'in', 'for', 'and', 'or', 'to', 'with', 'by',
  'from', 'at', 'as', 'is', 'are', 'using', 'via',
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'y', 'o', 'en', 'para',
  'con', 'por', 'sobre', 'mediante',
]);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Minusculas, sin tildes, sin puntuacion, sin etiquetas HTML. */
function normalizarTexto(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizar(s) {
  return normalizarTexto(s).split(' ').filter((w) => w.length > 2 && !VACIAS.has(w));
}

/**
 * Similitud de titulos sobre bolsas de palabras significativas.
 *
 * Combina dos medidas porque cada una falla en un caso distinto:
 *
 *   - Sorensen-Dice: buena en general, pero castiga fuerte la asimetria de
 *     largo. El titulo que uno anota a mano ("Performance intensification of
 *     regeneration process") suele ser un PREFIJO del titulo completo de
 *     Crossref, y Dice lo deja bajo el umbral aunque sea el mismo paper.
 *
 *   - Coeficiente de contencion (|A∩B| / min(|A|,|B|)): resuelve justamente
 *     ese caso, pero por si solo es demasiado permisivo con titulos cortos
 *     ("energia solar" calzaria con cualquier paper que use ambas palabras).
 *
 * Por eso la contencion solo se toma en cuenta si hay al menos MIN_COMUNES
 * palabras significativas compartidas, y se le aplica una pequena penalizacion
 * para que nunca puntue mas alto que una coincidencia realmente exacta.
 */
const MIN_COMUNES = 3;

function similitud(a, b) {
  const A = new Set(tokenizar(a));
  const B = new Set(tokenizar(b));
  if (A.size === 0 || B.size === 0) return 0;

  let comunes = 0;
  for (const w of A) if (B.has(w)) comunes++;

  const dice = (2 * comunes) / (A.size + B.size);
  if (comunes < MIN_COMUNES) return dice;

  const contencion = comunes / Math.min(A.size, B.size);
  return Math.max(dice, contencion * 0.95);
}

// ---------------------------------------------------------------------------
// Proceso
// ---------------------------------------------------------------------------

const estado = { ...$('Preparar texto').first().json };
const respuesta = $input.first() ? $input.first().json : {};

// Referencia contra la cual comparamos: el titulo que pusimos a mano,
// el <title> de la pagina, o el propio texto del mensaje.
const referencia = estado.titulo_hint || estado.titulo_pagina || estado.texto_original || '';

const candidatos = (respuesta &&
  respuesta.message &&
  Array.isArray(respuesta.message.items))
  ? respuesta.message.items
  : [];

let mejor = null;
let mejorPuntaje = 0;

for (const c of candidatos) {
  const tituloCandidato = Array.isArray(c.title) ? c.title.join(' ') : String(c.title || '');
  if (!tituloCandidato) continue;

  const p = similitud(referencia, tituloCandidato);
  if (p > mejorPuntaje) {
    mejorPuntaje = p;
    mejor = c;
  }
}

const aceptado = Boolean(mejor && mejorPuntaje >= UMBRAL_SIMILITUD && mejor.DOI);

return [{
  json: {
    ...estado,
    doi: aceptado ? String(mejor.DOI).toLowerCase() : '',
    tiene_doi: aceptado,
    doi_recuperado_por_busqueda: aceptado,

    // Trazabilidad para poder auditar despues por que se eligio (o no) un DOI
    crossref_busqueda_candidatos: candidatos.length,
    crossref_busqueda_puntaje: Number(mejorPuntaje.toFixed(3)),
    crossref_busqueda_titulo_elegido: mejor
      ? (Array.isArray(mejor.title) ? mejor.title.join(' ') : String(mejor.title || ''))
      : '',
    crossref_busqueda_umbral: UMBRAL_SIMILITUD,
  },
}];
