# MSP Central Monitoring — 운영 가이드

## 목차

1. [개요](#1-개요)
2. [시스템 요구사항](#2-시스템-요구사항)
3. [중앙 서버 배포](#3-중앙-서버-배포)
4. [에이전트 설치](#4-에이전트-설치)
5. [알림 설정](#5-알림-설정)
6. [대시보드 사용법](#6-대시보드-사용법)
7. [설정 파일 상세](#7-설정-파일-상세)
8. [운영 명령어](#8-운영-명령어)
9. [트러블슈팅](#9-트러블슈팅)

---

## 1. 개요

### 이 시스템은 무엇인가?

클라우드 MSP가 관리하는 **모든 고객의 서버**를 하나의 중앙 대시보드에서 모니터링하고,
이상 상황 발생 시 이메일로 알림을 받는 시스템이다.

### 수집 메트릭

| 카테고리 | 수집 항목 | 주기 |
|----------|-----------|------|
| CPU | 사용률, 코어별 사용 시간 | 15초 |
| 메모리 | 사용률, 전체/가용 용량 | 15초 |
| 디스크 | 마운트포인트별 사용률 | 15초 |
| 네트워크 | NIC별 수신/송신 트래픽 | 15초 |
| 시스템 | Load Average, Uptime | 15초 |

### 전체 흐름

```
고객 서버 (Alloy 에이전트)
    │ 15초마다 메트릭 push
    ▼
중앙 서버 Nginx :8880
    │
    ├──▶ VictoriaMetrics  →  Grafana 대시보드
    │
    └──▶ VictoriaMetrics  →  VMAlert (60초마다 규칙 평가)
                                  │ 임계값 초과
                                  ▼
                             Alertmanager
                                  │ SMTP
                                  ▼
                             📧 이메일 발송
```

---

## 2. 시스템 요구사항

### 중앙 서버

| 항목 | 최소 | 권장 |
|------|------|------|
| OS | Ubuntu 20.04+ | Ubuntu 22.04 LTS |
| CPU | 2 core | 4 core |
| RAM | 4 GB | 8 GB |
| 디스크 | 50 GB | 100 GB SSD |
| Docker | 24.0+ | 최신 안정 버전 |
| 포트 (인바운드) | 8880 (또는 80/443) | — |

### 고객 서버 (에이전트)

| 항목 | 요구사항 |
|------|----------|
| OS | Linux (Ubuntu/CentOS/Amazon Linux) 또는 Windows Server |
| 메모리 추가 | ~50 MB (Alloy 에이전트) |
| 네트워크 | outbound: 중앙서버:8880 접근 가능 (또는 relay 경유) |
| 권한 | root / sudo (Linux), 관리자 (Windows) |

---

## 3. 중앙 서버 배포

### 3.1 사전 준비

```bash
# Docker 설치 (Ubuntu)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# 프로젝트 클론
git clone https://github.com/Soojong94/monitoring_msp.git
cd monitoring_msp
```

### 3.2 환경변수 설정

```bash
cp .env.example .env
nano .env
```

**반드시 변경할 항목:**

```env
# 접근 비밀번호 (Grafana + Nginx Basic Auth)
GF_ADMIN_PASSWORD=강력한비밀번호123!
NGINX_BASIC_AUTH_PASSWORD=강력한비밀번호123!

# SMTP 이메일 알림
SMTP_HOST=smtp.gmail.com        # Gmail SMTP
SMTP_PORT=587
SMTP_FROM=msp-alerts@yourcompany.com
SMTP_USERNAME=msp-alerts@yourcompany.com
SMTP_PASSWORD=your-app-password  # Gmail: 앱 비밀번호 사용
ALERT_EMAIL_TO=ops@yourcompany.com

# 데이터 보존 기간 (기본 90일)
VM_RETENTION=90d
```

> Gmail 앱 비밀번호: Google 계정 → 보안 → 2단계 인증 → 앱 비밀번호

### 3.3 Alertmanager 설정 생성

```bash
# .env 기반으로 config/alertmanager/alertmanager.yml 생성
make alertmanager-config
```

### 3.4 스택 실행

```bash
# 빌드 + 실행
docker compose up -d

# 상태 확인 (5개 서비스 모두 healthy 대기)
docker compose ps
```

기대 결과:

```
NAME                  STATUS
msp-victoriametrics   Up (healthy)
msp-alertmanager      Up (healthy)
msp-vmalert           Up (healthy)
msp-grafana           Up (healthy)
msp-nginx             Up (healthy)
```

### 3.5 접근

| 항목 | 주소 |
|------|------|
| Grafana 대시보드 | `http://<중앙서버_IP>:8880` |
| Basic Auth | NGINX_BASIC_AUTH_USER / NGINX_BASIC_AUTH_PASSWORD |
| Grafana 로그인 | GF_ADMIN_USER / GF_ADMIN_PASSWORD |

### 3.6 방화벽

```bash
# 에이전트 push + Grafana 접근용
sudo ufw allow 8880/tcp
```

---

## 4. 에이전트 설치

자세한 내용: [agent-install.md](agent-install.md) (온라인) | [agent-offline-install.md](agent-offline-install.md) (폐쇄망)

### 모드 선택

| 상황 | 모드 |
|------|------|
| 중앙서버로 직접 outbound 가능 | `direct` |
| 고객사 내 게이트웨이 서버 | `relay-server` |
| outbound 차단, relay 경유 | `relay-agent` |

### 빠른 설치 (Linux)

```bash
# 레포 클론 또는 agents/ 폴더만 복사
git clone https://github.com/Soojong94/monitoring_msp.git
cd monitoring_msp

# Direct 모드
sudo ./agents/install.sh \
  --mode=direct \
  --customer-id=<고객사ID> \
  --server-name=<서버명> \
  --csp=<aws|kt|naver|nhn> \
  --region=<리전> \
  --environment=prod \
  --remote-write-url=http://<중앙서버_IP>:8880/api/v1/write
```

설치 후 `[OK] Alloy 실행 중` 메시지 확인.

### 새 고객 추가 체크리스트

- [ ] 에이전트 설치 (install.sh 또는 install.ps1)
- [ ] 2~3분 후 VictoriaMetrics에서 수신 확인
- [ ] Grafana 대시보드 customer 드롭다운에서 고객 확인

```bash
# 수신 확인
curl -s "http://<중앙서버_IP>:8428/api/v1/label/server_name/values"
```

---

## 5. 알림 설정

### 5.1 알림 규칙

| 알림명 | 조건 | 심각도 | for |
|--------|------|--------|-----|
| `ServerDown` | 5분 이상 메트릭 미수신 | critical | 즉시 |
| `HighCPUUsage` | CPU > 80% | warning | 5분 |
| `HighMemoryUsage` | 메모리 > 85% | warning | 5분 |
| `HighDiskUsage` | 디스크 > 90% | warning | 5분 |

ServerDown 발화 시 같은 서버의 CPU/메모리/디스크 알림은 자동 억제(inhibit)된다.

### 5.2 알림 발송 주기

| 심각도 | group_wait | repeat_interval |
|--------|-----------|-----------------|
| critical | 10초 | 1시간 |
| warning | 60초 | 6시간 |

### 5.3 SMTP 변경 시

`.env` 수정 후 재생성:

```bash
nano .env              # SMTP_* 수정
make alertmanager-config  # alertmanager.yml 재생성
docker compose restart alertmanager
```

### 5.4 알림 발화 확인 (CLI)

```bash
# VMAlert 규칙 상태
docker exec msp-vmalert wget -qO- http://127.0.0.1:8180/api/v1/rules | python3 -m json.tool

# Alertmanager 수신 알림
docker exec msp-alertmanager wget -qO- http://127.0.0.1:9093/api/v2/alerts
```

---

## 6. 대시보드 사용법

### 6.1 MSP 전체 고객 현황

**용도**: 모든 고객 상태를 한눈에 파악

- 상단 지표: 총 고객 수, 서버 수, 평균 CPU, 평균 메모리
- 고객별 현황 테이블: CPU/메모리 사용률 (60%+ 노란색, 80%+ 빨간색)
- `customer` 드롭다운: 특정 고객 필터링 가능

### 6.2 고객별 상세 현황

**용도**: 특정 고객의 모든 서버 현황

1. 상단 `customer` 드롭다운에서 고객 선택
2. `server` 드롭다운에서 전체 또는 특정 서버 선택
3. 서버별 CPU/메모리 추이, 네트워크 현황 확인

### 6.3 서버별 상세 현황

**용도**: 개별 서버 OS 레벨 분석

- CPU/메모리/디스크 게이지 + 추이 그래프
- Network I/O (NIC별), Disk I/O (읽기/쓰기)
- Load Average, Uptime

### 6.4 공통

- 우측 상단 시간 선택기: `Last 1h`, `Last 6h`, `Last 24h` 등
- 그래프 드래그: 특정 구간 확대
- 데이터는 기동 후 약 1분 뒤부터 표시됨 (rate() 계산 필요)

---

## 7. 설정 파일 상세

### 7.1 서비스 구성

| 서비스 | 이미지 | 내부 포트 | 역할 |
|--------|--------|-----------|------|
| victoriametrics | victoriametrics/victoria-metrics:v1.106.1 | 8428 | 시계열 저장소 |
| alertmanager | prom/alertmanager:v0.27.0 | 9093 | 알림 라우팅 (SMTP) |
| vmalert | victoriametrics/vmalert:v1.106.1 | 8180 | 알림 규칙 평가 |
| grafana | 커스텀 빌드 | 3000 | 대시보드 |
| nginx | 커스텀 빌드 | 80 | 리버스 프록시 (외부 :8880) |

기동 순서: VictoriaMetrics → Alertmanager → VMAlert → Grafana → Nginx

### 7.2 Nginx 라우팅

```
클라이언트 → Nginx(:8880)
  ├── /api/v1/write     → VictoriaMetrics (에이전트 push, 인증 없음)
  ├── /health           → 헬스체크
  └── /*                → Grafana (Basic Auth 적용)
```

에이전트 push 경로는 인증 없이 통과. Grafana 접근만 Basic Auth 적용.

### 7.3 VMAlert 알림 규칙 (`config/vmalert/rules/host-alerts.yml`)

```yaml
groups:
  - name: host.rules
    interval: 60s    # 60초마다 평가
    rules:
      - alert: ServerDown
        expr: absent_over_time(node_uname_info{customer_id!=""}[5m]) == 1
        # absent_over_time: 5분간 시리즈가 사라지면 1 반환
        # for: 0m — 이미 5분 윈도우가 조건에 포함됨

      - alert: HighCPUUsage
        expr: ... > 80    # for: 5m

      - alert: HighMemoryUsage
        expr: ... > 85    # for: 5m

      - alert: HighDiskUsage
        expr: ... > 90    # for: 5m (tmpfs/overlay 제외)
```

### 7.4 Alertmanager (`config/alertmanager/alertmanager.yml.tmpl`)

- 템플릿 파일: git에 커밋 (크레덴셜 없음)
- 생성 파일: `config/alertmanager/alertmanager.yml` → gitignore
- `make alertmanager-config`: `envsubst`로 `.env` 기반 생성

```yaml
inhibit_rules:
  - source_match:
      alertname: 'ServerDown'
    target_match_re:
      alertname: 'HighCPUUsage|HighMemoryUsage|HighDiskUsage'
    equal: ['customer_id', 'server_name']
```

### 7.5 VictoriaMetrics

| 파라미터 | 값 | 설명 |
|----------|----|------|
| retentionPeriod | 90d | 90일 데이터 보존 |
| dedup.minScrapeInterval | 30s | 중복 제거 |
| selfScrapeInterval | 15s | 자체 메트릭 수집 |

---

## 8. 운영 명령어

### 스택 관리

```bash
# 실행
docker compose up -d

# 중지
docker compose down

# 재시작 (전체)
docker compose restart

# 특정 서비스만 재시작
docker compose restart alertmanager

# 로그 확인 (실시간)
docker compose logs -f vmalert
docker compose logs -f alertmanager
```

### 상태 확인

```bash
# 서비스 상태
docker compose ps

# VMAlert 규칙 평가 결과
docker exec msp-vmalert wget -qO- http://127.0.0.1:8180/api/v1/rules

# 현재 발화 중인 알림
docker exec msp-alertmanager wget -qO- http://127.0.0.1:9093/api/v2/alerts

# VictoriaMetrics 등록 서버 목록
curl -s http://localhost:8428/api/v1/label/server_name/values
```

### 데이터 쿼리

```bash
# 특정 고객 수신 확인
curl -s "http://localhost:8428/api/v1/query" \
  --data-urlencode 'query=node_uname_info{customer_id="kt"}'

# CPU 사용률 현재값
curl -s "http://localhost:8428/api/v1/query" \
  --data-urlencode 'query=(1 - avg by (server_name)(rate(node_cpu_seconds_total{mode="idle"}[5m]))) * 100'
```

### Alertmanager 설정 업데이트

```bash
# .env SMTP 변경 후
make alertmanager-config           # 파일 재생성
docker compose restart alertmanager  # 컨테이너에 반영
```

---

## 9. 트러블슈팅

### 서비스 unhealthy

```bash
# 로그로 원인 확인
docker compose logs <서비스명> --tail=50
```

| 증상 | 원인 | 해결 |
|------|------|------|
| alertmanager unhealthy | `alertmanager.yml` 파일 없음 | `make alertmanager-config` 실행 |
| alertmanager unhealthy | yml 문법 오류 | `docker logs msp-alertmanager` 로 오류 확인 |
| vmalert unhealthy | VM 미기동 상태에서 시작 | `docker compose restart vmalert` |
| grafana unhealthy | 기동 시간 부족 | 30초 대기 후 재확인 |

### 대시보드 "No data"

```bash
# 1. VM에 데이터가 있는지 확인
curl -s "http://localhost:8428/api/v1/query?query=count(node_uname_info)"

# 2. 에이전트 로그 확인 (고객 서버에서)
journalctl -u alloy -n 30

# 3. 네트워크 연결 테스트 (고객 서버에서)
curl http://<중앙서버_IP>:8880/health
```

### 알림 이메일 미수신

```bash
# 1. Alertmanager 알림 상태 확인
docker exec msp-alertmanager wget -qO- http://127.0.0.1:9093/api/v2/alerts

# 2. Alertmanager 로그 확인
docker compose logs alertmanager --tail=50
# "dial tcp: connection refused" → SMTP 서버 주소 오류
# "authentication failed" → SMTP 비밀번호 오류

# 3. 설정 파일 내용 확인
cat config/alertmanager/alertmanager.yml
```

### 고객이 대시보드에 안 보임

```bash
# VM에서 직접 확인
curl -s "http://localhost:8428/api/v1/query" \
  --data-urlencode 'query=node_uname_info{customer_id="<고객ID>"}'

# 에이전트 상태 확인 (고객 서버에서)
systemctl status alloy
journalctl -u alloy -n 20
```

### ServerDown 알림이 계속 발화됨 (에이전트 없는 상태)

에이전트가 하나도 없으면 `absent_over_time`이 항상 1을 반환한다.
에이전트가 연결되면 실제 서버별 알림으로 전환된다.
더미 알림을 Alertmanager에서 silence 처리 가능:
`http://<중앙서버>:8880` → Grafana → Alerting → Alertmanager 연동 후 silence 설정.
