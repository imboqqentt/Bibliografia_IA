#!/usr/bin/env bash
#
# Revisa si esta instancia esta en riesgo de ser recuperada por Oracle.
#
# Oracle considera INACTIVA una instancia Always Free si, durante un periodo
# de 7 dias, se cumplen LAS TRES condiciones a la vez:
#
#     - CPU (percentil 95)  < 20%
#     - Red                 < 20%
#     - Memoria             < 20%   (solo en shapes A1 / ARM)
#
# Basta con superar UNA para no calificar como inactiva. La estrategia de
# este despliegue es superar la de MEMORIA con carga real (PostgreSQL con
# shared_buffers afinado sobre una instancia chica), en vez de simular
# actividad con procesos que queman CPU al vacio.
#
# Uso:   ./verificar-inactividad.sh
#
# OJO con el alcance: esto es una foto del momento, tomada desde adentro de
# la maquina. Oracle mide el percentil 95 sobre 7 dias con sus propias
# metricas. Si quieres la cifra que Oracle realmente ve, mirala en la consola:
#     Compute -> Instances -> tu instancia -> Metrics
# Este script sirve para saber si vas bien encaminado, no para discutirle a
# Oracle.

set -euo pipefail

UMBRAL=20

# ---------------------------------------------------------------------------
# Memoria
# ---------------------------------------------------------------------------
# Se usa la misma formula que la metrica MemoryUtilization del agente de OCI:
#     (MemTotal - MemAvailable) / MemTotal * 100
mem_total=$(awk '/^MemTotal:/     {print $2}' /proc/meminfo)
mem_avail=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
mem_pct=$(awk -v t="$mem_total" -v a="$mem_avail" \
  'BEGIN { printf "%.1f", (t - a) / t * 100 }')

mem_total_mb=$(( mem_total / 1024 ))
mem_uso_mb=$(( (mem_total - mem_avail) / 1024 ))

# ---------------------------------------------------------------------------
# CPU
# ---------------------------------------------------------------------------
# Muestra instantanea de 5 segundos a partir de /proc/stat.
leer_cpu() { awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8, $5}' /proc/stat; }
read -r t1 i1 < <(leer_cpu)
sleep 5
read -r t2 i2 < <(leer_cpu)
cpu_pct=$(awk -v t1="$t1" -v i1="$i1" -v t2="$t2" -v i2="$i2" \
  'BEGIN { dt = t2 - t1; di = i2 - i1; if (dt <= 0) print "0.0"; else printf "%.1f", (1 - di / dt) * 100 }')

# ---------------------------------------------------------------------------
# Informe
# ---------------------------------------------------------------------------
verde=$'\033[32m'; rojo=$'\033[31m'; amarillo=$'\033[33m'; fin=$'\033[0m'

veredicto() {  # $1 = valor
  awk -v v="$1" -v u="$UMBRAL" 'BEGIN { print (v >= u) ? "SOBRE" : "BAJO" }'
}

mem_estado=$(veredicto "$mem_pct")
cpu_estado=$(veredicto "$cpu_pct")

echo
echo "  Umbral de inactividad de Oracle: ${UMBRAL}%"
echo "  ------------------------------------------------------------"

if [ "$mem_estado" = "SOBRE" ]; then
  printf "  Memoria   %s%5s%%%s   (%s MB de %s MB)   %sSOBRE el umbral%s\n" \
    "$verde" "$mem_pct" "$fin" "$mem_uso_mb" "$mem_total_mb" "$verde" "$fin"
else
  printf "  Memoria   %s%5s%%%s   (%s MB de %s MB)   %sBAJO el umbral%s\n" \
    "$rojo" "$mem_pct" "$fin" "$mem_uso_mb" "$mem_total_mb" "$rojo" "$fin"
fi

printf "  CPU       %s%5s%%%s   (muestra de 5 s, no es el percentil 95)\n" \
  "$amarillo" "$cpu_pct" "$fin"

echo "  ------------------------------------------------------------"
echo

if [ "$mem_estado" = "SOBRE" ]; then
  echo "  ${verde}Todo bien.${fin} La memoria sola ya te saca de la definicion de"
  echo "  instancia inactiva: los tres criterios son un Y logico, no un O."
  echo
  exit 0
fi

echo "  ${rojo}En riesgo.${fin} Los tres criterios estan bajo el umbral, asi que"
echo "  Oracle podria recuperar la instancia. Que revisar, en orden:"
echo
echo "   1. Confirma que PostgreSQL este corriendo:"
echo "        docker compose ps"
echo
echo "   2. Mira cuanta memoria esta usando cada contenedor:"
echo "        docker stats --no-stream"
echo
echo "   3. Si la instancia tiene demasiada RAM asignada, el problema no es"
echo "      que uses poco: es que pediste de mas. Con 12 GB, n8n + Postgres"
echo "      nunca van a llegar al 20%. Baja el shape a 1 OCPU / 4 GB."
echo
echo "   4. Si ya estas en 4 GB y aun asi vas bajo, sube shared_buffers de"
echo "      Postgres en docker-compose.yml (de 512MB a 768MB) y reinicia:"
echo "        docker compose up -d"
echo
exit 1
