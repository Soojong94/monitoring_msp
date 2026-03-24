# MSP 모니터링 관리 포털 - 제품 요구사항 문서 (PRD)

**프로젝트명:** MSP Monitoring Admin Portal
**URL:** grafana-admin.tbit.co.kr
**작성일:** 2026-03-24
**버전:** 1.0

---

## 1. 프로젝트 개요

### 1.1 목적

MSP(Managed Service Provider) 고객사 서버들의 모니터링 현황을 중앙에서 관리하기 위한 웹 관리 포털을 구축한다. 기존 monitoring_msp 스택(VictoriaMetrics, Alertmanager, VMAlert, Grafana) 위에 올라가는 관리 레이어로, 고객사별 알람 설정·이메일 수신자·서버 별칭 등을 GUI에서 손쉽게 관리할 수 있도록 한다.

### 1.2 배경

- 현재 고객사별 알람 수신자 변경 시 alertmanager.yml을 직접 수정해야 함
- 서버 추가/제거 시 설정 파일을 수동으로 편집해야 함
- 모든 고객사의 서버 현황을 한눈에 볼 수 있는 통합 뷰가 없음
- 에이전트 설치 명령어를 매번 수동으로 조합해야 함

### 1.3 범위

본 포털은 다음을 포함한다:
- 서버 현황 조회 및 관리 (별칭, 비활성화, 삭제)
- 고객사별 알람 설정 (이메일, 임계값)
- 에이전트 설치 명령어 생성기
- 시스템 상태 모니터링
- 알람 히스토리 및 월간 리포트 (Phase 3)

본 포털은 다음을 포함하지 않는다:
- 에이전트 서버에 대한 직접 접근 (SSH 등)
- 고객사 서버에서 직접 명령 실행
- Grafana 대시보드 편집

---

## 2. 핵심 설계 원칙

### 2.1 자동 감지 (Zero-Touch Provisioning)

고객사·서버는 에이전트가 메트릭을 VictoriaMetrics로 전송하는 순간 자동으로 감지된다. 포털에서 사전 등록하거나 수동으로 추가할 필요가 없다.

- VictoriaMetrics 라벨 `customer_id`, `server_name` 으로 고객사·서버를 식별
- 새 서버가 메트릭을 보내기 시작하면 즉시 포털 목록에 나타남

### 2.2 최소한의 DB 사용

포털 DB(SQLite)에는 VictoriaMetrics에 없는 추가 설정만 저장한다:
- 이메일 수신자
- 임계값 (기본값과 다를 경우)
- 서버 표시명 (별칭)
- 비활성 서버 목록
- 포털 로그인 계정

메트릭 데이터, 서버 목록, 알람 상태 등은 항상 VictoriaMetrics / Alertmanager API에서 실시간으로 조회한다.

### 2.3 에이전트 서버 무접근 원칙

포털은 에이전트가 설치된 고객사 서버에 절대 직접 접근하지 않는다.
- SSH 불필요
- 방화벽 인바운드 룰 추가 불필요
- 인터넷 차단 환경(폐쇄망)의 서버도 동일하게 처리 가능
- 모든 데이터는 에이전트가 주기적으로 push하는 메트릭을 통해 수집

---

## 3. 기술 스택

| 구분 | 기술 | 비고 |
|------|------|------|
| Backend | FastAPI (Python 3.11) | 비동기 처리 |
| Frontend | React + Vite (JSX) | TypeScript 사용 안 함 |
| 스타일 | Tailwind CSS | |
| DB | SQLite | Docker volume에 저장 |
| ORM | SQLAlchemy 2.x | |
| 인증 | JWT (로컬 계정) | |
| 컨테이너 | Docker | 기존 docker-compose.yml에 추가 |
| HTTP 클라이언트 | httpx (Python) / fetch (JS) | axios 사용 안 함 |

### 3.1 배포 구조

```
인터넷
  ↓
Nginx (grafana-admin.tbit.co.kr)
  ↓
msp-portal:8000 (FastAPI)
  ├── /api/*         → FastAPI 라우터
  └── /*             → React 빌드 정적 파일 서빙

FastAPI 내부 통신 (msp-net Docker network):
  ├── http://victoriametrics:8428
  ├── http://alertmanager:9093
  └── /var/run/docker.sock (Docker API)
```

### 3.2 단일 컨테이너 전략

Frontend(React)는 빌드 후 FastAPI가 정적 파일로 서빙한다. 별도의 프론트엔드 컨테이너를 운영하지 않아 배포 복잡도를 최소화한다.

---

## 4. DB 스키마

```sql
-- 서버 표시명 별칭 (실제 라벨과 다르게 보여줄 때)
CREATE TABLE server_aliases (
  customer_id    TEXT NOT NULL,  -- 실제 VM customer_id 라벨값
  server_name    TEXT NOT NULL,  -- 실제 VM server_name 라벨값
  display_customer TEXT,         -- 포털에서 보여줄 고객사명
  display_server   TEXT,         -- 포털에서 보여줄 서버명
  notes          TEXT,           -- 메모 (담당자, 용도 등)
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (customer_id, server_name)
);

-- 고객사별 알람 수신 이메일
CREATE TABLE customer_emails (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL,
  email       TEXT NOT NULL,
  enabled     INTEGER DEFAULT 1,  -- 1: 활성, 0: 비활성
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE (customer_id, email)
);

-- 고객사별 임계값 (미설정 시 기본값 90% 사용)
CREATE TABLE alert_thresholds (
  customer_id TEXT PRIMARY KEY,
  cpu         INTEGER DEFAULT 90,
  memory      INTEGER DEFAULT 90,
  disk        INTEGER DEFAULT 90,
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- 비활성 서버 (삭제했지만 데이터 유지를 선택한 경우)
CREATE TABLE inactive_servers (
  customer_id    TEXT NOT NULL,
  server_name    TEXT NOT NULL,
  deactivated_at TEXT DEFAULT (datetime('now')),
  reason         TEXT,
  PRIMARY KEY (customer_id, server_name)
);

-- 포털 로그인 계정
CREATE TABLE portal_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT DEFAULT 'admin',  -- 'admin' / 'viewer'
  created_at    TEXT DEFAULT (datetime('now')),
  last_login    TEXT
);

-- 알람 히스토리 (Phase 3 - Alertmanager webhook 수신)
CREATE TABLE alert_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   TEXT,
  server_name   TEXT,
  alert_name    TEXT,
  status        TEXT,   -- 'firing' / 'resolved'
  severity      TEXT,
  message       TEXT,
  started_at    TEXT,
  resolved_at   TEXT,
  received_at   TEXT DEFAULT (datetime('now'))
);
```

---

## 5. 기능 요구사항

### Phase 1 - 핵심 기능 (MVP)

#### 5.1 인증

| 기능 | 설명 |
|------|------|
| 로그인 | username + password → JWT 발급 |
| 로그아웃 | 클라이언트 토큰 삭제 |
| 권한 구분 | admin: 모든 기능 / viewer: 조회만 |
| 토큰 만료 | 24시간 |
| 초기 계정 | 환경변수 `PORTAL_INIT_USER`, `PORTAL_INIT_PASSWORD` 로 자동 생성 |

#### 5.2 서버 현황

| 기능 | 설명 |
|------|------|
| 서버 목록 조회 | VictoriaMetrics API로 실시간 조회, inactive_servers 제외 |
| 온라인 상태 판단 | 마지막 메트릭 수신 후 5분 이상 미수신 = 오프라인 |
| 서버 별칭 설정 | display_customer, display_server, notes 편집 |
| 서버 비활성화 (데이터 유지) | inactive_servers 테이블에 등록, 목록에서 숨김 |
| 서버 완전 삭제 | VictoriaMetrics delete_series API 호출로 메트릭 데이터 삭제 |
| 비활성 서버 복원 | inactive_servers에서 제거하여 목록에 다시 표시 |

**온라인 상태 판단 기준:**
```
마지막 메트릭 수신 시간 = now() - (now() - last_seen)
last_seen > now() - 5분 → ONLINE
last_seen <= now() - 5분 → OFFLINE
메트릭 없음 → UNKNOWN
```

#### 5.3 알람 설정

| 기능 | 설명 |
|------|------|
| 이메일 수신자 추가 | 고객사별 이메일 주소 등록 |
| 이메일 수신자 삭제 | 고객사별 이메일 주소 삭제 |
| 이메일 활성/비활성 | 이메일 주소별 수신 on/off |
| 임계값 설정 | CPU/메모리/디스크 % 임계값 (기본 90%) |
| 설정 적용 | alertmanager.yml 재생성 → alertmanager 컨테이너 재시작 |
| 설정 적용 | vmalert rules 재생성 → vmalert 컨테이너 재시작 |

**자동 재시작 플로우:**
```
사용자가 설정 저장
  → DB 업데이트
  → alertmanager.yml 파일 재생성
  → docker restart alertmanager
  → vmalert rules 파일 재생성
  → docker restart vmalert
  → 완료 응답 반환
```

**고객사별 임계값 로직:**
- `alert_thresholds` 테이블에 고객사 레코드가 있으면 해당 값 사용
- 없으면 기본값 90% 사용
- 고객사별 임계값이 다르면 vmalert에서 고객사별 rule 그룹 생성

#### 5.4 에이전트 설치 명령어 생성기

입력 파라미터:
| 파라미터 | 필수 | 설명 |
|----------|------|------|
| customer_id | Y | 고객사 식별자 (예: kt, skt, lg) |
| server_name | Y | 서버 식별자 (예: web-01, db-master) |
| csp | N | 클라우드 공급자 (aws, azure, gcp, onprem) |
| region | N | 리전 (예: ap-northeast-2) |
| environment | N | 환경 (prod, staging, dev) |
| mode | Y | 에이전트 모드 (full, minimal) |

출력:
- Linux bash 설치 명령어 (one-liner, 복사 버튼)
- Windows PowerShell 설치 명령어 (one-liner, 복사 버튼)

---

### Phase 2 - 모니터링 뷰

#### 5.5 대시보드

**요약 카드 (상단):**
- 총 고객사 수
- 총 서버 수 (활성)
- 오프라인 서버 수 (빨간색 하이라이트)
- 현재 발생 중인 알람 수

**고객사별 카드:**
- 고객사명 (별칭 적용)
- 서버 수 / 온라인 수
- 현재 CPU 평균 (%), 메모리 평균 (%)
- 알람 뱃지 (firing 중인 알람 수)
- Grafana 링크 (고객사 대시보드로 이동)

**알람 현황 테이블:**
- Alertmanager `/api/v2/alerts` 에서 실시간 조회
- 고객사, 서버명, 알람 종류, 심각도, 발생 시간 표시
- 자동 5초 새로고침

#### 5.6 시스템 상태

| 항목 | 조회 방법 |
|------|-----------|
| Docker 컨테이너 상태 | Docker socket API |
| VictoriaMetrics 저장 현황 | VM `/api/v1/status/tsdb` |
| 인증서 만료일 | 도메인 TLS 인증서 조회 |

모니터링 대상 컨테이너: victoriametrics, grafana, alertmanager, vmalert, nginx, msp-portal

---

### Phase 3 - 고급 기능

#### 5.7 알람 히스토리

- Alertmanager webhook receiver로 알람 발생/해소 이벤트 수신
- `alert_history` 테이블에 저장
- 조회: 날짜 범위, 고객사, 알람 종류, 상태(firing/resolved) 필터링
- 알람 발생 → 해소 시간 계산 (다운타임)

#### 5.8 월간 리포트

- 고객사별 서버 가용률 (SLA) 계산
  - 가용률 = (총 시간 - 다운타임) / 총 시간 × 100
- 월별 알람 발생 횟수 통계
- PDF 또는 화면 출력

---

## 6. API 설계

### 인증

```
POST /api/auth/login
  Body: { username, password }
  Response: { access_token, token_type, role }

POST /api/auth/logout
  Response: { message }

GET /api/auth/me
  Response: { username, role }
```

### 서버 관리

```
GET /api/servers
  Query: ?include_inactive=false
  Response: [ { customer_id, server_name, display_customer, display_server,
                online, last_seen, notes } ]

GET /api/servers/{customer_id}
  Response: [ { server_name, display_server, online, last_seen, ... } ]

PUT /api/servers/{customer_id}/{server_name}/alias
  Body: { display_customer, display_server, notes }
  Response: { message }

DELETE /api/servers/{customer_id}/{server_name}
  Query: ?purge=false
    purge=false → inactive_servers 등록 (메트릭 데이터 유지)
    purge=true  → VictoriaMetrics delete_series 호출 (완전 삭제)
  Response: { message }

POST /api/servers/{customer_id}/{server_name}/restore
  Description: 비활성 서버를 활성 상태로 복원
  Response: { message }
```

### 알람 설정

```
GET /api/alerts/config
  Response: [ { customer_id, emails: [], thresholds: {} } ]

GET /api/alerts/config/{customer_id}
  Response: { customer_id, emails: [], thresholds: {} }

PUT /api/alerts/config/{customer_id}
  Body: { emails: [{ email, enabled }], thresholds: { cpu, memory, disk } }
  Response: { message, restarted: [alertmanager, vmalert] }

POST /api/alerts/config/{customer_id}/emails
  Body: { email }
  Response: { id, email, enabled }

DELETE /api/alerts/config/{customer_id}/emails/{email_id}
  Response: { message }

GET /api/alerts/firing
  Description: Alertmanager 현재 발생 알람 프록시
  Response: [ { customer_id, server_name, alert_name, severity, starts_at } ]
```

### 에이전트 명령어

```
POST /api/agent/command
  Body: { customer_id, server_name, csp, region, environment, mode }
  Response: { linux, windows }
```

### 시스템 상태

```
GET /api/system/status
  Response: { containers: [], storage: {}, certificate: {} }

POST /api/system/restart/{service}
  service: victoriametrics | alertmanager | vmalert | grafana | nginx
  Response: { message, status }
```

### 알람 히스토리 (Phase 3)

```
POST /api/webhooks/alertmanager
  Description: Alertmanager webhook receiver
  Body: Alertmanager webhook payload

GET /api/alerts/history
  Query: ?customer_id=&start=&end=&status=
  Response: [ { alert_name, customer_id, server_name, status, started_at, resolved_at } ]
```

---

## 7. 파일 구조

```
portal/
├── PRD.md                     # 이 문서
├── CLAUDE.md                  # AI 작업 가이드
├── Dockerfile                 # 멀티스테이지 빌드 (프론트 빌드 + 백엔드 실행)
├── requirements.txt           # Python 의존성
├── .env.example               # 환경변수 예시
├── main.py                    # FastAPI 앱 진입점, 라우터 등록, 정적 파일 서빙
├── database.py                # SQLite 연결 및 세션 관리
├── models.py                  # SQLAlchemy 모델 (테이블 정의)
├── schemas.py                 # Pydantic 스키마 (요청/응답 모델)
├── auth.py                    # JWT 생성/검증, 권한 체크 의존성
├── routers/
│   ├── __init__.py
│   ├── servers.py             # /api/servers 엔드포인트
│   ├── alerts.py              # /api/alerts 엔드포인트
│   ├── agent.py               # /api/agent 엔드포인트
│   └── system.py              # /api/system 엔드포인트
├── services/
│   ├── __init__.py
│   ├── victoriametrics.py     # VM API 호출 (서버 목록, 상태, 삭제)
│   ├── alertmanager.py        # alertmanager.yml 생성 및 재시작
│   ├── vmalert.py             # vmalert rules 파일 생성 및 재시작
│   └── docker_mgr.py          # Docker socket API (컨테이너 상태, 재시작)
└── frontend/                  # React + Vite 프론트엔드
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── api.js             # API 호출 함수 모음
        ├── pages/
        │   ├── Login.jsx
        │   ├── Dashboard.jsx
        │   ├── Servers.jsx
        │   ├── AlertConfig.jsx
        │   └── System.jsx
        └── components/
            ├── Layout.jsx         # 사이드바 + 헤더 레이아웃
            ├── ServerCard.jsx     # 고객사 카드
            ├── AlertBadge.jsx     # 알람 수 뱃지
            ├── StatusDot.jsx      # 온라인/오프라인 표시 점
            └── InstallCommand.jsx # 설치 명령어 생성/복사
```

---

## 8. 환경변수

```env
# 필수
PORTAL_JWT_SECRET=your-secret-key-here
PORTAL_INIT_USER=admin
PORTAL_INIT_PASSWORD=changeme123

# 선택 (기본값 있음)
VICTORIAMETRICS_URL=http://victoriametrics:8428
ALERTMANAGER_URL=http://alertmanager:9093
GRAFANA_URL=http://grafana:3000
CONFIG_DIR=/monitoring_msp/config
DB_PATH=/app/data/portal.db
TOKEN_EXPIRE_HOURS=24
```

---

## 9. Nginx 설정 추가

기존 nginx.conf에 다음 서버 블록 추가:

```nginx
server {
    listen 443 ssl;
    server_name grafana-admin.tbit.co.kr;

    ssl_certificate     /etc/letsencrypt/live/grafana-admin.tbit.co.kr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/grafana-admin.tbit.co.kr/privkey.pem;

    location / {
        proxy_pass         http://msp-portal:8000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

---

## 10. docker-compose.yml 추가

기존 docker-compose.yml에 다음 서비스 추가:

```yaml
msp-portal:
  build: ./portal
  container_name: msp-portal
  restart: unless-stopped
  environment:
    - PORTAL_JWT_SECRET=${PORTAL_JWT_SECRET}
    - PORTAL_INIT_USER=${PORTAL_INIT_USER:-admin}
    - PORTAL_INIT_PASSWORD=${PORTAL_INIT_PASSWORD:-changeme123}
    - VICTORIAMETRICS_URL=http://victoriametrics:8428
    - ALERTMANAGER_URL=http://alertmanager:9093
    - CONFIG_DIR=/monitoring_msp/config
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - ~/monitoring_msp/config:/monitoring_msp/config
    - portal-db:/app/data
  networks:
    - msp-net
  ports:
    - "127.0.0.1:8000:8000"  # nginx에서만 접근

volumes:
  portal-db:
```

---

## 11. 비기능 요구사항

| 항목 | 요구사항 |
|------|----------|
| 가용성 | 모니터링 스택 컨테이너 장애 시 포털은 독립적으로 동작 |
| 응답시간 | API 응답 2초 이내 |
| 보안 | JWT 인증 없이 API 접근 불가, HTTPS 강제 |
| 로그 | 모든 설정 변경 작업 로그 기록 (사용자, 시간, 변경 내용) |
| 호환성 | Chrome, Firefox, Edge 최신 버전 |
| 데이터 보호 | SQLite DB는 Docker volume으로 컨테이너 재시작 후에도 유지 |

---

## 12. 개발 우선순위

| 순위 | 기능 | Phase |
|------|------|-------|
| 1 | 인증 (로그인/로그아웃) | 1 |
| 2 | 서버 현황 조회 (VM 연동) | 1 |
| 3 | 알람 설정 (이메일, 임계값) | 1 |
| 4 | 에이전트 설치 명령어 생성기 | 1 |
| 5 | 대시보드 (요약 + 고객사 카드) | 2 |
| 6 | 알람 현황 (Alertmanager 연동) | 2 |
| 7 | 시스템 상태 | 2 |
| 8 | 알람 히스토리 | 3 |
| 9 | 월간 리포트 | 3 |
