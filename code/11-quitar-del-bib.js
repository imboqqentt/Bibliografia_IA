/**
 * NODO: "Quitar del bib"
 * Tipo: Code (n8n-nodes-base.code) — Modo: Run Once for All Items
 *
 * QUE HACE
 *   Elimina una entrada de referencias.bib y devuelve el archivo completo ya
 *   listo para escribir. Es el espejo de 07-construir-bib-actualizado.js.
 *
 * COMO ENCUENTRA LA ENTRADA
 *   No sirve una expresion regular ingenua: las entradas BibTeX tienen llaves
 *   ANIDADAS —title = {{Analisis CFD}}— asi que buscar hasta el primer "}"
 *   corta a la mitad. Se cuenta la profundidad de llaves para hallar el cierre
 *   real de la entrada.
 *
 * IDEMPOTENTE
 *   Si la clave no esta en el archivo, no se toca nada y se dice. Reintentar
 *   un borrado no puede romper el .bib.
 *
 * ENTRADA:  salida de "Leer referencias.bib (comandos)"
 * SALIDA:   1 item con el contenido nuevo en base64 y el mensaje de commit
 */

function esc(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Devuelve [inicio, fin) de la entrada con esa clave, o null.
 *
 * Se busca "@tipo{clave," y desde la llave de apertura se avanza contando
 * llaves hasta que la profundidad vuelve a cero.
 */
function ubicarEntrada(texto, clave) {
  const claveEscapada = String(clave).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`@[a-zA-Z]+\\s*\\{\\s*${claveEscapada}\\s*,`, 'i');
  const m = texto.match(re);
  if (!m) return null;

  const inicio = m.index;
  const abre = texto.indexOf('{', inicio);
  if (abre === -1) return null;

  let profundidad = 0;
  for (let i = abre; i < texto.length; i++) {
    const c = texto[i];
    // Una llave escapada en LaTeX (\{) no cuenta como delimitador.
    if (c === '\\') { i++; continue; }
    if (c === '{') profundidad++;
    else if (c === '}') {
      profundidad--;
      if (profundidad === 0) return { inicio, fin: i + 1 };
    }
  }
  // Llaves desbalanceadas: mejor no tocar el archivo.
  return null;
}

// ---------------------------------------------------------------------------
// Proceso
// ---------------------------------------------------------------------------

const datos = $('Router de comandos').first().json;
const clave = String(datos.clave || '').trim();
const archivo = $input.first() ? $input.first().json : {};

// El nodo de GitHub entrega el contenido ya decodificado en .content
const original = typeof archivo.content === 'string' ? archivo.content : '';

const posicion = original ? ubicarEntrada(original, clave) : null;

let contenidoNuevo = original;
let quitada = false;

if (posicion) {
  contenidoNuevo = (original.slice(0, posicion.inicio) + original.slice(posicion.fin))
    // Al sacar una entrada del medio quedan tres o mas saltos seguidos.
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '') + '\n';
  quitada = true;
}

const respuesta = quitada
  ? [
    `Listo. <b>${esc(clave)}</b> eliminada.`,
    '',
    `Fila ${datos.fila_numero} de la planilla y entrada del referencias.bib.`,
    '',
    'La nota de Drive queda donde esta, por si quieres conservarla:',
    `<a href="${esc(datos.link_nota)}">${esc(datos.titulo || clave)}</a>`,
    '',
    '<i>El .bib vive en git, asi que la entrada sigue en el historial '
    + 'del repositorio si necesitas recuperarla.</i>',
  ].join('\n')
  : [
    `Quite <b>${esc(clave)}</b> de la planilla, pero no estaba en el referencias.bib.`,
    '',
    'Puede que ya la hubieras borrado a mano. El archivo quedo intacto.',
  ].join('\n');

return [{
  json: {
    ...datos,
    quitada_del_bib: quitada,
    respuesta,

    // Lo que consume "Escribir referencias.bib (comandos)".
    // Base64 a proposito: con acentos y llaves, mandar el texto plano
    // dispara el error "content is not valid Base64" del nodo de GitHub.
    contenido_base64: Buffer.from(contenidoNuevo, 'utf8').toString('base64'),
    commit_message: quitada
      ? `bib: elimina ${clave}`
      : `bib: sin cambios (${clave} no estaba)`,
  },
}];
