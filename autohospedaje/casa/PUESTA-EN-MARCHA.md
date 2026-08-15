# Puesta en marcha en el PC de casa — paso a paso

Guía ordenada **por tiempo**, pensada para el caso concreto: PC de escritorio
con 16 GB, y el dominio llegando por el **GitHub Student Developer Pack** con
72 horas de espera desde la aprobación.

El `README.md` de esta carpeta es la referencia por tema. Esto es la secuencia.

---

## La idea que ordena todo

El dominio sirve para **una sola cosa**: que Telegram despierte el flujo por sí
mismo. Crossref, deduplicación, resumen, `.bib`, nota y planilla **no lo
necesitan**.

Por eso los bloques 1 a 3 se hacen hoy, sin esperar nada, y dejan el sistema
funcionando y probado. Cuando se habiliten los beneficios, sólo queda enchufar
el túnel: diez minutos, no una tarde.

| Bloque | Cuándo | Qué |
|---|---|---|
| 1 | Hoy | El PC: Ubuntu, BIOS, Docker |
| 2 | Hoy | Bot de Telegram y las 4 credenciales |
| 3 | Hoy | Levantar n8n y **probar el flujo entero** sin dominio |
| 4 | Día 3 | Canjear el dominio y delegarlo a Cloudflare |
| 5 | Día 3 | Crear el túnel |
| 6 | Día 3 | Activar y probar de verdad |
| 7 | Día 3 | Respaldo |

---

# BLOQUE 1 — El PC (hoy)

## 1.0 Decide primero: formatear o no

| | Ubuntu Server | El Windows que ya tiene |
|---|---|---|
| El PC queda | Dedicado al servidor | Igual que ahora |
| Vuelve solo tras un reinicio | **Siempre** | Sólo con inicio de sesión automático |
| Trabajo | Reinstalar el sistema | Media hora |

Si el PC está de verdad en desuso, **Ubuntu Server** y sigues con 1.1.

Si prefieres no tocarlo, es perfectamente viable: sigue **§1.3 del
[README de autohospedaje](../README.md)** (Docker Desktop sobre WSL2 más el
inicio de sesión automático) y vuelve acá directo al **bloque 2**. El resto de
la guía es idéntico; sólo cambia que trabajas desde la terminal de Ubuntu de
WSL en vez de por SSH.

## 1.1 Instalar Ubuntu Server

**Ubuntu Server, no Desktop.** El escritorio se come 1–2 GB de RAM dibujando
una pantalla que nunca vas a mirar.

1. Descarga *Ubuntu Server LTS* de [ubuntu.com](https://ubuntu.com/download/server).
2. Graba el pendrive con [Rufus](https://rufus.ie) o [balenaEtcher](https://etcher.balena.io).
3. Durante la instalación, **marca "Install OpenSSH server"**. Sin eso vas a
   tener que trabajar con teclado y monitor conectados al PC.
4. Anota el usuario que creaste.

## 1.2 El ajuste de BIOS que se olvida

Entra a la BIOS/UEFI (F2, Supr o F10 al arrancar, según la placa) y busca una
opción llamada **Restore on AC Power Loss**, *AC Back Function* o *After Power
Failure*. Déjala en **Power On**.

Sin esto, un corte de luz a las 3 de la mañana deja el bot muerto hasta que
llegues a casa a apretar el botón. Es el ajuste que separa "se cayó dos horas"
de "estuvo muerto una semana y no me di cuenta".

## 1.3 Averiguar la IP local y entrar por SSH

En el PC, conectado a teclado por última vez:

```bash
ip -4 addr show | grep inet
```

Anota la IP de tu red local (algo como `192.168.1.x`). Desde ahora trabajas
desde el notebook:

```bash
ssh tuusuario@192.168.1.x
```

> Conviene fijarle una IP en el router (*DHCP reservation*), o algún día
> cambiará y tendrás que buscarla de nuevo.

## 1.4 Docker y evitar la suspensión

```bash
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

docker --version && docker compose version

# Que no se suspenda nunca
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

## Checkpoint 1

- [ ] Entro por SSH desde el notebook
- [ ] `docker --version` y `docker compose version` responden
- [ ] BIOS configurada para encender sola tras corte de luz

---

# BLOQUE 2 — Bot y credenciales (hoy)

## 2.1 Bot de Telegram

1. Habla con [@BotFather](https://t.me/BotFather), manda `/newbot`.
2. Nombre visible y username terminado en `bot`.
3. Guarda el token: `8123456789:AAH...`
4. **Escríbele `/start` a tu bot.** Obligatorio: Telegram no deja que un bot
   inicie la conversación.
5. Abre `https://api.telegram.org/bot<TU_TOKEN>/getUpdates` y anota el número
   de `result[0].message.chat.id`.

## 2.2 Google: planilla y credenciales

Detalle completo en §4 del [README principal](../../README.md).

1. Planilla nueva, primera pestaña renombrada a **`Consolidado`**.
2. En la fila 1, los 14 encabezados exactos.
3. Anota el ID de la planilla (está en su URL).
4. En [console.cloud.google.com](https://console.cloud.google.com): proyecto
   nuevo, habilita **Google Sheets API**, **Google Docs API** y **Google Drive
   API**, y crea un **OAuth client ID** de tipo *Web application*.

> La URI de redirección te la muestra n8n al crear la credencial. Como todavía
> no tienes dominio, usa la de `http://localhost:5678` por ahora; la corriges
> en el bloque 5 si hiciera falta.

## 2.3 GitHub

1. Crea `referencias.bib` **vacío** en la rama por defecto del repo de tu
   memoria. Tiene que existir: el flujo hace *append*, no *create*.
2. Genera un **fine-grained personal access token** limitado a ese repo, con
   permiso `Contents: Read and write`. Nada más.

## 2.4 Anthropic

API key en [console.anthropic.com](https://console.anthropic.com) → *API Keys*.

## Checkpoint 2

- [ ] Token de Telegram y chat\_id anotados
- [ ] Planilla con la pestaña `Consolidado` y los 14 encabezados
- [ ] ID de la planilla anotado
- [ ] OAuth client de Google creado
- [ ] `referencias.bib` existe en el repo
- [ ] Token de GitHub y API key de Anthropic

---

# BLOQUE 3 — Levantar y probar sin dominio (hoy)

## 3.0 Qué estás a punto de hacer, en cristiano

Si no vienes del mundo de servidores, esto te va a ahorrar confusión.

**Docker** es una forma de correr programas que vienen ya empaquetados, sin
instalarlos ni configurarlos uno por uno. Cada programa corre aislado en lo que
se llama un **contenedor**: una cajita con todo lo que necesita adentro.

El archivo `docker-compose.yml` de esta carpeta es una **receta** que dice qué
cajitas levantar y cómo conectarlas. En nuestro caso, tres:

| Contenedor | Qué es |
|---|---|
| `postgres` | La base de datos. Guarda tus workflows y credenciales |
| `n8n` | La aplicación en sí, la que ves en el navegador |
| `cloudflared` | El túnel que deja que Telegram llegue. **Todavía no**, falta el dominio |

El archivo `.env` es donde van **tus** datos: contraseñas, tu chat de Telegram,
tu dominio. La receta lo lee al arrancar. Está en `.gitignore`, así que nunca se
sube a GitHub.

O sea que todo el trabajo se reduce a: bajar la receta, escribir tus datos en el
`.env`, y decirle a Docker que levante las cajitas.

**Dónde escribes esto:** en la terminal de **Ubuntu** (menú inicio → Ubuntu),
**no** en PowerShell. Docker Desktop corre en Windows, pero tú le hablas desde
Ubuntu — eso es lo que activaste con el interruptor de *WSL Integration*.

## 3.1 Bajar el proyecto

Abre **Ubuntu** y escribe:

```bash
cd ~
git clone https://github.com/imboqqentt/Bibliografia_IA.git
cd Bibliografia_IA/autohospedaje/casa
```

Qué hizo cada línea:

- `cd ~` te lleva a tu carpeta personal dentro de Ubuntu. **Importante**: no uses
  `/mnt/c/...` (el disco de Windows), ahí Docker anda mucho más lento.
- `git clone` descarga el proyecto desde GitHub.
- `cd` entra a la carpeta de la configuración para PC de casa.

Para confirmar que estás en el lugar correcto:

```bash
ls
```

Tienes que ver `docker-compose.yml`, `.env.example`, `README.md` y
`PUESTA-EN-MARCHA.md`.

## 3.2 Preparar tus datos

```bash
cp .env.example .env
```

`cp` copia. Acabas de crear tu `.env` personal a partir de la plantilla.

Ahora genera las dos claves. **Copia lo que imprima cada comando** — las vas a
pegar en un momento:

```bash
openssl rand -hex 32
openssl rand -base64 24
```

La primera es la clave con la que n8n cifra tus credenciales. La segunda es la
contraseña de la base de datos. Son solo texto aleatorio; no tienes que
memorizarlas ni entenderlas.

Ahora abre el archivo para editarlo:

```bash
nano .env
```

> **Cómo se usa nano**, porque acá se atasca todo el mundo la primera vez:
> te mueves con las flechas (el mouse no sirve), escribes normal, y al terminar:
> **Ctrl+O** y Enter para guardar, después **Ctrl+X** para salir.
> En la terminal de Ubuntu de Windows, **pegar es con clic derecho** o
> Ctrl+Shift+V.

Completa por ahora sólo estas cuatro:

| Variable | Valor |
|---|---|
| `N8N_ENCRYPTION_KEY` | el `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | el `openssl rand -base64 24` |
| `BIBLIO_TELEGRAM_CHAT_ID` | tu chat\_id |
| El bloque **LOCAL** de URL | **déjalo como está**: `http://localhost:5678`. Es lo que hace que el *Sign in with Google* vuelva a tu n8n y no a un dominio inexistente |

`CLOUDFLARE_TUNNEL_TOKEN` queda vacío: todavía no existe.

> **Guarda la `N8N_ENCRYPTION_KEY` en tu gestor de contraseñas**, además del
> `.env`. Sin ella, un respaldo de la base no te devuelve las credenciales.

## 3.3 Encender

Asegúrate de que **Docker Desktop esté abierto** (ícono de la ballena en la
barra de tareas, en verde). Si no lo está, los comandos van a fallar con
`Cannot connect to the Docker daemon`.

```bash
docker compose up -d postgres n8n
```

Desglose:

- `docker compose` lee la receta de esta carpeta.
- `up` significa "levanta esto".
- `-d` es *detached*: queda corriendo en segundo plano y te devuelve la terminal.
- `postgres n8n` limita a esos dos contenedores. **Dejamos `cloudflared` fuera a
  propósito**: sin el token del túnel se reiniciaría en bucle. Lo sumamos en el
  bloque 5.

> **La primera vez tarda varios minutos** porque descarga las imágenes (unos
> 500 MB). Vas a ver muchas barras de progreso. **No lo interrumpas** aunque
> parezca detenido. Las veces siguientes arranca en segundos.

Cuando termine, revisa que estén arriba:

```bash
docker compose ps
```

Tienes que ver los dos con estado `running`, y `postgres` además como `healthy`.

Y para ver qué está haciendo n8n por dentro:

```bash
docker compose logs -f n8n
```

Espera la línea `Editor is now accessible via...`. **Sal con Ctrl+C** — eso
cierra el visor de mensajes, *no* apaga n8n.

## 3.4 Abrir n8n

Como estás trabajando en el mismo PC, simplemente abre el navegador en:

**http://localhost:5678**

La primera vez te pide crear una cuenta de dueño de la instancia: correo y
contraseña. **Es local, tuya, no se registra en ningún servicio.** Anótala.

> Si más adelante quieres entrar desde el notebook sin exponer nada, se hace con
> un túnel SSH — está en §5 del [README de esta carpeta](README.md). Mientras
> trabajes en el propio PC no lo necesitas.

**Anota la versión de n8n:** menú `Help → About`.

## 3.5 Importar y conectar

1. Abre `workflow.json` del repo, copia todo y pega con **Ctrl+V** en el canvas.
2. Conecta las credenciales **por etapas**, no todas de golpe:
   - Telegram (los 3 nodos)
   - Anthropic
   - Google Sheets → pega el ID de la planilla en los dos nodos
   - GitHub → completa `owner` y `repository` en los dos nodos
   - Google Docs → ajusta `folderId` si quieres carpeta propia

## 3.6 Probar el flujo entero, sin webhook

Acá está la parte que mucha gente no sabe que se puede.

1. Abre el nodo **Telegram Trigger**.
2. En el panel OUTPUT, presiona la **chincheta** (*Pin data*) → **Edit Output**.
3. Pega el caso `1_articulo_con_doi` de
   [`test/telegram-pin-ejemplos.json`](../../test/telegram-pin-ejemplos.json)
   — sólo el objeto interno.
4. **Cambia los `id` de `from` y `chat` por tu chat\_id real.**
5. **Execute Workflow**.

El flujo corre completo: consulta Crossref, resume con Claude, escribe la
entrada en `referencias.bib`, crea la nota y agrega la fila.

Repite con los otros tres casos del archivo (DOI suelto, página sin DOI, chat
no autorizado).

> **Quita el pin al terminar**, o el flujo seguirá usando el mensaje falso.

## Checkpoint 3

- [ ] n8n accesible desde el notebook por túnel SSH
- [ ] Versión de n8n anotada
- [ ] Workflow importado, 5 credenciales conectadas
- [ ] Caso 1 corre completo: hay commit en el repo, fila en la planilla y nota
      en Docs
- [ ] Caso 4 (chat ajeno) se corta en *Chat autorizado?*
- [ ] Pin quitado

**Con esto el sistema está probado.** Lo que falta es sólo la puerta de entrada.

---

# BLOQUE 4 — El dominio (día 3, al habilitarse los beneficios)

## 4.1 Canjear la oferta

1. Entra a [education.github.com/pack](https://education.github.com/pack) con
   tu cuenta verificada.
2. Busca la oferta de dominio y presiona **Get offer**. Te entrega un enlace o
   un código con instrucciones.

Hay dos ofertas y son **independientes**:

| Proveedor | Qué da |
|---|---|
| **Namecheap** | Un `.me` gratis por un año, con certificado SSL |
| **Name.com** | Un dominio gratis entre 25+ extensiones: `.live`, `.studio`, `.software`, `.app`, `.dev` |

Cualquiera sirve. Con Namecheap, el flujo es autorizar a Namecheap a leer tu
cuenta de GitHub desde [nc.me/landing/github](https://nc.me/landing/github) y
buscar un `.me` disponible.

> Los `.dev` y `.app` obligan a HTTPS siempre (están en la lista de precarga
> HSTS). Con Cloudflare Tunnel eso no es problema: el HTTPS lo pone Cloudflare.

Elige algo corto y que puedas dictar por teléfono. Va a ser la dirección de tu
n8n durante toda la memoria.

## 4.2 Crear la cuenta de Cloudflare y agregar el dominio

1. [cloudflare.com](https://cloudflare.com) → cuenta nueva. **El plan gratuito
   basta.**
2. **Add a site** → escribe tu dominio → elige el plan **Free**.
3. Cloudflare te muestra **dos nameservers**, tipo `alice.ns.cloudflare.com`.
   Cópialos.

## 4.3 Delegar los nameservers

En el panel del registrador donde canjeaste el dominio:

- **Namecheap:** *Domain List* → **Manage** en tu dominio → sección
  **NAMESERVERS** → elige **Custom DNS** → pega los dos de Cloudflare → guarda
  con el visto verde.
- **Name.com:** *My Domains* → tu dominio → **Nameservers** → reemplaza por los
  dos de Cloudflare.

## 4.4 Esperar y verificar

Desde tu notebook:

```bash
dig +short NS tudominio.me
```

Cuando responda con los nameservers de Cloudflare, está listo. Suele tomar
entre minutos y unas horas; Cloudflare te manda un correo cuando el dominio
queda activo.

## Checkpoint 4

- [ ] Dominio canjeado
- [ ] Agregado a Cloudflare
- [ ] `dig +short NS` responde con los nameservers de Cloudflare

**No sigas hasta que esto último dé bien.** El túnel no se puede crear sobre un
dominio que Cloudflare todavía no administra.

---

# BLOQUE 5 — El túnel (día 3)

## 5.1 Crear el túnel

En Cloudflare: **Zero Trust → Networks → Tunnels → Create a tunnel**

1. Tipo: **Cloudflared**.
2. Nombre: `n8n-casa`.
3. **Copia el token.** Es una cadena larga; va completa al `.env`.

## 5.2 Agregar el hostname público

En el mismo túnel, **Public Hostnames → Add a public hostname**:

| Campo | Valor |
|---|---|
| Subdomain | `n8n` |
| Domain | `tudominio.me` |
| Type | **HTTP** |
| URL | **`n8n:5678`** |

> **`n8n:5678`, no `localhost:5678`.** El conector corre dentro de Docker, así
> que `n8n` es el nombre del servicio en la red interna. Con `localhost` el
> túnel apunta a sí mismo y te da error 502. Es el error más común de todo
> este proceso.
>
> Y **HTTP, no HTTPS**: ese tramo es interno a Docker. El cifrado hacia
> internet lo pone Cloudflare.

## 5.3 Completar el `.env` y levantar todo

```bash
cd ~/Bibliografia_IA/autohospedaje/casa
nano .env
```

Ahora sí:

```
CLOUDFLARE_TUNNEL_TOKEN=<el token largo de Cloudflare>

# Comenta el bloque LOCAL y descomenta este:
N8N_URL_PUBLICA=https://n8n.tudominio.me
N8N_HOST=n8n.tudominio.me
N8N_PROTOCOL=https
N8N_PROXY_HOPS=1
```

```bash
docker compose up -d
docker compose logs -f cloudflared
```

Espera a ver `Registered tunnel connection` — normalmente cuatro veces, una por
cada conexión redundante.

## 5.4 Verificar desde fuera de tu casa

Abre `https://n8n.tudominio.me` **desde el celular con datos móviles, no con el
WiFi de tu casa**. Es la única forma de confirmar que de verdad sale a internet
y no estás viendo tu propia red.

Debe cargar con candado.

## Checkpoint 5

- [ ] `cloudflared` dice *Registered tunnel connection*
- [ ] `https://n8n.tudominio.me` carga con candado desde datos móviles

---

# BLOQUE 6 — Activar y probar de verdad (día 3)

Al cambiar el bloque de URL, n8n reinició. Entra por
`https://n8n.tudominio.me` y:

1. **Confirma que el pin del Telegram Trigger esté quitado.**
2. **Publica el workflow** con el boton *Publish* de arriba a la derecha. Recién ahí
   n8n le registra el webhook a Telegram.

Ahora las pruebas de verdad, desde el celular:

| # | Mándale al bot | Esperado |
|---|---|---|
| 1 | `https://doi.org/10.1016/j.applthermaleng.2019.114301` | Responde con `kumar2019performance`, `@article`, `LISTO` y link a la nota |
| 2 | **El mismo link otra vez** | `Ya registrado, citation key: ...` y **nada más**: sin commit, sin fila, sin documento nuevo |
| 3 | `10.1115/1.4048253` | Lo resuelve vía doi.org, `@article` |
| 4 | `https://www.skf.com/cl/products/rolling-bearings \| Catálogo SKF` | `@misc`, con `[REVISAR METADATOS]` en la planilla |

Y la prueba de seguridad: pídele a alguien que le escriba al bot. Esperado:
**silencio**. En *Executions* verás que el flujo se cortó en *Chat autorizado?*.

## Checkpoint 6

- [ ] El bot responde desde el celular
- [ ] Reenviar el mismo link no duplica nada
- [ ] Un chat ajeno no obtiene respuesta

---

# BLOQUE 7 — Respaldo (mismo día, no lo dejes para después)

```bash
cd ~/Bibliografia_IA/autohospedaje/casa
mkdir -p ~/respaldos
docker compose exec -T postgres pg_dump -U n8n n8n | gzip > ~/respaldos/n8n-$(date +%F).sql.gz
```

Y bájalo del PC, desde tu notebook:

```bash
scp tuusuario@192.168.1.x:~/respaldos/n8n-*.sql.gz .
```

Un respaldo que vive en la misma máquina que respalda no es un respaldo.

Para automatizarlo cada domingo, `crontab -e`:

```cron
0 3 * * 0 cd ~/Bibliografia_IA/autohospedaje/casa && docker compose exec -T postgres pg_dump -U n8n n8n | gzip > ~/respaldos/n8n-$(date +\%F).sql.gz
```

(En cron los `%` van escapados como `\%`.)

## Checkpoint 7

- [ ] Respaldo hecho y copiado fuera del PC
- [ ] `N8N_ENCRYPTION_KEY` en el gestor de contraseñas
- [ ] Cron semanal configurado

---

## Problemas frecuentes

| Síntoma | Causa |
|---|---|
| `cloudflared` reinicia en bucle | Token mal copiado, o `.env` todavía vacío |
| El túnel conecta pero da 502 | El hostname apunta a `localhost:5678`. Debe ser `n8n:5678` |
| El dominio no resuelve | Los nameservers aún no propagan. `dig +short NS tudominio.me` |
| n8n carga pero el bot no responde | El workflow no está publicado, o `N8N_URL_PUBLICA` no calza con el hostname del túnel |
| El bot ignora tus mensajes | `BIBLIO_TELEGRAM_CHAT_ID` mal puesto. Falla cerrado a propósito |
| El flujo usa siempre el mismo link | Quedó el pin puesto en el Telegram Trigger |
| Un nodo con triángulo de advertencia | Versión de n8n distinta. Mándame cuál es |

## Dónde te puedo ayudar

- **Bloque 3:** mándame la versión de n8n (`Help → About`) y el JSON de
  cualquier nodo que salga con advertencia (selecciónalo y `Ctrl+C`).
- **Bloque 5:** si el túnel falla, pégame `docker compose logs cloudflared`.
- **Cualquier bloque:** el mensaje de error completo sirve más que una captura.
