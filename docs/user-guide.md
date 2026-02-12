# MSP Central Monitoring - 사용 설명서

## 목차

1. [개요](#1-개요)
2. [시스템 요구사항](#2-시스템-요구사항)
3. [로컬 테스트 환경 구축](#3-로컬-테스트-환경-구축)
4. [프로덕션 배포](#4-프로덕션-배포)
5. [고객 서버에 에이전트 설치](#5-고객-서버에-에이전트-설치)
6. [대시보드 사용법](#6-대시보드-사용법)
7. [설정 파일 상세](#7-설정-파일-상세)
8. [트러블슈팅](#8-트러블슈팅)
9. [FAQ](#9-faq)

---

## 1. 개요

### 이 시스템은 무엇인가?

클라우드 MSP가 관리하는 **모든 고객의 서버**를 하나의 중앙 대시보드에서 모니터링하는 시스템이다.

### 어떤 데이터를 수집하는가?

| 카테고리 | 메트릭 | 수집 주기 | 수집 방식 |
|---|---|---|---|
| CPU | 사용률 (%), 코어별 사용 시간 | 15초 | Alloy Agent (push) |
| 메모리 | 사용률 (%), 전체/가용/Free | 15초 | Alloy Agent (push) |
| 디스크 | 사용률 (%), 전체/가용 용량 | 15초 | Alloy Agent (push) |
| 네트워크 | 수신/송신 트래픽 (bytes/sec) | 15초 | Alloy Agent (push) |
| 시스템 | Load Average, Uptime | 15초 | Alloy Agent (push) |
| CSP 비용 | 서비스별 일일/월간 비용 (USD) | 5분 | CSP Collector (pull) |
| CSP 리소스 | 인스턴스 수, CPU/메모리 사용률 | 5분 | CSP Collector (pull) |

### 전체 흐름

```
1. 고객 서버에 Alloy 에이전트 설치 (단일 바이너리, Docker 불필요)
2. 에이전트가 OS 메트릭을 15초마다 중앙 서버로 push
3. 중앙 서버의 VictoriaMetrics가 시계열 데이터 저장
4. Grafana 대시보드에서 실시간 시각화
5. CSP Collector가 별도로 AWS/Azure 등의 비용 데이터 수집
```

---

## 2. 시스템 요구사항

### 중앙 서버

| 항목 | 최소 | 권장 |
|---|---|---|
| OS | Ubuntu 20.04+ / CentOS 8+ | Ubuntu 22.04 LTS |
| CPU | 2 core | 4 core |
| RAM | 4 GB | 8 GB |
| 디스크 | 50 GB SSD | 100 GB SSD |
| Docker | 24.0+ | 최신 안정 버전 |
| Docker Compose | v2.0+ | 최신 안정 버전 |
| 네트워크 | 고정 IP 또는 도메인 | TLS 인증서 포함 도메인 |

### 고객 서버

| 항목 | 요구사항 |
|---|---|
| OS | Linux (Ubuntu, CentOS, Amazon Linux, etc.) |
| 메모리 | Alloy 에이전트 ~50MB 추가 |
| 네트워크 | 아웃바운드 HTTPS (443 또는 커스텀 포트) 허용 |
| 권한 | root 또는 sudo |

### 로컬 테스트 (Windows/Mac)

- Docker Desktop 설치 및 실행 중
- Git 설치
- 포트 8880, 8443, 3000, 8428 사용 가능

---

## 3. 로컬 테스트 환경 구축

### 3.1 프로젝트 클론

```bash
git clone https://github.com/Soojong94/monitoring_msp.git
cd monitoring_msp
```

### 3.2 환경변수 설정

```bash
cp .env.example .env.local
```

`.env.local` 기본값 (수정 없이 바로 사용 가능):

```env
# Grafana 관리자 계정
GF_ADMIN_USER=admin
GF_ADMIN_PASSWORD=admin123

# Nginx Basic Auth
NGINX_BASIC_AUTH_USER=admin
NGINX_BASIC_AUTH_PASSWORD=admin123

# 포트 (기본 80/443 대신 변경)
NGINX_HTTP_PORT=8880
NGINX_HTTPS_PORT=8443
```

### 3.3 이미지 빌드

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local build
```

빌드되는 이미지 4개:
- `monitoring_msp-grafana` - 대시보드 bake된 Grafana
- `monitoring_msp-nginx` - htpasswd bake된 Nginx
- `monitoring_msp-csp-collector` - CSP 메트릭 Mock exporter
- `monitoring_msp-alloy-simulator` - OS 메트릭 시뮬레이터

### 3.4 스택 기동

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local up -d
```

### 3.5 상태 확인

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local ps
```

기대 결과: 6개 컨테이너 모두 `healthy` 또는 `running`

```
NAME                  STATUS           PORTS
msp-victoriametrics   Up (healthy)     8428
msp-csp-collector     Up (healthy)     9091 (internal)
msp-grafana           Up (healthy)     3000
msp-nginx             Up (healthy)     8880, 8443
msp-alloy-simulator   Up               (push only)
msp-test-agent        Up               (push only)
```

### 3.6 대시보드 접속

1. 브라우저에서 `http://localhost:8880` 접속
2. Basic Auth: `admin` / `admin123`
3. 좌측 메뉴 → Dashboards → MSP Monitoring 폴더
4. 3개 대시보드 확인

> **참고**: CPU 사용률(`rate()` 계산)은 기동 후 약 1분 뒤부터 표시된다.
> 그 전에는 "No data" 로 보일 수 있다.

### 3.7 로컬 테스트에 포함된 Mock 데이터

| 컴포넌트 | 역할 | 데이터 |
|---|---|---|
| alloy-simulator | OS 메트릭 시뮬레이터 | 5개 고객, 14대 서버의 CPU/메모리/디스크/네트워크 |
| metrics-exporter | CSP 메트릭 Mock | 5개 고객의 AWS 비용, 인스턴스 수 |
| test-agent | 실제 Alloy 에이전트 | Docker Desktop VM의 실제 OS 메트릭 (customer_id=test-local) |

Mock 고객 목록:

| customer_id | 서버 수 | 특징 |
|---|---|---|
| alpha | 3 | 일반적인 웹+DB 구성 |
| beta | 2 | 높은 CPU 사용률 (80%+) |
| gamma | 4 | batch-01 디스크 사용률 90%+ |
| delta | 2 | 소규모 고객 |
| epsilon | 3 | 낮은 리소스 사용률 |
| test-local | 1 | 실제 Alloy 에이전트 (Docker VM 메트릭) |

### 3.8 스택 중지

```bash
# 컨테이너만 중지 (데이터 유지)
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local down

# 컨테이너 + 데이터(볼륨) 모두 삭제
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local down -v
```

---

## 4. 프로덕션 배포

### 4.1 중앙 서버 준비

```bash
# Docker 설치 (Ubuntu)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 프로젝트 클론
git clone https://github.com/Soojong94/monitoring_msp.git
cd monitoring_msp
```

### 4.2 환경변수 설정

```bash
cp .env.example .env
vi .env
```

**반드시 변경해야 할 항목:**

```env
# 강력한 비밀번호로 변경
GF_ADMIN_PASSWORD=YourStrongPassword123!
NGINX_BASIC_AUTH_PASSWORD=YourStrongPassword123!

# 포트 (80/443 사용 가능하면 기본값 유지)
NGINX_HTTP_PORT=80
NGINX_HTTPS_PORT=443

# VictoriaMetrics 보존 기간
VM_RETENTION=90d
```

### 4.3 빌드 & 기동 (프로덕션)

```bash
# 프로덕션은 docker-compose.yml만 사용 (local 오버라이드 없음)
docker compose build
docker compose up -d
```

### 4.4 방화벽 설정

중앙 서버에서 열어야 할 포트:

| 포트 | 용도 | 접근 대상 |
|---|---|---|
| 80 (또는 커스텀) | Grafana 대시보드 (HTTP) | MSP 관리자 |
| 443 (또는 커스텀) | Grafana 대시보드 (HTTPS) | MSP 관리자 |
| 8428 | VictoriaMetrics (에이전트 write) | 고객 서버 IP만 허용 |

---

## 5. 고객 서버에 에이전트 설치

### 5.1 Grafana Alloy 설치 (Ubuntu/Debian)

```bash
# 1. Grafana APT 저장소 추가
sudo apt-get install -y apt-transport-https software-properties-common
sudo mkdir -p /etc/apt/keyrings/
wget -q -O - https://apt.grafana.com/gpg.key | gpg --dearmor | sudo tee /etc/apt/keyrings/grafana.gpg > /dev/null
echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list

# 2. Alloy 설치
sudo apt-get update
sudo apt-get install -y alloy
```

### 5.2 Grafana Alloy 설치 (CentOS/RHEL/Amazon Linux)

```bash
# 1. Grafana YUM 저장소 추가
cat <<'EOF' | sudo tee /etc/yum.repos.d/grafana.repo
[grafana]
name=grafana
baseurl=https://rpm.grafana.com
repo_gpgcheck=1
enabled=1
gpgcheck=1
gpgkey=https://rpm.grafana.com/gpg.key
sslverify=1
sslcacert=/etc/pki/tls/certs/ca-bundle.crt
EOF

# 2. Alloy 설치
sudo yum install -y alloy
```

### 5.3 Alloy 설정 파일 작성

```bash
sudo vi /etc/alloy/config.alloy
```

아래 내용 입력 (3곳을 고객에 맞게 수정):

```alloy
// MSP Monitoring Agent Config
// 수정 필요: CUSTOMER_ID, SERVER_NAME, CENTRAL_URL

prometheus.exporter.unix "node" {
  set_collectors = ["cpu", "meminfo", "loadavg", "filesystem", "netdev", "uname"]
}

prometheus.scrape "node" {
  targets         = prometheus.exporter.unix.node.targets
  forward_to      = [prometheus.relabel.customer_labels.receiver]
  scrape_interval = "15s"
}

prometheus.relabel "customer_labels" {
  forward_to = [prometheus.remote_write.central.receiver]

  rule {
    action       = "replace"
    target_label = "customer_id"
    replacement  = "CUSTOMER_ID"       // <-- 고객 ID로 변경 (예: "alpha")
  }

  rule {
    action       = "replace"
    target_label = "server_name"
    replacement  = "SERVER_NAME"       // <-- 서버 이름으로 변경 (예: "web-01")
  }

  rule {
    action       = "replace"
    target_label = "environment"
    replacement  = "production"
  }
}

prometheus.remote_write "central" {
  endpoint {
    url = "CENTRAL_URL/api/v1/write"   // <-- 중앙 서버 주소 (예: "https://monitor.example.com/api/v1/write")
  }
}
```

**수정해야 할 3곳:**

| 항목 | 설명 | 예시 |
|---|---|---|
| `CUSTOMER_ID` | 고객 식별자 (영문 소문자, 하이픈 허용) | `alpha`, `beta-corp` |
| `SERVER_NAME` | 서버 식별자 (고객 내 유일) | `web-01`, `db-master` |
| `CENTRAL_URL` | 중앙 서버 주소 | `https://monitor.msp.com:8880` |

### 5.4 Alloy 서비스 시작

```bash
sudo systemctl enable alloy
sudo systemctl start alloy

# 상태 확인
sudo systemctl status alloy

# 로그 확인
sudo journalctl -u alloy -f
```

### 5.5 설치 확인

중앙 서버에서 데이터 수신 확인:

```bash
# VictoriaMetrics에서 해당 고객 데이터 확인
curl -s "http://중앙서버:8428/api/v1/query" \
  --data-urlencode 'query=node_uname_info{customer_id="alpha"}' | python3 -m json.tool
```

Grafana 대시보드에서 customer 드롭다운에 새 고객이 나타나면 성공.

### 5.6 고객 추가 체크리스트

새 고객 서버 추가 시:

- [ ] Alloy 설치 (5.1 또는 5.2)
- [ ] config.alloy 작성 (customer_id, server_name, central_url 설정)
- [ ] Alloy 서비스 시작 및 enable
- [ ] 중앙 서버에서 데이터 수신 확인
- [ ] Grafana 대시보드에서 고객 드롭다운 확인

---

## 6. 대시보드 사용법

### 6.1 MSP 전체 고객 현황

**용도**: 전체 고객 상태를 한눈에 파악

- 상단: 핵심 지표 4개 (고객 수, 서버 수, 평균 CPU, 전체 비용)
- 중간: 고객별 현황 테이블 (서버 수, CPU, 메모리, 비용)
  - CPU 60%+ 노란색, 80%+ 빨간색 셀 배경
  - 메모리 70%+ 노란색, 85%+ 빨간색 셀 배경
- 하단: 고객별 CPU/메모리 바 게이지, 비용 추이 차트

**고객 필터**: 상단 `customer` 드롭다운으로 특정 고객만 필터링 가능

### 6.2 고객별 상세 현황

**용도**: 특정 고객의 모든 서버를 상세히 확인

1. 상단 `customer` 드롭다운에서 고객 선택
2. `server` 드롭다운에서 All 또는 특정 서버 선택
3. 서버별 CPU/메모리 사용률 추이 그래프 확인
4. 하단 테이블에서 리소스 요약 확인

### 6.3 서버별 상세 현황

**용도**: 개별 서버의 OS 레벨 메트릭을 깊이 분석

1. `customer` → `server` 순서로 선택
2. Uptime, CPU/메모리/디스크 게이지 확인
3. CPU 추이 + Load Average 비교
4. 메모리 Total vs Available 비교
5. 네트워크 트래픽 디바이스별 확인

### 6.4 시간 범위 조정

- 우측 상단 시간 선택기에서 `Last 1 hour`, `Last 6 hours`, `Last 24 hours` 등 선택
- 드래그하여 특정 구간 확대 가능
- `Ctrl+Z`로 줌 되돌리기

---

## 7. 설정 파일 상세

### 7.1 docker-compose.yml (프로덕션)

4개 서비스 정의:

| 서비스 | 이미지 | 역할 |
|---|---|---|
| victoriametrics | victoriametrics/victoria-metrics:v1.106.1 | 시계열 저장소 |
| csp-collector | 커스텀 빌드 | CSP API 메트릭 수집 |
| grafana | 커스텀 빌드 | 대시보드 시각화 |
| nginx | 커스텀 빌드 | 리버스 프록시 + Basic Auth |

### 7.2 docker-compose.local.yml (로컬 테스트 오버라이드)

프로덕션 위에 덮어쓰는 로컬 전용 설정:

- csp-collector → Mock exporter로 교체
- alloy-simulator 추가 (14대 서버 시뮬레이션)
- test-agent 추가 (실제 Alloy 에이전트)
- VictoriaMetrics에 스크래핑 설정 추가
- 디버깅용 포트 노출 (3000, 8428)

### 7.3 nginx.conf

```
클라이언트 → Nginx(:80)
  ├── /api/v1/write      → VictoriaMetrics (에이전트 write, Auth 없음)
  ├── /api/v1/import/*   → VictoriaMetrics (에이전트 import, Auth 없음)
  ├── /health            → Nginx 자체 헬스체크
  └── /*                 → Grafana (Basic Auth 적용)
```

에이전트 write 경로는 Basic Auth를 적용하지 않는다.
에이전트가 비밀번호 없이 메트릭을 push할 수 있게 하기 위함이다.

### 7.4 VictoriaMetrics 설정

| 파라미터 | 값 | 설명 |
|---|---|---|
| retentionPeriod | 90d | 90일 데이터 보존 |
| dedup.minScrapeInterval | 30s | 중복 데이터 제거 (에이전트 재전송 보호) |
| selfScrapeInterval | 15s | 자체 메트릭 수집 |

### 7.5 Grafana 프로비저닝

- 데이터소스: VictoriaMetrics (`http://victoriametrics:8428`, prometheus 타입)
- 대시보드: `/var/lib/grafana/dashboards/` 에 JSON 파일 bake
- 홈 대시보드: `msp-overview.json`

---

## 8. 트러블슈팅

### 8.1 컨테이너가 unhealthy

```bash
# 로그 확인
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local logs <서비스명>
```

**자주 발생하는 원인:**

| 증상 | 원인 | 해결 |
|---|---|---|
| VictoriaMetrics unhealthy | 포트 8428 충돌 | 다른 서비스가 8428 사용 중인지 확인 |
| Grafana unhealthy | 기동 시간 부족 | 30초 대기 후 재확인 |
| Nginx unhealthy | Grafana 미기동 | Grafana가 먼저 healthy인지 확인 |

### 8.2 대시보드에 "No data"

**기동 직후 (1분 이내):**
- 정상. CPU `rate()` 계산에 최소 2개 데이터포인트 필요
- 1분 후 자동으로 표시됨

**1분 이상 경과 후에도 "No data":**

```bash
# 1. VictoriaMetrics에 데이터가 있는지 확인
curl -s "http://localhost:8428/api/v1/query?query=count(node_uname_info)"

# 2. 결과가 비어있으면 alloy-simulator 로그 확인
docker logs msp-alloy-simulator --tail=10

# 3. CSP 메트릭 확인
curl -s "http://localhost:8428/api/v1/query?query=count(msp_csp_cpu_utilization)"
```

### 8.3 고객 드롭다운에 특정 고객이 안 보임

- 해당 고객 서버의 Alloy 에이전트가 `node_uname_info` 메트릭을 push하고 있는지 확인
- VictoriaMetrics에서 직접 쿼리:
  ```bash
  curl -s "http://중앙서버:8428/api/v1/query" \
    --data-urlencode 'query=node_uname_info{customer_id="해당고객ID"}'
  ```

### 8.4 Alpine 컨테이너 IPv6 문제 (Windows Docker Desktop)

Alpine 컨테이너에서 `localhost`가 `::1`(IPv6)로 해석되어 healthcheck가 실패할 수 있다.

**해결**: 모든 healthcheck URL에서 `localhost` → `127.0.0.1`로 변경.
현재 docker-compose 파일들은 이미 `127.0.0.1`을 사용하도록 설정되어 있다.

### 8.5 포트 충돌

기본 포트와 충돌 시 `.env.local` (또는 `.env`)에서 변경:

```env
NGINX_HTTP_PORT=9090
NGINX_HTTPS_PORT=9443
```

---

## 9. FAQ

### Q: 고객 서버에 Docker를 설치해야 하나요?

**아니요.** 고객 서버에는 Grafana Alloy 바이너리만 설치합니다.
단일 실행 파일이며 systemd로 관리됩니다. 메모리 약 50MB만 사용합니다.

### Q: 고객 서버에서 방화벽 인바운드를 열어야 하나요?

**아니요.** Alloy 에이전트가 중앙 서버로 **push** 합니다.
고객 서버는 **아웃바운드 HTTPS**만 허용하면 됩니다.

### Q: 고객 서버의 IP를 알아야 하나요?

**아니요.** 에이전트가 중앙 서버 주소를 알고 push하므로,
고객 서버의 IP를 중앙 서버에 등록할 필요가 없습니다.

### Q: AWS 외에 다른 CSP도 지원하나요?

현재 Phase 1은 Mock 데이터로 동작합니다.
Phase 2에서 AWS boto3 연동, Phase 3에서 Azure/GCP/NCP 지원 예정입니다.
CSP Collector는 플러그인 아키텍처(`BaseProvider`)로 설계되어 있어 확장이 용이합니다.

### Q: 데이터는 얼마나 보존되나요?

기본 90일 (`VM_RETENTION=90d`).
`.env`에서 `VM_RETENTION` 값을 변경하여 조정할 수 있습니다.

### Q: 새 고객을 추가하려면?

1. 고객 서버에 Alloy 설치 (5장 참고)
2. config.alloy에 `customer_id`와 `server_name` 설정
3. Alloy 서비스 시작
4. 대시보드에서 자동으로 고객이 나타남 (별도 등록 불필요)

### Q: 대시보드를 커스터마이징하고 싶은데?

Grafana에서 직접 수정하면 컨테이너 재시작 시 초기화됩니다.
영구적으로 변경하려면:

1. `config/grafana/dashboards/` 아래 JSON 파일 수정
2. `docker compose build grafana` 로 이미지 재빌드
3. `docker compose up -d grafana` 로 적용

### Q: Alloy 에이전트가 수집하는 메트릭 목록은?

| 메트릭명 | 타입 | 설명 |
|---|---|---|
| `node_cpu_seconds_total` | counter | CPU 모드별 누적 사용 시간 |
| `node_memory_MemTotal_bytes` | gauge | 전체 메모리 |
| `node_memory_MemAvailable_bytes` | gauge | 가용 메모리 |
| `node_memory_MemFree_bytes` | gauge | 프리 메모리 |
| `node_filesystem_size_bytes` | gauge | 파일시스템 전체 용량 |
| `node_filesystem_avail_bytes` | gauge | 파일시스템 가용 용량 |
| `node_network_receive_bytes_total` | counter | 네트워크 수신 누적 바이트 |
| `node_network_transmit_bytes_total` | counter | 네트워크 송신 누적 바이트 |
| `node_load1` | gauge | 1분 Load Average |
| `node_load5` | gauge | 5분 Load Average |
| `node_uptime_seconds` | gauge | 서버 가동 시간 |
| `node_uname_info` | gauge | 서버 정보 (OS, 커널 버전) |

### Q: 대시보드에서 사용하는 주요 PromQL은?

```promql
# CPU 사용률 (%)
(1 - avg by (customer_id, server_name) (
  rate(node_cpu_seconds_total{mode="idle"}[5m])
)) * 100

# 메모리 사용률 (%)
(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100

# 디스크 사용률 (%)
(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100

# 네트워크 수신 속도 (bytes/sec)
rate(node_network_receive_bytes_total{device!="lo"}[5m])

# 고객 수
count(count by (customer_id) (node_uname_info))

# 서버 수
count(node_uname_info)
```
