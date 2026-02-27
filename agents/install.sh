#!/bin/bash
# ============================================
# MSP Monitoring - Grafana Alloy 설치 스크립트
# ============================================
# 지원 OS: Ubuntu 20.04+, Debian 11+, RHEL/CentOS 8+, Amazon Linux 2023
#
# 사용법:
#   # Direct 모드 (outbound 가능)
#   sudo ./install.sh \
#     --customer-id=kt \
#     --server-name=kt-prod-web-01 \
#     --csp=kt \
#     --region=kc1 \
#     --environment=prod \
#     --mode=direct \
#     --remote-write-url=http://[중앙서버IP]:8880/api/v1/write
#
#   # 릴레이 서버 모드 (내부 에이전트들의 트래픽을 중앙으로 전달 + 자체 메트릭 수집)
#   sudo ./install.sh \
#     --mode=relay-server \
#     --customer-id=kt \
#     --server-name=kt-relay-01 \
#     --csp=kt \
#     --region=kc1 \
#     --environment=prod \
#     --remote-write-url=http://[중앙서버IP]:8880/api/v1/write
#
#   # Outbound 차단 서버 모드 (릴레이를 통해 push)
#   sudo ./install.sh \
#     --customer-id=kt \
#     --server-name=kt-prod-db-01 \
#     --csp=kt \
#     --region=kc1 \
#     --environment=prod \
#     --mode=relay-agent \
#     --relay-url=http://10.0.1.5:9999/api/v1/metrics/write

set -euo pipefail

# -----------------------------------------------
# 설정 기본값
# -----------------------------------------------
ALLOY_VERSION="1.5.1"
INSTALL_DIR="/opt/alloy"
CONFIG_DIR="/etc/alloy"
SERVICE_NAME="alloy"

# 스크립트 파일 위치 기준으로 config 파일 경로 찾기
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# -----------------------------------------------
# 인자 파싱
# -----------------------------------------------
CUSTOMER_ID=""
SERVER_NAME=""
CSP=""
REGION=""
ENVIRONMENT="prod"
MODE=""              # direct | relay-server | relay-agent
REMOTE_WRITE_URL=""  # direct/relay-server 모드에서 중앙 서버 URL
RELAY_URL=""         # relay-agent 모드에서 릴레이 서버 내부 URL

for arg in "$@"; do
  case $arg in
    --customer-id=*)    CUSTOMER_ID="${arg#*=}" ;;
    --server-name=*)    SERVER_NAME="${arg#*=}" ;;
    --csp=*)            CSP="${arg#*=}" ;;
    --region=*)         REGION="${arg#*=}" ;;
    --environment=*)    ENVIRONMENT="${arg#*=}" ;;
    --mode=*)           MODE="${arg#*=}" ;;
    --remote-write-url=*) REMOTE_WRITE_URL="${arg#*=}" ;;
    --relay-url=*)      RELAY_URL="${arg#*=}" ;;
    --help|-h)
      head -40 "$0" | grep "^#" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "[ERROR] 알 수 없는 인자: $arg"; exit 1 ;;
  esac
done

# -----------------------------------------------
# 필수 인자 검증
# -----------------------------------------------
validate_args() {
  if [[ -z "$MODE" ]]; then
    echo "[ERROR] --mode 가 필요합니다 (direct | relay-server | relay-agent)"
    exit 1
  fi

  case "$MODE" in
    direct)
      if [[ -z "$CUSTOMER_ID" ]];    then echo "[ERROR] --customer-id 필요";    exit 1; fi
      if [[ -z "$SERVER_NAME" ]];    then echo "[ERROR] --server-name 필요";    exit 1; fi
      if [[ -z "$CSP" ]];            then echo "[ERROR] --csp 필요";            exit 1; fi
      if [[ -z "$REGION" ]];         then echo "[ERROR] --region 필요";         exit 1; fi
      if [[ -z "$REMOTE_WRITE_URL" ]]; then echo "[ERROR] --remote-write-url 필요"; exit 1; fi
      ;;
    relay-server)
      if [[ -z "$CUSTOMER_ID" ]];    then echo "[ERROR] --customer-id 필요";    exit 1; fi
      if [[ -z "$SERVER_NAME" ]];    then echo "[ERROR] --server-name 필요";    exit 1; fi
      if [[ -z "$CSP" ]];            then echo "[ERROR] --csp 필요";            exit 1; fi
      if [[ -z "$REGION" ]];         then echo "[ERROR] --region 필요";         exit 1; fi
      if [[ -z "$REMOTE_WRITE_URL" ]]; then echo "[ERROR] --remote-write-url 필요"; exit 1; fi
      ;;
    relay-agent)
      if [[ -z "$CUSTOMER_ID" ]];    then echo "[ERROR] --customer-id 필요";    exit 1; fi
      if [[ -z "$SERVER_NAME" ]];    then echo "[ERROR] --server-name 필요";    exit 1; fi
      if [[ -z "$CSP" ]];            then echo "[ERROR] --csp 필요";            exit 1; fi
      if [[ -z "$REGION" ]];         then echo "[ERROR] --region 필요";         exit 1; fi
      if [[ -z "$RELAY_URL" ]];      then echo "[ERROR] --relay-url 필요";      exit 1; fi
      ;;
    *)
      echo "[ERROR] 알 수 없는 모드: $MODE (direct | relay-server | relay-agent)"
      exit 1
      ;;
  esac
}

# -----------------------------------------------
# OS 감지
# -----------------------------------------------
detect_os() {
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    OS_ID="$ID"
    OS_VERSION="$VERSION_ID"
  else
    echo "[ERROR] /etc/os-release 파일을 찾을 수 없습니다."
    exit 1
  fi

  case "$OS_ID" in
    ubuntu|debian)   PKG_TYPE="deb" ;;
    rhel|centos|fedora|amzn|rocky|almalinux) PKG_TYPE="rpm" ;;
    *)
      echo "[ERROR] 지원하지 않는 OS: $OS_ID"
      exit 1
      ;;
  esac

  echo "[INFO] OS: $OS_ID $OS_VERSION ($PKG_TYPE)"
}

# -----------------------------------------------
# Grafana Alloy 설치
# -----------------------------------------------
install_alloy() {
  echo "[INFO] Grafana Alloy v${ALLOY_VERSION} 설치 중..."

  if command -v alloy &>/dev/null; then
    INSTALLED_VERSION=$(alloy --version 2>&1 | grep -oP 'v[\d.]+' | head -1 || true)
    echo "[INFO] Alloy 이미 설치됨: $INSTALLED_VERSION"
    return
  fi

  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64)  ARCH_SUFFIX="amd64" ;;
    aarch64) ARCH_SUFFIX="arm64" ;;
    *)
      echo "[ERROR] 지원하지 않는 아키텍처: $ARCH"
      exit 1
      ;;
  esac

  if [[ "$PKG_TYPE" == "deb" ]]; then
    # Ubuntu/Debian: Grafana 공식 저장소
    apt-get install -y apt-transport-https software-properties-common wget curl
    wget -q -O /usr/share/keyrings/grafana.key https://apt.grafana.com/gpg.key
    echo "deb [signed-by=/usr/share/keyrings/grafana.key] https://apt.grafana.com stable main" \
      > /etc/apt/sources.list.d/grafana.list
    apt-get update -q
    apt-get install -y alloy

  elif [[ "$PKG_TYPE" == "rpm" ]]; then
    # RHEL/CentOS/Amazon Linux: Grafana 공식 저장소
    cat > /etc/yum.repos.d/grafana.repo <<'REPOEOF'
[grafana]
name=grafana
baseurl=https://rpm.grafana.com
repo_gpgcheck=1
enabled=1
gpgcheck=1
gpgkey=https://rpm.grafana.com/gpg.key
sslverify=1
sslcacert=/etc/pki/tls/certs/ca-bundle.crt
REPOEOF
    yum install -y alloy
  fi

  echo "[INFO] Alloy 설치 완료"
}

# -----------------------------------------------
# Config 파일 배포
# -----------------------------------------------
deploy_config() {
  mkdir -p "$CONFIG_DIR"

  case "$MODE" in
    direct)
      CONFIG_SRC="$SCRIPT_DIR/direct/config.alloy"
      ;;
    relay-server)
      CONFIG_SRC="$SCRIPT_DIR/relay/relay-server.alloy"
      ;;
    relay-agent)
      CONFIG_SRC="$SCRIPT_DIR/relay/agent-to-relay.alloy"
      ;;
  esac

  if [[ ! -f "$CONFIG_SRC" ]]; then
    echo "[ERROR] Config 파일 없음: $CONFIG_SRC"
    echo "        install.sh 와 같은 디렉토리에 agents/ 구조가 있어야 합니다."
    exit 1
  fi

  cp "$CONFIG_SRC" "$CONFIG_DIR/config.alloy"
  echo "[INFO] Config 배포 완료: $CONFIG_DIR/config.alloy"
}

# -----------------------------------------------
# 환경변수 파일 생성
# -----------------------------------------------
write_env_file() {
  ENV_FILE="/etc/alloy/alloy.env"

  case "$MODE" in
    direct)
      cat > "$ENV_FILE" <<ENVEOF
CUSTOMER_ID=${CUSTOMER_ID}
SERVER_NAME=${SERVER_NAME}
CSP=${CSP}
REGION=${REGION}
ENVIRONMENT=${ENVIRONMENT}
REMOTE_WRITE_URL=${REMOTE_WRITE_URL}
ENVEOF
      ;;

    relay-server)
      cat > "$ENV_FILE" <<ENVEOF
REMOTE_WRITE_URL=${REMOTE_WRITE_URL}
RELAY_CUSTOMER_ID=${CUSTOMER_ID:-relay}
RELAY_SERVER_NAME=${SERVER_NAME:-relay-server}
RELAY_CSP=${CSP:-unknown}
RELAY_REGION=${REGION:-unknown}
RELAY_ENVIRONMENT=${ENVIRONMENT}
ENVEOF
      ;;

    relay-agent)
      cat > "$ENV_FILE" <<ENVEOF
CUSTOMER_ID=${CUSTOMER_ID}
SERVER_NAME=${SERVER_NAME}
CSP=${CSP}
REGION=${REGION}
ENVIRONMENT=${ENVIRONMENT}
RELAY_URL=${RELAY_URL}
ENVEOF
      ;;
  esac

  chmod 600 "$ENV_FILE"
  echo "[INFO] 환경변수 파일 생성: $ENV_FILE"
}

# -----------------------------------------------
# systemd 서비스 설정
# -----------------------------------------------
setup_systemd() {
  cat > /etc/systemd/system/alloy.service <<SVCEOF
[Unit]
Description=Grafana Alloy MSP Agent (${MODE})
Documentation=https://grafana.com/docs/alloy/
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=alloy
Group=alloy
EnvironmentFile=/etc/alloy/alloy.env
ExecStart=/usr/bin/alloy run /etc/alloy/config.alloy \
  --stability.level=generally-available \
  --storage.path=/var/lib/alloy

Restart=on-failure
RestartSec=5s

# 로그
StandardOutput=journal
StandardError=journal
SyslogIdentifier=alloy

[Install]
WantedBy=multi-user.target
SVCEOF

  systemctl daemon-reload
  systemctl enable alloy
  systemctl restart alloy

  echo "[INFO] systemd 서비스 등록 및 시작 완료"
}

# -----------------------------------------------
# 방화벽 규칙 (relay-server 모드: 포트 9999 오픈)
# -----------------------------------------------
open_relay_port() {
  if [[ "$MODE" != "relay-server" ]]; then
    return
  fi

  echo "[INFO] 릴레이 포트 9999 방화벽 오픈..."

  if command -v ufw &>/dev/null; then
    ufw allow 9999/tcp || true
  elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --add-port=9999/tcp || true
    firewall-cmd --reload || true
  else
    echo "[WARN] 방화벽 관리 도구 없음 (ufw/firewalld). 포트 9999는 수동으로 오픈 필요."
  fi
}

# -----------------------------------------------
# 상태 확인
# -----------------------------------------------
check_status() {
  sleep 3
  echo ""
  echo "============================="
  echo " 설치 완료"
  echo "============================="
  echo " 모드        : $MODE"
  [[ -n "$CUSTOMER_ID" ]] && echo " Customer ID : $CUSTOMER_ID"
  [[ -n "$SERVER_NAME" ]] && echo " Server Name : $SERVER_NAME"
  [[ -n "$CSP" ]]         && echo " CSP         : $CSP"
  [[ -n "$REGION" ]]      && echo " Region      : $REGION"
  echo ""

  if systemctl is-active --quiet alloy; then
    echo " [OK] Alloy 실행 중"
  else
    echo " [ERROR] Alloy 실행 실패 - 로그 확인:"
    echo "  journalctl -u alloy -n 30"
  fi

  if [[ "$MODE" == "relay-server" ]]; then
    echo ""
    echo " 릴레이 수신 포트: 9999"
    echo " 내부 서버에서 이 서버의 내부 IP:9999 로 push 설정하세요."
  fi
  echo "============================="
}

# -----------------------------------------------
# 메인
# -----------------------------------------------
main() {
  if [[ $EUID -ne 0 ]]; then
    echo "[ERROR] root 권한 필요: sudo ./install.sh ..."
    exit 1
  fi

  validate_args
  detect_os
  install_alloy
  deploy_config
  write_env_file
  open_relay_port
  setup_systemd
  check_status
}

main
