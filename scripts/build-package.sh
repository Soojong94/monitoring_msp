#!/bin/bash
# ============================================
# MSP Monitoring - 오프라인 배포 패키지 빌드
# ============================================
# 인터넷 되는 PC에서 실행하여 오프라인 설치 패키지 생성.
#
# 출력:
#   dist/msp-relay-linux-amd64.tar.gz  (릴레이 서버용)
#   dist/msp-agent-linux-amd64.tar.gz  (에이전트용)
#
# 사용법:
#   ./scripts/build-package.sh

set -euo pipefail

ALLOY_VERSION="1.5.1"
ALLOY_URL="https://github.com/grafana/alloy/releases/download/v${ALLOY_VERSION}/alloy-linux-amd64.zip"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"
TEMP_DIR=$(mktemp -d)

trap "rm -rf $TEMP_DIR" EXIT

echo "=========================================="
echo " MSP Agent 오프라인 패키지 빌드"
echo "=========================================="
echo " Alloy 버전: v${ALLOY_VERSION}"
echo ""

# -----------------------------------------------
# 1. Alloy 바이너리 다운로드
# -----------------------------------------------
echo "[1/4] Alloy 바이너리 다운로드 중..."

ALLOY_ZIP="$TEMP_DIR/alloy-linux-amd64.zip"
curl -fSL -o "$ALLOY_ZIP" "$ALLOY_URL"

# zip 해제 → 바이너리 추출
if command -v unzip &>/dev/null; then
  unzip -q "$ALLOY_ZIP" -d "$TEMP_DIR/alloy-extract"
else
  echo "[ERROR] unzip 이 설치되어 있지 않습니다: apt-get install unzip"
  exit 1
fi

# 바이너리 찾기 (zip 내 구조에 따라)
ALLOY_BIN=$(find "$TEMP_DIR/alloy-extract" -name "alloy-linux-amd64" -o -name "alloy" -type f | head -1)
if [[ -z "$ALLOY_BIN" ]]; then
  echo "[ERROR] zip 에서 alloy 바이너리를 찾을 수 없습니다."
  ls -la "$TEMP_DIR/alloy-extract/"
  exit 1
fi

chmod 755 "$ALLOY_BIN"
echo "[OK] 바이너리 다운로드 완료 ($(du -h "$ALLOY_BIN" | cut -f1))"

# -----------------------------------------------
# 2. relay 패키지 구성
# -----------------------------------------------
echo "[2/4] relay 패키지 구성 중..."

RELAY_DIR="$TEMP_DIR/msp-relay"
mkdir -p "$RELAY_DIR/bin" "$RELAY_DIR/config"

cp "$ALLOY_BIN" "$RELAY_DIR/bin/alloy"
cp "$PROJECT_DIR/agents/install-offline.sh" "$RELAY_DIR/install.sh"
chmod +x "$RELAY_DIR/install.sh"
cp "$PROJECT_DIR/agents/relay/relay-server.alloy" "$RELAY_DIR/config/relay-server.alloy"
cp "$PROJECT_DIR/agents/relay/agent-to-relay.alloy" "$RELAY_DIR/config/relay-agent.alloy"

cat > "$RELAY_DIR/README.txt" <<'EOF'
MSP Monitoring - 릴레이 서버 패키지
====================================

릴레이 서버 설치:
  sudo ./install.sh \
    --mode=relay-server \
    --customer-id=<고객사ID> \
    --server-name=<서버명> \
    --csp=<CSP> \
    --region=<리전> \
    --remote-write-url=http://<중앙서버IP>:8880/api/v1/write

내부 서버 → 릴레이 경유 설치:
  sudo ./install.sh \
    --mode=relay-agent \
    --customer-id=<고객사ID> \
    --server-name=<서버명> \
    --csp=<CSP> \
    --region=<리전> \
    --relay-url=http://<릴레이IP>:9999/api/v1/metrics/write

상태 확인:
  systemctl status alloy
  journalctl -u alloy -f
EOF

echo "[OK] relay 패키지 준비 완료"

# -----------------------------------------------
# 3. agent 패키지 구성
# -----------------------------------------------
echo "[3/4] agent 패키지 구성 중..."

AGENT_DIR="$TEMP_DIR/msp-agent"
mkdir -p "$AGENT_DIR/bin" "$AGENT_DIR/config"

cp "$ALLOY_BIN" "$AGENT_DIR/bin/alloy"
cp "$PROJECT_DIR/agents/install-offline.sh" "$AGENT_DIR/install.sh"
chmod +x "$AGENT_DIR/install.sh"
cp "$PROJECT_DIR/agents/relay/agent-to-relay.alloy" "$AGENT_DIR/config/relay-agent.alloy"

cat > "$AGENT_DIR/README.txt" <<'EOF'
MSP Monitoring - 에이전트 패키지
====================================

설치 (릴레이 경유):
  sudo ./install.sh \
    --mode=relay-agent \
    --customer-id=<고객사ID> \
    --server-name=<서버명> \
    --csp=<CSP> \
    --region=<리전> \
    --relay-url=http://<릴레이IP>:9999/api/v1/metrics/write

상태 확인:
  systemctl status alloy
  journalctl -u alloy -f
EOF

echo "[OK] agent 패키지 준비 완료"

# -----------------------------------------------
# 4. tar.gz 패키징
# -----------------------------------------------
echo "[4/4] tar.gz 패키징 중..."

mkdir -p "$DIST_DIR"

tar -czf "$DIST_DIR/msp-relay-linux-amd64.tar.gz" -C "$TEMP_DIR" msp-relay
tar -czf "$DIST_DIR/msp-agent-linux-amd64.tar.gz" -C "$TEMP_DIR" msp-agent

echo ""
echo "=========================================="
echo " 빌드 완료"
echo "=========================================="
echo ""
ls -lh "$DIST_DIR"/msp-*.tar.gz
echo ""
echo " 사용법:"
echo "   릴레이 서버: tar xzf msp-relay-linux-amd64.tar.gz && cd msp-relay"
echo "   에이전트:    tar xzf msp-agent-linux-amd64.tar.gz && cd msp-agent"
echo "=========================================="
