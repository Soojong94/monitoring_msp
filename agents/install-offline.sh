#!/bin/bash
# ============================================
# MSP Monitoring - Grafana Alloy 오프라인 설치 스크립트
# ============================================
# 인터넷 없이 동봉된 바이너리로 설치.
# build-package.sh 로 생성된 tar.gz 패키지에 포함.
#
# 사용법:
#   # 릴레이 서버 모드
#   sudo ./install.sh \
#     --mode=relay-server \
#     --customer-id=kt \
#     --server-name=kt-relay-01 \
#     --csp=kt \
#     --region=kc1 \
#     --environment=prod \
#     --remote-write-url=http://[중앙서버IP]:8880/api/v1/write
#
#   # 릴레이 에이전트 모드 (폐쇄망 서버)
#   sudo ./install.sh \
#     --mode=relay-agent \
#     --customer-id=kt \
#     --server-name=kt-prod-db-01 \
#     --csp=kt \
#     --region=kc1 \
#     --environment=prod \
#     --relay-url=http://10.0.1.5:9999/api/v1/metrics/write

set -euo pipefail

# -----------------------------------------------
# 설정
# -----------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="/etc/alloy"
SERVICE_NAME="alloy"

# -----------------------------------------------
# 인자 파싱
# -----------------------------------------------
CUSTOMER_ID=""
SERVER_NAME=""
CSP=""
REGION=""
ENVIRONMENT="prod"
MODE=""
REMOTE_WRITE_URL=""
RELAY_URL=""

for arg in "$@"; do
  case $arg in
    --customer-id=*)      CUSTOMER_ID="${arg#*=}" ;;
    --server-name=*)      SERVER_NAME="${arg#*=}" ;;
    --csp=*)              CSP="${arg#*=}" ;;
    --region=*)           REGION="${arg#*=}" ;;
    --environment=*)      ENVIRONMENT="${arg#*=}" ;;
    --mode=*)             MODE="${arg#*=}" ;;
    --remote-write-url=*) REMOTE_WRITE_URL="${arg#*=}" ;;
    --relay-url=*)        RELAY_URL="${arg#*=}" ;;
    --help|-h)
      head -30 "$0" | grep "^#" | sed 's/^# \?//'
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
    echo "[ERROR] --mode 가 필요합니다 (relay-server | relay-agent)"
    exit 1
  fi

  case "$MODE" in
    relay-server)
      if [[ -z "$CUSTOMER_ID" ]];      then echo "[ERROR] --customer-id 필요";      exit 1; fi
      if [[ -z "$SERVER_NAME" ]];      then echo "[ERROR] --server-name 필요";      exit 1; fi
      if [[ -z "$CSP" ]];              then echo "[ERROR] --csp 필요";              exit 1; fi
      if [[ -z "$REGION" ]];           then echo "[ERROR] --region 필요";           exit 1; fi
      if [[ -z "$REMOTE_WRITE_URL" ]]; then echo "[ERROR] --remote-write-url 필요"; exit 1; fi
      ;;
    relay-agent)
      if [[ -z "$CUSTOMER_ID" ]];  then echo "[ERROR] --customer-id 필요";  exit 1; fi
      if [[ -z "$SERVER_NAME" ]];  then echo "[ERROR] --server-name 필요";  exit 1; fi
      if [[ -z "$CSP" ]];          then echo "[ERROR] --csp 필요";          exit 1; fi
      if [[ -z "$REGION" ]];       then echo "[ERROR] --region 필요";       exit 1; fi
      if [[ -z "$RELAY_URL" ]];    then echo "[ERROR] --relay-url 필요";    exit 1; fi
      ;;
    *)
      echo "[ERROR] 알 수 없는 모드: $MODE (relay-server | relay-agent)"
      exit 1
      ;;
  esac
}

# -----------------------------------------------
# Alloy 바이너리 설치 (오프라인)
# -----------------------------------------------
install_alloy() {
  ALLOY_BIN="$SCRIPT_DIR/bin/alloy"

  if [[ ! -f "$ALLOY_BIN" ]]; then
    echo "[ERROR] Alloy 바이너리를 찾을 수 없습니다: $ALLOY_BIN"
    echo "        build-package.sh 로 생성된 패키지를 사용하세요."
    exit 1
  fi

  if command -v alloy &>/dev/null; then
    echo "[INFO] Alloy 이미 설치됨, 덮어쓰기..."
  fi

  # 바이너리 복사
  cp "$ALLOY_BIN" /usr/bin/alloy
  chmod 755 /usr/bin/alloy

  # alloy 유저/그룹 생성
  if ! id alloy &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin alloy
    echo "[INFO] alloy 유저 생성 완료"
  fi

  # 필요 디렉토리 생성
  mkdir -p /var/lib/alloy
  mkdir -p "$CONFIG_DIR"
  chown alloy:alloy /var/lib/alloy

  echo "[INFO] Alloy 바이너리 설치 완료: /usr/bin/alloy"
}

# -----------------------------------------------
# Config 파일 배포
# -----------------------------------------------
deploy_config() {
  case "$MODE" in
    relay-server)
      CONFIG_SRC="$SCRIPT_DIR/config/relay-server.alloy"
      ;;
    relay-agent)
      CONFIG_SRC="$SCRIPT_DIR/config/relay-agent.alloy"
      ;;
  esac

  if [[ ! -f "$CONFIG_SRC" ]]; then
    echo "[ERROR] Config 파일 없음: $CONFIG_SRC"
    exit 1
  fi

  cp "$CONFIG_SRC" "$CONFIG_DIR/config.alloy"
  echo "[INFO] Config 배포 완료: $CONFIG_DIR/config.alloy"
}

# -----------------------------------------------
# 환경변수 파일 생성
# -----------------------------------------------
write_env_file() {
  ENV_FILE="$CONFIG_DIR/alloy.env"

  case "$MODE" in
    relay-server)
      cat > "$ENV_FILE" <<ENVEOF
REMOTE_WRITE_URL=${REMOTE_WRITE_URL}
RELAY_CUSTOMER_ID=${CUSTOMER_ID}
RELAY_SERVER_NAME=${SERVER_NAME}
RELAY_CSP=${CSP}
RELAY_REGION=${REGION}
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
  echo " Customer ID : $CUSTOMER_ID"
  echo " Server Name : $SERVER_NAME"
  echo " CSP         : $CSP"
  echo " Region      : $REGION"
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
  install_alloy
  deploy_config
  write_env_file
  open_relay_port
  setup_systemd
  check_status
}

main
