# 에이전트 설치 가이드 (온라인)

인터넷이 가능한 서버에 모니터링 에이전트를 설치하는 방법.

> 인터넷이 없는 폐쇄망 서버는 [agent-offline-install.md](agent-offline-install.md) 참고.

## 개요

```
중앙 서버 :443 (HTTPS)
    ▲
    │ push (remote_write)
    │
[direct 모드] ────────────────────────── outbound 가능 서버
[relay-server 모드] ←── [relay-agent] ── outbound 차단 서버
        │
        └── :9999 수신 후 중앙으로 전달
```

**에이전트 3가지 모드:**

| 모드 | 대상 | 설치 스크립트 |
|------|------|--------------|
| `direct` | outbound 가능 서버 | install.sh / install.ps1 |
| `relay-server` | 고객사 게이트웨이 서버 | install.sh |
| `relay-agent` | outbound 차단 서버 | install.sh / install.ps1 |

**지원 OS:**

| 플랫폼 | 지원 OS |
|--------|---------|
| Linux | Ubuntu 20.04+, Debian 11+, RHEL/CentOS 8+, Amazon Linux 2023 |
| Windows | Windows Server 2016+, Windows 10/11 |

---

## Linux 설치

### 사전 준비

```bash
# 레포 클론 (또는 agents/ 폴더만 SCP로 복사)
apt-get install -y git curl  # 또는 yum
git clone https://github.com/Soojong94/monitoring_msp.git
cd monitoring_msp
chmod +x agents/install.sh
```

### 파라미터 설명

| 파라미터 | 설명 | 예시 |
|----------|------|------|
| `--mode` | 설치 모드 | `direct`, `relay-server`, `relay-agent` |
| `--customer-id` | 고객사 식별자 (영문, 하이픈 허용) | `kt`, `naver`, `nhn-cloud` |
| `--server-name` | 서버 이름 (고객 내 유일) | `web-01`, `db-master` |
| `--csp` | 클라우드 제공자 | `kt`, `aws`, `naver`, `nhn` |
| `--region` | 리전 | `kc1`, `ap-northeast-2` |
| `--environment` | 환경 (기본값: `prod`) | `prod`, `staging`, `test` |
| `--remote-write-url` | 중앙 서버 수신 URL (direct/relay-server 전용) | `http://1.2.3.4:8880/api/v1/write` |
| `--relay-url` | 릴레이 서버 내부 URL (relay-agent 전용) | `http://10.0.1.5:9999/api/v1/metrics/write` |

---

### Direct 모드

outbound가 가능한 서버. 중앙 서버로 직접 메트릭을 push.

```bash
sudo ./agents/install.sh \
  --mode=direct \
  --customer-id=kt \
  --server-name=kt-prod-web-01 \
  --csp=kt \
  --region=kc1 \
  --environment=prod \
  --remote-write-url=https://grafana.tbit.co.kr/api/v1/write
```

---

### Relay-Server 모드

고객사 내 게이트웨이 역할 서버. 내부 에이전트 메트릭을 :9999로 수신하고 중앙으로 전달.
자신의 OS 메트릭도 함께 수집한다.

```bash
sudo ./agents/install.sh \
  --mode=relay-server \
  --customer-id=kt \
  --server-name=kt-relay-01 \
  --csp=kt \
  --region=kc1 \
  --environment=prod \
  --remote-write-url=https://grafana.tbit.co.kr/api/v1/write
```

**설치 후 확인:**

```bash
systemctl status alloy
ss -tlnp | grep 9999   # :9999 수신 확인
```

**방화벽 (내부망에서 relay-agent → relay-server):**

```bash
# ufw
ufw allow 9999/tcp

# firewalld
firewall-cmd --permanent --add-port=9999/tcp && firewall-cmd --reload
```

---

### Relay-Agent 모드

outbound가 차단된 내부망 서버. relay-server의 내부 IP:9999 로 push.

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

### 설치 확인

```bash
systemctl status alloy
journalctl -u alloy -f    # 실시간 로그
```

`[OK] Alloy 실행 중` 메시지 확인.

2~3분 후 중앙 서버에서 수신 확인:

```bash
docker exec msp-victoriametrics wget -qO- "http://localhost:8428/api/v1/label/server_name/values"
# {"status":"success","data":["kt-prod-web-01",...]}
```

---

## Windows 설치

Windows Server 또는 Windows 10/11 서버에 Alloy를 Windows 서비스로 설치한다.

### 사전 준비

```powershell
# 관리자 PowerShell 실행
# 레포 클론 또는 agents\ 폴더 복사
git clone https://github.com/Soojong94/monitoring_msp.git
cd monitoring_msp
```

### 파라미터 설명

| 파라미터 | 설명 | 예시 |
|----------|------|------|
| `-Mode` | 설치 모드 | `direct`, `relay-agent` |
| `-CustomerId` | 고객사 식별자 | `kt` |
| `-ServerName` | 서버 이름 | `kt-win-web-01` |
| `-Csp` | 클라우드 제공자 | `kt`, `aws` |
| `-Region` | 리전 | `kc1` |
| `-Environment` | 환경 (기본값: `prod`) | `prod` |
| `-RemoteWriteUrl` | 중앙 서버 URL (direct 전용) | `http://1.2.3.4:8880/api/v1/write` |
| `-RelayUrl` | 릴레이 URL (relay-agent 전용) | `http://10.0.1.5:9999/api/v1/metrics/write` |

> Windows는 `relay-server` 모드를 지원하지 않는다. 게이트웨이 역할은 Linux 서버를 사용한다.

---

### Direct 모드

```powershell
.\agents\install.ps1 `
  -Mode direct `
  -CustomerId kt `
  -ServerName kt-win-web-01 `
  -Csp kt `
  -Region kc1 `
  -Environment prod `
  -RemoteWriteUrl https://grafana.tbit.co.kr/api/v1/write
```

---

### Relay-Agent 모드

```powershell
.\agents\install.ps1 `
  -Mode relay-agent `
  -CustomerId kt `
  -ServerName kt-win-db-01 `
  -Csp kt `
  -Region kc1 `
  -Environment prod `
  -RelayUrl http://<relay서버_내부IP>:9999/api/v1/metrics/write
```

---

### 설치 확인

```powershell
# 서비스 상태 확인
Get-Service GrafanaAlloy

# 로그 확인 (WinSW 래퍼 로그)
Get-Content "C:\ProgramData\GrafanaAlloy\logs\alloy-service.out.log" -Tail 30
```

`Status: Running` 확인.

2~3분 후 중앙 서버에서 수신 확인:

```bash
curl -s "http://localhost:8428/api/v1/label/server_name/values"
# {"status":"success","data":["kt-win-web-01",...]}
```

---

## 설치 후 관리

### Linux

```bash
# 서비스 재시작
sudo systemctl restart alloy

# 서비스 중지
sudo systemctl stop alloy

# 설정 파일 위치
/etc/alloy/config.alloy     # Alloy 설정 (Alloy 언어)
/etc/alloy/alloy.env         # 환경변수 (customer_id, server_name 등)

# 로그 확인
journalctl -u alloy -n 50
journalctl -u alloy --since "10 minutes ago"
```

### Windows

```powershell
# 서비스 재시작
Restart-Service GrafanaAlloy

# 서비스 중지/시작
Stop-Service GrafanaAlloy
Start-Service GrafanaAlloy

# 설정 파일 위치
C:\ProgramData\GrafanaAlloy\config.alloy       # Alloy 설정 (Alloy 언어)
C:\Program Files\GrafanaLabs\Alloy\alloy-service.xml  # WinSW 서비스 설정 (환경변수 포함)

# 로그 확인 (WinSW 래퍼가 남기는 로그)
Get-Content "C:\ProgramData\GrafanaAlloy\logs\alloy-service.out.log" -Tail 30

# 환경변수 변경 시 → alloy-service.xml 수정 후 서비스 재등록
# (또는 install.ps1 재실행)
```

---

## Windows 수집 메트릭 및 대시보드 호환성

Windows 에이전트(`config-windows.alloy`)는 `windows_exporter` 기반으로 메트릭을 수집하며,
Grafana 대시보드가 Linux `node_exporter` 메트릭 이름을 기준으로 구성되어 있어
**`prometheus.relabel`로 자동 변환**한다.

| Linux (node_exporter) | Windows (변환 전) | 비고 |
|-----------------------|-------------------|------|
| `node_cpu_seconds_total` | `windows_cpu_time_total` | mode 라벨 동일 |
| `node_memory_MemAvailable_bytes` | `windows_memory_available_bytes` | |
| `node_memory_MemTotal_bytes` | `windows_cs_physical_memory_bytes` | cs 컬렉터 |
| `node_filesystem_avail_bytes` | `windows_logical_disk_free_bytes` | volume → mountpoint 라벨 변환 |
| `node_filesystem_size_bytes` | `windows_logical_disk_size_bytes` | fstype=NTFS 추가 |
| `node_disk_read_bytes_total` | `windows_logical_disk_read_bytes_total` | volume → device 라벨 변환 |
| `node_disk_written_bytes_total` | `windows_logical_disk_write_bytes_total` | |
| `node_network_receive_bytes_total` | `windows_net_bytes_received_total` | nic → device 라벨 변환 |
| `node_network_transmit_bytes_total` | `windows_net_bytes_sent_total` | |
| `node_uname_info` | `windows_os_info` | |

> **Load Average**: Linux 전용 개념. Windows 서버에서 해당 패널은 "No data"로 표시되며 정상 동작임.

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| `[ERROR] Alloy 실행 실패` | config 또는 env 파일 오류 | `journalctl -u alloy -n 30` 확인 |
| 중앙 서버에 메트릭 미수신 | remote-write-url 오류 또는 방화벽 | `curl https://grafana.tbit.co.kr/health` 테스트 |
| relay-agent → relay-server 연결 실패 | relay-url 오류 또는 :9999 방화벽 | `curl http://<relay_IP>:9999/` 테스트 |
| `package alloy not found` | Grafana apt/yum 저장소 없음 | install.sh가 자동 추가. `journalctl` 로 오류 확인 |
| Windows: 서비스 시작 30초 후 자동 중지 (Event 7009/7000) | Alloy 단독 실행 시 Windows SCM 프로토콜 미구현 → 타임아웃 | WinSW 래퍼가 SCM 핸들링. install.ps1 재실행하면 자동 해결 |
| Windows: 메트릭이 VictoriaMetrics에는 있는데 대시보드에 안 보임 | config-windows.alloy가 구버전 (win_compat 릴레이 없음) | `git pull` 후 config 재배포: `Copy-Item agents\direct\config-windows.alloy C:\ProgramData\GrafanaAlloy\config.alloy` → `Restart-Service GrafanaAlloy` |
| Windows: 로그 파일을 못 찾겠음 | WinSW는 서비스 exe 이름 기준으로 로그 생성 | `C:\ProgramData\GrafanaAlloy\logs\alloy-service.out.log` 확인 |
