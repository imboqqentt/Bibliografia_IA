<#
.SYNOPSIS
    Diagnostica por que Docker Desktop no puede arrancar WSL, y opcionalmente
    lo repara.

.DESCRIPTION
    Docker Desktop necesita WSL 2.1.5 o superior. El sintoma tipico es que
    Docker muestre "There was a problem with WSL" y en el detalle aparezca que
    'wsl.exe --version' devolvio el texto de AYUDA en vez de un numero: eso
    significa que wsl.exe es la version antigua incorporada en Windows, que no
    reconoce ese argumento.

    Este script revisa las cinco cosas que tienen que estar bien, en el orden
    en que dependen una de otra, y te dice cual falla y que hacer.

.PARAMETER Reparar
    Ademas de diagnosticar, aplica los arreglos. Requiere ejecutar PowerShell
    como Administrador. Puede pedir reiniciar a mitad de camino: en ese caso
    reinicia y vuelve a correr el script con -Reparar.

.EXAMPLE
    .\diagnostico-wsl.ps1
    Solo diagnostica. No cambia nada.

.EXAMPLE
    .\diagnostico-wsl.ps1 -Reparar
    Diagnostica y arregla lo que pueda.

.NOTES
    Pensado para Windows en espanol: no depende de textos localizados, solo de
    codigos de salida y consultas estructuradas.
#>

[CmdletBinding()]
param(
    [switch]$Reparar
)

$ErrorActionPreference = 'Continue'

# WSL escribe en UTF-16 por defecto y eso llega ilegible a PowerShell.
$env:WSL_UTF8 = 1

$problemas = @()
$necesitaReinicio = $false

function Titulo($t) {
    Write-Host ""
    Write-Host "=== $t ===" -ForegroundColor Cyan
}

function Ok($t)    { Write-Host "  [ OK ] $t" -ForegroundColor Green }
function Falla($t) { Write-Host "  [FALLA] $t" -ForegroundColor Red }
function Aviso($t) { Write-Host "  [ ! ] $t" -ForegroundColor Yellow }
function Dato($t)  { Write-Host "         $t" -ForegroundColor DarkGray }

function EsAdministrador {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---------------------------------------------------------------------------
Titulo "0. Contexto"

$admin = EsAdministrador
if ($admin) { Ok "PowerShell con permisos de Administrador" }
else {
    Aviso "PowerShell SIN permisos de Administrador"
    Dato "El diagnostico funciona igual, pero algunas revisiones y todos los"
    Dato "arreglos necesitan Administrador. Cierra y abre PowerShell con"
    Dato "'Ejecutar como administrador'."
}

try {
    $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
    # EditionID viene siempre en ingles, aunque Windows este en espanol.
    Dato "Edicion:  $($cv.EditionID)"
    Dato "Version:  $($cv.DisplayVersion)  (build $($cv.CurrentBuild).$($cv.UBR))"
    if ([int]$cv.CurrentBuild -lt 22000) {
        Aviso "Esto no es Windows 11. La guia asume Windows 11."
    }
} catch {
    Aviso "No se pudo leer la version de Windows del registro."
}

# ---------------------------------------------------------------------------
Titulo "1. Virtualizacion del procesador"

$virtOk = $false
try {
    $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
    $cpu = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1

    if ($cs.HypervisorPresent) {
        Ok "Hay un hipervisor activo (la virtualizacion esta funcionando)"
        $virtOk = $true
    } elseif ($cpu.VirtualizationFirmwareEnabled) {
        Ok "Virtualizacion habilitada en la BIOS"
        $virtOk = $true
    } else {
        Falla "Virtualizacion DESHABILITADA en la BIOS"
        Dato "Nada de lo demas va a funcionar sin esto. Entra a la BIOS al"
        Dato "arrancar (F2, Supr o F10 segun la placa) y activa VT-x, SVM o"
        Dato "'Intel Virtualization Technology' / 'AMD-V'."
        Dato "Verificalo tambien en Administrador de tareas -> Rendimiento ->"
        Dato "CPU -> Virtualizacion."
        $problemas += "Virtualizacion apagada en la BIOS"
    }
} catch {
    Aviso "No se pudo consultar el estado de virtualizacion."
}

# ---------------------------------------------------------------------------
Titulo "2. Caracteristicas de Windows"

$caracteristicas = @(
    @{ Nombre = 'Microsoft-Windows-Subsystem-Linux'; Descripcion = 'Subsistema de Windows para Linux' },
    @{ Nombre = 'VirtualMachinePlatform';           Descripcion = 'Plataforma de maquina virtual' }
)

$faltanCaracteristicas = @()

foreach ($c in $caracteristicas) {
    try {
        $f = Get-WindowsOptionalFeature -Online -FeatureName $c.Nombre -ErrorAction Stop
        if ($f.State -eq 'Enabled') {
            Ok "$($c.Descripcion)"
        } else {
            Falla "$($c.Descripcion) -> estado: $($f.State)"
            $faltanCaracteristicas += $c.Nombre
            $problemas += "Falta habilitar $($c.Nombre)"
        }
    } catch {
        Aviso "No se pudo consultar $($c.Nombre) (requiere Administrador)"
    }
}

if ($Reparar -and $faltanCaracteristicas.Count -gt 0) {
    if (-not $admin) {
        Falla "No puedo habilitarlas sin permisos de Administrador."
    } else {
        foreach ($nombre in $faltanCaracteristicas) {
            Write-Host "  -> Habilitando $nombre ..." -ForegroundColor Yellow
            Enable-WindowsOptionalFeature -Online -FeatureName $nombre -All -NoRestart | Out-Null
        }
        $necesitaReinicio = $true
        Ok "Caracteristicas habilitadas"
    }
}

# ---------------------------------------------------------------------------
Titulo "3. Version de WSL"

$wslModerno = $false
$wslExiste = $null -ne (Get-Command wsl.exe -ErrorAction SilentlyContinue)

if (-not $wslExiste) {
    Falla "wsl.exe no existe en el sistema"
    $problemas += "WSL no instalado"
} else {
    # En la version antigua, 'wsl --version' imprime la AYUDA y devuelve 1.
    $salida = (& wsl.exe --version 2>&1 | Out-String)
    $codigo = $LASTEXITCODE

    if ($codigo -eq 0 -and $salida -match '(\d+)\.(\d+)\.(\d+)') {
        $version = [version]("{0}.{1}.{2}" -f $Matches[1], $Matches[2], $Matches[3])
        if ($version -ge [version]'2.1.5') {
            Ok "WSL $version  (Docker Desktop pide 2.1.5 o superior)"
            $wslModerno = $true
        } else {
            Falla "WSL $version es anterior a la 2.1.5 que pide Docker Desktop"
            $problemas += "WSL desactualizado"
        }
    } else {
        Falla "wsl.exe no reconoce --version"
        Dato "Es la version antigua incorporada en Windows. Este es exactamente"
        Dato "el error que reporta Docker Desktop: recibe el texto de ayuda en"
        Dato "vez de un numero de version."
        $problemas += "WSL antiguo, sin soporte para --version"
    }
}

if ($Reparar -and -not $wslModerno -and -not $necesitaReinicio) {
    if (-not $admin) {
        Falla "Necesito Administrador para actualizar WSL."
    } else {
        Write-Host "  -> Ejecutando 'wsl --update' ..." -ForegroundColor Yellow
        & wsl.exe --update 2>&1 | Out-String | Write-Host
        if ($LASTEXITCODE -ne 0) {
            Falla "'wsl --update' fallo (codigo $LASTEXITCODE)"
            Dato "Instala WSL a mano, cualquiera de las dos vias:"
            Dato "  - Microsoft Store, busca 'Windows Subsystem for Linux'"
            Dato "  - MSI en https://github.com/microsoft/WSL/releases"
            $problemas += "wsl --update fallo; instalar a mano"
        } else {
            Ok "WSL actualizado. Reinicia y vuelve a correr este script."
            $necesitaReinicio = $true
        }
    }
}

# ---------------------------------------------------------------------------
Titulo "4. Distribuciones instaladas"

if ($wslExiste) {
    $distros = (& wsl.exe -l -q 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and $distros) {
        Ok "Distribuciones encontradas:"
        $distros -split "`r?`n" | Where-Object { $_.Trim() } | ForEach-Object {
            Dato "  - $($_.Trim())"
        }
        # Detalle con version de WSL por distro (1 vs 2)
        $detalle = (& wsl.exe -l -v 2>&1 | Out-String).Trim()
        if ($detalle) { Dato "" ; $detalle -split "`r?`n" | ForEach-Object { Dato $_ } }
    } else {
        Falla "No hay ninguna distribucion de Linux instalada"
        Dato "Docker Desktop necesita al menos una (Ubuntu) para funcionar."
        $problemas += "Sin distribucion de Linux"

        if ($Reparar -and $admin -and $wslModerno) {
            Write-Host "  -> Instalando Ubuntu ..." -ForegroundColor Yellow
            & wsl.exe --set-default-version 2 2>&1 | Out-Null
            & wsl.exe --install -d Ubuntu 2>&1 | Out-String | Write-Host
            $necesitaReinicio = $true
        }
    }
} else {
    Falla "Sin wsl.exe no se puede revisar esto"
}

# ---------------------------------------------------------------------------
Titulo "Resultado"

if ($problemas.Count -eq 0) {
    Write-Host ""
    Write-Host "  Todo en orden por el lado de WSL." -ForegroundColor Green
    Write-Host ""
    Write-Host "  Siguiente paso: abre Docker Desktop y dale Restart. Despues" -ForegroundColor Green
    Write-Host "  ve a Settings -> Resources -> WSL Integration y activa el" -ForegroundColor Green
    Write-Host "  interruptor de Ubuntu." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  Problemas encontrados, en orden de dependencia:" -ForegroundColor Red
    $i = 1
    foreach ($p in $problemas) {
        Write-Host "   $i. $p" -ForegroundColor Red
        $i++
    }
    Write-Host ""
    if (-not $Reparar) {
        Write-Host "  Para intentar arreglarlos automaticamente, abre PowerShell" -ForegroundColor Yellow
        Write-Host "  como Administrador y corre:" -ForegroundColor Yellow
        Write-Host "      .\diagnostico-wsl.ps1 -Reparar" -ForegroundColor White
    }
}

if ($necesitaReinicio) {
    Write-Host ""
    Write-Host "  *** REINICIA EL EQUIPO y vuelve a correr este script. ***" -ForegroundColor Magenta
    Write-Host "  Los cambios de caracteristicas de Windows y de WSL no toman" -ForegroundColor Magenta
    Write-Host "  efecto hasta reiniciar." -ForegroundColor Magenta
}

Write-Host ""
Write-Host "  Copia TODA esta salida si necesitas ayuda para interpretarla." -ForegroundColor DarkGray
Write-Host ""
