/**
 * NODO: "Preparar fila"
 * Tipo: Code (n8n-nodes-base.code) — Modo: Run Once for All Items
 *
 * QUE HACE
 *   Emite un item cuyas CLAVES son exactamente los encabezados del consolidado.
 *   Eso permite configurar el nodo Google Sheets con "Map Automatically"
 *   (columns.mappingMode = autoMapInputData), que es mucho mas robusto al
 *   importar el workflow que mapear columna por columna: no depende de que
 *   n8n haya cargado el esquema de la planilla.
 *
 *   Encabezados esperados en la fila 1 de la pestana "Consolidado",
 *   exactamente con estos nombres y en este orden:
 *
 *     fecha_ingreso | citation_key | tipo | autores | anio | titulo |
 *     publicacion | doi | url | descripcion_breve | capitulo_previsto |
 *     estado | estado_resumen | link_nota
 *
 * ENTRADA:  salida de "Escribir nota" (Google Docs)
 * SALIDA:   1 item con las 14 columnas
 */

const registro = { ...$('Construir bib actualizado').first().json };

// El id del documento sale del nodo que lo creo. Google Docs devuelve
// documentId; algunas versiones exponen id. Se cubren ambos.
const docCreado = $('Crear nota').first().json || {};
const documentId = docCreado.documentId || docCreado.id || '';
const linkNota = documentId ? `https://docs.google.com/document/d/${documentId}/edit` : '';

// Marca visible en la planilla cuando los metadatos no vienen de Crossref
const sufijoManual = registro.metadatos_manuales === 'SI' ? ' [REVISAR METADATOS]' : '';

return [{
  json: {
    fecha_ingreso: registro.fecha_ingreso || '',
    citation_key: registro.citation_key || '',
    tipo: registro.bibtex_tipo || '@misc',
    autores: registro.autores_texto || '',
    anio: registro.anio || '',
    titulo: (registro.titulo || '') + sufijoManual,
    publicacion: registro.publicacion || '',
    doi: registro.doi || '',
    url: registro.url_final || registro.url || '',
    descripcion_breve: registro.descripcion_breve || '',

    // Se llena a mano cuando decidas en que capitulo la vas a usar
    capitulo_previsto: '',

    // Valores sugeridos: "por leer" / "leido" / "citado"
    estado: 'por leer',

    // LISTO | PENDIENTE
    estado_resumen: registro.estado_resumen || 'PENDIENTE',

    link_nota: linkNota,
  },
}];
