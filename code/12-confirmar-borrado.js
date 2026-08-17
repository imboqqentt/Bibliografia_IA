/**
 * NODO: "Confirmar borrado"
 * Tipo: Code (n8n-nodes-base.code) — Modo: Run Once for All Items
 *
 * QUE HACE
 *   Nada mas que recuperar el texto de confirmacion que armo
 *   "Quitar del bib" y dejarlo en el campo que espera el nodo de Telegram.
 *
 * POR QUE HACE FALTA
 *   "Responder comando" manda {{ $json.respuesta }}, y a el llegan las tres
 *   ramas de comandos. Pero el ultimo nodo de la rama de borrado es el de
 *   Google Sheets, cuya salida es la respuesta de la API de Google, no el
 *   texto del mensaje.
 *
 *   Se podria haber puesto una expresion condicional en el nodo de Telegram,
 *   pero eso obliga a que ese nodo conozca la forma de cada rama. Con este
 *   paso, las tres ramas cumplen el mismo contrato —un item con 'respuesta'—
 *   y el nodo de Telegram no sabe de donde viene.
 *
 * ENTRADA:  salida de "Borrar fila" (respuesta de la API de Sheets)
 * SALIDA:   1 item con { respuesta }
 */

const borrado = $('Quitar del bib').first().json;

return [{
  json: {
    respuesta: borrado.respuesta,
    clave: borrado.clave,
    quitada_del_bib: borrado.quitada_del_bib,
    fila_borrada: borrado.fila_numero,
  },
}];
