# n8n en Oracle Cloud Always Free

Despliegue con **PostgreSQL + Caddy (HTTPS automático)** sobre una instancia
ARM gratuita de Oracle.

> **¿Vas a instalarlo ahora?** Sigue
> [PUESTA-EN-MARCHA.md](PUESTA-EN-MARCHA.md), que es la misma información pero
> ordenada por tiempo, con checkpoints de verificación. Este README es la
> referencia por tema: búscalo cuando necesites el detalle de algo puntual.

La idea de fondo: la instancia no se mantiene viva con trucos, se mantiene
viva **porque está bien dimensionada**. Ver §6.

---

## 1. Crear la cuenta

En [cloud.oracle.com](https://cloud.oracle.com) → *Start for free*.

- **Pide tarjeta de crédito** para verificación, aunque el tier gratuito no
  cobre. Hacen una retención pequeña y la devuelven.
- Elige bien la **región de origen**: no se puede cambiar después, y de ella
  depende que haya capacidad ARM disponible.

---

## 2. Crear la instancia — la parte que importa

**Compute → Instances → Create instance**

| Campo | Valor | Por qué |
|---|---|---|
| Image | Ubuntu 22.04 o 24.04 (ARM) | Docker se instala sin fricción |
| Shape | `VM.Standard.A1.Flex` | Es el ARM del tier gratuito |
| OCPUs | **1** | |
| Memoria | **4 GB** | **No pidas el máximo.** Ver §6 |
| SSH keys | Sube tu llave pública | |

> **El error que hay que evitar:** tomar los 12 GB completos "porque son
> gratis". Con 12 GB, n8n + PostgreSQL usan un 8% de memoria y la instancia
> califica como inactiva. Con 4 GB, los mismos servicios superan el 20% y el
> problema desaparece. Menos máquina es más seguro acá.

Si sale **"Out of host capacity"**: es habitual en regiones populares. Prueba
en otro *availability domain*, o reintenta más tarde. Para un bot de Telegram
la latencia de la región da lo mismo, así que cualquiera sirve.

Anota la **IP pública** que te asignan.

---

## 3. Abrir los puertos — los DOS cortafuegos

Este es el tropiezo clásico de Oracle y donde se pierde una tarde entera.
Hay **dos** capas de filtrado y hay que abrir ambas. Si sólo abres una, el
sitio no responde y parece que el problema fuera n8n.

### Capa 1 — Security List (en la consola web)

**Networking → Virtual Cloud Networks →** tu VCN **→ Security Lists →**
*Default Security List* **→ Add Ingress Rules**

Agrega dos reglas:

| Source CIDR | Protocolo | Puerto destino |
|---|---|---|
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

### Capa 2 — iptables (dentro de la máquina, por SSH)

Las imágenes de Oracle traen reglas propias que bloquean todo salvo SSH:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

En imágenes de Oracle Linux (en vez de Ubuntu) se usa `firewall-cmd`:

```bash
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload
```

**No abras el 5678.** En este despliegue n8n no publica puertos al host: sólo
Caddy le habla. Así no hay forma de llegar a n8n saltándose el HTTPS.

---

## 4. Dominio

Necesitas un dominio con un registro **A** apuntando a la IP pública. Telegram
exige HTTPS para el webhook, y para tener HTTPS necesitas un nombre.

```
Tipo   Nombre   Valor
A      n8n      <IP pública de tu instancia>
```

Sirve cualquier dominio barato. Si usas Cloudflare como DNS, deja el registro
en **DNS only** (nube gris) mientras Caddy pide el certificado; después puedes
activar el proxy si quieres.

---

## 5. Instalar y levantar

Por SSH a la instancia:

```bash
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# Este repositorio
git clone <tu-repo> memoria
cd memoria/n8n/bibliografia-memoria/autohospedaje/oracle

cp .env.example .env
openssl rand -hex 32      # -> N8N_ENCRYPTION_KEY
openssl rand -base64 24   # -> POSTGRES_PASSWORD
nano .env                 # completa las 4 variables

docker compose up -d
docker compose logs -f
```

Caddy pide el certificado solo en el primer arranque. Si el DNS ya propagó y
los puertos están abiertos, en menos de un minuto tienes
`https://n8n.tudominio.cl` funcionando.

La primera vez te pide crear el usuario dueño de la instancia. Después, pega
el `workflow.json` con Ctrl+V y conecta las credenciales.

---

## 6. Por qué no hace falta ningún truco de keep-alive

Oracle considera **inactiva** una instancia Always Free si, durante 7 días, se
cumplen **las tres** condiciones a la vez:

- CPU (percentil 95) < 20%
- Red < 20%
- Memoria < 20% *(sólo en shapes A1)*

Es un **Y lógico**. Basta superar **una sola** para no calificar como inactiva.

Este despliegue supera la de memoria con carga real: PostgreSQL con
`shared_buffers=512MB` sobre una instancia de 4 GB. Entre Postgres y n8n el
uso queda establemente sobre el 20%, sin procesos que quemen CPU al vacío.

Para verificarlo:

```bash
./verificar-inactividad.sh
```

Te dice en qué porcentaje estás y qué ajustar si vas bajo. Corre en unos
segundos y no necesita permisos especiales.

Si quieres ver **la cifra que Oracle realmente mide** (percentil 95 sobre 7
días, que un script local no puede calcular): consola → **Compute → Instances
→** tu instancia **→ Metrics**.

---

## 7. Respaldos

Con PostgreSQL hay **dos** cosas que respaldar, no una:

```bash
# 1. La base de datos (workflows, credenciales cifradas, historial)
docker compose exec -T postgres pg_dump -U n8n n8n | gzip > n8n-db-$(date +%F).sql.gz

# 2. El volumen de n8n (clave de cifrado, binarios, logs)
docker run --rm -v oracle_n8n_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/n8n-files-$(date +%F).tar.gz -C /data .
```

> El nombre del volumen lleva el prefijo del directorio del proyecto.
> Confírmalo con `docker volume ls` si el comando no lo encuentra.

Para restaurar la base:

```bash
gunzip -c n8n-db-AAAA-MM-DD.sql.gz | docker compose exec -T postgres psql -U n8n n8n
```

**La `N8N_ENCRYPTION_KEY` va en tu gestor de contraseñas, no sólo en el `.env`.**
Un respaldo de la base sin esa clave no te devuelve las credenciales.

Y el respaldo no está respaldado si vive en la misma instancia: bájalo a tu
notebook o súbelo a Drive.

---

## 8. Mantención

```bash
docker compose pull && docker compose up -d    # actualizar
docker compose logs -f n8n                     # ver qué pasa
docker compose ps                              # estado de los 3 servicios
docker stats --no-stream                       # uso real de memoria
```

---

## 9. Lo que hay que tener presente

En **junio de 2026 Oracle redujo el tier gratuito a la mitad** (de 4 OCPU/24 GB
a 2 OCPU/12 GB) sin anuncio público ni aviso a los clientes. Es gratis y
funciona bien, pero las reglas las pone Oracle y las puede cambiar sin avisar.

Traducido a algo accionable: **mantén los respaldos al día y fuera de la
instancia**. Si un día la plataforma cambia, migrar a un VPS de pago es
levantar este mismo `docker-compose.yml` en otra máquina y restaurar el dump —
cosa de una hora, siempre que tengas el respaldo y la clave de cifrado.

Lo que no quieres es enterarte de que no tenías respaldo justo cuando lo
necesitas.
