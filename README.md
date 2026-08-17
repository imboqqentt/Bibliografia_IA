# Bibliografía Memoria — de un link de Telegram a una entrada BibTeX

Flujo de n8n para gestionar la bibliografía de una memoria de título de Ingeniería
Mecánica escrita en Overleaf.

Le mandas un link (o un DOI suelto) al bot de Telegram desde el celular y el flujo:

1. saca el DOI del link, o lo recupera desde las meta tags de la página, o lo busca por título en Crossref;
2. pide los metadatos bibliográficos a **Crossref** (autores, año, revista, volumen, número, páginas, tipo);
3. revisa si ya lo tenías registrado y, si es así, te responde y termina sin duplicar nada;
4. descarga la página o el PDF, extrae el texto y lo resume con un LLM **en español**;
5. agrega la entrada BibTeX a `referencias.bib` en tu repositorio de GitHub;
6. crea una nota de lectura en Google Docs;
7. agrega una fila al consolidado en Google Sheets;
8. te confirma por Telegram con la citation key, el tipo de entrada y el link a la nota.

**Regla central:** los metadatos bibliográficos salen *exclusivamente* de Crossref.
El LLM sólo redacta el resumen, la descripción breve, las palabras clave y la utilidad.
Nunca escribe un autor, un año, una revista ni un tipo de publicación.

---

## Contenido del repositorio

| Archivo | Qué es |
|---|---|
| `autohospedaje/` | Cómo y dónde correr n8n: notebook, PC de casa, Raspberry, VPS |
| `workflow.json` | El flujo completo, listo para importar con Ctrl+V en el canvas de n8n |
| `code/*.js` | El código de los 8 nodos Code, comentado, en archivos separados |
| `build_workflow.py` | Regenera `workflow.json` inyectando los `code/*.js`. Se corre tras editar el JS |
| `test/harness.js` | Banco de pruebas de los nodos Code, ejecutable fuera de n8n (`node test/harness.js`) |
| `test/telegram-pin-ejemplos.json` | Mensajes de Telegram falsos para probar el flujo sin webhook público |
| `SUPUESTOS.md` | Supuestos tomados y lo que probablemente tengas que ajustar a mano |

Si editas un archivo de `code/`, corre `python3 build_workflow.py` para regenerar el JSON,
o pega el código directamente en el nodo desde la interfaz de n8n. Las dos vías sirven.

---

## 1. Credenciales que tienes que crear

Todas se crean en n8n, en **Credentials → Add credential**. Ninguna clave va escrita
en el JSON: los nodos traen el campo de credencial marcado como `REEMPLAZAR` y tienes
que elegir la tuya del desplegable después de importar.

| Credencial en n8n | Tipo | Para qué | Cómo se obtiene |
|---|---|---|---|
| Telegram Bot Memoria | `Telegram API` | Trigger y respuestas | Token que te da @BotFather (ver §2) |
| Anthropic Memoria **o** Google Gemini Memoria | `Anthropic API` **o** `Google Gemini(PaLM) Api` | Redacción del resumen | `console.anthropic.com` → API Keys, **o** `aistudio.google.com/apikey` — ver §1.1 |
| GitHub Memoria | `GitHub API` (Access Token) | Leer y escribir `referencias.bib` | Token fino con permiso **Contents: Read and write** sobre el repo de la memoria |
| Google Sheets Memoria | `Google Sheets OAuth2 API` | Consolidado | Google Cloud Console → OAuth client (ver §4) |
| Google Docs Memoria | `Google Docs OAuth2 API` | Notas de lectura | Mismo proyecto de Google Cloud, mismo client |

Para GitHub usa un **fine-grained personal access token** limitado al repositorio de la
memoria, no un token clásico con acceso a toda tu cuenta. Los permisos mínimos son
`Contents: Read and write` sobre ese repo, nada más.

### 1.1 Qué modelo de lenguaje: hay dos archivos importables

El modelo **sólo redacta el resumen, la descripción breve, las palabras clave y la
utilidad**. Autor, año, revista y tipo salen de Crossref siempre. Por eso el proveedor
es una pieza intercambiable: cuelga de `Resumir con LLM` por una conexión
`ai_languageModel` y no toca ningún otro nodo.

El repositorio trae dos variantes generadas del mismo código. **Importas una, no las
dos:**

| Archivo | Sub-nodo | Credencial | Costo |
|---|---|---|---|
| `workflow.json` | Modelo Anthropic | `Anthropic API` | De pago; carga mínima US$5 |
| `workflow-gemini.json` | Modelo Gemini | `Google Gemini(PaLM) Api` | Capa gratuita |

**Gemini** se saca en [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
Ojo: en n8n la credencial aparece como *Google Gemini(PaLM) Api* — el nombre es
histórico, es la correcta— y **no** es la misma que las de Sheets y Docs: aquéllas son
OAuth contra tu cuenta, ésta es una API key. La capa gratuita tiene límites por minuto
y por día; si alguna vez los chocas, el flujo no se rompe, la referencia queda con
`estado_resumen = PENDIENTE`.

**Anthropic**, para referencia de costo: unas 30 fuentes al mes con Claude Sonnet 5
salen alrededor de **US$1 mensual**, así que la carga mínima de US$5 alcanza para casi
medio año. Con Claude Haiku 4.5 es la mitad.

Para regenerar los archivos desde el código:

```bash
python3 build_workflow.py                       # -> workflow.json
LLM_PROVEEDOR=gemini python3 build_workflow.py  # -> workflow-gemini.json
```

Además necesitas **una variable de entorno** en tu instancia de n8n:

```
BIBLIO_TELEGRAM_CHAT_ID=<tu chat_id numérico>
```

El nodo **Chat autorizado?** compara el remitente contra esa variable y descarta
cualquier otro. Falla cerrado: si la variable no existe, no pasa nadie.

> **Desde n8n 2.0** (abril 2026) el acceso a variables de entorno viene
> **bloqueado por defecto**: `N8N_BLOCK_ENV_ACCESS_IN_NODE` pasó de `false` a
> `true`. Los tres `docker-compose.yml` de este repositorio ya lo ponen
> explícitamente en `false`, así que si autohospedas con ellos no tienes que
> hacer nada. Si instalas n8n por tu cuenta, tienes que definir esa variable o
> el nodo *Chat autorizado?* va a fallar en cada mensaje.

> **En n8n Cloud** el acceso a `$env` viene bloqueado. Ahí abre el nodo
> **Chat autorizado?** y reemplaza el lado derecho de la condición por tu chat_id
> literal. Es tu copia privada del flujo, no el JSON que se comparte, así que no hay
> problema en escribirlo ahí. Como segunda barrera puedes además llenar
> *Telegram Trigger → Additional Fields → Restrict to Chat IDs*.

---

## 2. Registrar el bot de Telegram

1. En Telegram, habla con [@BotFather](https://t.me/BotFather) y manda `/newbot`.
2. Elige un nombre visible (ej. *Bibliografía Memoria*) y un username que termine en
   `bot` (ej. `memoria_biblio_bot`).
3. BotFather te devuelve un token de la forma `8123456789:AAH...`. **Ese token va sólo
   en la credencial de n8n**, nunca en un nodo ni en un archivo.
4. En n8n crea la credencial *Telegram API* y pega el token.
5. Averigua tu `chat_id`: escríbele algo a tu bot y abre en el navegador
   `https://api.telegram.org/bot<TU_TOKEN>/getUpdates`. El número en
   `result[0].message.chat.id` es tu chat_id. Ese es el valor de
   `BIBLIO_TELEGRAM_CHAT_ID`.
6. Escríbele `/start` al bot desde tu celular. Telegram no permite que un bot inicie
   la conversación, así que este paso es obligatorio para que pueda responderte.

El nodo Telegram Trigger registra el webhook solo al **publicar** el workflow
(en n8n 1.x ese boton se llamaba *Activar*). Si usas n8n
local, necesitas un túnel público (`n8n start --tunnel`) para que Telegram alcance tu
instancia.

### 2.1 Qué le puedes mandar al bot

Tres formas, y la tercera resuelve los papers de pago:

| Le mandas | Qué hace |
|---|---|
| Un link o un DOI suelto | Descarga la página, saca el DOI, consulta Crossref y resume |
| `<link> \| <título>` | Igual, pero usa ese título para buscar en Crossref si no hay DOI |
| **Un PDF como archivo adjunto** | Extrae el texto del PDF directamente, sin descargar nada |

**El PDF adjunto es la salida para las fuentes cerradas.** Un paper de Elsevier
o Springer sin acceso abierto no se puede descargar: el editor no publica el
texto y no existe copia legal en ningún repositorio. Lo bajas desde la
biblioteca de tu universidad y se lo reenvías al bot como archivo.

Al mandar el PDF, **escribe el DOI en el pie del archivo** (el campo de texto
que Telegram ofrece al adjuntar). Es lo que garantiza metadatos correctos. Si
no pones nada, el flujo intenta, en este orden:

1. Buscar el DOI **en la primera página del PDF** — casi todos los papers lo
   imprimen en el encabezado o el pie.
2. Usar el **nombre del archivo** como título para buscar en Crossref.

> Sólo mira las primeras 3.000 letras a propósito. Más abajo vienen las
> **referencias**, llenas de DOIs de *otros* trabajos: tomar uno de ahí daría
> una cita completa y equivocada, que es peor que quedarse sin metadatos.

Dos límites que conviene saber:

- **20 MB por archivo**, tope de la API de Telegram para bots.
- Un **PDF escaneado sin capa de texto** no se puede leer: queda con
  `estado_resumen = PENDIENTE` y el bot te dice que necesita OCR.

> Mándalo como **archivo**, no como foto. En Telegram, *Adjuntar → Archivo*.

### 2.2 Comandos para revisar desde el teléfono

Cualquier mensaje que empiece con `/` se responde y **no** se registra como
referencia.

| Comando | Qué devuelve |
|---|---|
| `/enlaces` | Total registrado, más el link a la planilla y al `referencias.bib` |
| `/ultimas` | Las 5 más recientes, cada título enlazado a su nota de lectura |
| `/pendientes` | Las que quedaron sin resumen automático, para completarlas a mano |
| `/ver <clave>` | El comienzo del resumen, más palabras clave y utilidad |
| `/borrar <clave>` | Elimina la referencia de la planilla y del `.bib` |
| `/ayuda` | La lista de comandos |

La `<clave>` es la citation key: `/ver ackermann2022rationales`.

**Sobre `/borrar`.** Quita la fila de la planilla y la entrada del `.bib`, en
ese orden inverso: primero el `.bib`, después la fila. Es deliberado — si algo
falla a medio camino, es preferible que sobre una fila (visible, fácil de
borrar a mano) a que sobre una entrada en el `.bib`, que se arrastraría en
silencio hasta la memoria compilada.

**La nota de Drive no se borra.** El bot te devuelve su link para que decidas.
Borrar archivos de tu Drive automáticamente es una puerta que prefiero no
abrir.

> Si te arrepientes: el `.bib` vive en git, así que la entrada sigue en el
> historial del repositorio. La fila de la planilla se recupera desde el
> historial de versiones de Google Sheets.

Los enlaces **no están escritos en ninguna parte**: se deducen en tiempo de
ejecución de los nodos que ya apuntan a tu planilla y a tu repositorio, con
`$('Nodo').params`. Si algún día cambias de planilla, los comandos siguen a la
nueva sin tocar nada.

> Esta rama arregla además un problema silencioso: `/start` —que Telegram manda
> solo al abrir el chat con el bot por primera vez— antes entraba al flujo
> normal e intentaba registrarse como si fuera una fuente bibliográfica.

---

## 3. Preparar el repositorio del `.bib` y sincronizarlo con Overleaf

El `.bib` vive en un repositorio de GitHub, no en Google Drive. La razón es que
**Overleaf sincroniza nativamente con Git/GitHub**, así que la entrada llega a tu
proyecto con un `pull`, y además te queda un commit por cada referencia agregada
(historial y rollback gratis).

### Preparación

1. Crea (o usa) el repositorio de GitHub donde vive tu memoria.
2. Crea en la **rama por defecto** un archivo `referencias.bib`. Puede estar vacío,
   pero **tiene que existir**: el flujo hace *append*, no *create*.
3. En n8n abre los nodos **Leer referencias.bib** y **Escribir referencias.bib** y
   completa `owner`, `repository` y, si tu `.bib` no está en la raíz, `filePath`
   (por ejemplo `bibliografia/referencias.bib`) en **los dos nodos**.

### Conectar con Overleaf

En Overleaf, dentro del proyecto: **Menu → GitHub → Link to GitHub repository**.
Requiere plan de pago de Overleaf.

Después, tu ciclo de trabajo es:

- mandas links al bot durante la semana;
- en Overleaf haces **Menu → GitHub → Pull GitHub changes into Overleaf**;
- las entradas nuevas aparecen en `referencias.bib` y ya puedes citarlas con
  `\cite{apellido2024palabra}`.

En el `.tex` necesitas, como siempre:

```latex
\usepackage[utf8]{inputenc}   % o compilar con LuaLaTeX / XeLaTeX
\usepackage{hyperref}          % necesario para los campos doi y url
...
\bibliographystyle{plain}      % o el estilo que exija tu escuela
\bibliography{referencias}
```

> **¿Dónde vas a correr n8n?** La carpeta
> [`autohospedaje/`](autohospedaje/) tiene una variante por situación de red:
> [`casa/`](autohospedaje/casa/) para un PC doméstico detrás de CGNAT
> (PostgreSQL + Cloudflare Tunnel), [`oracle/`](autohospedaje/oracle/) para un
> VPS con IP pública (PostgreSQL + Caddy), y la raíz de `autohospedaje/` para
> el notebook mientras armas y depuras.

> Si no tienes Overleaf de pago: puedes clonar el repo localmente y subir el `.bib`
> a mano cada cierto tiempo, o cambiar los dos nodos GitHub por nodos Google Drive
> (`file: update` con *Change File Content*). Pierdes el historial y la sincronización
> automática, pero el resto del flujo funciona igual.

---

## 4. Preparar Google Sheets y Google Docs

### Planilla

1. Crea una planilla nueva en Google Sheets.
2. Renombra la primera pestaña a **`Consolidado`** (exactamente así, el flujo la busca
   por nombre).
3. En la **fila 1** pega estos 14 encabezados, en este orden y con estos nombres
   exactos — el nodo usa *Map Automatically* y hace calzar las claves con los
   encabezados:

```
fecha_ingreso	citation_key	tipo	autores	anio	titulo	publicacion	doi	url	descripcion_breve	capitulo_previsto	estado	estado_resumen	link_nota
```

4. Copia el ID de la planilla desde su URL
   (`docs.google.com/spreadsheets/d/`**`ESTO_ES_EL_ID`**`/edit`) y pégalo en los nodos
   **Leer consolidado** y **Agregar fila consolidado**.

### Credenciales de Google

En [console.cloud.google.com](https://console.cloud.google.com):

1. Crea un proyecto.
2. **APIs & Services → Library**: habilita *Google Sheets API*, *Google Docs API* y
   *Google Drive API*.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
4. En *Authorized redirect URIs* pega la URL que te muestra n8n al crear la credencial.
5. Usa el mismo Client ID y Client Secret para las dos credenciales de n8n (Sheets y
   Docs) y autoriza cada una con el botón *Sign in with Google*.

> ### Las dos trampas de Google
>
> **1. Publica la pantalla de consentimiento, o todo se cae en 7 días.**
>
> Mientras el *publishing status* de la pantalla de consentimiento esté en
> **Testing**, Google **revoca los tokens de refresco a los 7 días**. El flujo
> te va a funcionar perfecto una semana y después va a empezar a fallar con
> `invalid_grant`, justo cuando ya dejaste de mirarlo.
>
> La solución: **APIs & Services → OAuth consent screen → Publish app**, para
> pasarlo a *In Production*. Vas a ver un aviso de "aplicación no verificada" al
> autorizar — es esperado y puedes continuar, porque eres el único usuario de tu
> propia aplicación. Con el estado en producción, los tokens dejan de expirar.
>
> **2. Vas a necesitar DOS redirect URIs.**
>
> La URL de callback cambia según cómo entres a n8n. Agrega ambas desde ya y te
> ahorras rehacer las credenciales cuando montes el túnel:
>
> ```
> http://localhost:5678/rest/oauth2-credential/callback
> https://n8n.tudominio.cl/rest/oauth2-credential/callback
> ```
>
> Google acepta `http://` sólo para `localhost`; para cualquier otro dominio
> exige `https://`.

### Carpeta de notas

El nodo **Crear nota** viene con `folderId = default`, es decir, la raíz de Mi unidad.
Para tenerlo ordenado, crea una carpeta *Notas de lectura*, copia su ID desde la URL
(`drive.google.com/drive/folders/`**`ID`**) y pégalo en ese nodo.

> **Por qué Google Docs y no `.docx`:** el nodo Google Docs es nativo, devuelve el
> `documentId` con el que se arma el link de la columna `link_nota`, y la nota queda
> editable desde el celular y buscable desde Drive. Generar un `.docx` obligaría a
> construir el binario dentro de un nodo Code sin librería disponible en el sandbox de
> n8n: más frágil y sin ganancia real. El costo es que el nodo sólo inserta texto
> plano, sin negritas ni encabezados.

---

## 5. Importar el flujo

1. Abre `workflow.json` o `workflow-gemini.json` —según el proveedor que elegiste en
   §1.1—, selecciona todo y cópialo.
2. En n8n, entra a un workflow nuevo y pega con **Ctrl+V** sobre el canvas.
3. Recorre los nodos con credencial (aparecen con un triángulo de advertencia) y elige
   la credencial correcta en cada uno:
   Telegram Trigger · Avisar duplicado · Confirmar por Telegram ·
   **Modelo Anthropic** o **Modelo Gemini** ·
   Leer consolidado · Agregar fila consolidado · Leer referencias.bib ·
   Escribir referencias.bib · Crear nota · Escribir nota.
4. Reemplaza los placeholders:
   - `REEMPLAZAR_ID_DE_LA_PLANILLA` en los dos nodos de Sheets;
   - `REEMPLAZAR_USUARIO_GITHUB` y `REEMPLAZAR_REPO_OVERLEAF` en los dos nodos de GitHub;
   - el `folderId` del nodo **Crear nota**, si quieres una carpeta específica.
5. Guarda y **publica** el workflow con el boton *Publish* de arriba a la derecha.

---

## 6. Probar paso a paso

Hazlo en este orden: cada prueba ejercita un camino distinto del flujo.

### Prueba 0 — el código, sin n8n

```bash
node test/harness.js
```

Corre los 8 nodos Code contra datos reales de Crossref y verifica el escapado LaTeX,
el mapeo de tipos, la deduplicación, la generación de citation keys y el append
idempotente al `.bib`. Debe terminar con *Todas las comprobaciones pasaron*.

### Prueba 0.5 — el flujo entero, sin webhook público

Sirve mientras todavía no tienes el dominio ni el túnel funcionando: el webhook
público sólo hace falta para que **Telegram despierte el flujo solo**. Todo lo
demás —Crossref, deduplicación, resumen, `.bib`, nota y planilla— se puede
probar de inmediato usando datos fijados.

En n8n:

1. Abre el nodo **Telegram Trigger**.
2. En el panel de salida (OUTPUT), presiona el ícono de **chincheta**
   (*Pin data*) y después **Edit Output**.
3. Pega uno de los casos de
   [`test/telegram-pin-ejemplos.json`](test/telegram-pin-ejemplos.json)
   — sólo el objeto, sin la clave que lo nombra.
4. **Cambia los `id` de `from` y `chat` por tu chat\_id real**, o el nodo
   *Chat autorizado?* va a cortar el flujo (que es exactamente lo que debe
   hacer).
5. Presiona **Execute Workflow**.

El flujo corre completo como si el mensaje hubiera llegado de verdad: escribe
en el `.bib`, crea la nota y agrega la fila. Los cuatro casos del archivo
cubren artículo con DOI, DOI suelto, página sin DOI y chat no autorizado.

> **Quita el pin cuando termines.** Con la chincheta puesta, el flujo sigue
> usando ese mensaje falso en vez de los que lleguen de verdad.

### Prueba 1 — artículo con DOI en el link (camino feliz)

Mándale al bot:

```
https://doi.org/10.1016/j.applthermaleng.2019.114301
```

Esperado, en unos 30–60 segundos:

- respuesta en Telegram con `Citation key: kumar2019performance`, `Tipo BibTeX: @article`,
  `Resumen: LISTO` y el link a la nota;
- commit nuevo en tu repo con la entrada `@article{kumar2019performance, ...}`;
- fila nueva en el consolidado con `estado = por leer`;
- Google Doc con el resumen, las palabras clave y la utilidad.

### Prueba 2 — idempotencia

Manda **el mismo link otra vez**.

Esperado: responde `Ya registrado, citation key: kumar2019performance` y **nada más**.
Sin commit nuevo, sin fila nueva, sin documento nuevo. Verifícalo en las tres partes.

### Prueba 3 — DOI suelto

```
10.1115/1.4048253
```

Esperado: lo resuelve vía `doi.org`, tipo `@article`, y la citation key sale
`mansfield2020assessment`.

### Prueba 4 — página sin DOI

```
https://www.skf.com/cl/products/rolling-bearings | Catálogo de rodamientos SKF
```

Esperado: entrada `@misc` con `howpublished` y `note = {Consultado el ...}`, la columna
`titulo` marcada con `[REVISAR METADATOS]` y el aviso *"OJO: metadatos sin Crossref"*
en la respuesta de Telegram. El texto tras el `|` se usa como título, porque sin DOI
Crossref no tiene de dónde sacarlo.

### Prueba 5 — fuente inaccesible

Manda un link con paywall duro (por ejemplo un artículo de ScienceDirect al que no
tengas acceso). Esperado: **el flujo no falla**. La referencia se registra igual con
los metadatos de Crossref y `estado_resumen = PENDIENTE`. Esa columna es tu lista de
pendientes: filtra por `PENDIENTE` y resume esas a mano.

### Prueba 6 — chat ajeno

Pídele a alguien que le escriba al bot. Esperado: silencio absoluto. En el historial de
ejecuciones de n8n verás que el flujo se cortó en **Chat autorizado?**.

### Si algo falla

Ve a **Executions** en n8n y abre la ejecución. Los nodos que fallaron pero no cortaron
el flujo aparecen en amarillo: haz click y mira el campo `error`. Los nodos externos
tienen reintentos (3 intentos con espera) y `continueOnFail` donde corresponde, así que
la mayoría de las fallas se ven como campos vacíos, no como flujo caído.

---

## Cómo se usa después

La planilla es el tablero de control:

- **`estado`**: `por leer` → `leído` → `citado`. Lo mueves tú a mano.
- **`capitulo_previsto`**: lo llenas cuando decides dónde va la fuente.
- **`estado_resumen = PENDIENTE`**: fuentes que hay que leer a mano.
- **`titulo` con `[REVISAR METADATOS]`**: entradas sin Crossref, hay que verificar
  autor y año contra la fuente original antes de citarlas.

Para citar, usas la citation key de la columna `citation_key` tal cual:
`\cite{kumar2019performance}`.
