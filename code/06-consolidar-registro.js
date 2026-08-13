/**
 * NODO: "Consolidar registro"
 * Tipo: Code (n8n-nodes-base.code) — Modo: Run Once for All Items
 *
 * QUE HACE
 *   Junta los metadatos de Crossref (nodo 04) con el resumen del LLM y produce
 *   las tres cosas que se van a escribir:
 *
 *     a) bibtex_entry  -> la entrada que se agrega a referencias.bib
 *     b) nota_texto    -> el cuerpo del Google Doc de lectura
 *     c) los campos de la fila del consolidado (los arma el nodo 08)
 *
 *   ESCAPADO LaTeX
 *     Se escapan & % $ # _ { } ~ ^ \ en TODOS los campos del .bib.
 *     Se mantiene UTF-8 para tildes y ñ (asume \usepackage[utf8]{inputenc}
 *     con pdfLaTeX, o directamente LuaLaTeX/XeLaTeX).
 *     El titulo se envuelve en llaves dobles -> title = {{...}} para que
 *     BibTeX no baje a minusculas los acronimos (CFD, ASME, NCh).
 *
 *   El LLM SOLO aporta resumen, descripcion_breve, palabras_clave y utilidad.
 *   Ningun campo bibliografico se toma de su salida.
 *
 * ENTRADA:  salida de "Resumir con LLM" (rama con texto) o de la rama sin texto
 * SALIDA:   1 item con todo lo necesario para escribir
 */

// ---------------------------------------------------------------------------
// Escapado LaTeX
// ---------------------------------------------------------------------------

// Mapa de caracteres reservados de LaTeX -> su forma segura.
// Se aplica en UNA sola pasada de regex para no re-escapar las barras
// invertidas que el propio escapado introduce.
const MAPA_LATEX = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '&': '\\&',
  '%': '\\%',
  '$': '\\$',
  '#': '\\#',
  '_': '\\_',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};

/**
 * Escapa los 10 caracteres reservados de LaTeX.
 * NO toca acentos ni ñ: quedan en UTF-8 tal cual.
 */
function escLatex(valor) {
  return String(valor == null ? '' : valor)
    .replace(/[\\{}&%$#_~^]/g, (ch) => MAPA_LATEX[ch])
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Campo de titulo: escapado + llaves dobles.
 * title = {{Análisis CFD de un Túnel de Viento}}
 * Las llaves externas son las del campo BibTeX; las internas protegen las
 * mayusculas y los acronimos del case-folding de los estilos bibliograficos.
 */
function campoTitulo(valor) {
  return `{{${escLatex(valor)}}}`;
}

/** Campo normal: escapado dentro de llaves simples. */
function campo(valor) {
  return `{${escLatex(valor)}}`;
}

/**
 * Campo de identificador (doi / url): escapado MINIMO, a proposito.
 *
 * Un DOI de Springer como 10.1007/978-3-030-14907-9_5 lleva guion bajo, y una
 * URL puede llevar _ & ~. Si se escaparan como \_ \& \textasciitilde{}, el
 * texto se veria bien pero el ENLACE quedaria roto: hyperref usa el contenido
 * literal del campo como destino del href. Por eso estos dos campos van crudos,
 * igual que como los exportan Zotero o JabRef.
 *
 * Las dos unicas excepciones son % y #, que rompen al tokenizador de LaTeX
 * antes de que hyperref alcance a verlos (% abre comentario, # es parametro de
 * macro). hyperref si acepta \% y \# dentro de \url y \href.
 *
 * Requiere que el preambulo cargue hyperref o url (todas las plantillas de
 * Overleaf lo hacen). Ver SUPUESTOS.md.
 */
function campoIdentificador(valor) {
  const limpio = String(valor == null ? '' : valor)
    .trim()
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#');
  return `{${limpio}}`;
}

/**
 * Autores en formato BibTeX: "Apellido, Nombre and Apellido2, Nombre2".
 * Las organizaciones van entre llaves para que BibTeX no las interprete como
 * "Apellido, Nombre":  author = {{Sociedad Chilena de Ingeniería}}
 */
function autoresBibtex(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return '';
  return lista
    .map((a) => {
      if (a.tipo === 'organizacion') return `{${escLatex(a.nombre)}}`;
      if (a.given) return `${escLatex(a.apellido)}, ${escLatex(a.given)}`;
      return escLatex(a.apellido);
    })
    .join(' and ');
}

/** Rango de paginas: Crossref usa "123-145", BibTeX quiere "123--145". */
function paginasBibtex(p) {
  return escLatex(String(p || '').replace(/\s*[-–—]+\s*/g, '--'));
}

// ---------------------------------------------------------------------------
// Lectura defensiva de la salida del LLM
// ---------------------------------------------------------------------------

/**
 * Segun la version del nodo "Basic LLM Chain", la salida del Structured Output
 * Parser puede llegar como:
 *   - el objeto desempaquetado en la raiz de $json
 *   - dentro de $json.output
 *   - como string JSON dentro de $json.text
 * Esta funcion cubre los tres casos sin romperse.
 */
function leerSalidaLlm(bruto) {
  if (!bruto || typeof bruto !== 'object') return {};

  const candidatos = [bruto.output, bruto, bruto.data];
  for (const c of candidatos) {
    if (c && typeof c === 'object' && !Array.isArray(c) && typeof c.resumen === 'string') {
      return c;
    }
  }

  if (typeof bruto.text === 'string') {
    try {
      const parsed = JSON.parse(bruto.text);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (e) { /* no era JSON */ }
  }
  return {};
}

// ---------------------------------------------------------------------------
// Proceso
// ---------------------------------------------------------------------------

const estado = { ...$('Dedupe y citation key').first().json };
const llm = leerSalidaLlm($input.first() ? $input.first().json : {});

const key = estado.citation_key;
const tipo = estado.tipo_bibtex || 'misc';

// --- Resumen ---------------------------------------------------------------
const resumen = String(llm.resumen || '').trim();
const hayResumen = resumen.length > 100;

const descripcionBreve = String(llm.descripcion_breve || '').trim() ||
  (estado.motivo_sin_texto ? 'Sin resumen automatico; revisar a mano' : '');

const palabrasClave = Array.isArray(llm.palabras_clave)
  ? llm.palabras_clave.map((p) => String(p).trim()).filter(Boolean)
  : String(llm.palabras_clave || '').split(/[,;]/).map((p) => p.trim()).filter(Boolean);

const utilidad = String(llm.utilidad || '').trim();

const estadoResumen = hayResumen ? 'LISTO' : 'PENDIENTE';

// --- Construccion de la entrada BibTeX -------------------------------------
// Cada tipo declara sus campos en orden. Los vacios se descartan al final.
const campos = [];
const push = (nombre, valor) => { if (valor && valor !== '{}' && valor !== '{{}}') campos.push([nombre, valor]); };

const autores = autoresBibtex(estado.autores);
const editores = autoresBibtex(estado.editores);

push('author', autores ? `{${autores}}` : '');
if (!autores && editores) push('editor', `{${editores}}`);
push('title', campoTitulo(estado.titulo));

switch (tipo) {
  case 'article':
    push('journal', campo(estado.publicacion));
    push('volume', campo(estado.volumen));
    push('number', campo(estado.numero));
    push('pages', estado.paginas ? `{${paginasBibtex(estado.paginas)}}` : '');
    break;

  case 'book':
    push('publisher', campo(estado.editorial));
    push('isbn', campo(estado.isbn));
    break;

  case 'incollection':
    push('booktitle', campoTitulo(estado.publicacion));
    if (autores && editores) push('editor', `{${editores}}`);
    push('publisher', campo(estado.editorial));
    push('pages', estado.paginas ? `{${paginasBibtex(estado.paginas)}}` : '');
    break;

  case 'inproceedings':
  case 'proceedings':
    push('booktitle', campoTitulo(estado.evento || estado.publicacion));
    push('publisher', campo(estado.editorial));
    push('pages', estado.paginas ? `{${paginasBibtex(estado.paginas)}}` : '');
    break;

  case 'techreport':
    push('institution', campo(estado.institucion || estado.editorial || estado.publicacion));
    push('number', campo(estado.numero));
    push('type', campo(estado.tipo_crossref === 'standard' ? 'Norma tecnica' : ''));
    break;

  case 'phdthesis':
    push('school', campo(estado.institucion || estado.editorial || estado.publicacion));
    break;

  default: // misc
    push('publisher', campo(estado.editorial));
    break;
}

push('year', campo(estado.anio));
push('doi', campoIdentificador(estado.doi));
push('url', campoIdentificador(estado.url_final || estado.url));

// --- Notas segun el caso ---------------------------------------------------
const notas = [];

if (tipo === 'misc' && !estado.doi) {
  // Pagina web / catalogo / norma sin DOI
  const host = (() => {
    try { return new URL(estado.url_final || estado.url).hostname.replace(/^www\./, ''); }
    catch (e) { return ''; }
  })();
  if (host) push('howpublished', campo(`En línea: ${host}`));
  notas.push(`Consultado el ${estado.fecha_consulta_legible}`);
} else if (estado.es_preprint) {
  notas.push(`Preprint${estado.publicacion ? ' publicado en ' + estado.publicacion : ''}`);
  notas.push(`Consultado el ${estado.fecha_consulta_legible}`);
}

if (estado.metadatos_manuales === 'SI') {
  notas.push('METADATOS POR VERIFICAR A MANO');
}

if (notas.length) push('note', campo(notas.join('. ')));

// Ancho de la columna de nombres de campo, para que quede prolijo al leerlo
const anchoMax = campos.reduce((m, [n]) => Math.max(m, n.length), 0);
const cuerpo = campos
  .map(([n, v]) => `  ${n.padEnd(anchoMax)} = ${v}`)
  .join(',\n');

const bibtexEntry = `@${tipo}{${key},\n${cuerpo}\n}`;

// --- Cuerpo de la nota de lectura (Google Docs) ----------------------------
// Sin la entrada BibTeX: esa vive solo en referencias.bib.
const lineasNota = [
  estado.titulo,
  '',
  `Autores: ${estado.autores_texto || '(no disponibles en Crossref)'}`,
  `Año: ${estado.anio || '(sin fecha)'}`,
  `Publicación: ${estado.publicacion || '(no disponible)'}`,
  `Tipo: @${tipo} (Crossref: ${estado.tipo_crossref})`,
  `Citation key: ${key}`,
  `DOI: ${estado.doi || '(sin DOI)'}`,
  `Link: ${estado.url_final || estado.url || '(sin link)'}`,
  `Metadatos manuales: ${estado.metadatos_manuales}`,
  `Estado del resumen: ${estadoResumen}`,
  '',
  '--- RESUMEN ---',
  hayResumen ? resumen : `(Pendiente) ${estado.motivo_sin_texto || 'No se pudo extraer texto de la fuente.'}`,
  '',
  '--- PALABRAS CLAVE ---',
  palabrasClave.length ? palabrasClave.join(', ') : '(pendiente)',
  '',
  '--- UTILIDAD PARA LA MEMORIA ---',
  utilidad || '(pendiente)',
  '',
  '--- NOTAS PROPIAS ---',
  '',
];

return [{
  json: {
    ...estado,

    // Resumen del LLM
    resumen,
    descripcion_breve: descripcionBreve.slice(0, 200),
    palabras_clave: palabrasClave,
    palabras_clave_texto: palabrasClave.join(', '),
    utilidad,
    estado_resumen: estadoResumen,

    // Artefactos listos para escribir
    bibtex_entry: bibtexEntry,
    bibtex_tipo: `@${tipo}`,
    nota_titulo: `${key} — ${String(estado.titulo).slice(0, 120)}`,
    nota_texto: lineasNota.join('\n'),
  },
}];
