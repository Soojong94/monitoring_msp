# MSP Central Monitoring System

클라우드 MSP를 위한 **다중 고객 서버 통합 모니터링** 시스템.

20개 이상의 고객 계정, 다중 CSP(AWS/Azure/GCP/NCP)의 클라우드 서버를
하나의 중앙 대시보드에서 실시간으로 관리한다.

## Architecture

```
[고객 서버들]                              [MSP 중앙 서버]
┌──────────────────┐                   ┌─────────────────────────────────┐
│ Customer A VM-1  │                   │                                 │
│  (Alloy Agent)   │──push──┐         │  ┌───────────────────────────┐  │
├──────────────────┤        │         │  │ VictoriaMetrics (:8428)   │  │
│ Customer A VM-2  │──push──┤         │  │ (시계열 저장소)            │  │
│  (Alloy Agent)   │        │  HTTPS  │  └─────────┬─────────────────┘  │
├──────────────────┤        ├────────▶│            │                    │
│ Customer B VM-1  │──push──┤         │  ┌─────────▼─────────────────┐  │
│  (Alloy Agent)   │        │         │  │ Grafana (:3000)           │  │
└──────────────────┘        │         │  │ (대시보드 시각화)          │  │
                            │         │  └─────────┬─────────────────┘  │
  CSP APIs ─────────────────┘         │            │                    │
  (AWS/Azure/GCP/NCP)                 │  ┌─────────▼─────────────────┐  │
       │                              │  │ Nginx (:80/443)           │  │
       ▼                              │  │ (리버스 프록시 + Auth)     │  │
  ┌────────────────┐                  │  └───────────────────────────┘  │
  │ CSP Collector  │                  │                                 │
  │ (비용/리소스)   │                  │  ┌───────────────────────────┐  │
  └────────────────┘                  │  │ CSP Collector (:9091)     │  │
                                      │  │ (CSP API 메트릭 수집)      │  │
                                      │  └───────────────────────────┘  │
                                      └─────────────────────────────────┘
```

### Data Flow

| 데이터 종류 | 수집 방식 | 수집 주체 | 설명 |
|---|---|---|---|
| OS 메트릭 (CPU, 메모리, 디스크, 네트워크) | **Push** (고객→중앙) | 고객 서버의 Grafana Alloy | 15초 간격, remote_write |
| CSP 비용/리소스 | **Pull** (중앙→CSP API) | 중앙 서버의 CSP Collector | 5분 간격, CloudWatch 등 |

## Tech Stack

| 컴포넌트 | 기술 | 선정 이유 |
|---|---|---|
| 시계열 저장소 | VictoriaMetrics v1.106 | Prometheus 대비 10x 메모리 효율, remote_write 내장 |
| 시각화 | Grafana 10.4 | 프로비저닝 대시보드, 변수 기반 다중 고객 전환 |
| 에이전트 | Grafana Alloy v1.5 | 단일 바이너리(~50MB), Docker 불필요, systemd 관리 |
| CSP 수집 | Python (aiohttp) | 플러그인 아키텍처, 다중 CSP 확장 가능 |
| 리버스 프록시 | Nginx 1.25 | Basic Auth, TLS 종단, 에이전트 write 프록시 |
| 오케스트레이션 | Docker Compose | 중앙 서버 전체 스택 관리 |

## Quick Start (Local Test)

### Prerequisites

- Docker Desktop (Windows/Mac) 또는 Docker Engine (Linux)
- Git

### 1. Clone & Setup

```bash
git clone https://github.com/Soojong94/monitoring_msp.git
cd monitoring_msp
cp .env.example .env.local
```

### 2. Build & Run

```bash
# 이미지 빌드
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local build

# 스택 기동
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local up -d
```

### 3. Access

- **대시보드**: http://localhost:8880 (admin / admin123)
- **Grafana 직접**: http://localhost:3000 (admin / admin123)
- **VictoriaMetrics**: http://localhost:8428

> 기동 후 약 1분 뒤부터 CPU rate() 데이터가 표시됩니다.

### 4. Stop

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local down

# 볼륨(데이터)까지 삭제
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local down -v
```

## Dashboards

### 1. MSP 전체 고객 현황 (`msp-overview`)
- 총 고객 수 / 서버 수
- 평균 CPU, 전체 월 비용
- 고객별 현황 테이블 (CPU/메모리/비용)
- 고객별 CPU/메모리 바 게이지
- 비용 추이 차트

### 2. 고객별 상세 현황 (`msp-customer-detail`)
- 서버 수, 평균 CPU/메모리 게이지, 월 비용
- 서버별 CPU/메모리 사용률 추이
- 네트워크 트래픽 (수신/송신)
- 서버별 리소스 요약 테이블

### 3. 서버별 상세 현황 (`msp-server-detail`)
- Uptime, CPU/메모리/디스크 게이지
- CPU 추이 + Load Average
- 메모리 추이 + Total/Available
- 네트워크 트래픽 (디바이스별)

## Directory Structure

```
monitoring_msp/
├── docker-compose.yml          # 프로덕션 스택 정의
├── docker-compose.local.yml    # 로컬 테스트 오버라이드
├── .env.example                # 환경변수 템플릿
├── .env.local                  # 로컬 테스트 환경변수 (gitignore)
├── Makefile                    # 빌드/실행 단축 명령어
│
├── collector/                  # CSP 메트릭 수집 서비스 (Python)
│   ├── main.py                 # aiohttp 웹서버 + /metrics, /healthz
│   ├── config.py               # 환경변수 설정
│   ├── customers.yml           # 고객 정의 (Phase 2)
│   ├── providers/
│   │   ├── base.py             # BaseProvider 추상 클래스
│   │   └── aws.py              # AWS 프로바이더 (Phase 2)
│   └── models/
│       ├── metric.py           # Metric 데이터클래스
│       └── customer.py         # Customer 데이터클래스
│
├── config/
│   ├── grafana/
│   │   ├── dashboards/         # 대시보드 JSON 3개
│   │   └── provisioning/       # 데이터소스 + 대시보드 프로비저닝
│   ├── nginx/
│   │   └── nginx.conf          # 리버스 프록시 + agent write 프록시
│   └── victoriametrics/
│       └── scrape.yml          # CSP Collector 스크래핑 설정
│
├── docker/
│   ├── grafana/Dockerfile      # 대시보드 + 프로비저닝 bake
│   ├── nginx/Dockerfile        # htpasswd + config bake
│   └── csp-collector/Dockerfile
│
└── mock/                       # 로컬 테스트용 Mock 서비스
    ├── alloy-simulator/        # 14대 서버 OS 메트릭 시뮬레이터
    ├── alloy-test/             # 실제 Alloy 에이전트 설정
    └── metrics-exporter/       # 5개 고객 CSP 메트릭 Mock
```

## Roadmap

| Phase | 내용 | 상태 |
|---|---|---|
| Phase 1 | 중앙 스택 + Mock 데이터 + 대시보드 3종 | **완료** |
| Phase 2 | AWS boto3 실제 연동, Alloy 설치 스크립트 | 예정 |
| Phase 3 | Azure/GCP/NCP 프로바이더 추가 | 예정 |
| Phase 4 | Alert 규칙 + Slack/Email 알림 | 예정 |
| Phase 5 | TLS 인증서 + 에이전트 인증 토큰 | 예정 |

## Key Design Decisions

### VictoriaMetrics > Prometheus
- 20+ 고객 × 수십 서버 규모에서 메모리 효율 10배
- remote_write 수신 내장 (별도 설정 불필요)
- PromQL 100% 호환

### Grafana Alloy > node_exporter + Prometheus
- 고객 서버에 Docker 불필요 (단일 바이너리)
- Push 방식 → 고객 서버 방화벽 인바운드 오픈 불필요
- `customer_id`, `server_name` 라벨 자동 주입

### 표준 node_exporter 메트릭 호환
- 모든 대시보드 PromQL이 실제 Alloy와 Mock 양쪽에서 동작
- `node_cpu_seconds_total` (카운터) + `rate()` 사용
- `node_uname_info` 기반 고객/서버 자동 탐색

## License

Private - Internal Use Only
