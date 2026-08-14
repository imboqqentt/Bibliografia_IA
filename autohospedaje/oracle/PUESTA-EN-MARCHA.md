# Puesta en marcha en Oracle — paso a paso

Esta guía está ordenada **por tiempo**, no por tema. El `README.md` de esta
carpeta es la referencia (busca ahí cuando necesites el detalle de algo); esto
es la secuencia para hacerlo de corrido sin quedarte esperando al pedo.

**Tiempo total:** entre 1 y 2 horas, la mayor parte esperando propagación de
DNS. Por eso el DNS se configura temprano, en la fase 2.

**Regla de oro:** hay un checkpoint en la fase 6 que **no puedes saltarte**.
Si levantas Caddy antes de tiempo, Let's Encrypt te bloquea por una hora.

---

## Fase 0 — Antes de tocar Oracle

Se hace desde tu notebook y no depende de nada. Hazlo primero para que después
no te frene.

### 0.1 Crear el bot de Telegram

1. Habla con [@BotFather](https://t.me/BotFather) y manda `/newbot`.
2. Nombre visible (ej. *Bibliografía Memoria*) y username terminado en `bot`.
3. Guarda el token que te da: `8123456789:AAH...`
4. **Escríbele `/start` a tu bot.** Sin esto no puede responderte nunca.
5. Abre en el navegador:
   `https://api.telegram.org/bot<TU_TOKEN>/getUpdates`
   y anota el número de `result[0].message.chat.id`.

Al terminar tienes **dos datos**: el token del bot y tu chat_id.

### 0.2 Tener un dominio

Cualquiera sirve. Necesitas poder crear un registro A.

- [ ] Token de Telegram anotado
- [ ] chat_id anotado
- [ ] Acceso al panel DNS de un dominio

---

## Fase 1 — Crear la instancia (≈15 min)

### 1.1 Cuenta

[cloud.oracle.com](https://cloud.oracle.com) → *Start for free*. Pide tarjeta
de crédito para verificación aunque no cobre.

> La **región de origen no se puede cambiar después**. Elige una y sigue.

### 1.2 Instancia

**Compute → Instances → Create instance**

| Campo | Valor |
|---|---|
| Image | **Ubuntu 22.04** o 24.04 (variante **aarch64/ARM**) |
| Shape | `VM.Standard.A1.Flex` |
| OCPUs | **1** |
| Memoria | **4 GB** |
| SSH keys | Sube tu llave pública |

> **No pidas 12 GB aunque estén disponibles.** Es lo que te deja bajo el umbral
> de inactividad y te hace perder la instancia. Ver §6 del README.

Si no tienes llave SSH:

```bash
ssh-keygen -t ed25519 -C "oracle-n8n"
cat ~/.ssh/id_ed25519.pub    # esto es lo que subes
```

**Si sale "Out of host capacity":** normal en regiones populares. Cambia de
*availability domain* y reintenta, o prueba más tarde.

### 1.3 Anota la IP pública y comprueba el acceso

```bash
ssh ubuntu@<IP_PUBLICA>
```

- [ ] Entré por SSH

**No sigas hasta que el SSH funcione.**

---

## Fase 2 — DNS, ahora mismo (≈2 min)

Esto va temprano a propósito: mientras propaga, tú avanzas con lo demás.

En el panel DNS de tu dominio:

```
Tipo   Nombre   Valor                TTL
A      n8n      <IP_PUBLICA>         300 (o el mínimo)
```

> Si usas **Cloudflare** como DNS: deja la nube en **gris (DNS only)**. Con la
> nube naranja, Cloudflare intercepta la validación y Caddy no consigue el
> certificado.

- [ ] Registro A creado

Sigue a la fase 3 sin esperar.

---

## Fase 3 — Los dos cortafuegos (≈10 min)

Oracle filtra en **dos capas** y hay que abrir las dos. Saltarse una es el
error más común, y el síntoma engaña: parece que el problema fuera n8n.

### 3.1 Security List (consola web)

**Networking → Virtual Cloud Networks →** tu VCN **→ Security Lists →**
*Default Security List* **→ Add Ingress Rules**

Dos reglas, ambas con Source CIDR `0.0.0.0/0` y protocolo TCP:

| Destination Port |
|---|
| 80 |
| 443 |

### 3.2 iptables (por SSH, dentro de la máquina)

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Verifica que quedaron:

```bash
sudo iptables -L INPUT -n --line-numbers | grep -E "dpt:(80|443)"
```

Debes ver dos líneas `ACCEPT`. Si no aparecen, no continúes.

- [ ] Security List con 80 y 443
- [ ] iptables con 80 y 443, verificado

---

## Fase 4 — Docker y el repositorio (≈10 min)

Por SSH:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

docker --version && docker compose version
```

Ambos comandos deben responder con una versión.

```bash
git clone <URL_DE_TU_REPO> memoria
cd memoria/n8n/bibliografia-memoria/autohospedaje/oracle
```

### Configurar el `.env`

```bash
cp .env.example .env
openssl rand -hex 32       # -> N8N_ENCRYPTION_KEY
openssl rand -base64 24    # -> POSTGRES_PASSWORD
nano .env
```

Completa las cuatro variables:

| Variable | Valor |
|---|---|
| `N8N_DOMINIO` | `n8n.tudominio.cl` |
| `POSTGRES_PASSWORD` | el `openssl rand -base64 24` |
| `N8N_ENCRYPTION_KEY` | el `openssl rand -hex 32` |
| `BIBLIO_TELEGRAM_CHAT_ID` | tu chat_id de la fase 0 |

> **Guarda la `N8N_ENCRYPTION_KEY` en tu gestor de contraseñas, además del
> `.env`.** Sin ella, un respaldo de la base no te devuelve las credenciales.

- [ ] Docker responde
- [ ] `.env` con las 4 variables

---

## Fase 5 — Crear las credenciales de Google y GitHub

Aprovecha lo que falta de propagación del DNS. Todo esto se hace en el
navegador y está detallado en el README principal (§1, §3 y §4):

- [ ] Planilla de Google con la pestaña `Consolidado` y los 14 encabezados
- [ ] Proyecto en Google Cloud con las APIs de Sheets, Docs y Drive habilitadas
- [ ] `referencias.bib` creado (aunque vacío) en la rama por defecto de tu repo
- [ ] Token fino de GitHub con `Contents: Read and write`
- [ ] API key de Anthropic

Anota el **ID de la planilla** y el **owner/repo** de GitHub: los vas a
necesitar al configurar los nodos.

---

## Fase 6 — CHECKPOINT (no te lo saltes)

Antes de levantar nada, las dos cosas tienen que dar bien.

### 6.1 ¿El DNS resuelve a tu IP?

**Desde tu notebook**, no desde la instancia:

```bash
dig +short n8n.tudominio.cl
```

Tiene que imprimir **exactamente tu IP pública**. Si no imprime nada o imprime
otra cosa, el DNS no ha propagado. Espera y reintenta.

### 6.2 ¿El puerto 80 llega desde afuera?

**Desde tu notebook**, con la instancia todavía sin levantar:

```bash
nc -zv n8n.tudominio.cl 80
```

- `Connection refused` → **bien**: el paquete llegó, sólo que nadie escucha
  todavía. Los cortafuegos están abiertos.
- `Connection timed out` → **mal**: algún cortafuegos sigue cerrado. Vuelve a
  la fase 3.

> Probar esto **desde dentro** de la instancia no sirve: el tráfico local no
> pasa por el filtro y siempre te va a dar bien.

- [ ] `dig` devuelve mi IP
- [ ] `nc` da *refused*, no *timed out*

**Recién ahora sigue.** Si levantas Caddy con esto fallando, gastas los 5
intentos que da Let's Encrypt y quedas bloqueado hasta una hora.

---

## Fase 7 — Levantar (≈5 min)

```bash
docker compose up -d
docker compose logs -f
```

Qué esperar en los logs:

1. `postgres` queda *healthy*.
2. `n8n` arranca y dice `Editor is now accessible via...`.
3. `caddy` obtiene el certificado: `certificate obtained successfully`.

Abre `https://n8n.tudominio.cl`. Debe cargar con **candado verde**.

### Si Caddy no consigue el certificado

Lee el error en `docker compose logs caddy`:

| Error | Causa | Solución |
|---|---|---|
| `timeout` / `connection refused` durante el challenge | Puertos cerrados | Fase 3 otra vez |
| `DNS problem: NXDOMAIN` | El DNS no resolvió | Espera propagación |
| `too many failed authorizations` | Ya quemaste la cuota | Espera 1 h, o usa el modo prueba del `Caddyfile` |

El `Caddyfile` trae comentado un **modo prueba** que usa el entorno de staging
de Let's Encrypt, con límites mucho más holgados. Si vas a hacer varios
intentos, descoméntalo: el navegador avisará que el certificado no es de
confianza, y eso está bien — significa que el mecanismo funciona. Después lo
comentas, corres `docker compose restart caddy` y pide el certificado real.

- [ ] `https://n8n.tudominio.cl` carga con candado

---

## Fase 8 — Verificar que no te van a recuperar la instancia

```bash
./verificar-inactividad.sh
```

Tiene que decir **SOBRE el umbral** en memoria. Si dice *BAJO*, revisa que
PostgreSQL esté corriendo (`docker compose ps`) y lee las sugerencias que
imprime el propio script.

- [ ] Memoria sobre 20%

---

## Fase 9 — n8n: importar y conectar por etapas

Crea el usuario dueño de la instancia (correo y clave, es local).

**Anota la versión de n8n**: `Help → About`.

Pega el `workflow.json` con **Ctrl+V** sobre el canvas.

Ahora conecta las credenciales **por etapas**, no todas de golpe. Así, cuando
algo falle, sabes exactamente qué lo rompió:

1. **Telegram.** Crea la credencial en los 3 nodos de Telegram. Activa el
   workflow y mándale un link al bot. Debería llegar hasta el primer nodo.
2. **Anthropic.** Prueba que el resumen se genere.
3. **Google Sheets.** Pega el ID de la planilla en los dos nodos.
4. **GitHub.** Completa `owner` y `repository` en los dos nodos.
5. **Google Docs.** Ajusta el `folderId` si quieres una carpeta específica.

Después corre las pruebas 1 a 6 del README principal (§6).

- [ ] Workflow importado
- [ ] Las 5 credenciales conectadas
- [ ] Prueba 1 (artículo con DOI) pasa
- [ ] Prueba 2 (idempotencia) pasa

---

## Fase 10 — Respaldo, el mismo día

No lo dejes para después.

```bash
docker compose exec -T postgres pg_dump -U n8n n8n | gzip > n8n-db-$(date +%F).sql.gz
```

Baja ese archivo a tu notebook:

```bash
scp ubuntu@<IP>:~/memoria/n8n/bibliografia-memoria/autohospedaje/oracle/n8n-db-*.sql.gz .
```

- [ ] Respaldo hecho y **fuera** de la instancia
- [ ] `N8N_ENCRYPTION_KEY` en el gestor de contraseñas

---

## Resumen de problemas frecuentes

| Síntoma | Causa más probable |
|---|---|
| `nc` da *timed out* | Falta abrir iptables (la capa 2 se olvida siempre) |
| Caddy no consigue certificado | DNS sin propagar, o nube naranja en Cloudflare |
| `too many failed authorizations` | Levantaste antes del checkpoint. Espera 1 h |
| El bot no responde | El workflow no está activo, o `WEBHOOK_URL` no calza con el dominio |
| El bot ignora tus mensajes | `BIBLIO_TELEGRAM_CHAT_ID` mal puesto. Falla cerrado a propósito |
| `verificar-inactividad.sh` dice BAJO | Pediste demasiada RAM al crear la instancia |
| Un nodo aparece con triángulo | Versión de n8n distinta. Mándame cuál es |

---

## Dónde te puedo ayudar

No tengo acceso a tu cuenta de Oracle ni a la instancia, así que las fases 1 a
8 las corres tú. Donde sí te sirvo:

- **Fase 7:** si Caddy falla, pégame la salida de `docker compose logs caddy`.
- **Fase 9:** mándame la versión de n8n y, si un nodo sale con advertencia,
  selecciónalo, `Ctrl+C`, y pégame el JSON acá.
- **Cualquier fase:** el mensaje de error completo sirve más que una captura.
