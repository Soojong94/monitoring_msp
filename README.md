# MSP Central Monitoring System

클라우드 MSP를 위한 **다중 고객 서버 통합 모니터링** 시스템.

Ubuntu 중앙 서버 1대에서 모든 고객사 서버의 OS 메트릭(CPU/메모리/디스크/네트워크)을 수집,
시각화하고, 임계값 초과 시 이메일 알림을 발송한다.

## Architecture

```
[고객사 서버 — outbound 가능]
  Server A  ─── Alloy (direct) ──────────────────────────┐
  Server B  ─── Alloy (direct) ──────────────────────────┤
                                                          │  :8880
[고객사 서버 — outbound 차단]                             ▼
  Server C  ─── Alloy (relay-agent) ─┐        ┌──────────────────────┐
  Server D  ─── Alloy (relay-agent) ─┤        │   중앙 서버 (Ubuntu)  │
                                     ▼        │                      │
                          Alloy (relay-server) │  VictoriaMetrics     │
                              :9999 수신       │  VMAlert             │
                                     │        │  Alertmanager        │
                                     └───────▶│  Grafana             │
                                              │  Nginx (8880/8443)   │
                                              └──────────┬───────────┘
                                                         │ SMTP
                                                    📧 이메일 알림
```

**에이전트 3가지 모드:**

| 모드 | 대상 서버 | 설명 |
|------|-----------|------|
| `direct` | outbound 가능 서버 | 중앙 서버로 직접 push |
| `relay-server` | 고객사 내 게이트웨이 서버 | 내부 에이전트 메트릭 수신(:9999) + 중앙으로 전달 + 자체 수집 |
| `relay-agent` | outbound 차단 서버 | relay-server 내부 IP:9999 로 push |

## Tech Stack

| 컴포넌트 | 기술 | 역할 |
|----------|------|------|
| 시계열 저장소 | VictoriaMetrics v1.106 | remote_write 수신, PromQL 지원, 90일 보존 |
| 알림 규칙 | VMAlert v1.106 | PromQL 기반 임계값 평가 (60초 주기) |
| 알림 라우팅 | Alertmanager v0.27 | SMTP 이메일 발송, 중복 억제, inhibit |
| 시각화 | Grafana 10.4 | 다중 고객 대시보드 3종 |
| 에이전트 | Grafana Alloy v1.5 | 단일 바이너리, systemd/Windows Service, Docker 불필요 |
| 리버스 프록시 | Nginx | Basic Auth, 에이전트 write 엔드포인트 노출 |
| 오케스트레이션 | Docker Compose | 중앙 서버 5개 서비스 관리 |

## 중앙 서버 설치 (Ubuntu)

### Prerequisites

- Ubuntu 20.04+
- Docker Engine + Docker Compose Plugin
- 포트 오픈: `8880` (에이전트 push + Grafana 접근)

### 설치

```bash
# Docker 설치
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# 레포 클론
git clone https://github.com/Soojong94/monitoring_msp.git
cd monitoring_msp

# 환경변수 설정 (비밀번호 + SMTP 정보 입력)
cp .env.example .env
nano .env

# Alertmanager 설정 파일 생성 (.env 기반)
make alertmanager-config

# 실행
docker compose up -d

# 상태 확인 (5개 서비스 모두 healthy)
docker compose ps
```

### 접근

- **Grafana 대시보드**: `http://<중앙서버_IP>:8880`
- **에이전트 write 엔드포인트**: `http://<중앙서버_IP>:8880/api/v1/write`

### .env 주요 설정

```env
# 접근 비밀번호
GF_ADMIN_PASSWORD=강력한비밀번호
NGINX_BASIC_AUTH_PASSWORD=강력한비밀번호

# SMTP 이메일 알림 (Phase 3)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_FROM=msp-alerts@yourcompany.com
SMTP_USERNAME=msp-alerts@yourcompany.com
SMTP_PASSWORD=your-app-password
ALERT_EMAIL_TO=ops@yourcompany.com
```

---

## 고객 서버 에이전트 설치

자세한 내용: [docs/agent-install.md](docs/agent-install.md) (온라인) | [docs/agent-offline-install.md](docs/agent-offline-install.md) (오프라인/폐쇄망)

### Linux — Direct 모드 (outbound 가능)

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

### Linux — Relay-Server 모드 (게이트웨이)

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

### Linux — Relay-Agent 모드 (내부망 서버)

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

### Windows (PowerShell 관리자)

```powershell
.\agents\install.ps1 `
  -Mode direct `
  -CustomerId kt `
  -ServerName kt-prod-web-01 `
  -Csp kt `
  -Region kc1 `
  -RemoteWriteUrl http://<중앙서버_IP>:8880/api/v1/write
```

---

## 알림 규칙

| 알림 | 조건 | 심각도 |
|------|------|--------|
| `ServerDown` | 5분 이상 메트릭 미수신 | critical |
| `HighCPUUsage` | CPU 사용률 > 80% (5분 지속) | warning |
| `HighMemoryUsage` | 메모리 사용률 > 85% (5분 지속) | warning |
| `HighDiskUsage` | 디스크 사용률 > 90% (5분 지속) | warning |

- **critical** 알림: 10초 대기 후 발송, 1시간마다 반복
- **warning** 알림: 60초 대기 후 발송, 6시간마다 반복
- **ServerDown 시**: 해당 서버의 CPU/메모리/디스크 알림 자동 억제 (inhibit)

---

## Dashboards

| 대시보드 | 용도 |
|----------|------|
| MSP 전체 고객 현황 | 전체 고객·서버 수, 평균 CPU/메모리, 고객별 현황 테이블 |
| 고객별 상세 현황 | 특정 고객의 서버별 CPU/메모리 추이, 네트워크 현황 |
| 서버별 상세 현황 | 개별 서버의 CPU/메모리/디스크 게이지, Disk I/O, 네트워크 |

---

## Directory Structure

```
monitoring_msp/
├── docker-compose.yml              # 중앙 서버 프로덕션 스택 (5개 서비스)
├── .env.example                    # 환경변수 템플릿 (SMTP 포함)
├── Makefile                        # 편의 명령어 (make up, make alertmanager-config 등)
│
├── agents/                         # 고객 서버 에이전트 설치
│   ├── install.sh                  # Linux 온라인 설치 (direct/relay-server/relay-agent)
│   ├── install-offline.sh          # Linux 오프라인 설치 (패키지 동봉)
│   ├── install.ps1                 # Windows 설치 (direct/relay-agent)
│   ├── direct/
│   │   ├── config.alloy            # Linux direct 모드 Alloy 설정
│   │   └── config-windows.alloy   # Windows direct 모드 Alloy 설정
│   └── relay/
│       ├── relay-server.alloy      # relay-server 모드 (수신 + 전달 + 자체 수집)
│       ├── agent-to-relay.alloy    # Linux relay-agent 모드
│       └── agent-to-relay-windows.alloy  # Windows relay-agent 모드
│
├── config/
│   ├── alertmanager/
│   │   └── alertmanager.yml.tmpl  # Alertmanager 설정 템플릿 (make alertmanager-config로 생성)
│   ├── vmalert/rules/
│   │   └── host-alerts.yml        # 알림 규칙 4종 (ServerDown/CPU/Memory/Disk)
│   ├── grafana/
│   │   ├── dashboards/            # 대시보드 JSON 3종
│   │   └── provisioning/          # 데이터소스 + 대시보드 자동 프로비저닝
│   └── nginx/
│       └── nginx.conf             # 리버스 프록시 + Basic Auth
│
├── docker/
│   ├── grafana/Dockerfile         # 대시보드 bake 이미지
│   ├── nginx/Dockerfile           # htpasswd bake 이미지
│   └── ubuntu-systemd/            # 로컬 테스트용 Ubuntu 이미지
│
├── scripts/
│   └── build-package.sh           # 오프라인 배포 패키지 빌드
│
└── docs/
    ├── user-guide.md              # 전체 운영 가이드
    ├── agent-install.md           # 에이전트 설치 가이드 (온라인)
    ├── agent-offline-install.md   # 에이전트 설치 가이드 (오프라인/폐쇄망)
    └── ubuntu-local-test.md       # 로컬 테스트 가이드 (Docker Ubuntu)
```

---

## Roadmap

| Phase | 내용 | 상태 |
|-------|------|------|
| Phase 1 | 중앙 스택 + 대시보드 3종 + 에이전트 설치 스크립트 (Linux/Windows) | **완료** |
| Phase 2 | 오프라인 배포 패키지 + 실 서버 배포 검증 | **완료** |
| Phase 3 | VMAlert + Alertmanager + SMTP 이메일 알림 | **완료** |
| Phase 4 | TLS 인증서 + 에이전트 인증 토큰 | 예정 |
| Phase 5 | 대시보드 고도화 (Uptime SLA, 이상 감지) | 예정 |

## License

Private - Internal Use Only
