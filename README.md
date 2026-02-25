# MSP Central Monitoring System

클라우드 MSP를 위한 **다중 고객 서버 통합 모니터링** 시스템.

Ubuntu 중앙 서버 1대에서 모든 고객사 서버의 OS 메트릭(CPU/메모리/디스크/네트워크)을 수집하여 Grafana로 시각화한다.

## Architecture

```
[고객사 서버 — outbound 가능]
  Server A  ─── Alloy (direct) ──────────────────────────┐
  Server B  ─── Alloy (direct) ──────────────────────────┤
                                                          │  HTTP
[고객사 서버 — outbound 차단]                             ▼  :8880
  Server C  ─── Alloy (relay-agent) ─┐        ┌─────────────────────┐
  Server D  ─── Alloy (relay-agent) ─┤        │   중앙 서버 (Ubuntu) │
                                     ▼        │                     │
                          Alloy (relay-server) │  VictoriaMetrics   │
                              :9999 수신       │  Grafana            │
                                     │        │  Nginx (8880/8443)  │
                                     └───────▶└─────────────────────┘
```

**에이전트 3가지 모드:**

| 모드 | 대상 서버 | 설명 |
|---|---|---|
| `direct` | outbound 가능 서버 | 중앙 서버로 직접 push |
| `relay-server` | 고객사 내 게이트웨이 역할 서버 | 내부 에이전트 메트릭 수신(:9999) + 중앙으로 전달 + 자체 수집 |
| `relay-agent` | outbound 차단 서버 | relay-server 내부 IP:9999 로 push |

## Tech Stack

| 컴포넌트 | 기술 | 역할 |
|---|---|---|
| 시계열 저장소 | VictoriaMetrics v1.106 | remote_write 수신, PromQL 지원 |
| 시각화 | Grafana 10.4 | 다중 고객 대시보드 3종 |
| 에이전트 | Grafana Alloy v1.5 | 단일 바이너리, systemd, Docker 불필요 |
| 리버스 프록시 | Nginx | Basic Auth, 에이전트 write 엔드포인트 노출 |
| 오케스트레이션 | Docker Compose | 중앙 서버 스택 관리 |

## 중앙 서버 설치 (Ubuntu)

### Prerequisites

- Ubuntu 20.04+
- Docker Engine + Docker Compose Plugin
- 포트 오픈: 8880 (에이전트 push + Grafana 접근)

### 설치

```bash
# Docker 설치
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker

# 레포 클론
git clone https://github.com/Soojong94/monitoring_msp.git
cd monitoring_msp

# 환경변수 설정 (비밀번호 변경 권장)
cp .env.example .env
nano .env

# 실행
docker compose up -d

# 상태 확인
docker compose ps
```

### 접근

- **Grafana 대시보드**: `http://<중앙서버_IP>:8880`
- **에이전트 write 엔드포인트**: `http://<중앙서버_IP>:8880/api/v1/write`

---

## 고객사 서버 에이전트 설치

레포를 clone하거나 `agents/` 폴더만 대상 서버로 복사한 뒤 실행.

### Direct 모드 (outbound 가능 서버)

```bash
sudo ./agents/install.sh \
  --mode=direct \
  --customer-id=kt \
  --server-name=kt-prod-web-01 \
  --csp=kt \
  --region=kc1 \
  --environment=prod \
  --remote-write-url=http://<중앙서버_IP>:8880/api/v1/write
```

### Relay-Server 모드 (고객사 내 게이트웨이)

내부 서버들의 메트릭을 모아 중앙으로 전달 + 자신의 메트릭도 수집.
포트 9999가 방화벽에서 열려야 함 (install.sh가 자동으로 오픈).

```bash
sudo ./agents/install.sh \
  --mode=relay-server \
  --customer-id=kt \
  --server-name=kt-relay-01 \
  --csp=kt \
  --region=kc1 \
  --environment=prod \
  --remote-write-url=http://<중앙서버_IP>:8880/api/v1/write
```

### Relay-Agent 모드 (outbound 차단 서버)

```bash
sudo ./agents/install.sh \
  --mode=relay-agent \
  --customer-id=kt \
  --server-name=kt-prod-db-01 \
  --csp=kt \
  --region=kc1 \
  --environment=prod \
  --relay-url=http://<relay서버_내부IP>:9999/api/v1/metrics/write
```

---

## 로컬 테스트 (Docker로 3서버 구조 시뮬레이션)

실제 서버 없이 Windows/Mac에서 relay 구조를 검증할 때 사용.

```
[msp-agent] → relay:9999 → [msp-relay] → victoriametrics → [msp-grafana]
```

### 실행

```bash
docker compose -f docker-compose.yml -f docker-compose.3server-test.yml up -d
```

### 데이터 확인 (2~3분 후)

```bash
# relay-01, agent-01 둘 다 보이면 성공
docker exec msp-victoriametrics wget -q -O - \
  "http://127.0.0.1:8428/api/v1/label/server_name/values"
```

### 접근

- Grafana: `http://localhost:8880` (admin / changeme)
- Grafana 직접: `http://localhost:3000`

### 종료

```bash
# 데이터 유지
docker compose -f docker-compose.yml -f docker-compose.3server-test.yml down

# 데이터 포함 완전 초기화
docker compose -f docker-compose.yml -f docker-compose.3server-test.yml down -v
```

---

## Dashboards

### 1. MSP 전체 고객 현황 (`msp-overview`)
- 총 고객 수 / 서버 수 / 평균 CPU / 평균 메모리
- 고객별 현황 테이블 (CPU/메모리/네트워크)
- 네트워크 트래픽 현황 (수신/송신)

### 2. 고객별 상세 현황 (`msp-customer-detail`)
- CSP/리전 필터, 서버별 CPU/메모리 추이
- 네트워크 수신/송신 현황 (Top 5 + 추이)
- 서버별 리소스 요약 테이블

### 3. 서버별 상세 현황 (`msp-server-detail`)
- CPU/메모리/디스크 게이지 + 추이
- 네트워크 트래픽 (NIC별 수신/송신)
- Disk I/O (읽기/쓰기 Bps)

---

## Directory Structure

```
monitoring_msp/
├── docker-compose.yml              # 중앙 서버 프로덕션 스택
├── docker-compose.local.yml        # 로컬 단일 에이전트 테스트
├── docker-compose.3server-test.yml # 로컬 3서버 구조 시뮬레이션
├── .env.example                    # 환경변수 템플릿
│
├── agents/                         # 고객 서버 에이전트 설치
│   ├── install.sh                  # 통합 설치 스크립트 (direct/relay-server/relay-agent)
│   ├── direct/
│   │   └── config.alloy            # direct 모드 Alloy 설정
│   └── relay/
│       ├── relay-server.alloy      # relay-server 모드 (수신 + 전달 + 자체 수집)
│       └── agent-to-relay.alloy    # relay-agent 모드 (내부망으로만 push)
│
├── config/
│   ├── grafana/
│   │   ├── dashboards/             # 대시보드 JSON 3종
│   │   └── provisioning/           # 데이터소스 + 대시보드 자동 프로비저닝
│   └── nginx/
│       └── nginx.conf              # 리버스 프록시 + Basic Auth
│
├── docker/
│   ├── grafana/Dockerfile          # 대시보드 빌드 포함 이미지
│   └── nginx/Dockerfile            # htpasswd 포함 이미지
│
└── mock/
    └── alloy-test/
        └── config.alloy            # 로컬 테스트용 Alloy 설정
```

---

## Roadmap

| Phase | 내용 | 상태 |
|---|---|---|
| Phase 1 | 중앙 스택 + 대시보드 3종 + 에이전트 설치 스크립트 | **완료** |
| Phase 2 | 실제 고객 서버(kt/naver/nhn/aws) 에이전트 설치 테스트 | **진행 중** |
| Phase 3 | Alert 규칙 + Slack/Email 알림 | 예정 |
| Phase 4 | TLS 인증서 + 에이전트 인증 토큰 | 예정 |
| Phase 5 | 대시보드 고도화 (Uptime SLA, 이상 감지) | 예정 |

## License

Private - Internal Use Only
