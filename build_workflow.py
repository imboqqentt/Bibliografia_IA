#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera workflow.json a partir de los archivos de code/.

Se mantiene el codigo de los nodos Code en archivos .js separados y se inyecta
aqui, para no tener que editar JavaScript escapado dentro de un JSON gigante.

Uso:  python3 build_workflow.py                       -> workflow.json (Anthropic)
      LLM_PROVEEDOR=gemini python3 build_workflow.py  -> workflow-gemini.json
"""

import io
import re
import json
import os
import uuid

BASE = os.path.dirname(os.path.abspath(__file__))
CODE = os.path.join(BASE, "code")

# Correo para el "polite pool" de Crossref.
#
# No es un secreto: Crossref pide explicitamente que vaya visible en el
# User-Agent o en el parametro mailto. Pero tampoco tiene por que quedar
# incrustado en un repositorio publico, asi que se lee en tiempo de ejecucion
# desde la variable de entorno CROSSREF_MAILTO (igual que el chat de Telegram).
#
# Si la variable no esta definida, Crossref responde igual: pierdes el acceso
# al pool prioritario y las consultas van algo mas lentas, nada mas.
MAILTO = "={{ $env.CROSSREF_MAILTO }}"
USER_AGENT = "=BibliografiaMemoria/1.0 (mailto:{{ $env.CROSSREF_MAILTO }})"

# Placeholders que hay que reemplazar tras importar (ver README)
ID_PLANILLA = "REEMPLAZAR_ID_DE_LA_PLANILLA"
PESTANA = "Consolidado"
GH_OWNER = "REEMPLAZAR_USUARIO_GITHUB"
GH_REPO = "REEMPLAZAR_REPO_OVERLEAF"
BIB_PATH = "referencias.bib"


def js(nombre):
    with io.open(os.path.join(CODE, nombre), encoding="utf-8") as fh:
        return fh.read()


def nid(semilla):
    """UUID estable por nombre de nodo, para que regenerar no mueva los ids."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "n8n-biblio/" + semilla))


def cond_bool(expr):
    """Condicion booleana 'es verdadero' del nodo If v2."""
    return {
        "options": {"caseSensitive": True, "leftValue": "",
                    "typeValidation": "loose", "version": 2},
        "conditions": [{
            "id": nid("cond/" + expr),
            "leftValue": expr,
            "rightValue": "",
            "operator": {"type": "boolean", "operation": "true", "singleValue": True},
        }],
        "combinator": "and",
    }


def cond_str(izq, op, der):
    return {
        "options": {"caseSensitive": False, "leftValue": "",
                    "typeValidation": "loose", "version": 2},
        "conditions": [{
            "id": nid("cond/" + izq + op + der),
            "leftValue": izq,
            "rightValue": der,
            "operator": {"type": "string", "operation": op},
        }],
        "combinator": "and",
    }


def node(name, ntype, tv, pos, params, **extra):
    n = {
        "parameters": params,
        "id": nid(name),
        "name": name,
        "type": ntype,
        "typeVersion": tv,
        "position": list(pos),
    }
    n.update(extra)
    return n


def code_node(name, archivo, pos, notes):
    return node(
        name, "n8n-nodes-base.code", 2, pos,
        {"mode": "runOnceForAllItems", "jsCode": js(archivo)},
        notes=notes,
    )


# ---------------------------------------------------------------------------
# Proveedor del modelo de lenguaje
# ---------------------------------------------------------------------------
# El LLM es una PIEZA INTERCAMBIABLE. Cuelga del nodo "Resumir con LLM" por una
# conexion de tipo ai_languageModel y no toca ningun otro nodo: los metadatos
# bibliograficos salen de Crossref, no del modelo. Cambiar de proveedor es
# cambiar este sub-nodo y nada mas.
#
# Por eso el script genera DOS archivos importables:
#
#   workflow.json         -> Anthropic (Claude). Requiere credito en la API.
#   workflow-gemini.json  -> Google Gemini. Tiene capa gratuita.
#
# Se importa uno de los dos, no los dos.

PROVEEDORES = {
    "anthropic": {
        "nodo": "Modelo Anthropic",
        "archivo": "workflow.json",
        "tipo": "@n8n/n8n-nodes-langchain.lmChatAnthropic",
        "typeVersion": 1.3,
        "parametros": {
            "model": {"__rl": True, "value": "claude-sonnet-4-6", "mode": "list",
                      "cachedResultName": "claude-sonnet-4-6"},
            "options": {"maxTokensToSample": 2048, "temperature": 0.2},
        },
        "credenciales": {"anthropicApi": {"id": "REEMPLAZAR",
                                          "name": "Anthropic Memoria"}},
        "notas": "Si tu version de n8n no lista este modelo, elige otro del "
                 "desplegable.",
    },
    "gemini": {
        "nodo": "Modelo Gemini",
        "archivo": "workflow-gemini.json",
        "tipo": "@n8n/n8n-nodes-langchain.lmChatGoogleGemini",
        # La v1.1 existe y trae por defecto un modelo en preview. Se fija la v1
        # a proposito: es la que garantiza el modelo estable de abajo.
        "typeVersion": 1,
        "parametros": {
            # gemini-2.5-flash esta en la capa gratuita y tiene contexto de
            # sobra para los 45.000 caracteres que manda el flujo.
            "modelName": "models/gemini-2.5-flash",
            "options": {"maxOutputTokens": 2048, "temperature": 0.2},
        },
        # Ojo con el nombre: la credencial se llama "Google Gemini(PaLM) Api"
        # en la interfaz, por razones historicas. Es la correcta.
        "credenciales": {"googlePalmApi": {"id": "REEMPLAZAR",
                                           "name": "Google Gemini Memoria"}},
        "notas": "Capa gratuita de Google AI Studio. Si el desplegable no lista "
                 "el modelo, elige cualquier otro *-flash.",
    },
}

PROVEEDOR = os.environ.get("LLM_PROVEEDOR", "anthropic")
if PROVEEDOR not in PROVEEDORES:
    raise SystemExit("LLM_PROVEEDOR debe ser uno de: %s"
                     % ", ".join(sorted(PROVEEDORES)))
LLM = PROVEEDORES[PROVEEDOR]


def nodo_modelo():
    return node(
        LLM["nodo"], LLM["tipo"], LLM["typeVersion"], (3340, 560),
        LLM["parametros"],
        credentials=LLM["credenciales"],
        notes=LLM["notas"],
    )


# ---------------------------------------------------------------------------
# Mensajes de Telegram
# ---------------------------------------------------------------------------
# TRAMPA: el nodo de Telegram NUNCA manda texto plano.
#
# En addAdditionalFields() de nodes-base/nodes/Telegram/GenericFunctions.ts hay
# esto:
#
#     if (!additionalFields.parse_mode) {
#         additionalFields.parse_mode = 'Markdown';
#     }
#
# O sea: si no eliges modo, el nodo te pone Markdown legacy por su cuenta. No
# hay opcion "sin formato" en el desplegable, y dejarlo vacio no sirve porque
# '' es falsy y cae en ese mismo if.
#
# Con Markdown legacy, un solo guion bajo suelto abre una cursiva que nunca se
# cierra y Telegram responde 400 "can't parse entities". Los links de Google
# Docs traen guiones bajos y guiones a menudo, asi que reventaba casi siempre.
#
# La salida es HTML, que es el modo que Telegram recomienda y donde solo tres
# caracteres son especiales:
#
#     "All <, > and & symbols that are not a part of a tag or an HTML entity
#      must be replaced with the corresponding HTML entities"
#     -- https://core.telegram.org/bots/api#html-style
#
# Asi que va parse_mode HTML explicito y TODO valor interpolado pasa por
# tg_esc(). Escapar de mas es inofensivo; escapar de menos rompe el mensaje.

PARSE_MODE_TELEGRAM = "HTML"


def tg_esc(expresion):
    """Interpola un valor en un mensaje de Telegram escapando para HTML.

    El orden importa: el & va primero, si no se re-escaparia el & de las
    entidades que acaba de generar.
    """
    return ("{{ String(%s ?? '')"
            ".replace(/&/g, '&amp;')"
            ".replace(/</g, '&lt;')"
            ".replace(/>/g, '&gt;') }}" % expresion)


# ---------------------------------------------------------------------------
# Prompt del LLM
# ---------------------------------------------------------------------------
# Se le entregan los metadatos SOLO como contexto para que el resumen sea
# coherente; se le prohibe explicitamente devolverlos o corregirlos.
PROMPT = """=Eres un asistente de investigacion para una memoria de titulo de Ingenieria Mecanica.

REGLAS ESTRICTAS
1. Responde SIEMPRE en espanol de Chile, en registro tecnico y sobrio.
2. NO inventes ni corrijas datos bibliograficos. Autores, anio, revista y tipo
   ya fueron obtenidos de Crossref y NO son parte de tu tarea. Si el texto
   contradice los metadatos, ignoralo: tu unica tarea es resumir el contenido.
3. Si el texto de la fuente esta incompleto o truncado, resume solo lo que
   efectivamente aparece y dilo en el resumen. No rellenes con suposiciones.
4. Devuelve unicamente el JSON pedido, sin texto adicional.

METADATOS DE LA FUENTE (contexto, no los repitas en tu respuesta)
- Titulo: {{ $json.titulo }}
- Autores: {{ $json.autores_texto || 'no disponibles' }}
- Anio: {{ $json.anio || 'no disponible' }}
- Publicacion: {{ $json.publicacion || 'no disponible' }}
- Tipo: {{ $json.tipo_crossref }}

CAMPOS QUE DEBES PRODUCIR
- resumen: entre 200 y 300 palabras. Estructuralo en cuatro focos, en prosa
  continua (sin vinetas ni titulos): objetivo del trabajo, metodo o enfoque
  experimental/numerico, resultados principales con cifras cuando existan, y
  limitaciones o alcances declarados.
- descripcion_breve: UNA sola linea, maximo 15 palabras, sin punto final.
- palabras_clave: entre 3 y 5 terminos tecnicos en espanol.
- utilidad: UNA linea sobre para que sirve esta fuente en una memoria de
  Ingenieria Mecanica (que capitulo o argumento podria sustentar).

TEXTO DE LA FUENTE
<<<
{{ $json.texto_fuente }}
>>>"""

ESQUEMA_RESUMEN = json.dumps({
    "type": "object",
    "required": ["resumen", "descripcion_breve", "palabras_clave", "utilidad"],
    # A proposito SIN "additionalProperties": false.
    #
    # El parser valida la respuesta contra este esquema y, si no calza, el nodo
    # falla entero y la referencia se queda sin resumen. Con la restriccion, un
    # modelo que agregue un campo de mas —cosa que hacen— tumbaba todo el
    # resumen por un dato que "Consolidar registro" ni siquiera lee: ese nodo
    # toma los cuatro campos por nombre y descarta el resto.
    #
    # Fallar por un extra inofensivo es un mal negocio. Los cuatro que importan
    # siguen siendo obligatorios via "required".
    "properties": {
        "resumen": {
            "type": "string",
            "description": "Resumen en espanol de 200 a 300 palabras: objetivo, metodo, resultados y limitaciones.",
        },
        "descripcion_breve": {
            "type": "string",
            "description": "Una sola linea, maximo 15 palabras, sin punto final.",
        },
        "palabras_clave": {
            "type": "array",
            "minItems": 3,
            "maxItems": 5,
            "items": {"type": "string"},
            "description": "Entre 3 y 5 terminos tecnicos en espanol.",
        },
        "utilidad": {
            "type": "string",
            "description": "Una linea sobre su utilidad en una memoria de Ingenieria Mecanica.",
        },
    },
}, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Nodos
# ---------------------------------------------------------------------------
nodes = []

nodes.append(node(
    "Telegram Trigger", "n8n-nodes-base.telegramTrigger", 1.2, (-800, 300),
    {"updates": ["message"], "additionalFields": {}},
    credentials={"telegramApi": {"id": "REEMPLAZAR", "name": "Telegram Bot Memoria"}},
    notes="Opcional: en Additional Fields > Restrict to Chat IDs puedes poner tu chat_id "
          "como segunda barrera. La validacion obligatoria la hace el nodo siguiente.",
    webhookId=nid("webhook/telegram"),
))

nodes.append(node(
    "Chat autorizado?", "n8n-nodes-base.if", 2.2, (-580, 300),
    {"conditions": cond_str(
        "={{ String($json.message?.chat?.id ?? $json.edited_message?.chat?.id ?? '') }}",
        "equals",
        "={{ String($env.BIBLIO_TELEGRAM_CHAT_ID ?? '').trim() }}",
    ), "options": {}},
    notes="Solo responde a tu chat. Falla cerrado: si la variable de entorno no existe, "
          "no coincide nada. En n8n Cloud ($env bloqueado) reemplaza el lado derecho "
          "por tu chat_id literal.",
))

nodes.append(node(
    "Ignorar mensaje", "n8n-nodes-base.noOp", 1, (-360, 480), {},
    notes="Remitente no autorizado: el flujo termina aqui sin responder.",
))

nodes.append(code_node("Normalizar entrada", "01-normalizar-entrada.js", (-360, 280),
                       "Extrae URL y DOI del mensaje. Sin llamadas externas."))

nodes.append(node(
    "Hay URL?", "n8n-nodes-base.if", 2.2, (-140, 280),
    {"conditions": cond_bool("={{ $json.hay_url_descarga }}"), "options": {}},
))

nodes.append(node(
    "Descargar fuente", "n8n-nodes-base.httpRequest", 4.2, (80, 180),
    {
        "url": "={{ $json.url_descarga }}",
        "sendHeaders": True,
        "headerParameters": {"parameters": [
            {"name": "User-Agent",
             "value": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"},
            {"name": "Accept",
             "value": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8"},
            {"name": "Accept-Language", "value": "es-CL,es;q=0.9,en;q=0.8"},
        ]},
        "options": {
            "timeout": 60000,
            "response": {"response": {
                "responseFormat": "file",
                "outputPropertyName": "data",
                "neverError": True,
            }},
        },
    },
    retryOnFail=True, maxTries=3, waitBetweenTries=3000,
    onError="continueRegularOutput", alwaysOutputData=True,
    notes="neverError + continueRegularOutput: un paywall o un 403 no puede romper el flujo.",
))

nodes.append(node(
    "Es PDF?", "n8n-nodes-base.if", 2.2, (300, 180),
    {"conditions": cond_str(
        "={{ String($binary?.data?.mimeType || '') + '|' + "
        "String($binary?.data?.fileExtension || '') + '|' + "
        "String($('Normalizar entrada').first().json.url_descarga || '') }}",
        "contains", "pdf",
    ), "options": {}},
    notes="Mira el mime type, la extension y la URL: algunos servidores mandan PDF "
          "con content-type generico.",
))

nodes.append(node(
    "Extraer texto PDF", "n8n-nodes-base.extractFromFile", 1.1, (520, 80),
    {"operation": "pdf", "binaryPropertyName": "data", "options": {"joinPages": True}},
    onError="continueRegularOutput", alwaysOutputData=True,
    notes="PDF escaneado sin capa de texto -> sale vacio y el resumen queda PENDIENTE.",
))

nodes.append(node(
    "Extraer texto HTML", "n8n-nodes-base.extractFromFile", 1.1, (520, 280),
    {"operation": "text", "binaryPropertyName": "data", "destinationKey": "data",
     "options": {}},
    onError="continueRegularOutput", alwaysOutputData=True,
    notes="Devuelve el HTML crudo en $json.data; el nodo siguiente lo limpia y le "
          "saca las meta tags citation_doi / citation_title.",
))

nodes.append(code_node("Preparar texto", "02-preparar-texto.js", (740, 280),
                       "Limpia el texto, lo trunca y rescata DOI/titulo desde las meta tags."))

nodes.append(node(
    "Falta DOI?", "n8n-nodes-base.if", 2.2, (960, 280),
    {"conditions": cond_bool(
        "={{ !$json.tiene_doi && (String($json.titulo_hint || '').length > 8 || "
        "String($json.titulo_pagina || '').length > 8) }}"), "options": {}},
    notes="Solo busca por titulo si no hay DOI Y hay algun titulo utilizable.",
))

nodes.append(node(
    "Crossref buscar por titulo", "n8n-nodes-base.httpRequest", 4.2, (1180, 180),
    {
        "url": "https://api.crossref.org/works",
        "sendQuery": True,
        "queryParameters": {"parameters": [
            {"name": "query.bibliographic",
             "value": "={{ String($json.titulo_hint || $json.titulo_pagina || '').slice(0, 300) }}"},
            {"name": "rows", "value": "5"},
            {"name": "select", "value": "DOI,title,author,issued,container-title,type"},
            {"name": "mailto", "value": MAILTO},
        ]},
        "sendHeaders": True,
        "headerParameters": {"parameters": [{"name": "User-Agent", "value": USER_AGENT}]},
        "options": {"timeout": 30000,
                    "response": {"response": {"neverError": True}}},
    },
    retryOnFail=True, maxTries=3, waitBetweenTries=2000,
    onError="continueRegularOutput", alwaysOutputData=True,
    notes="Polite pool de Crossref: mailto en la query y correo en el User-Agent.",
))

nodes.append(code_node("Elegir candidato Crossref", "03-elegir-candidato-crossref.js",
                       (1400, 180),
                       "Acepta el DOI solo si la similitud de titulo supera el umbral."))

nodes.append(node("Unificar DOI", "n8n-nodes-base.noOp", 1, (1620, 280), {},
                  notes="Punto de encuentro de las dos ramas de resolucion de DOI."))

nodes.append(node(
    "Hay DOI?", "n8n-nodes-base.if", 2.2, (1840, 280),
    {"conditions": cond_bool("={{ $json.tiene_doi }}"), "options": {}},
))

nodes.append(node(
    "Crossref metadatos", "n8n-nodes-base.httpRequest", 4.2, (2060, 180),
    {
        "url": "=https://api.crossref.org/works/{{ $json.doi }}",
        "sendQuery": True,
        "queryParameters": {"parameters": [{"name": "mailto", "value": MAILTO}]},
        "sendHeaders": True,
        "headerParameters": {"parameters": [{"name": "User-Agent", "value": USER_AGENT}]},
        "options": {"timeout": 30000,
                    "response": {"response": {"neverError": True}}},
    },
    retryOnFail=True, maxTries=3, waitBetweenTries=2000,
    onError="continueRegularOutput", alwaysOutputData=True,
    notes="FUENTE UNICA de autores, anio, revista, volumen, numero, paginas y tipo. "
          "Si devuelve 404, el flujo sigue y marca metadatos_manuales = SI.",
))

nodes.append(code_node("Normalizar metadatos", "04-normalizar-metadatos.js", (2280, 280),
                       "Crossref -> campos planos + mapeo type -> tipo de entrada BibTeX."))

nodes.append(node(
    "Leer consolidado", "n8n-nodes-base.googleSheets", 4.5, (2500, 280),
    {
        "documentId": {"__rl": True, "value": ID_PLANILLA, "mode": "id"},
        "sheetName": {"__rl": True, "value": PESTANA, "mode": "name"},
        "options": {},
    },
    retryOnFail=True, maxTries=3, waitBetweenTries=2000, alwaysOutputData=True,
    credentials={"googleSheetsOAuth2Api": {"id": "REEMPLAZAR", "name": "Google Sheets Memoria"}},
    notes="A proposito SIN continueOnFail: si no se puede leer el consolidado hay que "
          "detenerse, porque sin el no se puede deduplicar y se duplicarian filas.",
))

nodes.append(code_node("Dedupe y citation key", "05-dedupe-y-citation-key.js", (2720, 280),
                       "Detecta duplicados por DOI/URL y genera la citation key con sufijo."))

nodes.append(node(
    "Ya registrado?", "n8n-nodes-base.if", 2.2, (2940, 280),
    {"conditions": cond_bool("={{ $json.duplicado }}"), "options": {}},
))

nodes.append(node(
    "Avisar duplicado", "n8n-nodes-base.telegram", 1.2, (3160, 160),
    {
        "chatId": "={{ $('Telegram Trigger').first().json.message.chat.id }}",
        "text": "=Ya registrado, citation key: "
                + tg_esc("$json.citation_key_existente") + "\n\n"
                + tg_esc("$json.fila_duplicada_titulo") + "\n"
                + tg_esc("$json.fila_duplicada_link_nota"),
        "additionalFields": {"appendAttribution": False,
                             "disable_web_page_preview": True,
                             "parse_mode": PARSE_MODE_TELEGRAM},
    },
    retryOnFail=True, maxTries=3,
    credentials={"telegramApi": {"id": "REEMPLAZAR", "name": "Telegram Bot Memoria"}},
    notes="Fin del flujo: no se escribe nada en .bib, Docs ni Sheets.",
))

nodes.append(node(
    "Hay texto para resumir?", "n8n-nodes-base.if", 2.2, (3160, 400),
    {"conditions": cond_bool("={{ $json.texto_suficiente }}"), "options": {}},
    notes="Si no hay texto util, se salta el LLM y la referencia se registra igual "
          "con estado_resumen = PENDIENTE.",
))

nodes.append(node(
    "Resumir con LLM", "@n8n/n8n-nodes-langchain.chainLlm", 1.5, (3400, 320),
    {"promptType": "define", "text": PROMPT, "hasOutputParser": True, "batching": {}},
    retryOnFail=True, maxTries=2, waitBetweenTries=5000,
    onError="continueRegularOutput", alwaysOutputData=True,
    notes="El LLM SOLO redacta resumen, descripcion breve, palabras clave y utilidad.",
))

nodes.append(nodo_modelo())

nodes.append(node(
    "Formato JSON del resumen", "@n8n/n8n-nodes-langchain.outputParserStructured", 1.2,
    (3560, 560),
    {
        "schemaType": "manual",
        "inputSchema": ESQUEMA_RESUMEN,
        # autoFix viene en false de fabrica: si el modelo devuelve algo que no
        # calza —lo tipico es envolver el JSON en ```json ... ``` o agregar una
        # frase antes— el parser tira error y la referencia se queda sin
        # resumen.
        #
        # En true, n8n hace UNA llamada extra al modelo pasandole la salida
        # mala y el error, para que la corrija. Solo se gasta cuando el primer
        # intento fallo, asi que en la practica es gratis y convierte un fallo
        # duro en un reintento.
        "autoFix": True,
    },
    notes="Auto-Fix Format activado: un JSON mal formado se reintenta en vez de "
          "perder el resumen.",
))

nodes.append(code_node("Consolidar registro", "06-consolidar-registro.js", (3800, 400),
                       "Arma la entrada BibTeX con escapado LaTeX y el cuerpo de la nota."))

nodes.append(node(
    "Leer referencias.bib", "n8n-nodes-base.github", 1.1, (4020, 400),
    {
        "resource": "file", "operation": "get",
        "owner": {"__rl": True, "value": GH_OWNER, "mode": "name"},
        "repository": {"__rl": True, "value": GH_REPO, "mode": "name"},
        "filePath": BIB_PATH,
        "asBinaryProperty": False,
    },
    retryOnFail=True, maxTries=3, waitBetweenTries=2000,
    onError="continueRegularOutput", alwaysOutputData=True,
    credentials={"githubApi": {"id": "REEMPLAZAR", "name": "GitHub Memoria"}},
    notes="Lee de la rama por defecto del repo. El archivo debe existir (aunque este vacio).",
))

nodes.append(code_node("Construir bib actualizado", "07-construir-bib-actualizado.js",
                       (4240, 400),
                       "Append idempotente + resolucion final de la citation key."))

nodes.append(node(
    "Escribir referencias.bib", "n8n-nodes-base.github", 1.1, (4460, 400),
    {
        "resource": "file", "operation": "edit",
        "owner": {"__rl": True, "value": GH_OWNER, "mode": "name"},
        "repository": {"__rl": True, "value": GH_REPO, "mode": "name"},
        "filePath": BIB_PATH,
        "binaryData": False,
        "fileContent": "={{ $json.contenido_base64 }}",
        "commitMessage": "={{ $json.commit_message }}",
        "additionalParameters": {},
    },
    retryOnFail=True, maxTries=3, waitBetweenTries=3000,
    credentials={"githubApi": {"id": "REEMPLAZAR", "name": "GitHub Memoria"}},
    notes="El nodo resuelve el SHA solo. El contenido va en base64 para evitar el error "
          "'content is not valid Base64' con acentos y llaves.",
))

nodes.append(node(
    "Crear nota", "n8n-nodes-base.googleDocs", 2, (4680, 400),
    {"resource": "document", "operation": "create", "driveId": "myDrive",
     "folderId": "default", "title": "={{ $json.nota_titulo }}"},
    retryOnFail=True, maxTries=3, waitBetweenTries=2000,
    credentials={"googleDocsOAuth2Api": {"id": "REEMPLAZAR", "name": "Google Docs Memoria"}},
    notes="folderId 'default' = raiz de Mi unidad. Cambialo por el ID de tu carpeta "
          "'Notas de lectura' para tenerlo ordenado.",
))

nodes.append(node(
    "Escribir nota", "n8n-nodes-base.googleDocs", 2, (4900, 400),
    {
        "resource": "document", "operation": "update",
        "documentURL": "={{ $json.documentId || $json.id }}",
        "simple": False,
        "actionsUi": {"actionFields": [{
            "object": "text", "action": "insert",
            "text": "={{ $('Construir bib actualizado').first().json.nota_texto }}",
        }]},
    },
    retryOnFail=True, maxTries=3, waitBetweenTries=2000,
    credentials={"googleDocsOAuth2Api": {"id": "REEMPLAZAR", "name": "Google Docs Memoria"}},
    notes="La nota NO lleva la entrada BibTeX: esa vive solo en referencias.bib.",
))

nodes.append(code_node("Preparar fila", "08-preparar-fila.js", (5120, 400),
                       "Emite exactamente las 14 columnas del consolidado."))

nodes.append(node(
    "Agregar fila consolidado", "n8n-nodes-base.googleSheets", 4.5, (5340, 400),
    {
        "operation": "append",
        "documentId": {"__rl": True, "value": ID_PLANILLA, "mode": "id"},
        "sheetName": {"__rl": True, "value": PESTANA, "mode": "name"},
        "columns": {
            "mappingMode": "autoMapInputData",
            "value": {},
            "matchingColumns": [],
            "schema": [],
            "attemptToConvertTypes": False,
            "convertFieldsToString": True,
        },
        "options": {},
    },
    retryOnFail=True, maxTries=3, waitBetweenTries=3000,
    credentials={"googleSheetsOAuth2Api": {"id": "REEMPLAZAR", "name": "Google Sheets Memoria"}},
    notes="Map Automatically: las claves del item deben calzar con los encabezados "
          "de la fila 1 de la pestana Consolidado.",
))

nodes.append(node(
    "Confirmar por Telegram", "n8n-nodes-base.telegram", 1.2, (5560, 400),
    {
        "chatId": "={{ $('Telegram Trigger').first().json.message.chat.id }}",
        "text": "=Registrado.\n\n"
                "Citation key: "
                + tg_esc("$('Construir bib actualizado').first().json.citation_key") + "\n"
                "Tipo BibTeX: "
                + tg_esc("$('Construir bib actualizado').first().json.bibtex_tipo") + "\n"
                "Resumen: "
                + tg_esc("$('Construir bib actualizado').first().json.estado_resumen")
                # Este texto lo escribo yo entero, no lleva datos de fuera, asi
                # que no necesita escapado.
                + "{{ $('Construir bib actualizado').first().json.metadatos_manuales === 'SI' "
                  "? '\\n\\nOJO: metadatos sin Crossref, revisalos a mano.' : '' }}"
                # Cuando el resumen queda PENDIENTE, decir POR QUE. Sin esto hay
                # que abrir n8n y revisar la ejecucion para enterarse de si fue
                # un paywall, un 403 o un PDF escaneado.
                + "{{ $('Construir bib actualizado').first().json.estado_resumen === 'PENDIENTE'"
                  " ? '\\nMotivo: ' + String($('Construir bib actualizado').first()"
                  ".json.motivo_sin_texto ?? 'sin detalle')"
                  ".replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')"
                  " : '' }}\n\n"
                "Nota: " + tg_esc("$('Preparar fila').first().json.link_nota"),
        "additionalFields": {"appendAttribution": False,
                             "disable_web_page_preview": True,
                             "parse_mode": PARSE_MODE_TELEGRAM},
    },
    retryOnFail=True, maxTries=3,
    credentials={"telegramApi": {"id": "REEMPLAZAR", "name": "Telegram Bot Memoria"}},
))

# --- Notas adhesivas -------------------------------------------------------
def sticky(name, pos, size, content, color=7):
    return node(name, "n8n-nodes-base.stickyNote", 1, pos,
                {"content": content, "height": size[1], "width": size[0], "color": color})


nodes.append(sticky("Nota entrada", (-820, 60), (740, 200), """## 1. Entrada y validacion
El bot recibe un link o un DOI suelto.
**Chat autorizado?** exige que `$env.BIBLIO_TELEGRAM_CHAT_ID`
sea igual a tu chat id. Falla cerrado.
En n8n Cloud reemplaza esa expresion por tu id literal.""", 4))

nodes.append(sticky("Nota lectura", (60, -60), (860, 200), """## 2. Descarga y lectura
Se descarga como binario y se decide PDF vs HTML.
Del HTML se rescatan `citation_doi` y `citation_title`,
que es como se obtiene el DOI en ScienceDirect / Springer.
Paywall, 403 o PDF escaneado -> el flujo sigue igual.""", 5))

nodes.append(sticky("Nota crossref", (940, 40), (700, 200), """## 3. DOI y metadatos
Sin DOI se busca por titulo en Crossref, con un umbral
de similitud estricto: antes sin DOI que con uno errado.
**Crossref metadatos** es la unica fuente de autores,
anio, revista y tipo. El LLM no toca esos campos.""", 3))

nodes.append(sticky("Nota dedupe", (2480, 40), (640, 200), """## 4. Deduplicacion
Se leen todas las filas del consolidado ANTES de
escribir nada y antes de gastar tokens.
Duplicado por DOI, o por URL normalizada si no hay DOI.
Reenviar el mismo link no duplica nada.""", 6))

nodes.append(sticky("Nota escritura", (3980, 160), (1100, 200), """## 5. Escritura
`.bib` en GitHub (read-modify-write con append idempotente),
nota en Google Docs, fila en Sheets, confirmacion por Telegram.
La citation key definitiva la fija **Construir bib actualizado**
y de ahi la toman la nota, la planilla y el mensaje.""", 7))


# ---------------------------------------------------------------------------
# Conexiones
# ---------------------------------------------------------------------------
def main(*destinos):
    """Una sola salida principal hacia N destinos."""
    return {"main": [[{"node": d, "type": "main", "index": 0} for d in destinos]]}


def rama(verdadero, falso):
    """Nodo If: salida 0 = true, salida 1 = false."""
    return {"main": [
        [{"node": verdadero, "type": "main", "index": 0}],
        [{"node": falso, "type": "main", "index": 0}],
    ]}


connections = {
    "Telegram Trigger": main("Chat autorizado?"),
    "Chat autorizado?": rama("Normalizar entrada", "Ignorar mensaje"),
    "Normalizar entrada": main("Hay URL?"),
    "Hay URL?": rama("Descargar fuente", "Preparar texto"),
    "Descargar fuente": main("Es PDF?"),
    "Es PDF?": rama("Extraer texto PDF", "Extraer texto HTML"),
    "Extraer texto PDF": main("Preparar texto"),
    "Extraer texto HTML": main("Preparar texto"),
    "Preparar texto": main("Falta DOI?"),
    "Falta DOI?": rama("Crossref buscar por titulo", "Unificar DOI"),
    "Crossref buscar por titulo": main("Elegir candidato Crossref"),
    "Elegir candidato Crossref": main("Unificar DOI"),
    "Unificar DOI": main("Hay DOI?"),
    "Hay DOI?": rama("Crossref metadatos", "Normalizar metadatos"),
    "Crossref metadatos": main("Normalizar metadatos"),
    "Normalizar metadatos": main("Leer consolidado"),
    "Leer consolidado": main("Dedupe y citation key"),
    "Dedupe y citation key": main("Ya registrado?"),
    "Ya registrado?": rama("Avisar duplicado", "Hay texto para resumir?"),
    "Hay texto para resumir?": rama("Resumir con LLM", "Consolidar registro"),
    "Resumir con LLM": main("Consolidar registro"),
    # El modelo alimenta DOS nodos, no uno.
    #
    # Con autoFix activado, el parser deja de ser una hoja del grafo: le crece
    # una entrada ai_languageModel *obligatoria*, porque la correccion del JSON
    # mal formado es otra llamada al modelo. Sin conectarla, el nodo falla con
    # "A Model sub-node must be connected and enabled" y se pierde el resumen,
    # que es justo lo que autoFix venia a evitar.
    #
    # Se reutiliza el mismo sub-nodo: misma credencial, mismo modelo.
    LLM["nodo"]: {"ai_languageModel": [[
        {"node": "Resumir con LLM", "type": "ai_languageModel", "index": 0},
        {"node": "Formato JSON del resumen", "type": "ai_languageModel", "index": 0},
    ]]},
    "Formato JSON del resumen": {"ai_outputParser": [
        [{"node": "Resumir con LLM", "type": "ai_outputParser", "index": 0}]]},
    "Consolidar registro": main("Leer referencias.bib"),
    "Leer referencias.bib": main("Construir bib actualizado"),
    "Construir bib actualizado": main("Escribir referencias.bib"),
    "Escribir referencias.bib": main("Crear nota"),
    "Crear nota": main("Escribir nota"),
    "Escribir nota": main("Preparar fila"),
    "Preparar fila": main("Agregar fila consolidado"),
    "Agregar fila consolidado": main("Confirmar por Telegram"),
}

workflow = {
    # El proveedor va en el nombre para no confundir las dos variantes si
    # llegas a importar ambas por error.
    "name": "Bibliografia Memoria — Telegram a BibTeX (%s)" % PROVEEDOR,
    "nodes": nodes,
    "connections": connections,
    "pinData": {},
    "settings": {
        "executionOrder": "v1",
        "saveManualExecutions": True,
        "saveExecutionProgress": True,
        "callerPolicy": "workflowsFromSameOwner",
    },
}

# ---------------------------------------------------------------------------
# Validaciones antes de escribir
# ---------------------------------------------------------------------------
nombres = [n["name"] for n in nodes]
assert len(nombres) == len(set(nombres)), "Hay nombres de nodo repetidos"

# Ningun nodo de Telegram puede quedarse sin parse_mode explicito: el nodo le
# pone Markdown legacy por su cuenta cuando falta, y ahi cualquier guion bajo
# de un link revienta el envio con un 400. Ver el comentario de tg_esc().
for n in nodes:
    if n["type"] == "n8n-nodes-base.telegram":
        modo = n["parameters"].get("additionalFields", {}).get("parse_mode")
        assert modo == PARSE_MODE_TELEGRAM, (
            "%s no fija parse_mode=%s" % (n["name"], PARSE_MODE_TELEGRAM))
        texto = n["parameters"].get("text", "")
        # Cada interpolacion tiene que venir escapada.
        crudas = [t for t in re.findall(r"\{\{(.*?)\}\}", texto, re.S)
                  if "replace(/&/g" not in t and "?" not in t]
        assert not crudas, "%s interpola sin escapar: %s" % (n["name"], crudas)

# Si el parser tiene autoFix, su entrada de modelo es obligatoria: la
# correccion del JSON es otra llamada al LLM. Olvidar el cable deja el nodo
# muerto con "A Model sub-node must be connected and enabled".
for n in nodes:
    if n["type"].endswith("outputParserStructured") and n["parameters"].get("autoFix"):
        destinos = [c["node"]
                    for salidas in connections.values()
                    for ramas in salidas.get("ai_languageModel", [])
                    for c in ramas]
        assert n["name"] in destinos, (
            "%s tiene autoFix pero ningun modelo conectado" % n["name"])

for origen, salidas in connections.items():
    assert origen in nombres, "Origen inexistente: %s" % origen
    for _tipo, ramas in salidas.items():
        for r in ramas:
            for c in r:
                assert c["node"] in nombres, "Destino inexistente: %s" % c["node"]

destino = os.path.join(BASE, LLM["archivo"])
with io.open(destino, "w", encoding="utf-8") as fh:
    fh.write(json.dumps(workflow, ensure_ascii=False, indent=2))

print("OK  %s  (%d nodos, %d conexiones, LLM: %s)"
      % (destino, len(nodes), len(connections), PROVEEDOR))
