# Autohospedar n8n en tu propio hardware

Guía para correr el flujo en tu propio hardware en vez de n8n Cloud.

---

## Antes que nada: qué máquina para qué

Las dos máquinas sirven, pero para cosas distintas, y conviene tenerlo claro
antes de empezar:

| | Notebook | PC en desuso | Raspberry |
|---|---|---|---|
| **Para qué es buena** | Construir y depurar | Dejarlo corriendo | Dejarlo corriendo |
| Se suspende al cerrar la tapa | Sí → el bot muere | No | No |
| Cambia de red | Sí → se cae el túnel | No | No |
| Disco | SSD | SSD o HDD | microSD, se desgasta |
| Consumo | Irrelevante si igual la usas | 30–100 W | 3–6 W |

El **PC en desuso** es técnicamente la mejor de las tres para dejarlo corriendo
(disco real en vez de microSD, x86 sin sorpresas), pero es el que más consume.
Ver §1.2 para el cálculo de cuánto te cuesta al mes.

**El punto que importa:** el flujo existe para que mandes links **desde el
celular cuando encuentras una fuente**. Si n8n vive en el notebook, sólo
funciona cuando el notebook está abierto, despierto y con la terminal corriendo.
Los mensajes que mandes con el notebook cerrado se pierden o quedan en el
limbo. Eso no rompe nada, pero convierte "mando el link cuando lo encuentro"
en "tengo que estar sentado frente al notebook", que es justamente lo que la
automatización venía a evitar.

Además, la [documentación de n8n](https://docs.n8n.io/deploy/host-n8n/install-options/install-with-docker)
dice explícitamente que el túnel es *"a convenience tool for local development"*
y que la URL se imprime en cada arranque — o sea, **cambia cada vez que
reinicias**, y cada cambio obliga a reactivar el workflow para que Telegram
vuelva a registrar el webhook.

**Recomendación:** notebook para la fase de armado, Raspberry para producción.
No es rehacer trabajo: es el mismo `docker-compose.yml`, el mismo
`workflow.json` y, si conservas la `N8N_ENCRYPTION_KEY`, hasta las mismas
credenciales.

---

> **Elige tu despliegue:**
>
> - **PC de casa o Raspberry** (conexión doméstica, detrás de CGNAT):
>   [`casa/`](casa/) — PostgreSQL + Cloudflare Tunnel.
> - **VPS con IP pública** (Oracle, Hetzner, cualquiera):
>   [`oracle/`](oracle/) — PostgreSQL + Caddy con HTTPS automático.
> - **Notebook, sólo para armar y probar**: sigue en este archivo, §2.
>
> Los tres usan el mismo `workflow.json`. La diferencia está en dónde se
> termina el TLS, que es lo que cambia según si tienes IP pública o no.

## 1. Requisitos

- **Docker** y **Docker Compose**.
  - **Windows 11:** Docker Desktop sobre WSL2. Ver §1.1, tiene detalles propios.
  - macOS: Docker Desktop.
  - Linux: `docker` + `docker compose` desde el gestor de paquetes.
- En **Raspberry**: sistema operativo de **64 bits**. Verifica con:

```bash
uname -m      # aarch64 = bien | armv7l = hay que reinstalar en 64 bits
free -h       # 2 GB mínimo, 4 GB cómodo
```

Con `armv7l` la última imagen disponible es n8n 1.26.0, que es demasiado
antigua para las versiones de nodo de este workflow.

---

### 1.1 Windows 11

La idea de fondo: **instalas Docker en Windows, pero trabajas dentro de Ubuntu
(WSL2)**. Todos los comandos de esta guía y de la de Oracle son de Linux
(`openssl`, `cp`, `dig`, tuberías con `gzip`), y en PowerShell no existen o se
comportan distinto. Además, así lo que aprendes acá es exactamente lo mismo que
vas a hacer en el servidor: no aprendes dos veces.

**Requisitos:** Windows 11 Pro, Enterprise o Education 23H2 o superior, 8 GB de
RAM y virtualización habilitada en la BIOS. Docker Desktop es gratis para uso
personal y educativo.

#### Paso 1 — Instalar WSL2

En **PowerShell como administrador**:

```powershell
wsl --install
```

Instala WSL2 y Ubuntu de una. **Reinicia**. Al volver, Ubuntu se abre solo y te
pide crear un usuario y contraseña de Linux (no tiene relación con tu cuenta de
Windows; anótala igual, la vas a necesitar para `sudo`).

#### Paso 2 — Instalar Docker Desktop

Descárgalo de [docker.com](https://docs.docker.com/desktop/setup/install/windows-install/)
e instálalo dejando marcada la opción de **WSL 2 backend**.

Después ábrelo y ve a **Settings → Resources → WSL Integration**. Activa el
interruptor de **Ubuntu** y dale a *Apply & restart*. Sin este paso, el comando
`docker` no existe dentro de Ubuntu.

#### Paso 3 — Verificar desde Ubuntu

Abre **Ubuntu** desde el menú inicio (no PowerShell) y corre:

```bash
docker --version
docker compose version
```

Los dos tienen que responder con una versión. Si dicen *command not found*,
falta el interruptor del paso 2.

#### Las tres trampas de Windows

**1. Clona en el sistema de archivos de Linux, no en el de Windows.**

```bash
cd ~                       # /home/tuusuario, dentro de Ubuntu
git clone -b claude/n8n-bibliography-workflow-6gm00l \
  https://github.com/imboqqentt/codigos.git memoria
```

Si clonas en `/mnt/c/Users/...` (o sea, en el disco de Windows), Docker anda
mucho más lento y aparecen problemas de permisos en los volúmenes. La carpeta
`~` de Ubuntu es la correcta.

Para abrirla desde el Explorador de Windows cuando la necesites:
`\\wsl$\Ubuntu\home\tuusuario\memoria`

**2. No edites los archivos con el Bloc de notas ni con editores de Windows.**

Windows guarda los saltos de línea como CRLF y eso rompe el `.env` y los
scripts. Edita desde Ubuntu con `nano`, o usa VS Code con la extensión
**WSL** (te aparece "WSL: Ubuntu" abajo a la izquierda cuando estás bien).

```bash
nano .env
```

**3. Docker Desktop tiene que estar corriendo.**

Si cierras Docker Desktop, los contenedores se detienen. Déjalo iniciando con
Windows (**Settings → General → Start Docker Desktop when you sign in**).

#### Opcional: limitar la RAM que toma WSL2

Por defecto WSL2 puede tomar bastante memoria. Si tu notebook anda justo, crea
el archivo `C:\Users\<tu-usuario>\.wslconfig` con:

```ini
[wsl2]
memory=4GB
processors=2
```

Después, en PowerShell: `wsl --shutdown` y vuelve a abrir Ubuntu.

#### Y de aquí en adelante

Todo el resto de esta guía se corre **dentro de Ubuntu**, y los comandos son
idénticos a los de Linux. Sigue desde §2.

---

### 1.2 PC de escritorio en desuso

Técnicamente es **mejor que la Raspberry**, y la razón principal no es la
potencia: es el **disco**. La Raspberry arranca desde microSD, y las microSD
mueren por desgaste de escritura — que es justo lo que hace una base de datos
funcionando todo el día. Un PC con SSD o incluso con disco duro no tiene ese
problema. Se suma que es x86\_64, así que no hay nada que revisar sobre
arquitecturas ni imágenes ARM: todo funciona sin preguntas.

Lo que sí hay que mirar antes es la **cuenta de la luz**.

#### El cálculo que conviene hacer

Regla práctica para Chile, con la tarifa BT1 residencial (entre $110 y $180
por kWh según distribuidora y zona; el valor exacto está en tu boleta):

> **Cada watt de consumo continuo cuesta alrededor de $100 al mes.**

O sea, un equipo que consume 50 W encendido las 24 horas te cuesta unos
**$5.000 mensuales**. Para comparar, un VPS en Hetzner sale unos €4,5, que a la
fecha de escribir esto es del mismo orden.

| Tipo de equipo | Consumo típico en reposo | Costo mensual aprox. |
|---|---|---|
| PC antiguo (2008–2012) | 60–100 W | $6.000 – $10.000 |
| PC intermedio (2015–2020) | 30–50 W | $3.000 – $5.000 |
| Mini PC / NUC | 10–25 W | $1.000 – $2.500 |
| Raspberry Pi | 3–6 W | $300 – $600 |

Para medirlo de verdad necesitas un medidor de consumo enchufable. Sin eso, la
tabla te sirve de estimación.

**Conclusión honesta:** si el PC es de los antiguos, la electricidad te va a
costar más que arrendar un VPS. Si es intermedio, sale parecido. Si es un mini
PC, gana por lejos. En ninguno de los casos es "gratis", que es lo que uno
supone al usar algo que ya tiene.

#### Requisitos

- **4 GB de RAM** mínimo, 8 GB cómodo.
- Cualquier disco. Si tiene HDD mecánico anda igual, sólo más lento al arrancar.
- Conexión por cable al router, idealmente. El WiFi se cae más seguido y aquí
  la disponibilidad es todo el punto.

#### Instalación

**Instala Ubuntu Server, no Ubuntu Desktop.** El escritorio se come 1–2 GB de
RAM en dibujar una pantalla que nunca vas a mirar. Descarga *Ubuntu Server LTS*
desde [ubuntu.com](https://ubuntu.com/download/server), grábalo con
[Rufus](https://rufus.ie) o [balenaEtcher](https://etcher.balena.io) y durante
la instalación marca **"Install OpenSSH server"**.

Después de instalar, desde tu notebook:

```bash
ssh tuusuario@<ip-local-del-pc>
```

Y desde ahí sigues con Docker igual que en el servidor:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
```

#### Los tres ajustes que la gente olvida

**1. Que se encienda solo después de un corte de luz.**

Es el más importante y no es de software: está en la **BIOS/UEFI**. Busca una
opción llamada *Restore on AC Power Loss*, *AC Back Function* o *After Power
Failure* y déjala en **Power On** (viene en *Last State* o *Power Off* según el
equipo).

Sin esto, un corte de luz a las 3 de la mañana deja el bot muerto hasta que
llegues a casa a apretar el botón.

**2. Que no se suspenda.**

Ubuntu Server normalmente no suspende, pero asegúralo:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

**3. Que no se apague al cerrar la tapa** (si fuera un notebook viejo):

```bash
sudo sed -i 's/^#*HandleLidSwitch=.*/HandleLidSwitch=ignore/' /etc/systemd/logind.conf
sudo systemctl restart systemd-logind
```

#### Para que Telegram lo alcance

Igual que con la Raspberry: **Cloudflare Tunnel**, la opción B de §3. Estás en
una conexión doméstica, así que probablemente detrás de CGNAT, y el túnel
resuelve eso sin abrir puertos en el router.

#### Un ahorro extra

Una vez que ande y accedas sólo por SSH, **desconecta el monitor** y, si el
equipo tiene tarjeta de video dedicada que no necesitas, sácala y usa el video
integrado. Una GPU antigua puede estar consumiendo 15–20 W sin hacer nada, que
son $1.500–$2.000 al mes tirados a la basura.

---

## 2. Levantar n8n

```bash
cd autohospedaje
cp .env.example .env

# Genera la clave de cifrado y guárdala en tu gestor de contraseñas
openssl rand -hex 32
```

Abre `.env` y completa `N8N_ENCRYPTION_KEY` y `BIBLIO_TELEGRAM_CHAT_ID`.
`WEBHOOK_URL` puedes dejarla vacía por ahora: sin ella n8n igual levanta y
puedes importar el flujo, sólo que el bot todavía no recibe mensajes.

```bash
docker compose up -d
docker compose logs -f
```

Entra a **http://localhost:5678**. La primera vez te pide crear el usuario
dueño de la instancia (correo y clave). Eso es local, no es una cuenta de n8n.

> Si al arrancar ves una advertencia sobre *task runners*, sigue la instrucción
> que imprime el propio log: la recomendación cambia entre versiones y conviene
> hacerle caso a la que trae tu versión, no a una escrita de antemano acá.

Ya puedes importar `workflow.json` con Ctrl+V y conectar las credenciales.
Anota la **versión de n8n** que aparece en `Help → About`.

---

## 3. Exponerlo a internet para que Telegram lo alcance

### Opción A — túnel temporal (sólo para probar)

Levanta el túnel, copia la URL que imprime, pégala en `WEBHOOK_URL` del `.env`
y reinicia con `docker compose up -d`. Luego desactiva y reactiva el workflow
en la interfaz para que Telegram registre el webhook nuevo.

Repite ese baile cada vez que reinicies. Por eso no sirve como solución
permanente.

### Opción B — Cloudflare Tunnel con dominio propio (lo que sirve de verdad)

Da una URL estable con HTTPS, funciona detrás de CGNAT (relevante en Chile,
donde varios proveedores domésticos no entregan IP pública) y no requiere
abrir ningún puerto del router.

1. Ten un dominio administrado por Cloudflare (uno `.cl` o cualquiera barato).
2. En el panel de Cloudflare: **Zero Trust → Networks → Tunnels → Create tunnel**.
3. Elige *Cloudflared*, ponle nombre y copia el token que te entrega.
4. Agrega un *public hostname*: por ejemplo `n8n.tudominio.cl` apuntando al
   servicio `http://n8n:5678`.
5. Agrega el conector al `docker-compose.yml`, en el mismo archivo, bajo
   `services`:

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: cloudflared
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on:
      - n8n
```

6. En el `.env`, agrega el token y ajusta las tres variables de URL:

```
CLOUDFLARE_TUNNEL_TOKEN=el-token-que-te-dio-cloudflare
WEBHOOK_URL=https://n8n.tudominio.cl
N8N_HOST=n8n.tudominio.cl
N8N_PROTOCOL=https
```

7. `docker compose up -d` y reactiva el workflow.

Lo que **no** deberías hacer es abrir el puerto 5678 directo a internet desde
el router. Quedaría un n8n con tus credenciales de Google y GitHub expuesto sin
HTTPS a cualquiera que escanee el puerto.

---

## 4. Respaldos

Todo lo importante vive en un solo lugar: el volumen `n8n_data`, montado en
`/home/node/.n8n`. Ahí están la base de datos SQLite, el historial y las
credenciales cifradas.

```bash
# Respaldar
docker run --rm -v n8n_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/n8n-backup-$(date +%F).tar.gz -C /data .

# Restaurar
docker run --rm -v n8n_data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/n8n-backup-AAAA-MM-DD.tar.gz -C /data
```

Dos advertencias que valen más que el respaldo mismo:

- **La `N8N_ENCRYPTION_KEY` va aparte, en tu gestor de contraseñas.** Un
  respaldo del volumen sin esa clave no te sirve para recuperar las
  credenciales.
- **El respaldo no está respaldado si vive en el mismo disco.** Súbelo a Drive
  o cópialo a otra máquina.

---

## 5. Migrar del notebook a la Raspberry

Cuando el flujo ya funcione en el notebook:

1. Copia `docker-compose.yml` y `.env` a la Raspberry, **con la misma
   `N8N_ENCRYPTION_KEY`**.
2. Respalda el volumen en el notebook y restáuralo en la Raspberry (comandos
   de arriba). Eso te lleva credenciales, workflow e historial de una vez.
3. Cambia `WEBHOOK_URL`, `N8N_HOST` y `N8N_PROTOCOL` a las del túnel
   permanente.
4. `docker compose up -d` en la Raspberry.
5. Reactiva el workflow para que Telegram registre el webhook nuevo.
6. **Apaga n8n en el notebook.** Dos instancias con el mismo bot se pelean el
   webhook: Telegram sólo entrega a una, y no necesariamente a la que esperas.

Si prefieres partir de cero en la Raspberry en vez de migrar el volumen,
exporta el workflow desde la interfaz (`···  → Download`) y vuelve a crear las
5 credenciales a mano. Es más lento pero también funciona.

---

## 6. Mantención

```bash
docker compose pull && docker compose up -d    # actualizar n8n
docker compose logs -f n8n                     # ver qué pasa
docker compose restart n8n                     # reiniciar
```

Actualiza cada cierto tiempo, pero **no en medio de una semana de entrega**:
una actualización mayor puede cambiar versiones de nodo y dejarte un nodo
marcado como incompatible justo cuando necesitas registrar fuentes.
