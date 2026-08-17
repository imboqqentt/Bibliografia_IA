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
| `workflow.json` | El flujo completo (Anthropic), listo para importar con Ctrl+V en el canvas de n8n |
| `workflow-gemini.json` | La misma variante con Google Gemini, que tiene capa gratuita |
| `code/*.js` | El código de los 12 nodos Code, comentado, en archivos separados |
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

### 2.2 Navegar la bibliografía desde el teléfono

El bot se maneja **tocando**, no escribiendo. Telegram convierte en enlace
tocable cualquier `/palabra` dentro del texto de un mensaje, así que cada
pantalla trae sus propias acciones listas para apretar.

```
/start                        →  menú principal
  └ /lista                    →  las referencias, paginadas de 8 en 8
      └ /ver_<clave>          →  ficha de una referencia
          ├ /resumen_<clave>  →  el comienzo del resumen
          ├ /enlaces_<clave>  →  su nota y su fila en la planilla
          └ /borrar_<clave>   →  pide confirmación
              └ /borrar_si_<clave>
```

No tienes que memorizar ni escribir ninguno: van dentro de los mensajes y se
tocan. Los de entrada, por si acaso, son `/menu`, `/lista`, `/pendientes` y
`/enlaces`.

**Por qué comandos tocables y no botones.** El campo `inlineKeyboard` del nodo
de Telegram es una estructura **fija**: las filas y botones se definen al
diseñar el flujo, no en ejecución, así que una lista de N referencias con
paginación no cabe. La alternativa era llamar a la API con un nodo HTTP
Request, pero la credencial `telegramApi` no tiene bloque `authenticate` y ese
nodo no puede usarla — habría que sacar el token del gestor de credenciales.

Ventaja lateral: los títulos se leen completos. Un botón corta a unos 30
caracteres, y *"Second law comparison of single effect and double…"* queda
ilegible.

> Al editar los mensajes, los comandos van en **texto plano y en línea
> propia**. Dentro de `<code>` o `<a>` el cliente deja de detectarlos y no se
> pueden tocar.

**Sobre borrar.** Hace falta un segundo toque en un comando distinto
(`/borrar_si_…`), porque un comando tocable se aprieta sin querer con la misma
facilidad que un botón. Quita la fila de la planilla y la entrada del `.bib`,
en ese orden inverso: primero el `.bib`, después la fila. Si algo falla a medio
camino, es preferible que sobre una fila —visible, fácil de borrar a mano— a
que sobre una entrada en el `.bib`, que se arrastraría en silencio hasta la
memoria compilada.

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

> Esto arregla además un problema silencioso: `/start` —que Telegram manda solo
> al abrir el chat con el bot por primera vez— antes entraba al flujo normal e
> intentaba registrarse como si fuera una fuente bibliográfica.

### 2.3 El menú nativo de Telegram (opcional, un minuto)

Para que el botón **☰** junto al campo de texto muestre los comandos de
entrada, regístralos una sola vez. Desde tu computador:

```bash
curl -s -X POST "https://api.telegram.org/bot<TU_TOKEN>/setMyCommands" \
  -H 'Content-Type: application/json' \
  -d '{"commands":[
    {"command":"menu","description":"Menu principal"},
    {"command":"lista","description":"Ver todas las referencias"},
    {"command":"pendientes","description":"Las que falta resumir"},
    {"command":"enlaces","description":"Planilla y referencias.bib"}
  ]}'
```

Es una llamada a Telegram, no a n8n: no cambia el flujo y se puede repetir sin
riesgo.

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

## 5. Instalar el flujo en n8n

Vale tanto para una instalación nueva como para actualizar una que ya tenías.
Si es lo segundo, **empieza por §5.4**, que tiene un paso previo que te ahorra
rehacer trabajo.

El flujo son **48 nodos** más 5 notas adhesivas. Nada de eso se configura a
mano: sólo hay **5 credenciales** y **4 valores propios** que rellenar. Todo lo
demás viene resuelto.

### 5.1 Pegar el flujo

1. Abre `workflow.json` **o** `workflow-gemini.json` —según el proveedor de
   modelo que elegiste en §1.1—, selecciona todo (**Ctrl+A**) y copia
   (**Ctrl+C**).
2. En n8n: **Overview → Create Workflow**.
3. Haz clic sobre el lienzo vacío y pega (**Ctrl+V**).

Aparecen los 48 nodos con triángulos de advertencia. Es lo esperado: marcan lo
que falta por conectar.

> **Importas uno de los dos archivos, no los dos.** Si importas ambos, los dos
> Telegram Trigger se pelean el mismo webhook y sólo responde uno.

### 5.2 Conectar las 5 credenciales

Abre cada nodo y elige la credencial del desplegable. Están agrupadas por
credencial para que la elijas una vez y recorras sus nodos seguidos:

| Credencial | Nodos donde va |
|---|---|
| **Telegram API** (5) | Telegram Trigger · Avisar duplicado · Confirmar por Telegram · Responder comando · Descargar PDF de Telegram |
| **Google Sheets OAuth2** (4) | Leer consolidado · Agregar fila consolidado · Leer consolidado (comandos) · Borrar fila |
| **GitHub API** (4) | Leer referencias.bib · Escribir referencias.bib · Leer referencias.bib (comandos) · Escribir referencias.bib (comandos) |
| **Google Docs OAuth2** (3) | Crear nota · Escribir nota · Leer nota (comandos) |
| **Anthropic** *o* **Google Gemini(PaLM)** (1) | Modelo Anthropic *o* Modelo Gemini |

⚠️ **Elige siempre la credencial existente del desplegable, no crees una
nueva.** Al abrir un nodo de Telegram, n8n a veces ofrece crear una credencial
en blanco; si aceptas, quedan dos con el mismo aspecto y el nodo habla con otro
bot. Ponle nombre a tus credenciales (`Telegram Bot Memoria`, no *Unnamed
credential*) para poder distinguirlas de un vistazo.

### 5.3 Rellenar los 4 valores propios

| Valor | Nodos | De dónde sale |
|---|---|---|
| `REEMPLAZAR_ID_DE_LA_PLANILLA` | Leer consolidado · Agregar fila consolidado | El ID en la URL de tu planilla (§4) |
| `REEMPLAZAR_USUARIO_GITHUB` | Leer referencias.bib · Escribir referencias.bib | Tu usuario u organización de GitHub |
| `REEMPLAZAR_REPO_OVERLEAF` | Leer referencias.bib · Escribir referencias.bib | El repo que sincroniza con Overleaf (§3) |
| `folderId` (opcional) | Crear nota | ID de una carpeta de Drive; `default` = raíz |

**Sólo esos.** Los nodos de la rama de comandos —`Leer consolidado (comandos)`,
`Borrar fila`, `Leer/Escribir referencias.bib (comandos)`— **no** hay que
configurarlos: leen la planilla y el repo de los nodos de arriba mediante
`$('Nodo').params`. Si mañana cambias de planilla, cambias un sitio y todo lo
demás sigue.

⚠️ **Después de tocar la planilla o la pestaña en un nodo de Sheets, revisa
`Agregar fila consolidado`.** Cambiar el documento reinicializa el componente
completo y el **Mapping Column Mode** vuelve a su valor de fábrica, *Map Each
Column Manually*. Tiene que quedar en **Map Automatically**, y ése es el ajuste
que va **al final**, cuando ya no vayas a tocar planilla ni pestaña.

### 5.4 Si estás actualizando un flujo que ya funcionaba

Los pasos de arriba valen igual, pero **antes de importar nada**:

1. **Guarda una copia del flujo actual.** Abre el workflow viejo, clic en el
   lienzo, **Ctrl+A** y **Ctrl+C**, y pega en un archivo de texto. Ahí quedan
   tus IDs, tu repo y tus ajustes, por si necesitas consultarlos.
2. **Importa en un workflow NUEVO**, no encima del que anda. El viejo se queda
   publicado y respondiendo mientras armas el nuevo.
3. Configura el nuevo con §5.2 y §5.3.
4. Cuando esté listo: **despublica el viejo primero**, y recién entonces
   publica el nuevo.

> El orden del paso 4 importa. Telegram acepta **un solo webhook por bot**: si
> publicas el nuevo con el viejo aún publicado, el registro del webhook se
> pisa y puedes quedarte sin ninguno de los dos respondiendo. Despublicar
> primero deja el terreno limpio.

Cuando confirmes que el nuevo funciona, borra el viejo.

### 5.5 Publicar

Botón **Publish** arriba a la derecha. Ese es el momento en que el Telegram
Trigger registra el webhook con Telegram; hasta entonces el bot no responde a
mensajes reales.

> Necesitas que tu n8n sea alcanzable desde internet por HTTPS. Si lo
> autohospedas, mira `autohospedaje/` — hay un túnel de Cloudflare listo, y uno
> temporal para probar sin dominio.

### 5.6 Comprobar que quedó bien

Escríbele `/start` al bot. Si responde con el menú, están funcionando la
credencial de Telegram, el webhook, la validación de tu chat y la lectura de la
planilla — o sea, media instalación en un solo mensaje.

Después manda un DOI de acceso abierto, por ejemplo:

```
https://doi.org/10.3390/en14164935
```

La respuesta con `Resumen: OK` confirma el resto: Crossref, el modelo, GitHub,
Docs y Sheets. Si algo falla, §7 tiene los errores frecuentes con su causa
exacta.

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

---

## 7. Errores frecuentes y su causa

Ve a **Executions** en n8n y abre la ejecución. Los nodos que fallaron pero no
cortaron el flujo aparecen en amarillo: haz click y mira el campo `error`. Los
nodos externos tienen reintentos y `continueOnFail` donde corresponde, así que
la mayoría de las fallas se ven como campos vacíos, no como flujo caído.

Esta tabla recoge errores reales de puesta en marcha. Casi ninguno dice lo que
en realidad pasa.

| El error dice | Lo que pasa de verdad |
|---|---|
| `At least one value has to be added under 'Values to Send'` | No falta ningún dato: el **Mapping Column Mode** de `Agregar fila consolidado` se reseteó a *Map Each Column Manually*. Vuelve a ponerlo en **Map Automatically** — y hazlo al final, después de fijar planilla y pestaña |
| `can't parse entities: Can't find end of the entity` | Falta `Parse Mode = HTML` en un nodo de Telegram. Sin él, el nodo manda **Markdown legacy** por su cuenta, y un guion bajo de un link de Docs abre una cursiva que nunca cierra |
| `can't parse entities: Unexpected end tag` | El campo `Text` quedó en modo **Fixed**. Se está enviando el texto de la expresión tal cual, y Telegram choca con el `</` de un `.replace(/</g, …)`. Pásalo a **Expression** |
| `Bad Request: invalid file_id` | El nodo habla con **otro bot**. Los `file_id` son privados de cada bot. Comprueba que la credencial sea la misma del `Telegram Trigger` — dos credenciales sin nombre se ven idénticas en el desplegable |
| `A Model sub-node must be connected and enabled` | Activaste **Auto-Fix Format** en el parser. Eso le agrega una entrada `Model` obligatoria: conéctale el mismo sub-nodo de modelo que alimenta `Resumir con LLM` |
| `Model output doesn't fit required format`, y en la entrada se ve prosa cortada | El modelo se quedó sin presupuesto. **Gemini cuenta el razonamiento dentro de `maxOutputTokens`**; súbelo a `8192` en el sub-nodo del modelo |
| `Chat autorizado?` siempre da `false` | Compara el `chat.id` del mensaje contra `$env.BIBLIO_TELEGRAM_CHAT_ID`. El error típico es haber anotado el **id del bot** (el número antes de los dos puntos del token) en vez del tuyo |
| El bot no responde a nada | El workflow no está publicado, o la URL pública de n8n no coincide con la que Telegram tiene registrada. Republicar re-registra el webhook |
| El flujo usa siempre la misma fuente | Quedaron **datos pineados** en el `Telegram Trigger`. Quita la chincheta |
| `404 NOT_FOUND` en un nodo de Google | El ID de la planilla o del documento. Cambia el selector a *From list* y elige de la lista |
| `invalid_client` al conectar Google | El Client ID o el Secret no calzan. El ID termina en `.apps.googleusercontent.com` y el secret empieza con `GOCSPX-` |
| La sesión de Google se cae a los 7 días | El proyecto de Google Cloud quedó en estado *Testing*. Publícalo a *Production* |

### Cuando el error no es un error

Tres resultados parecen fallas y son el comportamiento diseñado:

- **`estado_resumen = PENDIENTE`.** La fuente no se pudo leer: muro de pago,
  bloqueo anti-bots o PDF escaneado. La referencia queda registrada igual, con
  metadatos correctos de Crossref. El bot te dice el motivo en el mensaje.
- **`bib: sin cambios (X ya estaba)`.** Segunda capa de idempotencia. Reenviar
  el mismo link no duplica la entrada.
- **`metadatos_manuales = SÍ`.** No hubo DOI ni coincidencia fiable en
  Crossref. El flujo prefiere quedarse sin metadatos antes que inventarlos:
  hay que completarlos a mano.

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
