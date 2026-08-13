/**
 * NODO: "Construir bib actualizado"
 * Tipo: Code (n8n-nodes-base.code) — Modo: Run Once for All Items
 *
 * QUE HACE
 *   Read-modify-write del archivo referencias.bib alojado en GitHub.
 *
 *   1. Decodifica el contenido base64 que devuelve el nodo GitHub (file:get).
 *   2. IDEMPOTENCIA REAL sobre el archivo: si el DOI o la citation key ya
 *      estan en el .bib, no agrega nada y devuelve el archivo intacto.
 *   3. Si la key ya existe pero apunta a otra obra, corre el sufijo
 *      (b, c, d...) y reescribe la primera linea de la entrada. La key final
 *      que sale de aqui es la que usan la nota, la planilla y el mensaje de
 *      Telegram: una sola fuente de verdad.
 *   4. Devuelve el contenido nuevo YA en base64. El nodo GitHub detecta que
 *      es base64 valido y lo sube tal cual, lo que evita el clasico error
 *      "content is not valid Base64" con archivos que mezclan UTF-8 y llaves.
 *
 * ENTRADA:  salida de "Leer referencias.bib" (GitHub file:get, no binario)
 * SALIDA:   1 item con contenido_base64, citation_key final y bib_modificado
 */

// ---------------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------------

// Cabecera que se escribe si el archivo estaba completamente vacio
const CABECERA = [
  '% referencias.bib',
  '% Generado y mantenido automaticamente por el flujo de n8n "Bibliografia Memoria".',
  '% Las entradas se agregan al final. Editar a mano es seguro: el flujo solo hace append.',
  '',
].join('\n');

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Escapa una cadena para usarla literal dentro de una expresion regular. */
function reEscape(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sufijos BibTeX: 1 -> b, 2 -> c, ..., 25 -> z, 26 -> aa */
function sufijo(indice) {
  if (indice <= 0) return '';
  let n = indice + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(97 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Proceso
// ---------------------------------------------------------------------------

const registro = { ...$('Consolidar registro').first().json };
const respuestaGh = $input.first() ? $input.first().json : {};

// --- 1. Contenido actual del archivo --------------------------------------
let contenido = '';
let archivoExiste = false;

if (respuestaGh && typeof respuestaGh.content === 'string' && respuestaGh.content.length) {
  archivoExiste = true;
  // GitHub devuelve base64 con saltos de linea cada 60 caracteres
  contenido = Buffer.from(respuestaGh.content.replace(/\s/g, ''), 'base64').toString('utf8');
} else if (respuestaGh && respuestaGh.error) {
  // El nodo GitHub tiene onError=continueRegularOutput: un 404 llega como item de error.
  throw new Error(
    'No se pudo leer referencias.bib en GitHub. Crea el archivo (aunque sea vacio) ' +
    'en la rama configurada antes de la primera ejecucion. Detalle: ' +
    JSON.stringify(respuestaGh.error).slice(0, 300),
  );
}

// --- 2. Idempotencia: ¿ya esta esta obra en el archivo? -------------------
const doi = String(registro.doi || '').trim().toLowerCase();
let yaEstaba = false;
let motivoYaEstaba = '';

if (doi && contenido.toLowerCase().includes(doi)) {
  yaEstaba = true;
  motivoYaEstaba = 'El DOI ya aparece en referencias.bib';
}

// --- 3. Resolucion de colision de citation key ----------------------------
// Se buscan las keys existentes del archivo: @tipo{key,
const keysEnArchivo = new Set();
const reKeys = /@\w+\s*\{\s*([^,\s}]+)\s*,/g;
let m;
while ((m = reKeys.exec(contenido)) !== null) {
  keysEnArchivo.add(m[1].trim().toLowerCase());
}

let keyFinal = registro.citation_key;
let entrada = registro.bibtex_entry;

if (!yaEstaba) {
  const base = registro.citation_key_base || registro.citation_key;
  let i = 0;
  keyFinal = registro.citation_key;

  while (keysEnArchivo.has(keyFinal.toLowerCase())) {
    i += 1;
    keyFinal = base + sufijo(i);
    if (i > 200) break;
  }

  if (keyFinal !== registro.citation_key) {
    // Reescribe solo la key de la primera linea: "@article{vieja," -> "@article{nueva,"
    entrada = entrada.replace(
      new RegExp(`^(@\\w+\\s*\\{\\s*)${reEscape(registro.citation_key)}(\\s*,)`),
      `$1${keyFinal}$2`,
    );
  }
}

// --- 4. Nuevo contenido ---------------------------------------------------
let contenidoNuevo = contenido;
let modificado = false;

if (!yaEstaba) {
  let base = contenido.trim().length ? contenido.replace(/\s+$/, '') : CABECERA.replace(/\s+$/, '');
  contenidoNuevo = `${base}\n\n${entrada}\n`;
  modificado = true;
}

return [{
  json: {
    ...registro,

    // La key final manda para nota, planilla y Telegram
    citation_key: keyFinal,
    citation_key_cambio_en_bib: keyFinal !== registro.citation_key,
    bibtex_entry: entrada,

    bib_existe: archivoExiste,
    bib_modificado: modificado,
    bib_ya_contenia: yaEstaba,
    bib_motivo: motivoYaEstaba,
    bib_entradas_previas: keysEnArchivo.size,

    // Lo que consume el nodo "Escribir referencias.bib"
    contenido_base64: Buffer.from(contenidoNuevo, 'utf8').toString('base64'),
    commit_message: yaEstaba
      ? `bib: sin cambios (${keyFinal} ya estaba)`
      : `bib: agrega ${keyFinal}`,
  },
}];
