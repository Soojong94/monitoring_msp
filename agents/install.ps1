# ============================================
# MSP Monitoring - Grafana Alloy Windows Installer
# ============================================
# Supported OS: Windows Server 2016+, Windows 10/11
#
# Usage (Admin PowerShell):
#   # Direct mode
#   .\install.ps1 `
#     -Mode direct `
#     -CustomerId kt `
#     -ServerName kt-prod-web-01 `
#     -Csp kt `
#     -Region kc1 `
#     -Environment prod `
#     -RemoteWriteUrl https://grafana.tbit.co.kr/api/v1/write
#
#   # Relay-agent mode (no outbound internet)
#   .\install.ps1 `
#     -Mode relay-agent `
#     -CustomerId kt `
#     -ServerName kt-prod-db-01 `
#     -Csp kt `
#     -Region kc1 `
#     -Environment prod `
#     -RelayUrl http://10.0.1.5:9999/api/v1/metrics/write
#
#Requires -RunAsAdministrator

param(
    [string]$Mode         = "",
    [string]$CustomerId   = "",
    [string]$ServerName   = "",
    [string]$Csp          = "",
    [string]$Region       = "",
    [string]$Environment  = "prod",
    [string]$RemoteWriteUrl = "",
    [string]$RelayUrl     = ""
)

$ErrorActionPreference = "Stop"

# -----------------------------------------------
# Config
# -----------------------------------------------
$AlloyVersion = "1.5.1"
$InstallDir   = "$env:ProgramFiles\GrafanaLabs\Alloy"
$ConfigDir    = "$env:ProgramData\GrafanaAlloy"
$ServiceName  = "GrafanaAlloy"
$AlloyExe     = "$InstallDir\alloy.exe"
$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path

# -----------------------------------------------
# Helpers
# -----------------------------------------------
function Write-Step($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Fail($msg) {
    Write-Host "[ERROR] $msg" -ForegroundColor Red
    exit 1
}

# -----------------------------------------------
# Validate arguments
# -----------------------------------------------
function Invoke-ValidateArgs {
    if (-not $Mode) { Write-Fail "--Mode required (direct | relay-agent)" }

    switch ($Mode) {
        "direct" {
            if (-not $CustomerId)      { Write-Fail "--CustomerId required" }
            if (-not $ServerName)      { Write-Fail "--ServerName required" }
            if (-not $Csp)             { Write-Fail "--Csp required" }
            if (-not $Region)          { Write-Fail "--Region required" }
            if (-not $RemoteWriteUrl)  { Write-Fail "--RemoteWriteUrl required" }
        }
        "relay-agent" {
            if (-not $CustomerId)  { Write-Fail "--CustomerId required" }
            if (-not $ServerName)  { Write-Fail "--ServerName required" }
            if (-not $Csp)         { Write-Fail "--Csp required" }
            if (-not $Region)      { Write-Fail "--Region required" }
            if (-not $RelayUrl)    { Write-Fail "--RelayUrl required" }
        }
        default { Write-Fail "Unknown mode: $Mode (direct | relay-agent)" }
    }
}

# -----------------------------------------------
# Install Grafana Alloy
# -----------------------------------------------
function Install-Alloy {
    Write-Step "Checking Grafana Alloy v$AlloyVersion..."

    if (Test-Path $AlloyExe) {
        $ver = (& $AlloyExe --version 2>&1) -join "" | Select-String -Pattern "v[\d.]+" |
               ForEach-Object { $_.Matches[0].Value }
        Write-OK "Alloy already installed: $ver"
        return
    }

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    $arch   = if ([System.Environment]::Is64BitOperatingSystem) { "amd64" } else { "386" }
    $zipUrl = "https://github.com/grafana/alloy/releases/download/v$AlloyVersion/alloy-windows-$arch.exe.zip"
    $zipTmp = "$env:TEMP\alloy-windows.zip"
    $exeTmp = "$env:TEMP\alloy-extract"

    Write-Step "Downloading: $zipUrl"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipTmp -UseBasicParsing

    Write-Step "Extracting..."
    Expand-Archive -Path $zipTmp -DestinationPath $exeTmp -Force

    $exeFile = Get-ChildItem -Path $exeTmp -Filter "alloy*.exe" -Recurse | Select-Object -First 1
    if (-not $exeFile) { Write-Fail "alloy exe not found in zip." }
    Copy-Item $exeFile.FullName -Destination $AlloyExe -Force

    Remove-Item $zipTmp  -Force
    Remove-Item $exeTmp  -Recurse -Force

    Write-OK "Alloy installed: $AlloyExe"
}

# -----------------------------------------------
# Deploy config file
# -----------------------------------------------
function Deploy-Config {
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

    $configSrc = switch ($Mode) {
        "direct"      { "$ScriptDir\direct\config-windows.alloy" }
        "relay-agent" { "$ScriptDir\relay\agent-to-relay-windows.alloy" }
    }

    if (-not (Test-Path $configSrc)) {
        Write-Fail "Config file not found: $configSrc - agents/ directory must be alongside install.ps1"
    }

    Copy-Item $configSrc -Destination "$ConfigDir\config.alloy" -Force
    Write-OK "Config deployed: $ConfigDir\config.alloy"
}

# -----------------------------------------------
# Register Windows service + set env vars
# -----------------------------------------------
function Install-WinSW {
    $winswExe = "$InstallDir\alloy-service.exe"
    if (Test-Path $winswExe) {
        Write-OK "WinSW already present"
        return $winswExe
    }

    Write-Step "Downloading WinSW (service wrapper)..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest `
        -Uri "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe" `
        -OutFile $winswExe `
        -UseBasicParsing
    Write-OK "WinSW downloaded: $winswExe"
    return $winswExe
}

function Invoke-SetupService {
    $dataDir    = "$ConfigDir\data"
    $logDir     = "$ConfigDir\logs"
    $xmlPath    = "$InstallDir\alloy-service.xml"

    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    New-Item -ItemType Directory -Force -Path $logDir  | Out-Null

    $winsw = Install-WinSW

    # Remove existing service
    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Step "Removing existing service..."
        if ($existing.Status -eq "Running") {
            & $winsw stop | Out-Null
        }
        & $winsw uninstall | Out-Null
        Start-Sleep -Seconds 2
    }

    # Build env vars XML fragment
    $envXml = switch ($Mode) {
        "direct" { @"
  <env name="CUSTOMER_ID"      value="$CustomerId" />
  <env name="SERVER_NAME"      value="$ServerName" />
  <env name="CSP"              value="$Csp" />
  <env name="REGION"           value="$Region" />
  <env name="ENVIRONMENT"      value="$Environment" />
  <env name="REMOTE_WRITE_URL" value="$RemoteWriteUrl" />
"@ }
        "relay-agent" { @"
  <env name="CUSTOMER_ID"  value="$CustomerId" />
  <env name="SERVER_NAME"  value="$ServerName" />
  <env name="CSP"          value="$Csp" />
  <env name="REGION"       value="$Region" />
  <env name="ENVIRONMENT"  value="$Environment" />
  <env name="RELAY_URL"    value="$RelayUrl" />
"@ }
    }

    # Write WinSW XML config (must sit next to alloy-service.exe)
    $xml = @"
<service>
  <id>$ServiceName</id>
  <name>Grafana Alloy MSP Agent ($Mode)</name>
  <description>MSP Monitoring Agent - Grafana Alloy</description>
  <executable>$AlloyExe</executable>
  <arguments>run "$ConfigDir\config.alloy" --stability.level=generally-available --storage.path="$dataDir"</arguments>
  <startmode>Automatic</startmode>
  <logpath>$logDir</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>
$envXml</service>
"@
    $xml | Set-Content -Path $xmlPath -Encoding UTF8

    # Register and start service via WinSW
    Write-Step "Registering service via WinSW..."
    & $winsw install $xmlPath | Out-Null

    # Start service
    try {
        Start-Service -Name $ServiceName -ErrorAction Stop
        Write-OK "Service registered and started via WinSW"
    } catch {
        Write-Warn "Service start failed: $_"
        Write-Warn "Check logs: $logDir\$ServiceName.out.log"
    }
}

# -----------------------------------------------
# Firewall rule (relay-server only - currently unused)
# -----------------------------------------------
function Open-RelayPort {
    if ($Mode -ne "relay-server") { return }
    Write-Step "Opening relay port 9999..."
    try {
        New-NetFirewallRule -DisplayName "MSP Alloy Relay (9999)" `
            -Direction Inbound -Protocol TCP -LocalPort 9999 `
            -Action Allow -ErrorAction Stop | Out-Null
        Write-OK "Firewall rule added (TCP 9999)"
    } catch {
        Write-Warn "Firewall rule failed (manual config needed): $_"
    }
}

# -----------------------------------------------
# Show status
# -----------------------------------------------
function Show-Status {
    Start-Sleep -Seconds 3
    Write-Host ""
    Write-Host "=============================" -ForegroundColor Green
    Write-Host " Installation Complete"        -ForegroundColor Green
    Write-Host "=============================" -ForegroundColor Green
    Write-Host " Mode        : $Mode"
    if ($CustomerId)  { Write-Host " Customer ID : $CustomerId" }
    if ($ServerName)  { Write-Host " Server Name : $ServerName" }
    if ($Csp)         { Write-Host " CSP         : $Csp" }
    if ($Region)      { Write-Host " Region      : $Region" }
    Write-Host ""

    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq "Running") {
        Write-Host " [OK] Alloy running" -ForegroundColor Green
    } else {
        Write-Host " [ERROR] Alloy failed to start" -ForegroundColor Red
        Write-Host "  Check: Get-Content '$ConfigDir\logs\alloy.log' -Tail 30" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host " Check logs  : Get-Content '$ConfigDir\logs\$ServiceName.out.log' -Tail 30"
    Write-Host " Restart     : Restart-Service $ServiceName"
    Write-Host "=============================" -ForegroundColor Green
}

# -----------------------------------------------
# Main
# -----------------------------------------------
Invoke-ValidateArgs
Install-Alloy
Deploy-Config
Invoke-SetupService
Open-RelayPort
Show-Status
