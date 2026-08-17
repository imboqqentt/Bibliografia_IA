/**
 * NODO: "Armar vista de nota"
 * Tipo: Code (n8n-nodes-base.code) — Modo: Run Once for All Items
 *
 * QUE HACE
 *   Toma el texto de la nota de lectura que acaba de leer el nodo de Google
 *   Docs y devuelve el COMIENZO del resumen, para hacerse una idea del
 *   contenido sin abrir el documento.
 *
 *   La nota tiene una estructura conocida, porque la escribe este mismo flujo
 *   en 06-consolidar-registro.js:
 *
 *       <titulo>
 *       Autores: ...
 *       Anio: ...
 *       Citation key: ...
 *       Enlace: ...
 *
 *       RESUMEN
 *       <200-300 palabras>
 *
 *       PALABRAS CLAVE
 *       ...
 *
 *       UTILIDAD
 *       ...
 *
 *   Se busca el bloque RESUMEN en vez de cortar por caracteres desde el
 *   principio: si no, el recorte se lo comerian los metadatos de la cabecera.
 *
 * ENTRADA:  salida de "Leer nota (comandos)"  ->  $json.content
 * SALIDA:   1 item con { respuesta } en HTML de Telegram
 */

// Cuanto resumen mostrar. Un mensaje de Telegram admite 4096 caracteres, pero
// la gracia es hacerse una idea rapido, no leer el resumen entero en el chat.
const MAX_RESUMEN = 700;

function esc(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Recorta en el final de frase mas cercano, para no cortar a media palabra. */
function recortarEnFrase(texto, tope) {
  const t = String(texto || '').trim();
  if (t.length <= tope) return { texto: t, recortado: false };

  const corte = t.slice(0, tope);
  // Se prefiere terminar en punto; si no hay uno razonablemente cerca del
  // final, se cae a un espacio.
  const punto = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('.\n'));
  if (punto > tope * 0.5) {
    return { texto: corte.slice(0, punto + 1), recortado: true };
  }
  const espacio = corte.lastIndexOf(' ');
  return { texto: (espacio > 0 ? corte.slice(0, espacio) : corte) + '…', recortado: true };
}

/**
 * Saca el contenido de una seccion de la nota.
 *
 * Los encabezados que escribe 06-consolidar-registro.js van asi, en linea
 * propia:
 *
 *     --- RESUMEN ---
 *     --- PALABRAS CLAVE ---
 *     --- UTILIDAD PARA LA MEMORIA ---
 *     --- NOTAS PROPIAS ---
 *
 * Se recorre por lineas en vez de con una expresion regular sobre todo el
 * texto: con el flag multilinea, el ancla de "final" se cumple al terminar
 * CUALQUIER linea, asi que la seccion se cortaria en la primera.
 */
function esEncabezado(linea) {
  return /^-{3,}\s*.+\s*-{3,}$/.test(String(linea).trim());
}

function seccion(texto, nombre) {
  const lineas = String(texto || '').split(/\r?\n/);
  const objetivo = `--- ${nombre} ---`.toLowerCase();
  const inicio = lineas.findIndex((l) => l.trim().toLowerCase() === objetivo);
  if (inicio === -1) return '';

  const cuerpo = [];
  for (let i = inicio + 1; i < lineas.length; i++) {
    if (esEncabezado(lineas[i])) break;
    cuerpo.push(lineas[i]);
  }
  return cuerpo.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Proceso
// ---------------------------------------------------------------------------

const datos = $('Router de comandos').first().json;
const doc = $input.first() ? $input.first().json : {};

// El nodo de Docs en modo "simple" entrega todo el texto plano en .content
const contenido = String(doc.content || '');

const resumen = seccion(contenido, 'RESUMEN');
const utilidad = seccion(contenido, 'UTILIDAD PARA LA MEMORIA');
const palabras = seccion(contenido, 'PALABRAS CLAVE');

// Cuando el resumen quedo pendiente, la nota lleva "(Pendiente) <motivo>".
const estaPendiente = /^\(Pendiente\)/i.test(resumen);

const partes = [`<b>${esc(datos.clave)}</b>`];
if (datos.titulo) partes.push(esc(datos.titulo));
partes.push('');

if (!contenido.trim()) {
  partes.push('La nota esta vacia. Puede que se haya creado pero no escrito.');
} else if (estaPendiente) {
  partes.push('Sin resumen automatico todavia.');
  partes.push(esc(resumen.replace(/^\(Pendiente\)\s*/i, '')));
} else if (!resumen) {
  // Nota escrita a mano, o con otro formato: se muestra el principio tal cual
  // en vez de decir que no hay nada.
  const { texto } = recortarEnFrase(contenido, MAX_RESUMEN);
  partes.push(esc(texto));
} else {
  const { texto, recortado } = recortarEnFrase(resumen, MAX_RESUMEN);
  partes.push(esc(texto));
  if (palabras && !/^\(pendiente\)$/i.test(palabras)) {
    partes.push('', `<i>${esc(palabras)}</i>`);
  }
  if (utilidad && !/^\(pendiente\)$/i.test(utilidad)) {
    partes.push('', `<b>Utilidad:</b> ${esc(utilidad)}`);
  }
  if (recortado) partes.push('', 'Sigue en la nota completa:');
}

partes.push('', `<a href="${esc(datos.link_nota)}">📝 Abrir la nota completa</a>`);

// Comandos tocables para seguir navegando. En texto plano y en linea propia:
// dentro de <code> o <a> Telegram ya no los detecta como bot_command.
partes.push('', '⬅️ Volver a la ficha:', `/ver_${datos.clave}`);

return [{
  json: {
    respuesta: partes.join('\n'),
    clave: datos.clave,
    tenia_resumen: Boolean(resumen),
  },
}];
