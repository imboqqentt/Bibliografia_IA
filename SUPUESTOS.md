# Supuestos y ajustes pendientes

Dos listas: lo que asumí al construir el flujo, y lo que muy probablemente tengas que
tocar a mano después de importar.

---

## A. Supuestos que tomé

### Sobre tu entorno

0. **Probado contra n8n 2.34.6.** Los cambios de n8n 2.0 que afectan a este
   flujo ya están contemplados:
   - `N8N_BLOCK_ENV_ACCESS_IN_NODE` cambió su default a `true`. Los tres
     compose lo fuerzan a `false`, que es lo que necesita el nodo
     *Chat autorizado?* para leer `$env.BIBLIO_TELEGRAM_CHAT_ID`.
   - `N8N_DEFAULT_BINARY_DATA_MODE` ya no tiene modo `default`; ahora es
     `filesystem`, que es justo lo que los compose ya declaraban.
   - El interruptor *Activar/Desactivar* pasó a llamarse **Publicar/Despublicar**.
     Las guías usan la nomenclatura nueva.
   - Ninguno de los nodos retirados en 2.0 (Spontit, crowd.dev, Kitemaker,
     Automizy) se usa acá.

1. **n8n propio o Cloud, versión reciente.** Los nodos van con estas versiones de
   esquema: `telegramTrigger` 1.2, `if` 2.2, `code` 2, `httpRequest` 4.2,
   `extractFromFile` 1.1, `googleSheets` 4.5, `github` 1.1, `googleDocs` 2,
   `telegram` 1.2, `chainLlm` 1.5, `outputParserStructured` 1.2, y —según la variante—
   `lmChatAnthropic` 1.3 o `lmChatGoogleGemini` 1.
   Si tu n8n es más antiguo, al importar verás "unknown node version" en algún nodo:
   bájale el `typeVersion` en el JSON o vuelve a crear ese nodo desde el canvas.
2. **Overleaf con plan de pago**, que es lo que habilita la sincronización con GitHub.
   Sin eso, el `.bib` igual se escribe en el repo pero tienes que bajarlo a mano.
3. **Zona horaria `America/Santiago`**, usada para `fecha_ingreso` y para el
   "Consultado el dd/mm/aaaa" de las entradas web. Está en la primera línea de
   configuración de `code/01-normalizar-entrada.js`.
4. **El correo para Crossref se lee de la variable `CROSSREF_MAILTO`**, no está
   incrustado en el workflow. Crossref pide que las aplicaciones se identifiquen
   con un correo y a cambio da acceso al *polite pool*, que responde más rápido.
   Se dejó como variable de entorno para que el repositorio no cargue datos
   personales y pueda ser público. **Si la dejas vacía el flujo funciona igual**,
   sólo que las consultas van por la vía pública.

### Sobre las decisiones de diseño

5. **La deduplicación se hace contra Google Sheets, no contra el `.bib`.** La planilla
   es la fuente de verdad del "¿ya lo tengo?". El `.bib` tiene su propia verificación
   de respaldo (nodo *Construir bib actualizado*), pero si borras una fila de la
   planilla, el flujo volverá a procesar esa fuente. La entrada `.bib` no se duplicará,
   pero sí se creará una nota de Google Docs nueva.
6. **La descarga ocurre antes de deduplicar.** Suena al revés, pero es a propósito: en
   ScienceDirect, Springer y Wiley el DOI no está en la URL, y la única forma confiable
   de obtenerlo es leer las meta tags `citation_doi` de la página. Sin descargar
   primero, esos links no se podrían deduplicar por DOI. El costo es una descarga
   inútil cuando reenvías un link repetido; el beneficio es que la deduplicación
   funciona de verdad. **Ninguna escritura ni llamada al LLM ocurre antes del chequeo
   de duplicados.**
7. **La citation key definitiva la fija el nodo `Construir bib actualizado`,** no el de
   deduplicación. El nodo de dedupe propone una key mirando la planilla; el del `.bib`
   la confirma mirando el archivo y le corre el sufijo si hace falta. La nota, la fila
   y el mensaje de Telegram leen todos de ahí, así que las cuatro cosas siempre
   coinciden.
8. **`sf` = sin fecha.** Cuando Crossref no entrega año, la key queda
   `skfsfcatalogo` en vez de `skf2026catalogo`. Preferí eso a inventar el año actual.
9. **Palabras genéricas se saltan al armar la key.** "análisis", "estudio", "the",
   "of" y similares no sirven para distinguir una fuente de otra, así que la key toma
   la primera palabra *significativa* del título. Un artículo titulado "Análisis CFD de
   un túnel de viento" queda como `apellido2021tunel`, no `apellido2021analisis`.
   La lista está en `code/05-dedupe-y-citation-key.js` (constante `VACIAS`).
10. **`doi` y `url` llevan escapado mínimo, a propósito.** Todos los demás campos
    escapan los 10 caracteres reservados de LaTeX. En `doi` y `url` sólo se escapan
    `%` y `#`. Si escapara el guion bajo, un DOI de Springer como
    `10.1007/978-3-030-14907-9_5` quedaría como `..._5` con barra invertida y el
    **enlace** apuntaría a una dirección inexistente, aunque el texto se viera bien.
    Es el mismo criterio que usan Zotero y JabRef. **Requiere `hyperref` o `url` en el
    preámbulo**, cosa que traen todas las plantillas de Overleaf.
11. **El título completo va entre llaves dobles.** `title = {{Análisis CFD de un Túnel}}`
    protege todas las mayúsculas y acrónimos del case-folding de los estilos
    bibliográficos. Es lo que pediste, y es más robusto que intentar detectar acrónimos
    uno por uno. Efecto lateral: si tu escuela exige títulos en minúsculas ("sentence
    case"), el estilo no podrá aplicarlo. Si te pasa, cambia `campoTitulo()` por
    `campo()` en `code/06-consolidar-registro.js`.
12. **Umbral de similitud de 0.72 para aceptar un DOI encontrado por título.** Es
    estricto a propósito: un DOI equivocado en una memoria es peor que un campo vacío.
    Cuando no alcanza el umbral, la entrada queda marcada `metadatos_manuales = SI`.
    El umbral está al inicio de `code/03-elegir-candidato-crossref.js`.
13. **600 caracteres es el mínimo para considerar que hay texto.** Bajo eso se asume
    paywall, captcha o página de redirección, y el resumen queda `PENDIENTE`.
    Constante `MIN_CHARS_UTILES` en `code/02-preparar-texto.js`.
14. **45.000 caracteres es el tope que se le manda al LLM** (unos 12k tokens). Los
    papers largos se truncan; el resumen se hace igual sobre esa porción, que en la
    práctica cubre introducción, método y resultados. Constante `MAX_CHARS` en el
    mismo archivo.
15. **Se toma sólo el primer autor para la key**, aunque el `.bib` guarda la lista
    completa.
16. **Sin autor, la key usa el dominio del sitio.** El catálogo de SKF queda como
    `skfsfcatalogo`.
17. **Un solo link por mensaje.** Si mandas varios en un mismo mensaje, se procesa el
    primero.

---

## B. Lo que probablemente tengas que ajustar a mano

Ordenado de más a menos probable.

### Casi seguro

1. **Los placeholders.** `REEMPLAZAR_ID_DE_LA_PLANILLA` (2 nodos de Sheets),
   `REEMPLAZAR_USUARIO_GITHUB` y `REEMPLAZAR_REPO_OVERLEAF` (2 nodos de GitHub), y las
   5 credenciales. Sin esto el flujo no corre.
2. **`BIBLIO_TELEGRAM_CHAT_ID`.** Si estás en n8n Cloud, `$env` viene bloqueado y
   tienes que poner tu chat_id literal en el nodo **Chat autorizado?**. Si no lo haces,
   ese nodo va a fallar en cada mensaje. Es la única parte del flujo que exige una
   decisión sobre dónde corres n8n.
3. **El modelo de lenguaje concreto.** `workflow.json` trae `claude-sonnet-4-6` y
   `workflow-gemini.json` trae `models/gemini-2.5-flash`. Los dos son valores por
   defecto razonables, no requisitos: si tu instancia es más antigua o el desplegable
   no lista ese modelo, elige otro de la lista. Es un cambio de un click.

   El proveedor mismo también es intercambiable, y a propósito: el modelo redacta
   *sólo* el resumen, la descripción, las palabras clave y la utilidad. Los metadatos
   bibliográficos vienen de Crossref, así que cambiar de proveedor no puede afectar la
   corrección de una cita. Eso es lo que permite tener dos variantes del flujo que se
   diferencian en un único sub-nodo.
4. **La pestaña de la planilla se busca por nombre (`Consolidado`)** usando el modo
   *By Name* del selector. Si tu versión de n8n no ofrece ese modo, cambia el selector
   a *From list* y elige la pestaña. Igual con el ID de la planilla si prefieres *From
   list* en vez de *By ID*.

   > **Ojo con el efecto secundario.** El selector de documento, el de pestaña y el
   > modo de mapeo son partes del mismo componente (`resourceMapper`). Si cambias el
   > documento o la hoja desde la interfaz, n8n reinicializa el componente entero y el
   > **Mapping Column Mode vuelve a su valor por defecto, `defineBelow`** (*Map Each
   > Column Manually*), pisando el `autoMapInputData` que trae el JSON. Sin columnas
   > definidas a mano, el nodo falla con *"At least one value has to be added under
   > 'Values to Send'"*. No falta ningún dato: hay que volver a elegir **Map
   > Automatically** en el nodo. Pasa igual en *Leer consolidado* si alguna vez le
   > cambias la hoja.

### Bastante probable

5. **La ruta del `.bib`.** Viene como `referencias.bib` en la raíz. Si en tu proyecto
   está en un subdirectorio, cámbialo en **los dos** nodos de GitHub.
6. **La rama.** Los nodos GitHub trabajan contra la **rama por defecto** del repo. Si
   escribes la memoria en otra rama, agrégala en *Additional Parameters → Branch* del
   nodo **Escribir referencias.bib**. El nodo de lectura no tiene ese campo, así que si
   usas una rama distinta a la principal, vas a tener que resolverlo con un nodo HTTP
   Request con la credencial de GitHub, apuntando a
   `GET /repos/{owner}/{repo}/contents/{path}?ref={rama}`.
7. **`referencias.bib` tiene que existir antes de la primera ejecución.** El flujo hace
   *append*, no *create*. Si no existe, el nodo *Construir bib actualizado* corta con un
   mensaje que lo dice explícitamente.
8. **La carpeta de las notas.** `folderId = default` deja los documentos sueltos en la
   raíz de Mi unidad. Después de 20 fuentes eso es un desorden; ponle el ID de una
   carpeta.
9. **La inserción de texto en Google Docs.** El nodo inserta al final del documento con
   los valores por defecto de `actionsUi`. Si tu versión de n8n pide explícitamente un
   `index` o un `insertSegment`, abre el nodo **Escribir nota** y complétalos desde la
   interfaz. Es el punto del flujo donde más varía la interfaz entre versiones de n8n.

### Posible, según lo que te encuentres

10. **Normas chilenas (NCh) y catálogos de fabricante** no están en Crossref. Van a
    entrar siempre como `@misc` con `metadatos_manuales = SI`. Para esas, usa la
    sintaxis `<url> | <título>` al mandarlas y después completa autor/año a mano en el
    `.bib`. Si tu escuela exige `@manual` para normas en vez de `@techreport`, ajusta
    el mapa `MAPA_TIPO_BIBTEX` en `code/04-normalizar-metadatos.js`.
11. **PDFs escaneados sin capa de texto.** La extracción devuelve vacío y el resumen
    queda `PENDIENTE`. El flujo no hace OCR. Si te pasa seguido, se puede agregar un
    nodo con un servicio de OCR entre la descarga y *Preparar texto*.
12. **Sitios con Cloudflare o login duro.** Devuelven un 403 o una página de desafío.
    La referencia se registra igual con los metadatos de Crossref; sólo pierdes el
    resumen automático.
13. **`estado_resumen = PENDIENTE` es tu cola de trabajo.** Filtra la planilla por esa
    columna cada cierto tiempo: son las fuentes que hay que leer y resumir a mano.
14. **Tesis y memorias de otras universidades** rara vez están en Crossref, aunque
    tengan DOI. Suelen caer en `@misc` en vez de `@phdthesis`. Revisa el tipo antes de
    citarlas.
15. **Rendimiento de la deduplicación.** El nodo lee *todas* las filas del consolidado
    en cada ejecución. Para una memoria (100–300 fuentes) es instantáneo. Si algún día
    pasaras de unas 2.000 filas, convendría cambiar a una lectura filtrada por DOI.
16. **Un `.bib` con entradas previas hechas a mano.** El flujo las respeta: lee el
    archivo completo, detecta las keys existentes para no chocar con ellas y agrega la
    nueva al final. Pero esas entradas viejas **no** están en la planilla, así que si
    reenvías un link que ya tenías a mano, se creará una fila y una nota nuevas (la
    entrada `.bib` sí se detecta y no se duplica). Si quieres evitarlo, carga esas
    referencias antiguas en la planilla antes de empezar.

---

## C. Cosas que decidí *no* hacer

- **No hay OCR.** Agrega complejidad y costo para un caso relativamente raro.
- **No se descarga el PDF a Drive.** Sólo se extrae el texto. Si quieres archivar los
  PDFs, se puede agregar un nodo Google Drive `upload` después de la descarga.
- **No se escribe nada en el `.tex`.** La entrada BibTeX vive sólo en `referencias.bib`,
  como pediste. El flujo nunca toca el documento.
- **No hay reintento automático de las fuentes `PENDIENTE`.** Se podría hacer con un
  segundo workflow con Schedule Trigger que relea la planilla, pero es un flujo aparte.
- **El LLM no valida ni corrige metadatos de Crossref.** Aunque el texto del paper
  contradiga a Crossref, gana Crossref. Es la regla que pediste y está escrita
  explícitamente en el prompt.
