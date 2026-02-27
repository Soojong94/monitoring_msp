# 에이전트 오프라인 설치 가이드

인터넷이 없는 폐쇄망 서버에 모니터링 에이전트를 설치하는 방법.

## 개요

```
[인터넷 PC] → build-package.sh → tar.gz 생성
                                      ↓ SCP/USB
[릴레이 서버] ← msp-relay-linux-amd64.tar.gz
[에이전트 서버] ← msp-agent-linux-amd64.tar.gz
```

**패키지 2종:**

| 패키지 | 대상 | 포함 모드 |
|--------|------|-----------|
| `msp-relay-linux-amd64.tar.gz` | 릴레이 서버 | relay-server, relay-agent |
| `msp-agent-linux-amd64.tar.gz` | 내부 서버 | relay-agent |

---

## 1단계: 패키지 빌드 (인터넷 되는 PC에서)

### 사전 요구사항

- Linux 또는 WSL 환경
- `curl`, `unzip` 설치 필요

### 빌드 실행

```bash
git clone https://github.com/Soojong94/monitoring_msp.git
cd monitoring_msp

chmod +x scripts/build-package.sh
./scripts/build-package.sh
```

### 결과물

```
dist/
├── msp-relay-linux-amd64.tar.gz   (~80MB)
└── msp-agent-linux-amd64.tar.gz   (~80MB)
```

---

## 2단계: 서버에 파일 전달

SCP, USB, 또는 내부 파일 전송 시스템으로 전달.

```bash
# 릴레이 서버로 전달
scp dist/msp-relay-linux-amd64.tar.gz user@릴레이서버IP:/tmp/

# 에이전트 서버로 전달 (릴레이 경유 가능)
scp dist/msp-agent-linux-amd64.tar.gz user@에이전트서버IP:/tmp/
```

---

## 3단계: 릴레이 서버 설치

릴레이 서버는 내부 에이전트들의 메트릭을 받아 중앙 서버로 전달하며, 자체 OS 메트릭도 수집합니다.

```bash
cd /tmp
tar xzf msp-relay-linux-amd64.tar.gz
cd msp-relay

sudo ./install.sh \
  --mode=relay-server \
  --customer-id=<고객사ID> \
  --server-name=<서버명> \
  --csp=<CSP> \
  --region=<리전> \
  --environment=prod \
  --remote-write-url=http://<중앙서버IP>:8880/api/v1/write
```

### 파라미터 설명

| 파라미터 | 설명 | 예시 |
|----------|------|------|
| `--mode` | 설치 모드 | `relay-server` |
| `--customer-id` | 고객사 식별자 | `kt`, `naver`, `nhn` |
| `--server-name` | 서버 이름 | `kt-relay-01` |
| `--csp` | 클라우드 제공자 | `kt`, `aws`, `naver`, `nhn` |
| `--region` | 리전 | `kc1`, `ap-northeast-2` |
| `--environment` | 환경 (기본값: prod) | `prod`, `staging`, `test` |
| `--remote-write-url` | 중앙 서버 수신 URL | `http://1.2.3.4:8880/api/v1/write` |

### 설치 확인

```bash
systemctl status alloy          # 실행 상태 확인
journalctl -u alloy -f          # 실시간 로그
ss -tlnp | grep 9999            # 릴레이 포트 리스닝 확인
```

`[OK] Alloy 실행 중` 메시지와 포트 9999 리스닝이 확인되면 성공.

---

## 4단계: 에이전트 서버 설치

내부 서버에서 릴레이를 경유하여 메트릭을 전송합니다.

```bash
cd /tmp
tar xzf msp-agent-linux-amd64.tar.gz
cd msp-agent

sudo ./install.sh \
  --mode=relay-agent \
  --customer-id=<고객사ID> \
  --server-name=<서버명> \
  --csp=<CSP> \
  --region=<리전> \
  --environment=prod \
  --relay-url=http://<릴레이서버IP>:9999/api/v1/metrics/write
```

| 파라미터 | 설명 | 예시 |
|----------|------|------|
| `--relay-url` | 릴레이 서버 내부 주소 | `http://10.0.1.5:9999/api/v1/metrics/write` |

### 설치 확인

```bash
systemctl status alloy
journalctl -u alloy -f
```

---

## 5단계: 메트릭 수신 검증

중앙 서버에서 확인:

```bash
# VictoriaMetrics에서 등록된 서버 목록 조회
curl -s "http://중앙서버IP:8880/api/v1/label/server_name/values"
# 결과: {"status":"success","data":["relay-01","agent-01",...]}
```

또는 Grafana 대시보드에서 확인:
- `http://중앙서버IP:8880` 접속
- Nginx Basic Auth: `admin` / `changeme`
- Grafana 로그인: `admin` / `changeme`
- MSP Overview 대시보드에서 서버 목록 확인

---

## 패키지 내부 구조

```
msp-relay/                          msp-agent/
├── install.sh                      ├── install.sh
├── bin/                            ├── bin/
│   └── alloy  (Grafana Alloy)      │   └── alloy  (Grafana Alloy)
├── config/                         ├── config/
│   ├── relay-server.alloy          │   └── relay-agent.alloy
│   └── relay-agent.alloy           └── README.txt
└── README.txt
```

---

## 설치 후 관리

```bash
# 서비스 재시작
sudo systemctl restart alloy

# 서비스 중지
sudo systemctl stop alloy

# 설정 파일 위치
/etc/alloy/config.alloy     # Alloy 설정
/etc/alloy/alloy.env         # 환경변수 (customer_id, server_name 등)

# 로그 확인
journalctl -u alloy -n 50
journalctl -u alloy --since "10 minutes ago"
```

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| `[ERROR] Alloy 실행 실패` | config 또는 env 파일 오류 | `journalctl -u alloy -n 30` 로그 확인 |
| 릴레이 포트 9999 접속 불가 | 방화벽 차단 | `ufw allow 9999/tcp` 또는 `firewall-cmd --add-port=9999/tcp` |
| 중앙 서버에 메트릭 안 옴 | remote-write-url 오류 또는 네트워크 차단 | URL 확인, `curl http://중앙서버:8880/health` 테스트 |
| 에이전트 → 릴레이 연결 실패 | relay-url 오류 | `curl http://릴레이IP:9999/` 연결 테스트 |
