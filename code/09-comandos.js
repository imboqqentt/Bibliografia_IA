/**
 * NODO: "Router de comandos"
 * Tipo: Code (n8n-nodes-base.code) — Modo: Run Once for All Items
 *
 * QUE HACE
 *   Resuelve los comandos del bot y decide que hacer despues. Es la navegacion
 *   completa: menu, lista paginada, ficha de una referencia y confirmacion de
 *   borrado.
 *
 * LA IDEA: COMANDOS TOCABLES, NO BOTONES
 *
 *   Telegram convierte en enlace tocable cualquier /palabra dentro del texto
 *   de un mensaje (entidad "bot_command"). No hay que registrar nada ni usar
 *   teclados: basta con escribir /ver_ackermann2022rationales en el mensaje y
 *   el cliente lo muestra tocable.
 *
 *   Se eligio esto por sobre los teclados inline (botones de verdad) porque el
 *   campo inlineKeyboard del nodo de Telegram es una estructura FIJA: las
 *   filas y botones se definen al disenar el flujo, no en ejecucion. Una lista
 *   de N referencias con paginacion no cabe ahi. La alternativa era llamar a
 *   la API con un nodo HTTP Request, pero la credencial telegramApi no tiene
 *   bloque authenticate, asi que el HTTP Request no puede usarla y habria que
 *   sacar el token del gestor de credenciales.
 *
 *   Ventaja lateral: los titulos se leen completos. Un boton corta a ~30
 *   caracteres y "Second law comparison of single effect and double..." queda
 *   ilegible.
 *
 *   Ojo al escribir mensajes: los comandos van en TEXTO PLANO y en linea
 *   propia. Dentro de <code> o <a> el cliente ya no los hace tocables.
 *
 * ENTRADA:  filas de "Leer consolidado (comandos)"
 * SALIDA:   1 item con { accion, respuesta, clave, fila_numero, ... }
 */

// Cuantas referencias por pagina. Con 8 el mensaje entra de sobra en los 4096
// caracteres que admite Telegram, incluso con titulos largos.
const POR_PAGINA = 8;

// Los titulos se recortan a esto en los listados. En la ficha va completo.
const MAX_TITULO = 80;

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

/** Enlace a una fila concreta de la planilla. gid=0 es la primera pestana. */
function urlFila(numeroFila) {
  if (!urlPlanilla || !numeroFila) return urlPlanilla;
  return `${urlPlanilla}/edit#gid=0&range=A${numeroFila}`;
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

const msg = $('Telegram Trigger').first().json.message
  || $('Telegram Trigger').first().json.edited_message
  || {};

const textoCrudo = String(msg.text || '').trim();

// "/ultimas@MiBot argumento" -> "/ultimas". En grupos Telegram agrega el @bot.
const primera = textoCrudo.split(/\s+/)[0].toLowerCase().replace(/@.*$/, '');

// Todo lo que venga despues, para la sintaxis con espacio: "/ver clave"
const resto = textoCrudo.split(/\s+/).slice(1).join(' ').trim();

const filas = $input.all()
  .map((i) => i.json || {})
  .filter((f) => f && String(f.citation_key || '').trim() !== '');

const pendientes = filas.filter(
  (f) => String(f.estado_resumen || '').trim().toUpperCase() === 'PENDIENTE',
);

/**
 * Separa el comando de su argumento.
 *
 * Las citation keys que genera 05-dedupe-y-citation-key.js son solo letras y
 * digitos en minuscula, sin guiones bajos, asi que el primer "_" despues del
 * prefijo separa limpio. Los prefijos se prueban de mas largo a mas corto:
 * "/borrar_si_" tiene que ganarle a "/borrar_".
 */
const PREFIJOS = [
  ['/borrar_si_', 'borrar_si'],
  ['/borrar_', 'borrar'],
  ['/resumen_', 'resumen'],
  ['/enlaces_', 'enlaces_ref'],
  ['/ver_', 'ver'],
  ['/lista_', 'lista'],
];

/**
 * Comandos sin argumento pegado. Todo se normaliza a un nombre canonico SIN
 * barra, para que el despacho de mas abajo compare una sola forma: tener que
 * preguntar por '/lista' y por 'lista' a la vez es como se cuelan los bugs.
 */
const SIMPLES = {
  '/menu': 'menu', '/start': 'menu', '/ayuda': 'menu', '/help': 'menu',
  '/lista': 'lista', '/ultimas': 'lista',
  '/pendientes': 'pendientes',
  '/enlaces': 'enlaces', '/links': 'enlaces',
  // Formas con espacio, que se siguen aceptando: "/ver clave"
  '/ver': 'ver', '/resumen': 'resumen', '/borrar': 'borrar',
};

let comando = '';
let argumento = resto;

for (const [prefijo, nombre] of PREFIJOS) {
  if (primera.startsWith(prefijo) && primera.length > prefijo.length) {
    comando = nombre;
    argumento = primera.slice(prefijo.length);
    break;
  }
}

// Cualquier cosa que no se reconozca cae en el menu, que es la pantalla que
// explica como seguir.
if (!comando) comando = SIMPLES[primera] || 'menu';

// ---------------------------------------------------------------------------
// Busqueda
// ---------------------------------------------------------------------------

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
  const partes = [`No encontre la referencia <b>${esc(clave)}</b>.`];
  const suelto = String(clave || '').trim().toLowerCase();
  const parecidas = filas
    .map((f) => String(f.citation_key || ''))
    .filter((k) => suelto.length >= 3 && k.toLowerCase().includes(suelto.slice(0, 8)));
  if (parecidas.length) {
    partes.push('', 'Quizas era una de estas:', '');
    // En texto plano para que Telegram las haga tocables.
    partes.push(...parecidas.slice(0, 5).map((k) => `/ver_${k}`));
  } else {
    partes.push('', 'Ver todas:', '/lista');
  }
  return partes.join('\n');
}

// ---------------------------------------------------------------------------
// Pantallas
// ---------------------------------------------------------------------------

const PIE_MENU = ['', '⬅️ Menu principal:', '/menu'].join('\n');

function pantallaMenu() {
  const lineas = [
    '<b>📚 Bibliografia de la memoria</b>',
    '',
    `${filas.length} referencias registradas`,
  ];
  if (pendientes.length) {
    lineas.push(`${pendientes.length} sin resumen automatico`);
  }
  lineas.push(
    '',
    'Ver todas las referencias:',
    '/lista',
    '',
    'Solo las que falta resumir:',
    '/pendientes',
    '',
    'Planilla y referencias.bib:',
    '/enlaces',
    '',
    '<i>Para registrar algo nuevo, mandame un link, un DOI suelto, '
    + 'o un PDF adjunto con el DOI en el pie.</i>',
  );
  return lineas.join('\n');
}

/** Lista paginada. Cada entrada trae su comando tocable. */
function pantallaLista(lista, pagina, titulo, comandoPagina) {
  if (!lista.length) {
    return [`<b>${titulo}</b>`, '', 'No hay nada que mostrar todavia.', PIE_MENU].join('\n');
  }

  const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const p = Math.min(Math.max(1, pagina), totalPaginas);
  const desde = (p - 1) * POR_PAGINA;
  const trozo = lista.slice(desde, desde + POR_PAGINA);

  const lineas = [
    `<b>${titulo}</b>`,
    `${lista.length} en total · pagina ${p} de ${totalPaginas}`,
    '',
  ];

  trozo.forEach((f, i) => {
    const anio = String(f.anio || 's.f.').trim();
    const marca = String(f.estado_resumen || '').toUpperCase() === 'PENDIENTE' ? ' ⏳' : '';
    lineas.push(`<b>${desde + i + 1}.</b> ${esc(recortar(f.titulo || '(sin titulo)', MAX_TITULO))}`);
    lineas.push(`<i>${esc(anio)}</i>${marca}`);
    lineas.push(`/ver_${f.citation_key}`);
    lineas.push('');
  });

  const navegacion = [];
  if (p > 1) navegacion.push(`◀️ Anterior: ${comandoPagina}_${p - 1}`);
  if (p < totalPaginas) navegacion.push(`▶️ Siguiente: ${comandoPagina}_${p + 1}`);
  if (navegacion.length) lineas.push(...navegacion);

  lineas.push(PIE_MENU);
  return lineas.join('\n');
}

/** Ficha de una referencia: lo que reemplaza al panel de botones. */
function pantallaFicha(encontrada) {
  const f = encontrada.fila;
  const clave = String(f.citation_key || '');
  const pendiente = String(f.estado_resumen || '').toUpperCase() === 'PENDIENTE';

  const lineas = [
    `<b>${esc(f.titulo || '(sin titulo)')}</b>`,
    '',
  ];
  if (f.autores) lineas.push(esc(recortar(f.autores, 120)));
  const ficha = [f.anio, f.publicacion].filter(Boolean).map(esc).join(' · ');
  if (ficha) lineas.push(`<i>${ficha}</i>`);
  lineas.push(`Clave: <code>${esc(clave)}</code>`);

  if (f.descripcion_breve && !/^sin resumen/i.test(String(f.descripcion_breve))) {
    lineas.push('', esc(f.descripcion_breve));
  }

  lineas.push('', '─────────────', '');
  lineas.push(pendiente ? '📄 Resumen (quedo pendiente):' : '📄 Ver el resumen:');
  lineas.push(`/resumen_${clave}`);
  lineas.push('', '🔗 Nota y fila en la planilla:');
  lineas.push(`/enlaces_${clave}`);
  lineas.push('', '🗑 Eliminar esta referencia:');
  lineas.push(`/borrar_${clave}`);
  lineas.push('', '⬅️ Volver a la lista:');
  lineas.push('/lista');
  return lineas.join('\n');
}

// ---------------------------------------------------------------------------
// Proceso
// ---------------------------------------------------------------------------

// Que hacer despues de este nodo. El Switch siguiente rutea por este campo.
//   responder -> mandar 'respuesta' y terminar
//   ver       -> leer la nota de Docs y mostrar el comienzo del resumen
//   borrar    -> quitar del .bib y de la planilla
let accion = 'responder';
let seleccion = null;
let respuesta;

if (comando === 'lista') {
  const pagina = parseInt(argumento, 10) || 1;
  respuesta = pantallaLista(filas, pagina, '📚 Referencias', '/lista');

} else if (comando === 'pendientes') {
  respuesta = pantallaLista(pendientes, parseInt(argumento, 10) || 1,
    '⏳ Sin resumen automatico', '/pendientes');

} else if (comando === 'enlaces') {
  const partes = [
    '<b>🔗 Enlaces</b>',
    '',
    `${filas.length} referencias registradas`,
    '',
    urlPlanilla ? enlace(urlPlanilla, '📊 Planilla consolidada')
      : '(No pude deducir el enlace de la planilla)',
    urlBib ? enlace(urlBib, '📄 referencias.bib en GitHub')
      : '(No pude deducir el enlace del .bib)',
    PIE_MENU,
  ];
  respuesta = partes.join('\n');

} else if (comando === 'ver') {
  seleccion = buscarPorClave(argumento);
  respuesta = seleccion ? pantallaFicha(seleccion) : noEncontrada(argumento);

} else if (comando === 'enlaces_ref') {
  seleccion = buscarPorClave(argumento);
  if (!seleccion) {
    respuesta = noEncontrada(argumento);
  } else {
    const f = seleccion.fila;
    respuesta = [
      `<b>${esc(f.citation_key)}</b>`,
      esc(recortar(f.titulo || '', MAX_TITULO)),
      '',
      enlace(f.link_nota, '📝 Nota de lectura'),
      enlace(urlFila(seleccion.numeroFila), `📊 Fila ${seleccion.numeroFila} de la planilla`),
      f.doi ? enlace(`https://doi.org/${f.doi}`, `🔗 ${f.doi}`) : '',
      '',
      '⬅️ Volver a la ficha:',
      `/ver_${f.citation_key}`,
    ].filter((l) => l !== '').join('\n');
  }

} else if (comando === 'resumen') {
  seleccion = buscarPorClave(argumento);
  if (!seleccion) {
    respuesta = noEncontrada(argumento);
  } else if (!/^https?:\/\//i.test(String(seleccion.fila.link_nota || ''))) {
    // Puede pasar si la creacion de la nota fallo en su momento.
    respuesta = [
      `<b>${esc(seleccion.fila.citation_key)}</b> no tiene nota asociada, `
      + 'asi que no hay resumen que mostrar.',
      '',
      '⬅️ Volver a la ficha:',
      `/ver_${seleccion.fila.citation_key}`,
    ].join('\n');
  } else {
    // El texto vive en el documento de Docs, no en la planilla: hay que ir a
    // buscarlo. Lo hace el nodo siguiente.
    accion = 'ver';
    respuesta = '';
  }

} else if (comando === 'borrar') {
  // Primer paso: SOLO confirmar. Un comando tocable se aprieta sin querer con
  // la misma facilidad que un boton, y esto borra en dos sitios.
  seleccion = buscarPorClave(argumento);
  if (!seleccion) {
    respuesta = noEncontrada(argumento);
  } else {
    const f = seleccion.fila;
    respuesta = [
      '<b>⚠️ ¿Eliminar esta referencia?</b>',
      '',
      esc(recortar(f.titulo || '', MAX_TITULO)),
      `<code>${esc(f.citation_key)}</code>`,
      '',
      `Se quita de la planilla (fila ${seleccion.numeroFila}) y del referencias.bib.`,
      'La nota de Drive queda donde esta.',
      '',
      '✅ Si, eliminar:',
      `/borrar_si_${f.citation_key}`,
      '',
      '❌ No, volver a la ficha:',
      `/ver_${f.citation_key}`,
    ].join('\n');
    // Ojo: aca NO se borra nada. Solo lo hace /borrar_si_<clave>.
    seleccion = null;
  }

} else if (comando === 'borrar_si') {
  seleccion = buscarPorClave(argumento);
  if (!seleccion) {
    respuesta = noEncontrada(argumento);
  } else {
    accion = 'borrar';
    respuesta = '';
  }

} else {
  // Incluye /start, /menu, /ayuda y cualquier comando desconocido.
  respuesta = pantallaMenu();
}

return [{
  json: {
    comando,
    argumento,
    accion,
    respuesta,

    // Datos de la referencia elegida, para las ramas de resumen y borrado
    clave: seleccion ? String(seleccion.fila.citation_key || '') : '',
    titulo: seleccion ? String(seleccion.fila.titulo || '') : '',
    link_nota: seleccion ? String(seleccion.fila.link_nota || '') : '',
    fila_numero: seleccion ? seleccion.numeroFila : 0,

    total_referencias: filas.length,
    total_pendientes: pendientes.length,
  },
}];
