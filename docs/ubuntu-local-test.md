# Ubuntu 로컬 테스트 가이드

실제 클라우드 배포 전 Windows에서 Ubuntu 컨테이너 3개로 전체 구조를 검증하는 방법.

> 실제 클라우드 서버에서는 이 문서의 Docker 컨테이너 설정은 불필요하다.
> 클라우드 서버에서 바로 install.sh 또는 install.ps1 를 실행하면 된다.

## 구조

```
[ubuntu-agent]   relay-agent 모드 (Alloy)
     │ push :9999
[ubuntu-relay]   relay-server 모드 (Alloy)
     │ push :8880
[ubuntu-central] 중앙 서버
     └── Docker-in-Docker: VictoriaMetrics + VMAlert + Alertmanager + Grafana + Nginx
```

## 사전 요구사항

- Docker Desktop for Windows (실행 중)
- `ubuntu-systemd:22.04` 이미지 빌드 완료 (아래 참고)
- 레포 최신 상태 (`git pull`)

### ubuntu-systemd 이미지 빌드 (최초 1회)

```powershell
cd C:\...\monitoring_msp
docker build -t ubuntu-systemd:22.04 docker/ubuntu-systemd/
```

---

## Step 1: 기존 환경 정리

```powershell
docker rm -f ubuntu-central ubuntu-relay ubuntu-agent 2>$null
docker network rm msp-ubuntu-net 2>$null
```

## Step 2: 네트워크 + 컨테이너 생성

```powershell
docker network create msp-ubuntu-net

# 중앙 서버 (DinD용 --privileged, 포트 8880 노출)
docker run -d --name ubuntu-central --hostname central `
  --network msp-ubuntu-net --privileged -p 8880:8880 `
  ubuntu-systemd:22.04

# 릴레이 서버
docker run -d --name ubuntu-relay --hostname relay `
  --network msp-ubuntu-net --privileged `
  ubuntu-systemd:22.04

# 에이전트 서버
docker run -d --name ubuntu-agent --hostname agent `
  --network msp-ubuntu-net --privileged `
  ubuntu-systemd:22.04
```

## Step 3: ubuntu-central — Docker 설치 + 중앙 스택 실행

```powershell
docker exec -it ubuntu-central bash
```

```bash
# Docker 공식 저장소 추가
apt-get update && apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# DinD overlay 오류 우회 (vfs 드라이버)
mkdir -p /etc/docker
echo '{"storage-driver": "vfs"}' > /etc/docker/daemon.json

# Docker 데몬 시작
systemctl start docker
docker ps  # 빈 테이블이면 정상

# 레포 클론 + 환경설정
git clone https://github.com/Soojong94/monitoring_msp.git
cd monitoring_msp
cp .env.example .env

# Alertmanager 설정 생성 (SMTP는 더미값으로 동작)
apt-get install -y gettext-base   # envsubst 설치
make alertmanager-config

# 중앙 스택 실행 (5개 서비스)
docker compose up -d
docker compose ps   # 5개 모두 healthy 확인
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

## Step 4: ubuntu-relay — relay-server 설치

```powershell
docker exec -it ubuntu-relay bash
```

```bash
apt-get update && apt-get install -y ca-certificates curl git
git clone https://github.com/Soojong94/monitoring_msp.git
cd monitoring_msp
chmod +x agents/install.sh

sudo ./agents/install.sh \
  --mode=relay-server \
  --customer-id=test \
  --server-name=relay-01 \
  --csp=local \
  --region=local \
  --environment=test \
  --remote-write-url=http://central:8880/api/v1/write
```

`[OK] Alloy 실행 중` 확인.

## Step 5: ubuntu-agent — relay-agent 설치

```powershell
docker exec -it ubuntu-agent bash
```

```bash
apt-get update && apt-get install -y ca-certificates curl git
git clone https://github.com/Soojong94/monitoring_msp.git
cd monitoring_msp
chmod +x agents/install.sh

sudo ./agents/install.sh \
  --mode=relay-agent \
  --customer-id=test \
  --server-name=agent-01 \
  --csp=local \
  --region=local \
  --environment=test \
  --relay-url=http://relay:9999/api/v1/metrics/write
```

`[OK] Alloy 실행 중` 확인.

## Step 6: 검증 (2~3분 후)

ubuntu-central 안에서:

```bash
cd monitoring_msp

# 수신된 서버 목록 확인
docker exec msp-victoriametrics wget -q -O - \
  "http://127.0.0.1:8428/api/v1/label/server_name/values"
# 결과: {"status":"success","data":["agent-01","relay-01"]}

# VMAlert 알림 규칙 상태 확인
docker exec msp-vmalert wget -qO- "http://127.0.0.1:8180/api/v1/rules" | \
  grep -o '"name":"[^"]*"\|"state":"[^"]*"'
```

Grafana 대시보드:
- `http://localhost:8880` 접속
- Nginx Basic Auth: `admin` / `changeme`
- Grafana 로그인: `admin` / `changeme`
- MSP 전체 고객 현황 → `test` 고객, `relay-01` + `agent-01` 서버 확인

## 종료

```powershell
# 컨테이너 중지 (데이터 유지)
docker stop ubuntu-central ubuntu-relay ubuntu-agent

# 완전 삭제
docker rm -f ubuntu-central ubuntu-relay ubuntu-agent
docker network rm msp-ubuntu-net
```

---

## 트러블슈팅

| 문제 | 원인 | 해결 |
|------|------|------|
| `make alertmanager-config` 실패 | `envsubst` 없음 | `apt-get install -y gettext-base` |
| `docker compose up` 시 alertmanager unhealthy | `alertmanager.yml` 없음 | `make alertmanager-config` 먼저 실행 |
| DinD overlay 마운트 오류 | overlay-on-overlay 불가 | `daemon.json`에 `vfs` 드라이버 설정 |
| git clone SSL 오류 | CA 인증서 없음 | `apt-get install -y ca-certificates` |
| Grafana 로그인 루프 | Nginx가 Authorization 헤더 전달 | nginx.conf에 `proxy_set_header Authorization "";` 포함됨 (이미 해결) |
| `install.sh` 아무 출력 없이 종료 | `set -euo pipefail` 오류 | `journalctl -u alloy -n 10`으로 원인 확인 |
| CPU 사용률 0% | 컨테이너라 idle 상태 정상 | 실제 서버에서는 workload에 따라 표시됨 |
