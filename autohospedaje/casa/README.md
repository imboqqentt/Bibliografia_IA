# n8n en un PC de casa

Despliegue con **PostgreSQL + Cloudflare Tunnel**, para un equipo doméstico
detrás de una conexión residencial.

> **¿Lo vas a instalar ahora?** Sigue
> [PUESTA-EN-MARCHA.md](PUESTA-EN-MARCHA.md): la misma información ordenada por
> tiempo, en siete bloques, pensada para avanzar sin esperar el dominio. Este
> README es la referencia por tema.

Para el hardware (Ubuntu Server, arranque automático tras corte de luz, evitar
la suspensión, consumo eléctrico) mira **§1.2 del [README de autohospedaje](../README.md)**.
Esta guía cubre sólo la parte de red y despliegue.

---

## Por qué este despliegue y no el de `oracle/`

El compose de `oracle/` usa **Caddy** para el HTTPS. Caddy le pide el
certificado a Let's Encrypt, y para eso Let's Encrypt tiene que poder **entrar**
a tu máquina por el puerto 80.

En una conexión doméstica chilena eso normalmente no se puede: varios
proveedores usan **CGNAT**, o sea que compartes una IP pública con otros
clientes y no tienes una propia. No hay puerto que abrir en el router porque el
router no es el borde de la red.

**Cloudflare Tunnel invierte la dirección.** En vez de que entren a tu casa, tu
máquina *sale* hacia Cloudflare y mantiene esa conexión abierta. Telegram le
pega a Cloudflare, y Cloudflare te entrega el tráfico por el túnel ya
establecido.

Tres consecuencias prácticas:

- **No abres ningún puerto** en el router. Tu casa no queda expuesta.
- **Funciona detrás de CGNAT** y no necesitas IP fija.
- **El HTTPS lo pone Cloudflare**, así que Caddy sobra.

---

## 1. Dominio en Cloudflare

### El requisito, y lo que NO sirve

Necesitas un **dominio propio cuyos nameservers puedas apuntar a Cloudflare**.
Esa condición descarta las opciones "gratis" más conocidas:

- **DuckDNS, No-IP y similares no sirven.** Te dan un subdominio
  (`loquesea.duckdns.org`), pero la zona DNS es de ellos, no tuya. Cloudflare
  Tunnel necesita que el dominio esté administrado en tu cuenta de Cloudflare,
  y para eso tienes que poder delegar los nameservers. Con un subdominio ajeno
  no puedes.
- Lo mismo con los "dominio gratis incluido" de algunos hostings, si no te
  dejan cambiar los nameservers.

### Opción A — GitHub Student Developer Pack (gratis, empieza por acá)

Estás matriculado en un programa que otorga título, así que calificas.
[education.github.com/pack](https://education.github.com/pack)

Incluye, entre muchas otras cosas:

- **Namecheap:** un dominio `.me` gratis por un año, con certificado SSL.
- **Name.com:** un dominio gratis a elegir entre más de 25 extensiones
  (`.live`, `.studio`, `.software`, `.app`, `.dev`, entre otras).

Los dos permiten cambiar los nameservers a Cloudflare, que es lo que
necesitamos. La verificación pide correo institucional o documentación de
matrícula, y puede tardar un par de días.

> **Ojo con el año dos.** Es gratis el primer año; la renovación se paga a
> precio normal. Para una memoria que dura menos de eso, perfecto. Si después
> quieres conservarlo, presupuéstalo o migra a algo más barato.

### Opción B — Dominio `.cl` en NIC Chile

[nic.cl](https://www.nic.cl) — unos **$9.940 + IVA al año**, con descuento si
contratas varios años de una.

Más caro que un `.xyz` en oferta, pero el precio es estable: no tiene la trampa
del "primer año a $1.000 y renovación a $15.000" que usan varias registradoras
internacionales. Permite cambiar los nameservers a Cloudflare sin problema.

### Opción C — Registrar barato

Namecheap, Porkbun o Cloudflare Registrar. Extensiones como `.xyz` o `.site`
suelen salir muy barato el primer año.

> **Revisa el precio de RENOVACIÓN, no el de registro.** Es donde está el
> truco: muchas ofertas de primer año a menos de mil pesos renuevan sobre los
> quince mil.

Cloudflare Registrar tiene la ventaja de que vende a precio de costo y el
dominio ya queda dentro de Cloudflare, así que te saltas el paso siguiente.

### Apuntar el dominio a Cloudflare

Salvo que lo hayas registrado directamente en Cloudflare:

1. Crea la cuenta en [cloudflare.com](https://cloudflare.com) y agrega tu
   dominio con *Add a site*. El plan gratuito basta.
2. Cloudflare te muestra **dos nameservers** (algo como `xxx.ns.cloudflare.com`).
3. Entra al panel de donde compraste el dominio, busca *Nameservers* o
   *Servidores DNS* y reemplaza los que estén por esos dos.
4. Espera. La propagación suele tomar entre unos minutos y unas horas.
   Cloudflare te manda un correo cuando el dominio queda activo.

Para verificar desde tu notebook:

```bash
dig +short NS tudominio.cl
```

Cuando responda con los nameservers de Cloudflare, sigue al paso 2.

> Aprovecha ese tiempo de espera para instalar Ubuntu Server en el PC y dejar
> Docker listo. Ver §1.2 del [README de autohospedaje](../README.md).

---

## 2. Crear el túnel

En el panel de Cloudflare: **Zero Trust → Networks → Tunnels → Create a tunnel**

1. Elige **Cloudflared** como tipo.
2. Ponle un nombre (`n8n-casa`, por ejemplo).
3. **Copia el token** que te muestra. Es una cadena larga; va al `.env`.
4. En **Public Hostnames → Add a public hostname**:

| Campo | Valor |
|---|---|
| Subdomain | `n8n` |
| Domain | `tudominio.cl` |
| Type | `HTTP` |
| URL | `n8n:5678` |

> **`n8n:5678`, no `localhost:5678`.** El conector corre dentro de Docker, así
> que `n8n` es el nombre del servicio en la red interna. Con `localhost` el
> túnel apuntaría a sí mismo y no encontraría nada. Es el error más común de
> este paso.
>
> Y **HTTP, no HTTPS**: el tramo entre el conector y n8n es interno a Docker;
> el cifrado hacia internet lo pone Cloudflare.

---

## 3. Levantar

En el PC, por SSH:

```bash
git clone https://github.com/imboqqentt/bibliografia-memoria.git
cd bibliografia-memoria/autohospedaje/casa

cp .env.example .env
openssl rand -hex 32       # -> N8N_ENCRYPTION_KEY
openssl rand -base64 24    # -> POSTGRES_PASSWORD
nano .env                  # completa las 5 variables

docker compose up -d
docker compose logs -f
```

Qué esperar:

1. `postgres` queda *healthy*.
2. `n8n` dice `Editor is now accessible via...`.
3. `cloudflared` dice `Registered tunnel connection` (normalmente cuatro veces,
   una por cada conexión redundante que abre).

Abre `https://n8n.tudominio.cl`. Debe cargar con candado, desde cualquier red —
pruébalo desde el celular con los datos móviles, no desde el WiFi de tu casa,
para confirmar que de verdad sale a internet.

---

## 4. Si algo falla

| Síntoma | Causa |
|---|---|
| `cloudflared` reinicia en bucle | Token mal copiado. Va completo, sin espacios |
| El túnel conecta pero da error 502 | El hostname apunta a `localhost:5678`. Debe ser `n8n:5678` |
| El dominio no resuelve | Los nameservers todavía no propagan a Cloudflare |
| n8n carga pero el bot no responde | El workflow no está activo, o `N8N_DOMINIO` no calza con el hostname del túnel |
| El bot ignora tus mensajes | `BIBLIO_TELEGRAM_CHAT_ID` mal puesto. Falla cerrado a propósito |

Para ver los logs de un servicio puntual:

```bash
docker compose logs -f cloudflared
```

---

## 5. Acceso local, sin pasar por internet

El compose publica el puerto de n8n así:

```yaml
    ports:
      - "127.0.0.1:5678:5678"
```

El `127.0.0.1:` de adelante es lo que importa: deja el puerto accesible **sólo
desde el propio PC**, no desde el resto de tu red. Ni otro computador de la
casa ni un dispositivo comprometido en tu WiFi pueden llegar a n8n por ahí.

Sirve para dos cosas:

- **Trabajar antes de tener el dominio.** Puedes levantar sólo `postgres` y
  `n8n`, importar el flujo y probarlo entero mucho antes de que exista el túnel:

  ```bash
  docker compose up -d postgres n8n
  ```

  (`cloudflared` sin token se reiniciaría en bucle, por eso se deja fuera.)

- **Administrar desde el notebook** sin exponer nada, con un túnel SSH:

  ```bash
  ssh -L 5678:localhost:5678 tuusuario@<ip-local-del-pc>
  ```

  Deja esa terminal abierta y abre `http://localhost:5678` en tu navegador.

El acceso desde internet —el que necesita Telegram— lo da el túnel de
Cloudflare, no este puerto.

---

## 6. Respaldos

Dos cosas, no una:

```bash
# 1. La base de datos
docker compose exec -T postgres pg_dump -U n8n n8n | gzip > n8n-db-$(date +%F).sql.gz

# 2. El volumen de n8n (clave de cifrado, binarios, logs)
docker run --rm -v casa_n8n_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/n8n-files-$(date +%F).tar.gz -C /data .
```

> Confirma el nombre del volumen con `docker volume ls` si el segundo comando
> no lo encuentra: lleva el prefijo del directorio del proyecto.

**Sácalos del PC.** Un respaldo que vive en la misma máquina que respalda no es
un respaldo. Cópialos a tu notebook o súbelos a Drive.

Para automatizarlo semanalmente, `crontab -e`:

```cron
0 3 * * 0 cd ~/bibliografia-memoria/autohospedaje/casa && docker compose exec -T postgres pg_dump -U n8n n8n | gzip > ~/respaldos/n8n-$(date +\%F).sql.gz
```

(En cron los `%` van escapados como `\%`.)

---

## 7. Lo que hay que asumir

Estás dependiendo de que en tu casa no se corte la luz ni el internet. Para
registrar bibliografía es perfectamente aceptable: si el bot no responde una
tarde, mandas el link más tarde y no pasa nada.

Lo que sí importa es que el PC **vuelva solo** después de un corte. Eso se
configura en la BIOS y está en §1.2 del README de autohospedaje. Es el ajuste
que separa "se cayó dos horas" de "estuvo muerto una semana y no me di cuenta".
