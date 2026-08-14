# Autohospedar n8n: notebook y Raspberry

Guía para correr el flujo en tu propio hardware en vez de n8n Cloud.

---

## Antes que nada: qué máquina para qué

Las dos máquinas sirven, pero para cosas distintas, y conviene tenerlo claro
antes de empezar:

| | Notebook | Raspberry |
|---|---|---|
| **Para qué es buena** | Construir, importar, depurar | Dejarlo corriendo |
| Se suspende al cerrar la tapa | Sí → el bot muere | No |
| Cambia de red (casa, universidad) | Sí → se cae el túnel | No |
| Consumo | Irrelevante si igual la usas | 3–6 W |

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

> **¿Vas a Oracle Cloud Always Free?** Ese despliegue tiene su propia carpeta:
> [`oracle/`](oracle/), con PostgreSQL, HTTPS automático vía Caddy, el paso a
> paso de los dos cortafuegos de Oracle y un script que verifica que no estés
> en riesgo de que te recuperen la instancia. Esta guía cubre notebook y
> Raspberry.

## 1. Requisitos

- **Docker** y **Docker Compose**.
  - Windows / macOS: Docker Desktop.
  - Linux: `docker` + `docker compose` desde el gestor de paquetes.
- En **Raspberry**: sistema operativo de **64 bits**. Verifica con:

```bash
uname -m      # aarch64 = bien | armv7l = hay que reinstalar en 64 bits
free -h       # 2 GB mínimo, 4 GB cómodo
```

Con `armv7l` la última imagen disponible es n8n 1.26.0, que es demasiado
antigua para las versiones de nodo de este workflow.

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
