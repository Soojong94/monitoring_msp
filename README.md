# MSP Central Monitoring System

클라우드 MSP를 위한 **다중 고객 서버 통합 모니터링** 시스템.

Ubuntu 중앙 서버 1대에서 모든 고객사 서버의 OS 메트릭(CPU/메모리/디스크/네트워크)을 수집, 시각화하고, 임계값 초과 시 이메일 알림을 발송한다.

---

## 목차

1. [아키텍처](#아키텍처)
2. [Tech Stack](#tech-stack)
3. [중앙 서버 설치](#중앙-서버-설치)
4. [HTTPS 설정](#https-설정-lets-encrypt)
5. [Alertmanager 이메일 설정](#alertmanager-이메일-설정)
6. [에이전트 설치 — Linux](#에이전트-설치--linux)
7. [에이전트 설치 — Windows](#에이전트-설치--windows)
8. [대시보드](#대시보드)
9. [알람 규칙](#알람-규칙)
10. [중앙 서버 업데이트 방법](#중앙-서버-업데이트-방법)
11. [운영 참고사항](#운영-참고사항)
12. [트러블슈팅](#트러블슈팅)
13. [디렉토리 구조](#디렉토리-구조)

---

## 아키텍처

```
[고객사 서버 — outbound 가능]
  Server A  ─── Alloy (direct) ──────────────────────────┐
  Server B  ─── Alloy (direct) ──────────────────────────┤
                                                          │  :80 (HTTPS)
[고객사 서버 — outbound 차단]                             ▼
  Server C  ─── Alloy (relay-agent) ─┐        ┌─────────────────────────┐
  Server D  ─── Alloy (relay-agent) ─┤        │   중앙 서버 (Ubuntu)    │
                                     ▼        │                         │
                          Alloy (relay-server) │  VictoriaMetrics (DB)  │
                              :9999 수신       │  VMAlert (알림 평가)   │
                                     │        │  Alertmanager (이메일)  │
                                     └───────▶│  Grafana (대시보드)    │
                                              │  Nginx (HTTPS 프록시)  │
                                              └──────────┬──────────────┘
                                                         │ Gmail SMTP
                                                    📧 이메일 알림
```

**에이전트 3가지 모드:**

| 모드 | 대상 서버 | 설명 |
|------|-----------|------|
| `direct` | outbound 가능 서버 | 중앙 서버로 직접 push |
| `relay-server` | 고객사 내 게이트웨이 서버 | 내부 에이전트 메트릭 수신(:9999) + 중앙으로 전달 + 자체 수집 |
| `relay-agent` | outbound 차단 서버 | relay-server 내부 IP:9999 로 push |

---

## Tech Stack

| 컴포넌트 | 기술 | 역할 |
|----------|------|------|
| 시계열 저장소 | VictoriaMetrics v1.106 | remote_write 수신, PromQL 지원, 90일 보존 |
| 알림 규칙 | VMAlert v1.106 | PromQL 기반 임계값 평가 (60초 주기) |
| 알림 라우팅 | Alertmanager v0.27 | Gmail SMTP 이메일 발송, 중복 억제, inhibit |
| 시각화 | Grafana 10.4 | 다중 고객 대시보드 3종 |
| 에이전트 | Grafana Alloy v1.5 | 단일 바이너리, systemd/Windows Service |
| 리버스 프록시 | Nginx | HTTPS, Basic Auth, 에이전트 write 엔드포인트 |
| 오케스트레이션 | Docker Compose | 중앙 서버 5개 서비스 관리 |

---

## 중앙 서버 설치

### 사전 조건

- Ubuntu 20.04 이상 (NCP, AWS, GCP 등 무관)
- Docker Engine + Docker Compose Plugin
- 방화벽 포트 오픈:
  - `80` — HTTP (에이전트 remote_write + HTTPS 리다이렉트)
  - `443` — HTTPS (Grafana 대시보드 접근, HTTPS 설정 후)
  - 기본 포트(HTTPS 설정 전): `8880` (HTTP)

### 설치 순서

```bash
# 1. Docker 설치
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# 2. 레포 클론
git clone https://github.com/Soojong94/monitoring_msp.git
cd monitoring_msp

# 3. 환경변수 설정
cp .env.example .env
nano .env
```

### .env 필수 설정 항목

```env
# Grafana 관리자 계정
GF_ADMIN_USER=admin
GF_ADMIN_PASSWORD=강력한비밀번호

# Nginx Basic Auth (브라우저 접근 시 팝업 인증)
NGINX_BASIC_AUTH_USER=admin
NGINX_BASIC_AUTH_PASSWORD=강력한비밀번호

# 포트 (HTTPS 설정 전 기본값)
NGINX_HTTP_PORT=8880
NGINX_HTTPS_PORT=8443
```

```bash
# 4. Alertmanager 이메일 설정 파일 생성
#    (아래 "Alertmanager 이메일 설정" 섹션 참고 후 직접 생성)

# 5. 실행
docker compose up -d

# 6. 상태 확인 (5개 서비스 모두 healthy 확인)
docker compose ps
```

### 실행 확인

```bash
# 헬스 체크
curl http://<서버_IP>:8880/health
# 응답: {"status":"ok"}

# Grafana 접속
# 브라우저: http://<서버_IP>:8880
# ID: .env의 NGINX_BASIC_AUTH_USER / PW: NGINX_BASIC_AUTH_PASSWORD
# 이후 Grafana 로그인: GF_ADMIN_USER / GF_ADMIN_PASSWORD
```

---

## HTTPS 설정 (Let's Encrypt)

> **사전 조건**: 도메인이 서버 IP로 DNS A 레코드 연결되어 있어야 함.
> 예: `grafana.tbit.co.kr` → `211.188.53.76`

### DNS 확인

```bash
nslookup grafana.tbit.co.kr
# 서버 IP가 나오면 OK
```

### HTTPS 자동 설정

```bash
cd ~/monitoring_msp && git pull
bash scripts/setup-https.sh <도메인> <이메일>

# 예시
bash scripts/setup-https.sh grafana.tbit.co.kr ksj@tbit.co.kr
```

스크립트가 자동으로 수행하는 작업:
1. Let's Encrypt 인증서 발급 (certbot standalone)
2. nginx.conf를 HTTPS 버전으로 교체 (HTTP→HTTPS 리다이렉트 포함)
3. `docker-compose.override.yml` 생성 (인증서 볼륨 마운트 + 포트 80/443)
4. 인증서 자동 갱신 cron 등록 (매월 1일, 15일 새벽 3시)
5. nginx 재빌드 및 재시작

### HTTPS 설정 후 에이전트 URL 변경

HTTPS 설정 후 에이전트의 `REMOTE_WRITE_URL`을 변경해야 함.

> **주의**: Alloy remote_write는 HTTP 301 리다이렉트를 따라가지 않으므로 에이전트 설정을 직접 변경해야 함.

```bash
# 각 에이전트 서버에서
sudo nano /etc/alloy/alloy.env

# REMOTE_WRITE_URL 변경
REMOTE_WRITE_URL=https://grafana.tbit.co.kr/api/v1/write

# 재시작
sudo systemctl restart alloy
```

---

## Alertmanager 이메일 설정

> **현재 설정**: Gmail 앱 비밀번호를 사용하여 지정된 이메일로 알림 발송.

### alertmanager.yml 생성

`config/alertmanager/alertmanager.yml` 파일을 직접 생성 (git에 포함되지 않음):

```bash
cat > ~/monitoring_msp/config/alertmanager/alertmanager.yml << 'EOF'
global:
  smtp_smarthost: 'smtp.gmail.com:587'
  smtp_from: 'your-gmail@gmail.com'
  smtp_auth_username: 'your-gmail@gmail.com'
  smtp_auth_password: 'your-app-password'
  smtp_require_tls: true

route:
  group_by: ['customer_id', 'alertname']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'email-ops'
  routes:
    - match:
        severity: critical
      group_wait: 10s
      repeat_interval: 1h
      receiver: 'email-ops'
    - match:
        severity: warning
      group_wait: 60s
      repeat_interval: 6h
      receiver: 'email-ops'

receivers:
  - name: 'email-ops'
    email_configs:
      - to: 'recipient1@company.com, recipient2@company.com'
        send_resolved: true
        headers:
          Subject: '[{{ .Status | toUpper }}] {{ .GroupLabels.alertname }} - {{ .GroupLabels.customer_id }}'

inhibit_rules:
  - source_match:
      alertname: 'ServerDown'
    target_match_re:
      alertname: 'HighCPUUsage|HighMemoryUsage|HighDiskUsage'
    equal: ['customer_id', 'server_name']
EOF
```

> **Gmail 앱 비밀번호 발급**: Google 계정 → 보안 → 2단계 인증 활성화 → 앱 비밀번호 생성

### Alertmanager 설정 적용

```bash
# alertmanager.yml이 파일인지 확인 (디렉토리면 삭제 후 재생성)
ls -la config/alertmanager/alertmanager.yml

# docker compose 재시작
docker compose restart alertmanager

# 알림 테스트 (v2 API 사용)
curl http://localhost:9093/api/v2/alerts
```

---

## 에이전트 설치 — Linux

### 공통 사전 조건

- Ubuntu 20.04+ / Rocky Linux 8+ (또는 CentOS 8+)
- 인터넷 접근 가능한 서버: `install.sh` 사용
- 인터넷 차단 서버: `install-offline.sh` + 패키지 파일 사용

### 모드 1: Direct (인터넷 가능 서버)

중앙 서버로 메트릭을 직접 push하는 방식.

```bash
# 레포 클론 또는 파일 복사 후
sudo bash agents/install.sh \
  --mode=direct \
  --customer-id=<고객사ID> \
  --server-name=<서버명> \
  --csp=<클라우드> \
  --region=<리전> \
  --environment=<환경> \
  --remote-write-url=https://grafana.tbit.co.kr/api/v1/write
```

**파라미터 설명:**

| 파라미터 | 설명 | 예시 |
|----------|------|------|
| `--customer-id` | 고객사 식별자 (소문자, 숫자, 하이픈) | `kt`, `naver`, `samsung` |
| `--server-name` | 서버 이름 | `kt-prod-web-01` |
| `--csp` | 클라우드 제공자 | `aws`, `kt`, `naver`, `nhn`, `gcp` |
| `--region` | 리전 | `ap-northeast-2`, `kc1`, `kr` |
| `--environment` | 환경 구분 | `prod`, `staging`, `test` |
| `--remote-write-url` | 중앙 서버 주소 | `https://grafana.tbit.co.kr/api/v1/write` |

**설치 후 확인:**

```bash
systemctl status alloy
journalctl -u alloy -n 50
```

---

### 모드 2: Relay-Server (게이트웨이 서버)

인터넷은 가능하지만 내부 서버들이 중앙 서버로 직접 못 보내는 경우, 게이트웨이 역할.
- 내부 에이전트로부터 `:9999`로 메트릭 수신
- 중앙 서버로 전달
- 자체 OS 메트릭도 함께 수집

```bash
sudo bash agents/install.sh \
  --mode=relay-server \
  --customer-id=<고객사ID> \
  --server-name=<서버명> \
  --csp=<클라우드> \
  --region=<리전> \
  --environment=<환경> \
  --remote-write-url=https://grafana.tbit.co.kr/api/v1/write
```

**방화벽 설정 (relay-server):**

```bash
# relay-agent 서버들이 접근할 수 있도록 9999 포트 오픈
ufw allow 9999/tcp    # Ubuntu
firewall-cmd --permanent --add-port=9999/tcp && firewall-cmd --reload  # Rocky/CentOS
```

**설치 후 확인:**

```bash
systemctl status alloy
# 포트 수신 확인
ss -tlnp | grep 9999
```

---

### 모드 3: Relay-Agent (내부망/폐쇄망 서버)

인터넷 접근이 불가하여 relay-server를 통해서만 메트릭 전송.

#### 온라인 설치 (relay-server에서 파일 복사)

```bash
# relay-server에서 relay-agent 서버로 파일 복사
scp /usr/bin/alloy user@<DB서버_IP>:/tmp/alloy
scp -r ~/monitoring_msp/agents user@<DB서버_IP>:/tmp/agents

# relay-agent 서버에서 설치
sudo mv /tmp/alloy /usr/bin/alloy
sudo chmod +x /usr/bin/alloy
sudo bash /tmp/agents/install.sh \
  --mode=relay-agent \
  --customer-id=<고객사ID> \
  --server-name=<서버명> \
  --csp=<클라우드> \
  --region=<리전> \
  --environment=<환경> \
  --relay-url=http://<relay서버_내부IP>:9999/api/v1/metrics/write
```

> **중요**: `--relay-url`에는 relay-server의 **내부 IP**를 사용해야 함. 외부 IP 사용 불가.

#### 오프라인 설치 패키지 사용

```bash
# 중앙 서버(인터넷 가능한 곳)에서 패키지 빌드
bash scripts/build-package.sh

# 생성된 패키지: dist/msp-agent-linux-amd64.tar.gz
# 패키지를 대상 서버로 전달 후

tar xzf msp-agent-linux-amd64.tar.gz
sudo bash install-offline.sh \
  --mode=relay-agent \
  --customer-id=<고객사ID> \
  --server-name=<서버명> \
  --csp=<클라우드> \
  --region=<리전> \
  --environment=<환경> \
  --relay-url=http://<relay서버_내부IP>:9999/api/v1/metrics/write
```

---

### 에이전트 환경변수 파일 위치 및 수정

설치 후 설정은 `/etc/alloy/alloy.env` 에서 관리:

```bash
sudo nano /etc/alloy/alloy.env

# 수정 후 재시작
sudo systemctl restart alloy
```

---

## 에이전트 설치 — Windows

> **지원 모드**: `direct`, `relay-agent` (relay-server는 Linux 전용)

### 사전 조건

- Windows 10 / Windows Server 2016 이상
- PowerShell 5.1 이상
- **관리자 권한으로 PowerShell 실행** 필수
- 인터넷 접근 가능 (Alloy 바이너리 + WinSW 서비스 래퍼 자동 다운로드)

### 설치 (PowerShell 관리자)

```powershell
# 레포 클론 또는 파일 복사 후 PowerShell 관리자로 실행

# Direct 모드
.\agents\install.ps1 `
  -Mode direct `
  -CustomerId kt `
  -ServerName kt-prod-win-01 `
  -Csp kt `
  -Region kc1 `
  -Environment prod `
  -RemoteWriteUrl https://grafana.tbit.co.kr/api/v1/write

# Relay-Agent 모드
.\agents\install.ps1 `
  -Mode relay-agent `
  -CustomerId kt `
  -ServerName kt-prod-db-01 `
  -Csp kt `
  -Region kc1 `
  -Environment prod `
  -RelayUrl http://<relay서버_내부IP>:9999/api/v1/metrics/write
```

> **서비스 래퍼**: install.ps1은 내부적으로 **WinSW(Windows Service Wrapper)** v2.12.0을 사용한다.
> Alloy 단독 실행 시 Windows SCM(서비스 제어 관리자) 프로토콜을 구현하지 않아 30초 타임아웃으로
> 서비스가 자동 중지되는 문제가 있는데, WinSW가 이를 대신 처리한다.

### 설치 확인

```powershell
# 서비스 상태 확인
Get-Service GrafanaAlloy

# 로그 확인 (WinSW 래퍼 로그)
Get-Content "C:\ProgramData\GrafanaAlloy\logs\alloy-service.out.log" -Tail 30
```

### Windows 에이전트 관리

```powershell
# 서비스 재시작
Restart-Service GrafanaAlloy

# config만 교체하고 재시작 (설정 변경 시)
Copy-Item agents\direct\config-windows.alloy C:\ProgramData\GrafanaAlloy\config.alloy
Restart-Service GrafanaAlloy

# 서비스 중지/제거
Stop-Service GrafanaAlloy
& "C:\Program Files\GrafanaLabs\Alloy\alloy-service.exe" uninstall
```

### Windows 수집 메트릭

Linux `node_exporter`와 동일한 대시보드를 사용하기 위해 `config-windows.alloy`에서 메트릭 이름을 자동 변환한다.

| 항목 | 상태 |
|------|------|
| CPU 사용률 | ✅ 지원 |
| 메모리 사용률/용량 | ✅ 지원 |
| 디스크 사용률 (C:, D: 등) | ✅ 지원 |
| 디스크 I/O (읽기/쓰기) | ✅ 지원 |
| 네트워크 송수신 | ✅ 지원 |
| Uptime | ✅ 지원 |
| Load Average | ❌ Linux 전용 (Windows에서 "No data" — 정상) |

---

## 대시보드

Grafana 접속: `https://grafana.tbit.co.kr`

로그인 순서:
1. 브라우저 팝업: Nginx Basic Auth (NGINX_BASIC_AUTH_USER / NGINX_BASIC_AUTH_PASSWORD)
2. Grafana 로그인: GF_ADMIN_USER / GF_ADMIN_PASSWORD

### 대시보드 3종

| 대시보드 | 경로 | 용도 |
|----------|------|------|
| MSP 전체 고객 현황 | Home | 전체 고객사·서버 수, 평균 CPU/메모리, 고객별 현황 테이블 |
| 고객별 상세 현황 | customer 선택 | 특정 고객의 서버별 CPU/메모리 게이지, 서버 목록 테이블 |
| 서버별 상세 현황 | customer + server 선택 | 개별 서버 CPU/메모리/디스크/네트워크/Disk I/O 전체 |

### 서버별 상세 현황 패널 구성

| 섹션 | 패널 |
|------|------|
| 서버 요약 | Uptime, CPU 사용률, 메모리 사용률, 디스크 사용률 (최대) |
| CPU 상세 | CPU 사용률 추이, Load Average |
| 메모리 상세 | 메모리 사용률 추이, 메모리 구성 (Total/Available) |
| 네트워크 | 현재 수신/송신 속도, 누적량, NIC별 트래픽 추이 |
| 디스크 I/O | 읽기/쓰기 속도 (장치별), **디스크 사용률 추이 (마운트포인트별)** |
| 임계값 근접 경고 | CPU/메모리/디스크 임계값 도달률 게이지 |

> **멀티 디스크**: `/`, `/data`, `/backup` 등 여러 파티션이 있으면 자동으로 모두 표시됨. tmpfs, overlay, nfs 등 가상 파일시스템은 자동 제외.

---

## 알람 규칙

| 알림 | 조건 | 심각도 | 이메일 발송 주기 |
|------|------|--------|----------------|
| `ServerDown` | 5분 이상 메트릭 미수신 | critical | 즉시 → 1시간마다 반복 |
| `HighCPUUsage` | CPU 사용률 > 90% (5분 지속) | warning | 60초 후 → 6시간마다 반복 |
| `HighMemoryUsage` | 메모리 사용률 > 90% (5분 지속) | warning | 60초 후 → 6시간마다 반복 |
| `HighDiskUsage` | 디스크 사용률 > 90% (5분 지속, 마운트포인트별) | warning | 60초 후 → 6시간마다 반복 |

**알람 억제 (Inhibit):**
- ServerDown 발생 시 해당 서버의 CPU/메모리/디스크 알람 자동 억제
- (서버가 다운되면 파생 알람이 발생하지 않도록 방지)

**이메일 제목 형식:**
```
[FIRING] HighCPUUsage - customer_id
[RESOLVED] ServerDown - customer_id
```

---

## 중앙 서버 업데이트 방법

대시보드, 알람 규칙 등 설정 파일 변경 후 적용 방법:

```bash
cd ~/monitoring_msp

# 변경사항 가져오기
git pull

# 서비스별 업데이트 방법
# Grafana 대시보드 변경 → 이미지 재빌드 필요
docker compose build grafana && docker compose up -d grafana

# nginx 설정 변경 → 이미지 재빌드 필요
docker compose build nginx && docker compose up -d nginx

# VMAlert 규칙 변경 → 재시작만으로 적용
docker compose restart vmalert

# Alertmanager 설정 변경 → 재시작만으로 적용
docker compose restart alertmanager

# 전체 재시작
docker compose down && docker compose up -d
```

> **Grafana/Nginx는 이미지에 설정이 baked-in** 되어 있어서 `restart`가 아닌 `build` + `up -d` 필요.

---

## 운영 참고사항

### 에이전트 수집 메트릭

| 메트릭 | Linux | Windows | 비고 |
|--------|-------|---------|------|
| CPU 사용률 | ✅ | ✅ | |
| 메모리 사용률/용량 | ✅ | ✅ | |
| 디스크 사용량 | ✅ | ✅ | Linux: ext4/xfs만, Windows: NTFS(C:, D: 등) |
| 디스크 I/O | ✅ | ✅ | |
| 네트워크 송수신 | ✅ | ✅ | |
| Uptime | ✅ | ✅ | |
| Load Average | ✅ | ❌ | Linux 전용 개념. Windows에서는 "No data" (정상) |

> **Windows 메트릭 호환성**: `config-windows.alloy`는 `windows_exporter`가 생성하는 `windows_*` 메트릭을
> `prometheus.relabel`로 `node_*` 이름으로 자동 변환하여 Linux/Windows가 동일한 Grafana 대시보드를 공유한다.

### 라벨 체계

모든 메트릭에 다음 라벨이 붙음:

| 라벨 | 설명 | 예시 |
|------|------|------|
| `customer_id` | 고객사 식별자 | `kt`, `naver` |
| `server_name` | 서버명 | `kt-prod-web-01` |
| `csp` | 클라우드 종류 | `aws`, `kt`, `naver`, `nhn` |
| `region` | 리전 | `ap-northeast-2`, `kr` |
| `environment` | 환경 | `prod`, `staging`, `test` |

### 데이터 보존 기간

기본 90일. `.env`의 `VM_RETENTION` 값으로 변경 가능:

```env
VM_RETENTION=180d  # 180일로 변경
```

변경 후 VictoriaMetrics 재시작 필요:

```bash
docker compose restart victoriametrics
```

### 인증서 자동 갱신 확인

```bash
# cron 등록 확인
crontab -l | grep renew

# 갱신 로그 확인
cat /var/log/letsencrypt/renew-cron.log

# 수동 갱신 테스트
bash /root/renew-letsencrypt.sh
```

---

## 트러블슈팅

### 에이전트 데이터가 Grafana에 안 나올 때

```bash
# 1. 에이전트 상태 확인
systemctl status alloy
journalctl -u alloy -n 100

# 2. 중앙 서버에 실제로 데이터 도달하는지 확인
curl "https://grafana.tbit.co.kr/api/v1/query?query=node_uname_info" \
  # VictoriaMetrics 직접 조회는 내부에서
docker exec msp-victoriametrics \
  wget -qO- "http://localhost:8428/api/v1/label/customer_id/values"

# 3. 라벨 확인
docker exec msp-victoriametrics \
  wget -qO- "http://localhost:8428/api/v1/label/server_name/values"
```

### alertmanager.yml이 디렉토리로 만들어졌을 때

```bash
# 확인
ls -la config/alertmanager/alertmanager.yml

# 디렉토리면 삭제 후 파일로 재생성
rm -rf config/alertmanager/alertmanager.yml
cat > config/alertmanager/alertmanager.yml << 'EOF'
(위 Alertmanager 설정 섹션 내용 붙여넣기)
EOF

docker compose restart alertmanager
```

### alloy 서비스가 217/USER 오류로 실패할 때

바이너리를 직접 복사한 경우 alloy 사용자가 없어서 발생:

```bash
useradd --system --no-create-home --shell /bin/false alloy
mkdir -p /var/lib/alloy && chown alloy:alloy /var/lib/alloy
systemctl restart alloy
```

### Grafana 대시보드가 업데이트 안 될 때

설정이 이미지에 baked-in 되어 있어 `restart`만으로는 반영 안 됨:

```bash
docker compose build grafana && docker compose up -d grafana
```

### Windows: 서비스 시작 30초 후 자동 중지 (이벤트 7009/7000)

Alloy 단독 실행 시 Windows SCM(서비스 제어 관리자) 프로토콜(`SetServiceStatus`)을 구현하지 않아
30초 타임아웃 후 서비스가 자동 중지된다.

`install.ps1`이 **WinSW(Windows Service Wrapper)** v2.12.0을 자동으로 설치하여 이 문제를 해결한다.
수동으로 `New-Service`나 `sc.exe`로 등록하면 동일 문제가 재발한다.

```powershell
# 이벤트 로그로 확인
Get-EventLog -LogName System -Source "Service Control Manager" -Newest 10 | Where-Object { $_.Message -like "*Alloy*" }

# 해결: install.ps1 재실행 (WinSW가 자동 처리)
.\agents\install.ps1 -Mode direct -CustomerId <id> -ServerName <name> ...
```

### Windows: 메트릭이 VictoriaMetrics에는 있는데 대시보드에 안 보일 때

`config-windows.alloy`가 구버전인 경우. 최신 config에는 `prometheus.relabel "win_compat"` 블록이 있어
`windows_*` → `node_*` 메트릭 이름을 자동 변환한다.

```powershell
# config 버전 확인 (win_compat 블록 있는지)
Select-String "win_compat" C:\ProgramData\GrafanaAlloy\config.alloy

# 없으면 최신 config 배포
git pull
Copy-Item agents\direct\config-windows.alloy C:\ProgramData\GrafanaAlloy\config.alloy
Restart-Service GrafanaAlloy
```

### Alertmanager v2 API

v0.27 이상에서 `/api/v1/alerts`는 제거됨 (410 Gone). v2 사용:

```bash
curl http://localhost:9093/api/v2/alerts
```

### relay-server 9999 포트 연결 안 될 때

```bash
# relay-server에서 포트 열림 확인
ss -tlnp | grep 9999

# 방화벽 확인
ufw status
# 또는
firewall-cmd --list-ports
```

---

## 디렉토리 구조

```
monitoring_msp/
├── docker-compose.yml              # 중앙 서버 프로덕션 스택 (5개 서비스)
├── docker-compose.override.yml     # HTTPS 설정 후 자동 생성 (인증서 볼륨 마운트)
├── .env.example                    # 환경변수 템플릿
├── .env                            # 실제 환경변수 (git 제외)
├── Makefile                        # 편의 명령어
│
├── agents/                         # 고객 서버 에이전트 설치
│   ├── install.sh                  # Linux 온라인 설치 (direct/relay-server/relay-agent)
│   ├── install-offline.sh          # Linux 오프라인 설치
│   ├── install.ps1                 # Windows 설치 (direct/relay-agent)
│   ├── direct/
│   │   ├── config.alloy            # Linux direct 모드 Alloy 설정
│   │   └── config-windows.alloy    # Windows direct 모드 Alloy 설정
│   └── relay/
│       ├── relay-server.alloy      # relay-server 모드 설정
│       ├── agent-to-relay.alloy    # Linux relay-agent 모드 설정
│       └── agent-to-relay-windows.alloy  # Windows relay-agent 모드 설정
│
├── config/
│   ├── alertmanager/
│   │   ├── alertmanager.yml.tmpl   # 이메일 설정 템플릿
│   │   └── alertmanager.yml        # 실제 설정 파일 (git 제외, 직접 생성)
│   ├── vmalert/rules/
│   │   └── host-alerts.yml         # 알림 규칙 4종 (ServerDown/CPU/Memory/Disk)
│   ├── grafana/
│   │   ├── dashboards/             # 대시보드 JSON 3종
│   │   └── provisioning/           # 데이터소스 + 대시보드 자동 프로비저닝 설정
│   └── nginx/
│       └── nginx.conf              # 리버스 프록시 설정 (HTTPS 설정 후 자동 교체됨)
│
├── docker/
│   ├── grafana/Dockerfile          # 대시보드 baked 이미지 (grafana:10.4.0 기반)
│   ├── nginx/Dockerfile            # Basic Auth baked 이미지 (nginx:1.25-alpine 기반)
│   └── ubuntu-systemd/             # 로컬 테스트용 Ubuntu+systemd 이미지
│
├── scripts/
│   ├── build-package.sh            # 오프라인 배포 패키지 빌드 (dist/ 생성)
│   └── setup-https.sh              # Let's Encrypt HTTPS 자동 설정
│
└── docs/
    ├── agent-install.md            # 에이전트 설치 상세 가이드 (온라인)
    ├── agent-offline-install.md    # 에이전트 설치 상세 가이드 (오프라인)
    └── ubuntu-local-test.md        # 로컬 Docker Ubuntu 테스트 가이드
```

---

## 현재 운영 중인 환경

| 서버 | 역할 | 접속 |
|------|------|------|
| NCP 211.188.53.76 | 중앙 모니터링 서버 | https://grafana.tbit.co.kr |
| contract-management-server | relay-server (web-01) | 내부망 |

**지원 OS (중앙 서버 변경 없이 즉시 연동 가능):**

| OS | 에이전트 | 대시보드 호환 |
|----|---------|------------|
| Ubuntu / Debian | install.sh | ✅ 전체 패널 |
| Rocky / CentOS / RHEL | install.sh | ✅ 전체 패널 |
| Amazon Linux | install.sh | ✅ 전체 패널 |
| Windows Server 2016+ / Windows 10/11 | install.ps1 | ✅ 전체 패널 (Load Average 제외) |

---

## License

Private — Internal Use Only
