/**
 * NODO: "Armar respuesta comando"
 * Tipo: Code (n8n-nodes-base.code) — Modo: Run Once for All Items
 *
 * QUE HACE
 *   Responde los comandos del bot (los mensajes que empiezan con "/") en vez
 *   de tratarlos como referencias. Sirve para revisar lo guardado desde el
 *   telefono sin abrir Drive ni GitHub a mano.
 *
 *   De paso arregla un bug: antes, un "/start" —que Telegram manda solo al
 *   abrir el chat por primera vez— entraba al flujo normal e intentaba
 *   registrarse como si fuera una fuente bibliografica.
 *
 * DE DONDE SALEN LOS ENLACES
 *   No van escritos aca. Se leen de los parametros de los nodos que ya
 *   apuntan a la planilla y al repositorio, via $('Nodo').params. Asi el ID
 *   de la planilla y el owner/repo se configuran UNA vez y estos comandos
 *   siguen apuntando al lugar correcto aunque los cambies despues.
 *
 * ENTRADA:  filas de "Leer consolidado (comandos)"
 * SALIDA:   1 item con { respuesta } en HTML de Telegram
 */

// Cuantas referencias se listan en /ultimas. Un mensaje de Telegram admite
// 4096 caracteres; con 5 entradas y titulos largos queda holgado.
const CUANTAS_ULTIMAS = 5;

// Titulos mas largos que esto se recortan: en el celular una linea de 200
// caracteres es ilegible.
const MAX_TITULO = 90;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Escapa para el parse_mode HTML de Telegram.
 *
 * Son los tres unicos caracteres especiales de ese modo:
 *   "All <, > and & symbols that are not a part of a tag or an HTML entity
 *    must be replaced with the corresponding HTML entities"
 *
 * Se aplica a TODO lo que venga de la planilla —titulos, autores— porque un
 * "Heat & Mass Transfer" sin escapar tumba el mensaje entero con un 400.
 */
function esc(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Recorta sin cortar a media palabra. */
function recortar(texto, tope) {
  const t = String(texto || '').trim();
  if (t.length <= tope) return t;
  const corte = t.slice(0, tope);
  const espacio = corte.lastIndexOf(' ');
  return (espacio > tope * 0.6 ? corte.slice(0, espacio) : corte) + '…';
}

/** Enlace HTML, o solo el texto si no hay URL utilizable. */
function enlace(url, texto) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return esc(texto);
  return `<a href="${esc(u)}">${esc(texto)}</a>`;
}

/**
 * Lee un resource locator de otro nodo.
 *
 * Los campos tipo "__rl" guardan { value, mode, cachedResultName }. Da igual
 * si esta en modo "By ID" o "From list": el ID vive en .value en los dos.
 */
function valorRl(params, clave) {
  const campo = params ? params[clave] : null;
  if (!campo) return '';
  if (typeof campo === 'string') return campo;
  return String(campo.value || '');
}

// ---------------------------------------------------------------------------
// Enlaces, deducidos de los nodos que ya estan configurados
// ---------------------------------------------------------------------------

let urlPlanilla = '';
try {
  const id = valorRl($('Leer consolidado').params, 'documentId');
  if (id) urlPlanilla = `https://docs.google.com/spreadsheets/d/${id}`;
} catch (e) { /* si el nodo no existe, se responde sin ese enlace */ }

let urlBib = '';
try {
  const p = $('Leer referencias.bib').params;
  const owner = valorRl(p, 'owner');
  const repo = valorRl(p, 'repository');
  const ruta = String((p && p.filePath) || 'referencias.bib').replace(/^\/+/, '');
  // HEAD apunta siempre a la rama por defecto, sin tener que saber su nombre.
  if (owner && repo) urlBib = `https://github.com/${owner}/${repo}/blob/HEAD/${ruta}`;
} catch (e) { /* idem */ }

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

const msg = $('Telegram Trigger').first().json.message
  || $('Telegram Trigger').first().json.edited_message
  || {};

const textoCrudo = String(msg.text || '').trim();

// "/ultimas@MiBot argumento" -> "/ultimas". En grupos Telegram agrega el @bot.
const comando = textoCrudo
  .split(/\s+/)[0]
  .toLowerCase()
  .replace(/@.*$/, '');

// Todo lo que venga despues del comando: "/ver ackermann2022" -> "ackermann2022"
const argumento = textoCrudo.split(/\s+/).slice(1).join(' ').trim();

const filas = $input.all()
  .map((i) => i.json || {})
  .filter((f) => f && String(f.citation_key || '').trim() !== '');

const pendientes = filas.filter(
  (f) => String(f.estado_resumen || '').trim().toUpperCase() === 'PENDIENTE',
);

// ---------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------

/** Una linea por referencia: clave, titulo enlazado a su nota. */
function lineaReferencia(f) {
  const clave = esc(String(f.citation_key || '').trim());
  const titulo = recortar(f.titulo || '(sin titulo)', MAX_TITULO);
  const anio = String(f.anio || '').trim();
  const cabeza = `<b>${clave}</b>${anio ? ` (${esc(anio)})` : ''}`;
  return `${cabeza}\n${enlace(f.link_nota, titulo)}`;
}

const AYUDA = [
  '<b>Comandos disponibles</b>',
  '',
  '/enlaces — planilla y referencias.bib',
  `/ultimas — las ${CUANTAS_ULTIMAS} referencias mas recientes`,
  '/pendientes — las que quedaron sin resumen automatico',
  '/ver &lt;clave&gt; — el comienzo del resumen',
  '/borrar &lt;clave&gt; — elimina la referencia',
  '/ayuda — esta lista',
  '',
  'La &lt;clave&gt; es la citation key, por ejemplo <code>ackermann2022rationales</code>.',
  '',
  'Para registrar algo, mandame un link, un DOI suelto, '
  + 'o un PDF adjunto con el DOI escrito en el pie.',
].join('\n');

/**
 * Busca una referencia por citation key y devuelve tambien su NUMERO DE FILA
 * en la planilla, que es lo que necesita el borrado.
 *
 * COMO SE CALCULA LA FILA
 *   El nodo de Sheets no expone el numero de fila al leer, asi que se deduce
 *   de la posicion: la fila 1 son los encabezados, de modo que el elemento i
 *   (base 0) de la lectura vive en la fila i + 2.
 *
 *   Ojo con el supuesto: la lectura descarta las filas COMPLETAMENTE vacias,
 *   asi que un hueco en blanco a mitad de la planilla correria la cuenta. Por
 *   eso la confirmacion del borrado dice siempre que clave y que fila se
 *   eliminaron: si algun dia no calza, se ve en el mensaje.
 */
function buscarPorClave(clave) {
  const buscada = String(clave || '').trim().toLowerCase();
  if (!buscada) return null;
  for (let i = 0; i < filas.length; i++) {
    if (String(filas[i].citation_key || '').trim().toLowerCase() === buscada) {
      return { fila: filas[i], indice: i, numeroFila: i + 2 };
    }
  }
  return null;
}

/** Mensaje cuando la clave no existe, con sugerencias si algo se le parece. */
function noEncontrada(clave) {
  const partes = [`No encontre ninguna referencia con la clave <code>${esc(clave)}</code>.`];
  const suelto = String(clave || '').trim().toLowerCase();
  const parecidas = filas
    .map((f) => String(f.citation_key || ''))
    .filter((k) => suelto.length >= 3 && k.toLowerCase().includes(suelto.slice(0, 8)));
  if (parecidas.length) {
    partes.push('', 'Quizas quisiste decir:',
      ...parecidas.slice(0, 5).map((k) => `<code>${esc(k)}</code>`));
  } else {
    partes.push('', 'Usa /ultimas para ver las claves disponibles.');
  }
  return partes.join('\n');
}

// Que hacer despues de este nodo. El Switch siguiente rutea por este campo.
//   responder -> mandar 'respuesta' y terminar
//   ver       -> leer la nota de Docs y mostrar el comienzo del resumen
//   borrar    -> quitar del .bib y de la planilla
let accion = 'responder';
let seleccion = null;
let respuesta;

if (comando === '/enlaces' || comando === '/links') {
  const partes = [`<b>${filas.length} referencias registradas</b>`, ''];
  partes.push(urlPlanilla
    ? enlace(urlPlanilla, 'Planilla consolidada')
    : '(No pude deducir el enlace de la planilla)');
  partes.push(urlBib
    ? enlace(urlBib, 'referencias.bib en GitHub')
    : '(No pude deducir el enlace del .bib)');
  if (pendientes.length) {
    partes.push('', `${pendientes.length} sin resumen automatico. Usa /pendientes`);
  }
  respuesta = partes.join('\n');

} else if (comando === '/ultimas') {
  if (!filas.length) {
    respuesta = 'Todavia no hay referencias registradas.';
  } else {
    // La planilla se llena por append, asi que las ultimas filas son las mas
    // recientes. Se invierte para mostrar primero la mas nueva.
    const ultimas = filas.slice(-CUANTAS_ULTIMAS).reverse();
    respuesta = [
      `<b>Ultimas ${ultimas.length} de ${filas.length}</b>`,
      '',
      ultimas.map(lineaReferencia).join('\n\n'),
    ].join('\n');
  }

} else if (comando === '/pendientes') {
  if (!pendientes.length) {
    respuesta = 'No hay referencias pendientes de resumen. Todas tienen el suyo.';
  } else {
    const lista = pendientes.slice(-CUANTAS_ULTIMAS).reverse();

    // Ojo: la cabecera se arma aparte en vez de filtrar los vacios del
    // arreglo final, porque ese filtro se llevaba tambien las lineas en
    // blanco que separan los bloques y el mensaje quedaba apelmazado.
    const cabecera = [`<b>${pendientes.length} sin resumen automatico</b>`];
    if (lista.length < pendientes.length) {
      cabecera.push(`Mostrando las ${lista.length} mas recientes.`);
    }

    respuesta = [
      cabecera.join('\n'),
      '',
      lista.map(lineaReferencia).join('\n\n'),
      '',
      'Abre cada nota y escribe el resumen a mano.',
    ].join('\n');
  }

} else if (comando === '/ver') {
  if (!argumento) {
    respuesta = 'Dime cual: <code>/ver ackermann2022rationales</code>\n\n'
      + 'Con /ultimas ves las claves disponibles.';
  } else {
    seleccion = buscarPorClave(argumento);
    if (!seleccion) {
      respuesta = noEncontrada(argumento);
    } else if (!/^https?:\/\//i.test(String(seleccion.fila.link_nota || ''))) {
      // Puede pasar si la creacion de la nota fallo en su momento.
      respuesta = `<b>${esc(seleccion.fila.citation_key)}</b> no tiene nota asociada, `
        + 'asi que no hay resumen que mostrar.';
    } else {
      // El texto vive en el documento de Docs, no en la planilla: hay que ir
      // a buscarlo. Lo hace el nodo siguiente.
      accion = 'ver';
      respuesta = '';
    }
  }

} else if (comando === '/borrar') {
  if (!argumento) {
    respuesta = 'Dime cual: <code>/borrar ackermann2022rationales</code>\n\n'
      + 'Se elimina de la planilla y del referencias.bib. '
      + 'La nota de Drive queda, por si quieres conservarla.';
  } else {
    seleccion = buscarPorClave(argumento);
    if (!seleccion) {
      respuesta = noEncontrada(argumento);
    } else {
      accion = 'borrar';
      respuesta = '';
    }
  }

} else {
  // Incluye /start, /help y cualquier comando desconocido.
  respuesta = AYUDA;
}

return [{
  json: {
    comando,
    argumento,
    accion,
    respuesta,

    // Datos de la referencia elegida, para las ramas /ver y /borrar
    clave: seleccion ? String(seleccion.fila.citation_key || '') : '',
    titulo: seleccion ? String(seleccion.fila.titulo || '') : '',
    link_nota: seleccion ? String(seleccion.fila.link_nota || '') : '',
    fila_numero: seleccion ? seleccion.numeroFila : 0,

    total_referencias: filas.length,
    total_pendientes: pendientes.length,
  },
}];
