# ============================================
# MSP Monitoring - Grafana Alloy Windows 설치 스크립트
# ============================================
# 지원 OS: Windows Server 2016+, Windows 10/11
#
# 사용법 (관리자 PowerShell):
#   # Direct 모드
#   .\install.ps1 `
#     -Mode direct `
#     -CustomerId kt `
#     -ServerName kt-prod-web-01 `
#     -Csp kt `
#     -Region kc1 `
#     -Environment prod `
#     -RemoteWriteUrl http://[중앙서버IP]:8880/api/v1/write
#
#   # Relay-agent 모드 (outbound 차단 서버)
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
# 설정
# -----------------------------------------------
$AlloyVersion = "1.5.1"
$InstallDir   = "$env:ProgramFiles\GrafanaLabs\Alloy"
$ConfigDir    = "$env:ProgramData\GrafanaAlloy"
$ServiceName  = "GrafanaAlloy"
$AlloyExe     = "$InstallDir\alloy.exe"
$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path

# -----------------------------------------------
# 헬퍼
# -----------------------------------------------
function Write-Step($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Fail($msg) {
    Write-Host "[ERROR] $msg" -ForegroundColor Red
    exit 1
}

# -----------------------------------------------
# 필수 인자 검증
# -----------------------------------------------
function Invoke-ValidateArgs {
    if (-not $Mode) { Write-Fail "--Mode 필요 (direct | relay-agent)" }

    switch ($Mode) {
        "direct" {
            if (-not $CustomerId)      { Write-Fail "--CustomerId 필요" }
            if (-not $ServerName)      { Write-Fail "--ServerName 필요" }
            if (-not $Csp)             { Write-Fail "--Csp 필요" }
            if (-not $Region)          { Write-Fail "--Region 필요" }
            if (-not $RemoteWriteUrl)  { Write-Fail "--RemoteWriteUrl 필요" }
        }
        "relay-agent" {
            if (-not $CustomerId)  { Write-Fail "--CustomerId 필요" }
            if (-not $ServerName)  { Write-Fail "--ServerName 필요" }
            if (-not $Csp)         { Write-Fail "--Csp 필요" }
            if (-not $Region)      { Write-Fail "--Region 필요" }
            if (-not $RelayUrl)    { Write-Fail "--RelayUrl 필요" }
        }
        default { Write-Fail "알 수 없는 모드: $Mode (direct | relay-agent)" }
    }
}

# -----------------------------------------------
# Grafana Alloy 설치
# -----------------------------------------------
function Install-Alloy {
    Write-Step "Grafana Alloy v$AlloyVersion 설치 확인..."

    if (Test-Path $AlloyExe) {
        $ver = (& $AlloyExe --version 2>&1) -join "" | Select-String -Pattern "v[\d.]+" |
               ForEach-Object { $_.Matches[0].Value }
        Write-OK "Alloy 이미 설치됨: $ver"
        return
    }

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    $arch   = if ([System.Environment]::Is64BitOperatingSystem) { "amd64" } else { "386" }
    $zipUrl = "https://github.com/grafana/alloy/releases/download/v$AlloyVersion/alloy-windows-$arch.exe.zip"
    $zipTmp = "$env:TEMP\alloy-windows.zip"
    $exeTmp = "$env:TEMP\alloy-extract"

    Write-Step "다운로드 중: $zipUrl"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipTmp -UseBasicParsing

    Write-Step "압축 해제 중..."
    Expand-Archive -Path $zipTmp -DestinationPath $exeTmp -Force

    $exeFile = Get-ChildItem -Path $exeTmp -Filter "alloy*.exe" -Recurse | Select-Object -First 1
    if (-not $exeFile) { Write-Fail "zip에서 alloy exe를 찾을 수 없습니다." }
    Copy-Item $exeFile.FullName -Destination $AlloyExe -Force

    Remove-Item $zipTmp  -Force
    Remove-Item $exeTmp  -Recurse -Force

    Write-OK "Alloy 설치 완료: $AlloyExe"
}

# -----------------------------------------------
# Config 파일 배포
# -----------------------------------------------
function Deploy-Config {
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

    $configSrc = switch ($Mode) {
        "direct"      { "$ScriptDir\direct\config-windows.alloy" }
        "relay-agent" { "$ScriptDir\relay\agent-to-relay-windows.alloy" }
    }

    if (-not (Test-Path $configSrc)) {
        Write-Fail "Config 파일 없음: $configSrc`n install.ps1과 같은 디렉토리에 agents/ 구조가 있어야 합니다."
    }

    Copy-Item $configSrc -Destination "$ConfigDir\config.alloy" -Force
    Write-OK "Config 배포 완료: $ConfigDir\config.alloy"
}

# -----------------------------------------------
# Windows 서비스 등록 + 환경변수 설정
# -----------------------------------------------
function Setup-Service {
    $dataDir = "$ConfigDir\data"
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

    # 기존 서비스 제거
    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Step "기존 서비스 제거 중..."
        if ($existing.Status -eq "Running") {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        }
        & sc.exe delete $ServiceName | Out-Null
        Start-Sleep -Seconds 2
    }

    # 서비스 생성
    $binPath = "`"$AlloyExe`" run `"$ConfigDir\config.alloy`" " +
               "--stability.level=generally-available " +
               "--storage.path=`"$dataDir`""

    New-Service `
        -Name        $ServiceName `
        -BinaryPathName $binPath `
        -DisplayName "Grafana Alloy MSP Agent ($Mode)" `
        -Description "MSP Monitoring Agent - Grafana Alloy" `
        -StartupType Automatic | Out-Null

    # 환경변수 설정 (Registry MultiString)
    $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
    $envVars = switch ($Mode) {
        "direct" { @(
            "CUSTOMER_ID=$CustomerId",
            "SERVER_NAME=$ServerName",
            "CSP=$Csp",
            "REGION=$Region",
            "ENVIRONMENT=$Environment",
            "REMOTE_WRITE_URL=$RemoteWriteUrl"
        )}
        "relay-agent" { @(
            "CUSTOMER_ID=$CustomerId",
            "SERVER_NAME=$ServerName",
            "CSP=$Csp",
            "REGION=$Region",
            "ENVIRONMENT=$Environment",
            "RELAY_URL=$RelayUrl"
        )}
    }
    New-ItemProperty -Path $regPath -Name "Environment" -Value $envVars `
                     -PropertyType MultiString -Force | Out-Null

    # 서비스 시작
    Start-Service -Name $ServiceName
    Write-OK "Windows 서비스 등록 및 시작 완료"
}

# -----------------------------------------------
# 방화벽 규칙 (relay-server 전용 — 현재 미사용)
# -----------------------------------------------
function Open-RelayPort {
    if ($Mode -ne "relay-server") { return }
    Write-Step "릴레이 포트 9999 방화벽 오픈..."
    try {
        New-NetFirewallRule -DisplayName "MSP Alloy Relay (9999)" `
            -Direction Inbound -Protocol TCP -LocalPort 9999 `
            -Action Allow -ErrorAction Stop | Out-Null
        Write-OK "방화벽 규칙 추가 완료 (TCP 9999)"
    } catch {
        Write-Warn "방화벽 규칙 추가 실패 (수동 설정 필요): $_"
    }
}

# -----------------------------------------------
# 상태 확인
# -----------------------------------------------
function Show-Status {
    Start-Sleep -Seconds 3
    Write-Host ""
    Write-Host "=============================" -ForegroundColor Green
    Write-Host " 설치 완료"                    -ForegroundColor Green
    Write-Host "=============================" -ForegroundColor Green
    Write-Host " 모드        : $Mode"
    if ($CustomerId)  { Write-Host " Customer ID : $CustomerId" }
    if ($ServerName)  { Write-Host " Server Name : $ServerName" }
    if ($Csp)         { Write-Host " CSP         : $Csp" }
    if ($Region)      { Write-Host " Region      : $Region" }
    Write-Host ""

    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq "Running") {
        Write-Host " [OK] Alloy 실행 중" -ForegroundColor Green
    } else {
        Write-Host " [ERROR] Alloy 실행 실패" -ForegroundColor Red
        Write-Host "  이벤트 뷰어 → Windows 로그 → Application → 소스: GrafanaAlloy"
    }
    Write-Host ""
    Write-Host " 로그 확인: Get-EventLog -LogName Application -Source GrafanaAlloy -Newest 20"
    Write-Host " 서비스 재시작: Restart-Service $ServiceName"
    Write-Host "=============================" -ForegroundColor Green
}

# -----------------------------------------------
# 메인
# -----------------------------------------------
Invoke-ValidateArgs
Install-Alloy
Deploy-Config
Setup-Service
Open-RelayPort
Show-Status
