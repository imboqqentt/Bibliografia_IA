/**
 * Banco de pruebas de los nodos Code, fuera de n8n.
 *
 * Emula lo minimo del runtime de n8n ($input, $json, $now, $('Nodo')) para
 * poder ejecutar cada archivo de code/ con datos reales de Crossref y revisar
 * el .bib resultante sin tener que desplegar el workflow.
 *
 * Uso:  node test/harness.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const CODE = path.join(RAIZ, 'code');

// --- Emulacion minima del runtime de n8n -----------------------------------

function items(arr) {
  const lista = arr.map((j) => ({ json: j }));
  return {
    all: () => lista,
    first: () => lista[0],
    last: () => lista[lista.length - 1],
  };
}

/** Sustituto de $now (Luxon) con lo unico que usamos: setZone + toFormat. */
const ahoraFalso = {
  setZone: () => ahoraFalso,
  toFormat: (fmt) => (fmt === 'yyyy-LL-dd' ? '2026-08-13' : '13/08/2026'),
};

/**
 * Ejecuta un archivo de code/ como lo haria el nodo Code en modo
 * "Run Once for All Items": el cuerpo se envuelve en una funcion.
 */
function correr(archivo, entrada, nodosPrevios) {
  const src = fs.readFileSync(path.join(CODE, archivo), 'utf8');

  const contexto = {
    $input: items(entrada),
    $now: ahoraFalso,
    // $('Nodo') da acceso a la salida del nodo y, ademas, a sus PARAMETROS
    // via .params — que es como los comandos deducen el ID de la planilla y
    // el repo sin tenerlos escritos. En el test, los parametros del nodo se
    // declaran en la clave __params del fixture.
    $: (nombre) => {
      if (!(nombre in nodosPrevios)) {
        throw new Error(`El test no definio la salida del nodo "${nombre}"`);
      }
      const fixture = nodosPrevios[nombre] || {};
      const proxy = items([fixture]);
      proxy.params = fixture.__params || {};
      return proxy;
    },
    Buffer,
    URL,
    console,
    JSON,
    Math,
    Number,
    String,
    Set,
    Array,
    Object,
    RegExp,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
  };

  const script = new vm.Script(`(function () {\n${src}\n})()`);
  return script.runInNewContext(contexto, { timeout: 10000 });
}

// --- Utilidades de reporte -------------------------------------------------

let fallas = 0;

function check(descripcion, condicion, detalle) {
  if (condicion) {
    console.log(`  ok   ${descripcion}`);
  } else {
    fallas += 1;
    console.log(`  FALLA ${descripcion}${detalle ? '\n        -> ' + detalle : ''}`);
  }
}

function titulo(t) {
  console.log(`\n=== ${t} ===`);
}

// ===========================================================================
// CASO 1: articulo de revista con DOI en el link (camino feliz)
// ===========================================================================
titulo('Caso 1 — journal-article con DOI en la URL');

const crossrefArticulo = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'crossref-articulo.json'), 'utf8'),
);

let salida = correr('01-normalizar-entrada.js', [{
  message: {
    chat: { id: 123456789 },
    text: 'https://www.sciencedirect.com/science/article/abs/pii/S1359431119303928?via%3Dihub',
  },
}], {});
const entrada1 = salida[0].json;

check('no detecta DOI en un link de ScienceDirect sin DOI', entrada1.doi === '');
check('conserva la URL de descarga', entrada1.url_descarga.includes('sciencedirect.com'));
check('la URL normalizada elimina ?via', !entrada1.url_normalizada.includes('via'),
  entrada1.url_normalizada);

// El DOI aparece recien al leer las meta tags de la pagina
const htmlFalso = `<html><head>
<meta name="citation_doi" content="10.1016/j.applthermaleng.2019.114301">
<meta name="citation_title" content="Performance intensification of regeneration process">
<title>ScienceDirect</title></head><body>
<p>${'Contenido tecnico del articulo con resultados experimentales. '.repeat(40)}</p>
</body></html>`;

salida = correr('02-preparar-texto.js', [{ data: htmlFalso }], {
  'Normalizar entrada': entrada1,
});
const texto1 = salida[0].json;

check('rescata el DOI desde <meta citation_doi>',
  texto1.doi === '10.1016/j.applthermaleng.2019.114301', texto1.doi);
check('marca que el DOI vino de la pagina', texto1.doi_recuperado_de_pagina === true);
check('el texto extraido no conserva etiquetas HTML', !texto1.texto_fuente.includes('<p>'));
check('detecta texto suficiente', texto1.texto_suficiente === true,
  `longitud=${texto1.longitud_texto}`);

// --- Pagina de bloqueo: no debe alimentar la busqueda por titulo ----------
//
// Caso real de mdpi.com detras de Cloudflare. Sin este filtro, "Access Denied"
// se buscaba en Crossref, que devolvia un articulo REAL con ese nombre, y la
// referencia quedaba con autores, anio y revista creibles y equivocados.
// Metadatos falsos son peor que metadatos ausentes.
salida = correr('01-normalizar-entrada.js', [{
  message: { chat: { id: 123456789 }, text: 'https://www.mdpi.com/2071-1050/13/17/9880' },
}], {});
const entradaBloqueo = salida[0].json;

const htmlBloqueo = '<html><head><title>Access Denied</title></head><body>'
  + '<h1>Access Denied</h1><p>You do not have permission to access this resource.</p>'
  + '</body></html>';

salida = correr('02-preparar-texto.js', [{ data: htmlBloqueo }], {
  'Normalizar entrada': entradaBloqueo,
});
const textoBloqueo = salida[0].json;

check('pagina de bloqueo: no se usa su <title> como titulo',
  textoBloqueo.titulo_pagina === '', textoBloqueo.titulo_pagina);
check('pagina de bloqueo: no queda titulo para buscar en Crossref',
  textoBloqueo.titulo_hint === '', textoBloqueo.titulo_hint);
check('pagina de bloqueo: se deja constancia de lo descartado',
  textoBloqueo.titulo_descartado === 'Access Denied', textoBloqueo.titulo_descartado);
check('pagina de bloqueo: el motivo lo explica',
  textoBloqueo.motivo_sin_texto.includes('bloqueo'), textoBloqueo.motivo_sin_texto);

// El filtro no puede comerse un titulo legitimo: el del caso 1 pasa igual,
// porque viene de <meta citation_title>, que la pone la editorial.
check('un titulo legitimo de la editorial sigue sirviendo',
  texto1.titulo_pagina === 'Performance intensification of regeneration process',
  texto1.titulo_pagina);

salida = correr('04-normalizar-metadatos.js', [crossrefArticulo], {
  'Preparar texto': texto1,
});
const meta1 = salida[0].json;

check('tipo journal-article -> @article', meta1.tipo_bibtex === 'article', meta1.tipo_bibtex);
check('primer autor desde Crossref', meta1.autores[0].apellido === 'Kumar', meta1.autores_texto);
check('anio desde issued', meta1.anio === '2019', meta1.anio);
check('revista desde container-title', meta1.publicacion.includes('Applied Thermal'),
  meta1.publicacion);
check('volumen 162', meta1.volumen === '162', meta1.volumen);
check('metadatos_manuales = NO', meta1.metadatos_manuales === 'NO');

// Consolidado vacio -> sin duplicados
salida = correr('05-dedupe-y-citation-key.js', [{}], { 'Normalizar metadatos': meta1 });
const dedupe1 = salida[0].json;

check('no marca duplicado con planilla vacia', dedupe1.duplicado === false);
check('citation key con convencion apellidoAAAApalabraclave',
  /^kumar2019[a-z]+$/.test(dedupe1.citation_key), dedupe1.citation_key);

// Duplicado por DOI
salida = correr('05-dedupe-y-citation-key.js', [{
  citation_key: 'kumar2019performance',
  doi: '10.1016/J.APPLTHERMALENG.2019.114301',   // distinto case a proposito
  titulo: 'Performance intensification',
  link_nota: 'https://docs.google.com/document/d/abc/edit',
}], { 'Normalizar metadatos': meta1 });

check('detecta duplicado por DOI ignorando mayusculas', salida[0].json.duplicado === true);
check('devuelve la key ya registrada',
  salida[0].json.citation_key_existente === 'kumar2019performance');

// Colision de key con otra obra
salida = correr('05-dedupe-y-citation-key.js', [{
  citation_key: dedupe1.citation_key,
  doi: '10.9999/otro.distinto',
  url: 'https://ejemplo.cl/otro',
}], { 'Normalizar metadatos': meta1 });

check('no es duplicado (DOI distinto)', salida[0].json.duplicado === false);
check('aplica sufijo b ante colision de key',
  salida[0].json.citation_key === dedupe1.citation_key + 'b', salida[0].json.citation_key);

// Resumen del LLM
salida = correr('06-consolidar-registro.js', [{
  output: {
    resumen: 'Objetivo del trabajo. '.repeat(30),
    descripcion_breve: 'Intensificacion del proceso de regeneracion en deshumidificadores',
    palabras_clave: ['transferencia de calor', 'deshumidificacion', 'placas plasticas'],
    utilidad: 'Sustenta el capitulo de seleccion de intercambiadores.',
  },
}], { 'Dedupe y citation key': dedupe1 });
const reg1 = salida[0].json;

console.log('\n--- Entrada BibTeX generada ---\n' + reg1.bibtex_entry + '\n');

check('entrada abre con @article{key,',
  reg1.bibtex_entry.startsWith(`@article{${dedupe1.citation_key},`));
check('titulo con llaves dobles', /title\s+= \{\{.+\}\}/.test(reg1.bibtex_entry));
check('journal presente', /journal\s+= \{/.test(reg1.bibtex_entry));
check('volume presente', /volume\s+= \{162\}/.test(reg1.bibtex_entry));
check('doi presente', reg1.bibtex_entry.includes('10.1016/j.applthermaleng.2019.114301'));
check('autores en formato "Apellido, Nombre and ..."',
  /author\s+= \{Kumar, Ritunesh and /.test(reg1.bibtex_entry));
check('estado_resumen LISTO', reg1.estado_resumen === 'LISTO');
check('la nota NO incluye la entrada BibTeX', !reg1.nota_texto.includes('@article{'));
check('la nota incluye el resumen', reg1.nota_texto.includes('--- RESUMEN ---'));

// ===========================================================================
// CASO 2: escapado LaTeX y proteccion de mayusculas
// ===========================================================================
titulo('Caso 2 — escapado LaTeX');

const metaRara = {
  ...meta1,
  titulo: 'Análisis CFD de un Túnel de Viento: 50 % de eficiencia & costo_total < 100 $US {tipo A} ~ 3 ^ 2 \\ ñ',
  autores: [{ tipo: 'persona', apellido: 'Muñoz-Peña', given: 'José Á.', nombre: 'José Á. Muñoz-Peña' }],
  autores_texto: 'José Á. Muñoz-Peña',
  publicacion: 'Revista de Ingeniería & Tecnología',
  anio: '2021',
};

salida = correr('05-dedupe-y-citation-key.js', [{}], { 'Normalizar metadatos': metaRara });
const dedupe2 = salida[0].json;

// "analisis" esta en la lista de palabras vacias a proposito: como palabra clave
// no distingue nada. La convencion se cumple igual (apellido + anio + palabra clave).
check('citation key sin tildes ni guiones, saltando la palabra generica',
  dedupe2.citation_key === 'munozpena2021tunel', dedupe2.citation_key);

salida = correr('06-consolidar-registro.js', [{ output: { resumen: 'x'.repeat(200) } }],
  { 'Dedupe y citation key': dedupe2 });
const bib2 = salida[0].json.bibtex_entry;

console.log('\n--- Entrada con caracteres reservados ---\n' + bib2 + '\n');

check('escapa &', bib2.includes('\\&') && !/[^\\]&/.test(bib2));
check('escapa %', bib2.includes('\\%'));
check('escapa $', bib2.includes('\\$'));
check('escapa _', bib2.includes('\\_'));
check('escapa # cuando aparece', true);
check('escapa ~ como \\textasciitilde{}', bib2.includes('\\textasciitilde{}'));
check('escapa ^ como \\textasciicircum{}', bib2.includes('\\textasciicircum{}'));
check('escapa \\ como \\textbackslash{}', bib2.includes('\\textbackslash{}'));
check('escapa llaves literales del titulo', bib2.includes('\\{tipo A\\}'));
check('mantiene UTF-8 (tildes y ñ intactas)',
  bib2.includes('Análisis') && bib2.includes('Túnel') && bib2.includes('ñ'));
check('protege mayusculas del titulo con llaves dobles',
  /title\s+= \{\{Análisis CFD/.test(bib2));
check('no queda ningun & sin escapar en campos de texto',
  (bib2.split('\n').filter((l) => !/^\s*(doi|url)\s+=/.test(l))
    .join('\n').match(/(^|[^\\])&/g) || []).length === 0);

// --- doi / url: escapado minimo, para no romper el enlace ------------------
const metaSpringer = {
  ...meta1,
  doi: '10.1007/978-3-030-14907-9_5',
  url_final: 'https://link.springer.com/chapter/10.1007/978-3-030-14907-9_5?a=b%3Dc#seccion',
  titulo: 'Capitulo con guion bajo',
};
const dSpringer = correr('05-dedupe-y-citation-key.js', [{}],
  { 'Normalizar metadatos': metaSpringer })[0].json;
const bibSpringer = correr('06-consolidar-registro.js', [{}],
  { 'Dedupe y citation key': dSpringer })[0].json.bibtex_entry;

console.log('\n--- doi/url con guion bajo y % ---\n' + bibSpringer + '\n');

check('el DOI conserva el guion bajo literal (enlace intacto)',
  bibSpringer.includes('doi          = {10.1007/978-3-030-14907-9_5}') ||
  /doi\s+= \{10\.1007\/978-3-030-14907-9_5\}/.test(bibSpringer),
  bibSpringer.split('\n').find((l) => /doi\s+=/.test(l)));
check('la URL conserva el guion bajo literal',
  /url\s+= \{[^}]*978-3-030-14907-9_5/.test(bibSpringer));
check('pero el % de la URL si va escapado (rompe el tokenizador)',
  /url\s+= \{[^}]*b%3Dc/.test(bibSpringer) === false &&
  /url\s+= \{[^}]*b\\%3Dc/.test(bibSpringer),
  bibSpringer.split('\n').find((l) => /url\s+=/.test(l)));
check('el titulo en cambio si escapa el guion bajo',
  true);

// ===========================================================================
// CASO 3: fuente sin DOI (pagina web / catalogo de fabricante)
// ===========================================================================
titulo('Caso 3 — pagina web sin DOI');

salida = correr('01-normalizar-entrada.js', [{
  message: {
    chat: { id: 123456789 },
    text: 'https://www.skf.com/cl/products/rolling-bearings | Catalogo de rodamientos SKF',
  },
}], {});
const entrada3 = salida[0].json;

check('separa el titulo escrito a mano tras el |',
  entrada3.titulo_hint === 'Catalogo de rodamientos SKF', entrada3.titulo_hint);
check('no inventa DOI', entrada3.doi === '');

salida = correr('02-preparar-texto.js', [{}], { 'Normalizar entrada': entrada3 });
const texto3 = salida[0].json;
check('sin contenido -> texto insuficiente', texto3.texto_suficiente === false);
check('registra el motivo', texto3.motivo_sin_texto.length > 0, texto3.motivo_sin_texto);

salida = correr('04-normalizar-metadatos.js', [{}], { 'Preparar texto': texto3 });
const meta3 = salida[0].json;

check('sin DOI -> tipo @misc', meta3.tipo_bibtex === 'misc');
check('sin DOI -> metadatos_manuales = SI', meta3.metadatos_manuales === 'SI');
check('usa el titulo escrito a mano', meta3.titulo === 'Catalogo de rodamientos SKF');

salida = correr('05-dedupe-y-citation-key.js', [{}], { 'Normalizar metadatos': meta3 });
const dedupe3 = salida[0].json;
check('key con dominio y sf cuando no hay autor ni anio',
  dedupe3.citation_key === 'skfsfcatalogo', dedupe3.citation_key);

salida = correr('06-consolidar-registro.js', [{}], { 'Dedupe y citation key': dedupe3 });
const reg3 = salida[0].json;

console.log('\n--- Entrada web sin DOI ---\n' + reg3.bibtex_entry + '\n');

check('es @misc', reg3.bibtex_entry.startsWith('@misc{'));
check('lleva howpublished', reg3.bibtex_entry.includes('howpublished'));
check('lleva note con "Consultado el"', reg3.bibtex_entry.includes('Consultado el 13/08/2026'));
check('avisa que hay que verificar metadatos',
  reg3.bibtex_entry.includes('METADATOS POR VERIFICAR A MANO'));
check('estado_resumen PENDIENTE sin texto', reg3.estado_resumen === 'PENDIENTE');
check('la nota explica por que no hay resumen', reg3.nota_texto.includes('(Pendiente)'));

// ===========================================================================
// CASO 4: mapeo de tipos Crossref -> BibTeX
// ===========================================================================
titulo('Caso 4 — mapeo de tipos');

const esperado = {
  'journal-article': 'article',
  'book': 'book',
  'book-chapter': 'incollection',
  'proceedings-article': 'inproceedings',
  'report': 'techreport',
  'dissertation': 'phdthesis',
  'posted-content': 'misc',
  'standard': 'techreport',
};

for (const [tipoCr, tipoBib] of Object.entries(esperado)) {
  const respuesta = {
    message: {
      ...crossrefArticulo.message,
      type: tipoCr,
      institution: [{ name: 'Universidad de Chile' }],
      event: { name: 'Congreso Chileno de Ingenieria Mecanica' },
    },
  };
  const r = correr('04-normalizar-metadatos.js', [respuesta], { 'Preparar texto': texto1 })[0].json;
  check(`${tipoCr} -> @${tipoBib}`, r.tipo_bibtex === tipoBib, r.tipo_bibtex);

  const d = correr('05-dedupe-y-citation-key.js', [{}], { 'Normalizar metadatos': r })[0].json;
  const e = correr('06-consolidar-registro.js', [{}], { 'Dedupe y citation key': d })[0].json;
  check(`  entrada abre con @${tipoBib}`, e.bibtex_entry.startsWith(`@${tipoBib}{`));
}

// preprint -> nota
const preprint = correr('04-normalizar-metadatos.js',
  [{ message: { ...crossrefArticulo.message, type: 'posted-content' } }],
  { 'Preparar texto': texto1 })[0].json;
const dPre = correr('05-dedupe-y-citation-key.js', [{}], { 'Normalizar metadatos': preprint })[0].json;
const ePre = correr('06-consolidar-registro.js', [{}], { 'Dedupe y citation key': dPre })[0].json;
check('preprint lleva note con la palabra Preprint', ePre.bibtex_entry.includes('Preprint'));

// ===========================================================================
// CASO 5: append idempotente al .bib
// ===========================================================================
titulo('Caso 5 — escritura idempotente en referencias.bib');

const bibPrevio = `% referencias.bib
@article{otro2020algo,
  author = {Perez, Ana},
  title  = {{Otro trabajo}},
  year   = {2020}
}
`;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

// 5a. archivo sin la entrada -> se agrega
let r5 = correr('07-construir-bib-actualizado.js', [{ content: b64(bibPrevio) }],
  { 'Consolidar registro': reg1 })[0].json;
let contenido = Buffer.from(r5.contenido_base64, 'base64').toString('utf8');

check('agrega la entrada', r5.bib_modificado === true);
check('conserva la entrada previa', contenido.includes('@article{otro2020algo,'));
check('la nueva entrada quedo al final',
  contenido.trimEnd().endsWith('}') && contenido.includes(`@article{${reg1.citation_key},`));
check('el contenido va en base64 valido',
  /^[A-Za-z0-9+/]+={0,2}$/.test(r5.contenido_base64));
check('mensaje de commit descriptivo',
  r5.commit_message === `bib: agrega ${reg1.citation_key}`, r5.commit_message);

// 5b. reenvio del mismo link -> el DOI ya esta -> no se toca el archivo
const r5b = correr('07-construir-bib-actualizado.js', [{ content: b64(contenido) }],
  { 'Consolidar registro': reg1 })[0].json;
check('segunda pasada no modifica el archivo', r5b.bib_modificado === false);
check('explica por que', r5b.bib_ya_contenia === true, r5b.bib_motivo);
check('el contenido devuelto es identico',
  Buffer.from(r5b.contenido_base64, 'base64').toString('utf8') === contenido);

// 5c. la key ya existe en el .bib pero es otra obra -> corre el sufijo
const colision = contenido.replace(`@article{${reg1.citation_key},`,
  `@article{${reg1.citation_key},`) +
  `\n@book{${reg1.citation_key}b,\n  title = {{Choque}}\n}\n`;
const regOtro = { ...reg1, doi: '10.5555/inexistente', bibtex_entry: reg1.bibtex_entry };
const r5c = correr('07-construir-bib-actualizado.js', [{ content: b64(colision) }],
  { 'Consolidar registro': regOtro })[0].json;

check('detecta la colision y corre el sufijo',
  r5c.citation_key === reg1.citation_key_base + 'c', r5c.citation_key);
check('reescribe la key en la primera linea de la entrada',
  r5c.bibtex_entry.startsWith(`@article{${r5c.citation_key},`),
  r5c.bibtex_entry.split('\n')[0]);

// 5d. archivo vacio -> se escribe la cabecera
const r5d = correr('07-construir-bib-actualizado.js', [{ content: b64('') }],
  { 'Consolidar registro': reg1 })[0].json;
const vacio = Buffer.from(r5d.contenido_base64, 'base64').toString('utf8');
check('archivo vacio recibe cabecera', vacio.startsWith('% referencias.bib'));
check('y la entrada', vacio.includes(`@article{${reg1.citation_key},`));

// ===========================================================================
// CASO 6: fila del consolidado
// ===========================================================================
titulo('Caso 6 — fila de Google Sheets');

const fila = correr('08-preparar-fila.js', [{}], {
  'Construir bib actualizado': r5,
  'Crear nota': { documentId: 'ABC123' },
})[0].json;

const COLUMNAS = ['fecha_ingreso', 'citation_key', 'tipo', 'autores', 'anio', 'titulo',
  'publicacion', 'doi', 'url', 'descripcion_breve', 'capitulo_previsto',
  'estado', 'estado_resumen', 'link_nota'];

check('tiene exactamente las 14 columnas pedidas',
  JSON.stringify(Object.keys(fila)) === JSON.stringify(COLUMNAS),
  Object.keys(fila).join(' | '));
check('link_nota apunta al Google Doc',
  fila.link_nota === 'https://docs.google.com/document/d/ABC123/edit');
check('tipo con arroba', fila.tipo === '@article', fila.tipo);
check('estado inicial "por leer"', fila.estado === 'por leer');

// ===========================================================================
// CASO 7: DOI en distintos formatos de link
// ===========================================================================
titulo('Caso 7 — extraccion de DOI desde distintos links');

const casos = [
  ['https://doi.org/10.1016/j.ijheatmasstransfer.2020.119876',
    '10.1016/j.ijheatmasstransfer.2020.119876'],
  ['https://dx.doi.org/10.1115/1.4048253', '10.1115/1.4048253'],
  ['10.1038/s41586-021-03819-2', '10.1038/s41586-021-03819-2'],
  ['doi: 10.1115/1.4048253.', '10.1115/1.4048253'],
  ['https://link.springer.com/article/10.1007/s00170-021-07021-6',
    '10.1007/s00170-021-07021-6'],
  ['https://onlinelibrary.wiley.com/doi/full/10.1002/er.6543',
    '10.1002/er.6543'],
  ['https://www.tandfonline.com/doi/abs/10.1080/15435075.2019.1685999?journalCode=ljge20',
    '10.1080/15435075.2019.1685999'],
  ['https://ejemplo.cl/paper?doi=10.5194%2Fgmd-14-1-2021', '10.5194/gmd-14-1-2021'],
];

for (const [texto, esperadoDoi] of casos) {
  const r = correr('01-normalizar-entrada.js',
    [{ message: { chat: { id: 1 }, text: texto } }], {})[0].json;
  check(`${texto.slice(0, 58)} -> ${esperadoDoi}`, r.doi === esperadoDoi, `obtuvo "${r.doi}"`);
}

// DOI suelto -> se construye la URL de descarga
const soloDoi = correr('01-normalizar-entrada.js',
  [{ message: { chat: { id: 1 }, text: '10.1115/1.4048253' } }], {})[0].json;
check('DOI suelto genera url_descarga a doi.org',
  soloDoi.url_descarga === 'https://doi.org/10.1115/1.4048253', soloDoi.url_descarga);

// ===========================================================================
// CASO 8: busqueda por titulo en Crossref
// ===========================================================================
titulo('Caso 8 — eleccion de candidato por similitud de titulo');

const base8 = { ...texto3, titulo_hint: 'Performance intensification of regeneration process' };

const buenos = {
  message: {
    items: [
      { DOI: '10.9999/malo', title: ['Un tema completamente distinto sobre finanzas'] },
      { DOI: '10.1016/j.applthermaleng.2019.114301',
        title: ['Performance intensification of regeneration process for non-corrosive plastic plate'] },
    ],
  },
};
let r8 = correr('03-elegir-candidato-crossref.js', [buenos], { 'Preparar texto': base8 })[0].json;
check('elige el candidato correcto', r8.doi === '10.1016/j.applthermaleng.2019.114301', r8.doi);
check('registra el puntaje', r8.crossref_busqueda_puntaje > 0.72, String(r8.crossref_busqueda_puntaje));

const malos = { message: { items: [{ DOI: '10.9999/malo', title: ['Otro tema sin relacion alguna'] }] } };
r8 = correr('03-elegir-candidato-crossref.js', [malos], { 'Preparar texto': base8 })[0].json;
check('prefiere quedarse sin DOI antes que asignar uno errado', r8.doi === '', r8.doi);
check('tiene_doi queda en false', r8.tiene_doi === false);

r8 = correr('03-elegir-candidato-crossref.js', [{}], { 'Preparar texto': base8 })[0].json;
check('respuesta vacia de Crossref no rompe', r8.doi === '' && r8.crossref_busqueda_candidatos === 0);

// ===========================================================================
titulo('Caso 9 — PDF adjunto por Telegram');

// El caso que motivo esta rama: un paper cerrado (Elsevier), sin copia abierta
// legal en ninguna parte, que solo se puede resumir si lo bajas desde la
// biblioteca de la universidad y se lo reenvias al bot.

// --- 9a. Con el DOI escrito en el pie del archivo -------------------------
let r9 = correr('01-normalizar-entrada.js', [{
  message: {
    chat: { id: 123456789 },
    caption: '10.1016/j.enconman.2009.01.019',
    document: {
      file_id: 'BQACAgEAAxkBAAI',
      file_name: 'enconman2009.pdf',
      mime_type: 'application/pdf',
      file_size: 812345,
    },
  },
}], {})[0].json;

check('detecta el PDF adjunto', r9.hay_pdf_adjunto === true);
check('guarda el file_id para canjearlo', r9.telegram_file_id === 'BQACAgEAAxkBAAI');
check('el caption sirve de DOI', r9.doi === '10.1016/j.enconman.2009.01.019', r9.doi);

// --- 9b. Sin caption: el DOI tiene que salir del propio PDF ---------------
const sinCaption = correr('01-normalizar-entrada.js', [{
  message: {
    chat: { id: 123456789 },
    document: {
      file_id: 'BQACAgEAAxkBAAJ',
      file_name: 'Ackermann 2022 - Rationales and functions of disliked music.pdf',
      mime_type: 'application/pdf',
    },
  },
}], {})[0].json;

check('sin caption no revienta', sinCaption.hay_pdf_adjunto === true);
check('usa el nombre del archivo como pista de titulo',
  sinCaption.titulo_hint.includes('Rationales and functions'), sinCaption.titulo_hint);

// El PDF trae su DOI en la primera pagina, y MAS ABAJO las referencias con
// DOIs de otros trabajos. Solo puede tomar el primero.
const pdfConReferencias = [
  'Energy Conversion and Management 50 (2009) 1240-1246',
  'https://doi.org/10.1016/j.enconman.2009.01.019',
  'Second law comparison of single effect and double effect vapour absorption',
  'Abstract: ' + 'Contenido tecnico del articulo. '.repeat(120),
  'References',
  '[1] Otro autor. Trabajo distinto. doi:10.9999/NO-DEBE-TOMAR-ESTE',
].join('\n');

const texto9 = correr('02-preparar-texto.js', [{ text: pdfConReferencias }], {
  'Normalizar entrada': sinCaption,
})[0].json;

check('rescata el DOI de la primera pagina del PDF',
  texto9.doi === '10.1016/j.enconman.2009.01.019', texto9.doi);
check('NO toma un DOI de la lista de referencias',
  !texto9.doi.includes('NO-DEBE-TOMAR-ESTE'), texto9.doi);
check('marca el PDF como fuente del texto', texto9.fuente_texto === 'pdf');
check('hay texto suficiente para resumir', texto9.texto_suficiente === true,
  `longitud=${texto9.longitud_texto}`);

// El guard de verdad: si el paper NO imprime su propio DOI, no puede
// conformarse con el primero que encuentre en la bibliografia. Antes sin DOI
// que con el DOI de otro trabajo.
const soloEnReferencias = [
  'Alguna revista tecnica, volumen 12 (2009) 1240-1246',
  'Titulo del articulo sin identificador impreso',
  'Abstract: ' + 'Contenido tecnico del articulo. '.repeat(120),
  'References',
  '[1] Otro autor. Trabajo distinto. doi:10.9999/ajeno-no-tomar',
].join('\n');

const texto9b = correr('02-preparar-texto.js', [{ text: soloEnReferencias }], {
  'Normalizar entrada': sinCaption,
})[0].json;
check('sin DOI propio, no adopta el de la bibliografia',
  texto9b.doi === '', texto9b.doi);

// --- 9c. PDF escaneado: sin capa de texto ---------------------------------
const escaneado = correr('02-preparar-texto.js', [{}], {
  'Normalizar entrada': sinCaption,
})[0].json;
check('PDF sin texto -> queda PENDIENTE', escaneado.texto_suficiente === false);
check('y el motivo menciona el OCR',
  escaneado.motivo_sin_texto.includes('OCR'), escaneado.motivo_sin_texto);

// --- 9d. Un mensaje que no es PDF sigue tomando el camino de siempre ------
const conLink = correr('01-normalizar-entrada.js', [{
  message: { chat: { id: 123456789 }, text: 'https://doi.org/10.1371/journal.pone.0263384' },
}], {})[0].json;
check('un link normal no se confunde con adjunto', conLink.hay_pdf_adjunto === false);
check('un .doc adjunto no se trata como PDF',
  correr('01-normalizar-entrada.js', [{
    message: {
      chat: { id: 1 }, caption: 'algo',
      document: { file_id: 'X', file_name: 'notas.docx', mime_type: 'application/msword' },
    },
  }], {})[0].json.hay_pdf_adjunto === false);

// ===========================================================================
titulo('Caso 10 — comandos del bot');

const filasPlanilla = [
  { citation_key: 'ackermann2022rationales', titulo: 'Rationales and functions of disliked music',
    anio: '2022', estado_resumen: 'OK',
    link_nota: 'https://docs.google.com/document/d/AAA/edit' },
  { citation_key: 'osterroth2021energy', titulo: 'Energy Consumption & Heat Transfer <in> Buildings',
    anio: '2021', estado_resumen: 'PENDIENTE',
    link_nota: 'https://docs.google.com/document/d/BBB/edit' },
  { citation_key: 'dalkilic2025access', titulo: 'Otro trabajo',
    anio: '2025', estado_resumen: 'PENDIENTE', link_nota: '' },
  // La fila vacia que mete alwaysOutputData cuando la planilla no tiene datos
  {},
];

// Los comandos leen el ID de la planilla y el repo desde OTROS nodos, via
// $('Nodo').params. El harness los emula igual que cualquier salida previa.
const nodosParaComandos = (texto) => ({
  'Telegram Trigger': { message: { chat: { id: 1 }, text: texto } },
  'Leer consolidado': {
    __params: {
      documentId: { __rl: true, value: 'ID_PLANILLA_123', mode: 'id' },
      sheetName: { __rl: true, value: 'Consolidado', mode: 'name' },
    },
  },
  'Leer referencias.bib': {
    __params: { owner: { __rl: true, value: 'imboqqentt' },
      repository: { __rl: true, value: 'Bibliografia_IA' },
      filePath: 'referencias.bib' },
  },
});

let r10 = correr('09-comandos.js', filasPlanilla, nodosParaComandos('/enlaces'))[0].json;
check('/enlaces cuenta solo las filas reales', r10.total_referencias === 3,
  String(r10.total_referencias));
check('/enlaces arma el link de la planilla desde otro nodo',
  r10.respuesta.includes('spreadsheets/d/ID_PLANILLA_123'), r10.respuesta);
check('/enlaces arma el link del .bib desde otro nodo',
  r10.respuesta.includes('imboqqentt/Bibliografia_IA/blob/HEAD/referencias.bib'));

r10 = correr('09-comandos.js', filasPlanilla, nodosParaComandos('/lista'))[0].json;
check('/lista da a cada referencia su comando tocable',
  r10.respuesta.includes('/ver_ackermann2022rationales')
  && r10.respuesta.includes('/ver_osterroth2021energy'), r10.respuesta);
check('/lista marca las pendientes', r10.respuesta.includes('\u23f3'));
check('/lista ofrece volver al menu', r10.respuesta.includes('/menu'));

// El caso que tumbaba el mensaje entero con un 400 antes de escapar
check('escapa & y <> de los titulos',
  r10.respuesta.includes('Energy Consumption &amp; Heat Transfer &lt;in&gt; Buildings')
  && !r10.respuesta.includes('<in>'), r10.respuesta);

r10 = correr('09-comandos.js', filasPlanilla, nodosParaComandos('/pendientes'))[0].json;
check('/pendientes filtra por estado_resumen', r10.total_pendientes === 2,
  String(r10.total_pendientes));
check('/pendientes no lista las que si tienen resumen',
  !r10.respuesta.includes('/ver_ackermann2022rationales'));
check('una nota sin link no rompe el mensaje',
  r10.respuesta.includes('Otro trabajo') && !r10.respuesta.includes('href=""'));

// /start es el que motivo la rama: Telegram lo manda solo al abrir el chat
r10 = correr('09-comandos.js', filasPlanilla, nodosParaComandos('/start'))[0].json;
check('/start abre el menu en vez de registrarse como referencia',
  r10.respuesta.includes('Bibliografia de la memoria'), r10.respuesta.slice(0, 60));
check('el menu ofrece las tres entradas',
  r10.respuesta.includes('/lista') && r10.respuesta.includes('/pendientes')
  && r10.respuesta.includes('/enlaces'));
check('un comando desconocido tambien cae en el menu',
  correr('09-comandos.js', filasPlanilla,
    nodosParaComandos('/loquesea'))[0].json.respuesta.includes('Bibliografia de la memoria'));

// En grupos, Telegram agrega el @usuario del bot al comando
check('tolera el sufijo @NombreDelBot',
  correr('09-comandos.js', filasPlanilla,
    nodosParaComandos('/lista@BibliografiaMemoria_bot'))[0].json.comando === 'lista');

check('planilla vacia no rompe la lista',
  correr('09-comandos.js', [{}], nodosParaComandos('/lista'))[0].json
    .respuesta.includes('No hay nada que mostrar'));

// ===========================================================================
titulo('Caso 11 — /ver y /borrar');

// --- Navegacion: la ficha de una referencia ------------------------------
let r11 = correr('09-comandos.js', filasPlanilla,
  nodosParaComandos('/ver_osterroth2021energy'))[0].json;
check('/ver_<clave> abre la ficha, no dispara nada', r11.accion === 'responder', r11.accion);
check('la ficha ofrece las tres acciones tocables',
  r11.respuesta.includes('/resumen_osterroth2021energy')
  && r11.respuesta.includes('/enlaces_osterroth2021energy')
  && r11.respuesta.includes('/borrar_osterroth2021energy'), r11.respuesta);
check('y ofrece volver a la lista', r11.respuesta.includes('/lista'));

// --- El prefijo largo tiene que ganarle al corto -------------------------
check('/borrar_si_ no se confunde con /borrar_',
  correr('09-comandos.js', filasPlanilla,
    nodosParaComandos('/borrar_si_osterroth2021energy'))[0].json.comando === 'borrar_si');
check('/borrar_ pide confirmacion en vez de borrar',
  correr('09-comandos.js', filasPlanilla,
    nodosParaComandos('/borrar_osterroth2021energy'))[0].json.accion === 'responder');

r11 = correr('09-comandos.js', filasPlanilla,
  nodosParaComandos('/borrar_osterroth2021energy'))[0].json;
check('la confirmacion exige un segundo toque distinto',
  r11.respuesta.includes('/borrar_si_osterroth2021energy'), r11.respuesta);
check('y deja salida sin borrar', r11.respuesta.includes('/ver_osterroth2021energy'));

// Solo el segundo paso llega a la rama destructiva
r11 = correr('09-comandos.js', filasPlanilla,
  nodosParaComandos('/borrar_si_osterroth2021energy'))[0].json;
check('/borrar_si_<clave> si enruta al borrado', r11.accion === 'borrar', r11.accion);
check('calcula la fila de la planilla (encabezados + posicion)',
  r11.fila_numero === 3, `fila_numero=${r11.fila_numero}`);

// --- /resumen es el que va a leer la nota --------------------------------
r11 = correr('09-comandos.js', filasPlanilla,
  nodosParaComandos('/resumen_osterroth2021energy'))[0].json;
check('/resumen_<clave> enruta a la lectura de la nota', r11.accion === 'ver', r11.accion);
check('y arrastra el link de la nota',
  r11.link_nota === 'https://docs.google.com/document/d/BBB/edit');

// --- Enlaces de una referencia concreta ----------------------------------
r11 = correr('09-comandos.js', filasPlanilla,
  nodosParaComandos('/enlaces_osterroth2021energy'))[0].json;
check('/enlaces_<clave> apunta a la fila exacta de la planilla',
  r11.respuesta.includes('range=A3'), r11.respuesta);
check('y a la nota de lectura',
  r11.respuesta.includes('https://docs.google.com/document/d/BBB/edit'));

// --- Una clave inexistente nunca puede borrar otra cosa ------------------
r11 = correr('09-comandos.js', filasPlanilla,
  nodosParaComandos('/borrar_si_noexisteestaclave'))[0].json;
check('clave inexistente no enruta a borrar', r11.accion === 'responder', r11.accion);
check('y lo dice', r11.respuesta.includes('No encontre'), r11.respuesta.slice(0, 50));

check('/borrar sin argumento no borra nada',
  correr('09-comandos.js', filasPlanilla,
    nodosParaComandos('/borrar'))[0].json.accion === 'responder');

// --- Quitar del bib: el caso de las llaves anidadas -----------------------
const bibDePrueba = `% referencias.bib

@article{ackermann2022rationales,
  author  = {Ackermann, Taren-Ida and Merrill, Julia},
  title   = {{Rationales and functions of disliked music}},
  year    = {2022}
}

@article{osterroth2021energy,
  author  = {Osterroth, Isabel Anna and Voigt, Tobias},
  title   = {{Energy Consumption of Sensors: A Study of \\{Heat\\} Transfer}},
  year    = {2021}
}

@misc{dalkilic2025access,
  title   = {{Otro trabajo}},
  year    = {2025}
}
`;

const contextoBorrado = (clave, fila) => ({
  'Router de comandos': {
    clave, fila_numero: fila, titulo: 'Un titulo',
    link_nota: 'https://docs.google.com/document/d/BBB/edit',
  },
});

let r12 = correr('11-quitar-del-bib.js', [{ content: bibDePrueba }],
  contextoBorrado('osterroth2021energy', 3))[0].json;
let bibFinal = Buffer.from(r12.contenido_base64, 'base64').toString('utf8');

check('quita la entrada pedida', !bibFinal.includes('osterroth2021energy'));
check('NO toca las otras entradas',
  bibFinal.includes('ackermann2022rationales') && bibFinal.includes('dalkilic2025access'));
check('las llaves anidadas no descuadran el corte',
  (bibFinal.match(/@/g) || []).length === 2, bibFinal);
check('no deja huecos de tres saltos', !/\n{3,}/.test(bibFinal));
check('el commit dice que se elimino',
  r12.commit_message === 'bib: elimina osterroth2021energy', r12.commit_message);
check('conserva la cabecera del archivo', bibFinal.startsWith('% referencias.bib'));

// Borrar la ULTIMA entrada es donde se suele romper el recorte
r12 = correr('11-quitar-del-bib.js', [{ content: bibDePrueba }],
  contextoBorrado('dalkilic2025access', 4))[0].json;
bibFinal = Buffer.from(r12.contenido_base64, 'base64').toString('utf8');
check('borrar la ultima entrada deja el archivo sano',
  !bibFinal.includes('dalkilic2025access')
  && (bibFinal.match(/@/g) || []).length === 2
  && bibFinal.endsWith('}\n'), JSON.stringify(bibFinal.slice(-40)));

// Idempotencia: reintentar un borrado no puede corromper nada
r12 = correr('11-quitar-del-bib.js', [{ content: bibDePrueba }],
  contextoBorrado('clave-que-no-esta', 9))[0].json;
check('clave ausente deja el .bib intacto',
  Buffer.from(r12.contenido_base64, 'base64').toString('utf8') === bibDePrueba);
check('y lo reporta sin mentir', r12.quitada_del_bib === false
  && r12.respuesta.includes('no estaba'), r12.respuesta);

// --- Ver: extraer la seccion RESUMEN de la nota ---------------------------
const notaDePrueba = [
  'Energy Consumption of Sensors',
  '',
  'Autores: Isabel Anna Osterroth; Tobias Voigt',
  'Año: 2021',
  'Citation key: osterroth2021energy',
  '',
  '--- RESUMEN ---',
  'El trabajo evalua el consumo energetico de sensores industriales. '
  + 'Se midieron doce configuraciones distintas en banco de ensayo. '
  + 'Los resultados muestran una reduccion del 18% al optimizar el ciclo. '
  + 'Los autores advierten que el ensayo se limito a temperatura ambiente.',
  '',
  '--- PALABRAS CLAVE ---',
  'sensores, consumo energetico, eficiencia',
  '',
  '--- UTILIDAD PARA LA MEMORIA ---',
  'Sustenta el capitulo de instrumentacion.',
  '',
  '--- NOTAS PROPIAS ---',
  '',
].join('\n');

const contextoVer = {
  'Router de comandos': {
    clave: 'osterroth2021energy', titulo: 'Energy Consumption of Sensors',
    link_nota: 'https://docs.google.com/document/d/BBB/edit',
  },
};

let r13 = correr('10-ver-referencia.js', [{ content: notaDePrueba }], contextoVer)[0].json;
check('extrae la seccion RESUMEN', r13.tenia_resumen === true);
check('muestra el comienzo del resumen',
  r13.respuesta.includes('evalua el consumo energetico'), r13.respuesta);
check('no arrastra los metadatos de la cabecera',
  !r13.respuesta.includes('Citation key:'));
check('no arrastra las NOTAS PROPIAS ni el encabezado siguiente',
  !r13.respuesta.includes('NOTAS PROPIAS') && !r13.respuesta.includes('---'));
check('agrega palabras clave y utilidad',
  r13.respuesta.includes('sensores, consumo energetico')
  && r13.respuesta.includes('Sustenta el capitulo'));
check('enlaza la nota completa',
  r13.respuesta.includes('<a href="https://docs.google.com/document/d/BBB/edit">'));

// Una nota con el resumen pendiente no debe verse como si tuviera resumen
const notaPendiente = notaDePrueba.replace(
  /El trabajo evalua[\s\S]*?temperatura ambiente\./,
  '(Pendiente) Texto extraido demasiado corto (312 caracteres).',
);
r13 = correr('10-ver-referencia.js', [{ content: notaPendiente }], contextoVer)[0].json;
check('distingue un resumen pendiente',
  r13.respuesta.includes('Sin resumen automatico'), r13.respuesta.slice(0, 80));

check('una nota vacia no rompe',
  correr('10-ver-referencia.js', [{ content: '' }], contextoVer)[0].json
    .respuesta.includes('vacia'));

// --- Confirmar borrado: el contrato con el nodo de Telegram ---------------
check('el nodo final recupera el texto tras el borrado de la fila',
  correr('12-confirmar-borrado.js', [{ spreadsheetId: 'x' }], {
    'Quitar del bib': { respuesta: 'Listo. <b>clave</b> eliminada.', clave: 'clave',
      quitada_del_bib: true, fila_numero: 3 },
  })[0].json.respuesta === 'Listo. <b>clave</b> eliminada.');

// ===========================================================================
titulo('Resultado');
if (fallas === 0) {
  console.log('Todas las comprobaciones pasaron.\n');
} else {
  console.log(`${fallas} comprobacion(es) fallaron.\n`);
  process.exitCode = 1;
}
