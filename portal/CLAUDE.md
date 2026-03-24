# CLAUDE.md - MSP 모니터링 관리 포털 AI 작업 가이드

이 문서는 Claude Code가 `portal/` 디렉토리에서 작업할 때 반드시 따라야 할 규칙과 컨텍스트를 정의한다.

---

## 1. 프로젝트 컨텍스트

### 1.1 이 포털의 위치

```
monitoring_msp/        ← 기존 스택 루트
├── docker-compose.yml ← 기존 스택 (VM, AM, VMAlert, Grafana, Nginx)
├── config/
│   ├── alertmanager/alertmanager.yml
│   ├── vmalert/rules/host-alerts.yml
│   └── nginx/nginx.conf
└── portal/            ← 이 포털 (신규)
    ├── CLAUDE.md      ← 이 문서
    ├── PRD.md
    └── ...
```

포털은 기존 스택의 **관리 레이어**다. 기존 컨테이너를 대체하거나 수정하지 않는다. 단, 설정 파일(alertmanager.yml, vmalert rules)을 재생성하고 컨테이너를 재시작하는 권한을 가진다.

### 1.2 기존 스택 서비스 목록

| 서비스명 (컨테이너명) | 내부 URL | 역할 |
|-----------------------|----------|------|
| victoriametrics | http://victoriametrics:8428 | 메트릭 저장소 |
| alertmanager | http://alertmanager:9093 | 알람 라우팅 |
| vmalert | (내부 전용) | 알람 규칙 평가 |
| grafana | http://grafana:3000 | 대시보드 |
| nginx | (외부 진입점) | 리버스 프록시 |

모두 Docker network `msp-net` 안에서 통신한다. 포털 컨테이너도 동일 네트워크에 참여한다.

---

## 2. 절대 규칙 (위반 금지)

### 2.1 에이전트 서버 무접근

```
# 절대 금지
import paramiko           # SSH 라이브러리
subprocess.run(["ssh", ...])
os.system("ssh ...")
requests.get("http://고객사-서버-IP/...")
```

에이전트가 설치된 고객사 서버에 어떤 방식으로도 직접 접근하는 코드를 작성하지 않는다. 모든 데이터는 VictoriaMetrics API를 통해 조회한다.

### 2.2 내부 서비스 URL 고정

컨테이너 내부 통신은 반드시 Docker 내부 DNS명을 사용한다:

```python
# 올바름
VICTORIAMETRICS_URL = os.getenv("VICTORIAMETRICS_URL", "http://victoriametrics:8428")
ALERTMANAGER_URL = os.getenv("ALERTMANAGER_URL", "http://alertmanager:9093")

# 금지
"http://localhost:8428"   # 컨테이너 내부에서는 localhost가 자기 자신
"http://127.0.0.1:8428"   # 동일
"http://192.168.x.x:8428" # 하드코딩 IP 금지
```

### 2.3 설정 파일 변경 후 반드시 재시작

```python
# alertmanager.yml을 수정한 후
generate_alertmanager_config()    # 파일 재생성
docker_restart("alertmanager")    # 반드시 재시작

# vmalert rules를 수정한 후
generate_vmalert_rules()          # 파일 재생성
docker_restart("vmalert")         # 반드시 재시작
```

설정 파일 수정 후 재시작을 누락하면 변경사항이 반영되지 않는다.

### 2.4 프론트엔드 HTTP 클라이언트

```javascript
// 올바름
const response = await fetch('/api/servers');

// 금지
import axios from 'axios';  // axios 사용 안 함
```

### 2.5 TypeScript 사용 금지

```
// 금지
frontend/src/App.tsx
frontend/src/pages/Login.tsx

// 올바름
frontend/src/App.jsx
frontend/src/pages/Login.jsx
```

---

## 3. VictoriaMetrics API 패턴

### 3.1 고객사 목록 조회

```python
import httpx

async def get_customers() -> list[str]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{VICTORIAMETRICS_URL}/api/v1/label/customer_id/values"
        )
        data = resp.json()
        return data["data"]  # ["kt", "skt", "lg", ...]
```

### 3.2 전체 서버 목록 조회

```python
async def get_all_servers() -> list[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{VICTORIAMETRICS_URL}/api/v1/label/server_name/values"
        )
        return resp.json()["data"]
```

### 3.3 특정 고객사의 서버 목록

```python
async def get_servers_by_customer(customer_id: str) -> list[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{VICTORIAMETRICS_URL}/api/v1/series",
            params={"match[]": f'node_uname_info{{customer_id="{customer_id}"}}'}
        )
        data = resp.json()
        # 각 시리즈에서 라벨 추출
        return [
            {
                "customer_id": s.get("customer_id"),
                "server_name": s.get("server_name"),
                "instance": s.get("instance"),
            }
            for s in data["data"]
        ]
```

### 3.4 서버 온라인 상태 확인

```python
from datetime import datetime, timezone

async def get_server_status(customer_id: str, server_name: str) -> dict:
    """마지막 메트릭 수신 시간 기준으로 온라인/오프라인 판단 (5분 기준)"""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{VICTORIAMETRICS_URL}/api/v1/query",
            params={
                "query": f'node_uname_info{{customer_id="{customer_id}",server_name="{server_name}"}}'
            }
        )
        data = resp.json()
        results = data.get("data", {}).get("result", [])

        if not results:
            return {"online": False, "last_seen": None}

        # 타임스탬프 추출 (Unix timestamp)
        timestamp = results[0]["value"][0]
        last_seen = datetime.fromtimestamp(timestamp, tz=timezone.utc)
        now = datetime.now(tz=timezone.utc)
        online = (now - last_seen).total_seconds() < 300  # 5분 = 300초

        return {
            "online": online,
            "last_seen": last_seen.isoformat(),
        }
```

### 3.5 시리즈 완전 삭제 (purge)

```python
async def delete_series(customer_id: str, server_name: str) -> bool:
    """VictoriaMetrics에서 특정 서버의 모든 메트릭 시리즈 삭제"""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{VICTORIAMETRICS_URL}/api/v1/admin/tsdb/delete_series",
            params={
                "match[]": f'{{customer_id="{customer_id}",server_name="{server_name}"}}'
            }
        )
        return resp.status_code == 204
```

### 3.6 현재 메트릭 값 조회 (대시보드용)

```python
async def get_current_cpu(customer_id: str) -> float:
    """고객사 전체 서버의 평균 CPU 사용률"""
    query = (
        f'avg(100 - avg by(server_name) '
        f'(rate(node_cpu_seconds_total{{mode="idle",customer_id="{customer_id}"}}[5m])) * 100)'
    )
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{VICTORIAMETRICS_URL}/api/v1/query",
            params={"query": query}
        )
        data = resp.json()
        results = data.get("data", {}).get("result", [])
        if results:
            return float(results[0]["value"][1])
        return 0.0
```

---

## 4. 알람 설정 자동 생성 규칙

### 4.1 alertmanager.yml 생성 패턴

```python
def generate_alertmanager_config(
    customers: list[dict]  # [{ customer_id, emails: [str] }]
) -> str:
    """
    고객사별 receiver 생성.
    customer_id 라벨 기준으로 route 분기.
    이메일 없는 고객사는 blackhole receiver로.
    """
    config = {
        "global": {
            "smtp_smarthost": "smtp.gmail.com:587",
            "smtp_from": "alertmanager@tbit.co.kr",
            "smtp_auth_username": "${SMTP_USER}",
            "smtp_auth_password": "${SMTP_PASSWORD}",
        },
        "route": {
            "receiver": "blackhole",
            "group_by": ["customer_id", "alertname"],
            "group_wait": "30s",
            "group_interval": "5m",
            "repeat_interval": "4h",
            "routes": []
        },
        "receivers": [{"name": "blackhole"}]
    }

    for customer in customers:
        if not customer["emails"]:
            continue

        receiver_name = f"customer-{customer['customer_id']}"

        # route 추가
        config["route"]["routes"].append({
            "match": {"customer_id": customer["customer_id"]},
            "receiver": receiver_name
        })

        # receiver 추가
        config["receivers"].append({
            "name": receiver_name,
            "email_configs": [
                {"to": email, "send_resolved": True}
                for email in customer["emails"]
            ]
        })

    return yaml.dump(config, default_flow_style=False, allow_unicode=True)
```

**파일 경로:** `/monitoring_msp/config/alertmanager/alertmanager.yml`

### 4.2 vmalert rules 생성 패턴

```python
DEFAULT_THRESHOLDS = {"cpu": 90, "memory": 90, "disk": 90}

def generate_vmalert_rules(
    customers_thresholds: list[dict]
    # [{ customer_id, cpu, memory, disk }]
) -> str:
    """
    고객사별 임계값이 기본값과 다를 경우 고객사별 rule 그룹 생성.
    기본값(90%)인 경우 공통 rule 그룹에서 처리.
    """
    groups = []

    # 기본값을 사용하는 고객사들 (공통 그룹)
    default_customers = [
        c for c in customers_thresholds
        if c["cpu"] == 90 and c["memory"] == 90 and c["disk"] == 90
    ]
    # 커스텀 임계값을 가진 고객사들
    custom_customers = [
        c for c in customers_thresholds
        if not (c["cpu"] == 90 and c["memory"] == 90 and c["disk"] == 90)
    ]

    # 공통 그룹 (기본 90%)
    if default_customers or not customers_thresholds:
        customer_filter = ""
        if default_customers:
            ids = "|".join(c["customer_id"] for c in default_customers)
            customer_filter = f',customer_id=~"{ids}"'

        groups.append(_make_rule_group("host-alerts-default", customer_filter, 90, 90, 90))

    # 고객사별 커스텀 그룹
    for customer in custom_customers:
        groups.append(_make_rule_group(
            f"host-alerts-{customer['customer_id']}",
            f',customer_id="{customer["customer_id"]}"',
            customer["cpu"],
            customer["memory"],
            customer["disk"]
        ))

    return yaml.dump({"groups": groups}, default_flow_style=False, allow_unicode=True)


def _make_rule_group(name: str, customer_filter: str, cpu: int, mem: int, disk: int) -> dict:
    return {
        "name": name,
        "rules": [
            {
                "alert": "HighCPU",
                "expr": f'(100 - avg by(customer_id, server_name) (rate(node_cpu_seconds_total{{mode="idle"{customer_filter}}}[5m])) * 100) > {cpu}',
                "for": "5m",
                "labels": {"severity": "warning"},
                "annotations": {
                    "summary": "High CPU usage on {{ $labels.server_name }}",
                    "description": f"CPU > {cpu}% for 5 minutes"
                }
            },
            {
                "alert": "HighMemory",
                "expr": f'(1 - node_memory_MemAvailable_bytes{{{customer_filter.lstrip(",")}}} / node_memory_MemTotal_bytes{{{customer_filter.lstrip(",")}}}) * 100 > {mem}',
                "for": "5m",
                "labels": {"severity": "warning"},
                "annotations": {
                    "summary": "High memory usage on {{ $labels.server_name }}",
                    "description": f"Memory > {mem}% for 5 minutes"
                }
            },
            {
                "alert": "HighDisk",
                "expr": f'(1 - node_filesystem_avail_bytes{{fstype!="tmpfs"{customer_filter}}} / node_filesystem_size_bytes{{fstype!="tmpfs"{customer_filter}}}) * 100 > {disk}',
                "for": "5m",
                "labels": {"severity": "warning"},
                "annotations": {
                    "summary": "High disk usage on {{ $labels.server_name }}",
                    "description": f"Disk > {disk}% for 5 minutes"
                }
            },
            {
                "alert": "ServerDown",
                "expr": f'up{{job="node-exporter"{customer_filter}}} == 0',
                "for": "5m",
                "labels": {"severity": "critical"},
                "annotations": {
                    "summary": "Server {{ $labels.server_name }} is down",
                    "description": "No metrics received for 5 minutes"
                }
            }
        ]
    }
```

**파일 경로:** `/monitoring_msp/config/vmalert/rules/host-alerts.yml`

---

## 5. 인증 구조

### 5.1 JWT 설정

```python
# auth.py
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta
import os

SECRET_KEY = os.getenv("PORTAL_JWT_SECRET")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv("TOKEN_EXPIRE_HOURS", "24"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def create_access_token(data: dict) -> str:
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode = {**data, "exp": expire}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> dict:
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    return payload  # { sub: username, role: "admin"|"viewer" }
```

### 5.2 권한 체크 의존성

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    try:
        payload = verify_token(token)
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin required")
    return user
```

### 5.3 라우터에서 권한 적용

```python
# viewer: 조회만 허용
@router.get("/api/servers", dependencies=[Depends(get_current_user)])
async def list_servers(): ...

# admin: 변경 작업
@router.put("/api/servers/{customer_id}/{server}/alias",
            dependencies=[Depends(require_admin)])
async def set_alias(): ...
```

---

## 6. Docker 관련

### 6.1 컨테이너 설정

```yaml
# docker-compose.yml에 추가
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
    - /var/run/docker.sock:/var/run/docker.sock   # Docker API
    - ~/monitoring_msp/config:/monitoring_msp/config  # 설정 파일 수정
    - portal-db:/app/data                         # SQLite 영구 저장
  networks:
    - msp-net
  ports:
    - "127.0.0.1:8000:8000"

volumes:
  portal-db:
```

### 6.2 Docker socket API 패턴

```python
# services/docker_mgr.py
import httpx

DOCKER_SOCKET = "http+unix://%2Fvar%2Frun%2Fdocker.sock"


async def get_container_status(container_name: str) -> dict:
    transport = httpx.AsyncHTTPTransport(uds="/var/run/docker.sock")
    async with httpx.AsyncClient(transport=transport, base_url="http://docker") as client:
        resp = await client.get(f"/containers/{container_name}/json")
        if resp.status_code == 404:
            return {"name": container_name, "status": "not_found"}
        data = resp.json()
        return {
            "name": container_name,
            "status": data["State"]["Status"],  # running, exited, etc.
            "running": data["State"]["Running"],
            "started_at": data["State"]["StartedAt"],
        }


async def restart_container(container_name: str) -> bool:
    transport = httpx.AsyncHTTPTransport(uds="/var/run/docker.sock")
    async with httpx.AsyncClient(transport=transport, base_url="http://docker") as client:
        resp = await client.post(f"/containers/{container_name}/restart")
        return resp.status_code == 204
```

### 6.3 Dockerfile (멀티스테이지 빌드)

```dockerfile
# Stage 1: 프론트엔드 빌드
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python 백엔드
FROM python:3.11-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
# 프론트엔드 빌드 결과물 복사
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# SQLite DB 디렉토리 생성
RUN mkdir -p /app/data

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 7. 프론트엔드 규칙

### 7.1 기술 스택

- React + Vite (JSX, TypeScript 사용 안 함)
- Tailwind CSS (스타일)
- fetch API (HTTP 호출, axios 사용 안 함)
- React Router (클라이언트 라우팅)

### 7.2 API 호출 패턴

```javascript
// src/api.js - 모든 API 호출 함수를 여기에 집중
const getToken = () => localStorage.getItem('token');

const apiFetch = async (path, options = {}) => {
  const token = getToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (response.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
    return;
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'API Error');
  }

  return response.json();
};

export const api = {
  login: (username, password) =>
    apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  getServers: () => apiFetch('/api/servers'),

  setAlias: (customerId, serverName, data) =>
    apiFetch(`/api/servers/${customerId}/${serverName}/alias`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // ... 기타 API
};
```

### 7.3 Vite 설정 (개발 시 프록시)

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
```

### 7.4 FastAPI 정적 파일 서빙

```python
# main.py
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

app = FastAPI(title="MSP Portal")

# API 라우터 먼저 등록
app.include_router(auth_router, prefix="/api")
app.include_router(servers_router, prefix="/api")
# ...

# 정적 파일 서빙 (프론트엔드 빌드 결과물)
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "frontend", "dist")
if os.path.exists(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=f"{FRONTEND_DIST}/assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """React Router를 위한 SPA 폴백"""
        return FileResponse(f"{FRONTEND_DIST}/index.html")
```

---

## 8. 개발 순서 (반드시 이 순서로)

작업 시 아래 순서를 엄격히 따른다. 각 단계를 완료한 후 다음 단계로 넘어간다.

### Step 1: 기반 설정 파일

```
portal/Dockerfile
portal/requirements.txt
portal/.env.example
```

### Step 2: DB 레이어

```
portal/database.py   # SQLite 연결, 세션 팩토리
portal/models.py     # SQLAlchemy 모델 (5개 테이블)
portal/schemas.py    # Pydantic 요청/응답 스키마
```

### Step 3: 인증

```
portal/auth.py       # JWT 생성/검증, 권한 의존성
portal/routers/auth.py  # 로그인/로그아웃 엔드포인트
```

### Step 4: 라우터 (순서 중요)

```
portal/routers/servers.py   # 서버 현황 API
portal/routers/alerts.py    # 알람 설정 API
portal/routers/agent.py     # 에이전트 명령어 생성 API
portal/routers/system.py    # 시스템 상태 API
```

### Step 5: 서비스 레이어

```
portal/services/victoriametrics.py  # VM API 클라이언트
portal/services/alertmanager.py     # alertmanager.yml 생성
portal/services/vmalert.py          # vmalert rules 생성
portal/services/docker_mgr.py       # Docker socket API
```

### Step 6: FastAPI 진입점

```
portal/main.py   # 라우터 등록, 정적 파일 서빙, 시작 시 초기 계정 생성
```

### Step 7: docker-compose.yml 수정

```
monitoring_msp/docker-compose.yml  # msp-portal 서비스 추가
```

### Step 8: nginx.conf 수정

```
monitoring_msp/config/nginx/nginx.conf  # grafana-admin 서브도메인 라우팅 추가
```

### Step 9: 프론트엔드

```
portal/frontend/package.json
portal/frontend/vite.config.js
portal/frontend/tailwind.config.js
portal/frontend/index.html
portal/frontend/src/main.jsx
portal/frontend/src/App.jsx
portal/frontend/src/api.js
portal/frontend/src/pages/Login.jsx
portal/frontend/src/pages/Dashboard.jsx
portal/frontend/src/pages/Servers.jsx
portal/frontend/src/pages/AlertConfig.jsx
portal/frontend/src/pages/System.jsx
portal/frontend/src/components/Layout.jsx
portal/frontend/src/components/ServerCard.jsx
portal/frontend/src/components/AlertBadge.jsx
portal/frontend/src/components/StatusDot.jsx
portal/frontend/src/components/InstallCommand.jsx
```

---

## 9. 에러 처리 패턴

### 9.1 VictoriaMetrics 장애 시

```python
async def get_customers() -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{VICTORIAMETRICS_URL}/api/v1/label/customer_id/values")
            resp.raise_for_status()
            return resp.json()["data"]
    except httpx.TimeoutException:
        raise HTTPException(status_code=503, detail="VictoriaMetrics timeout")
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"VictoriaMetrics error: {e}")
```

### 9.2 Docker socket 접근 실패 시

```python
async def get_container_status(name: str) -> dict:
    try:
        # ... Docker API 호출
    except Exception as e:
        # Docker socket이 없거나 권한 없을 때 (개발 환경)
        return {"name": name, "status": "unknown", "error": str(e)}
```

### 9.3 설정 파일 경로 확인

```python
CONFIG_DIR = os.getenv("CONFIG_DIR", "/monitoring_msp/config")

def get_alertmanager_config_path() -> str:
    path = os.path.join(CONFIG_DIR, "alertmanager", "alertmanager.yml")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path
```

---

## 10. 테스트 / 로컬 개발

### 10.1 백엔드 로컬 실행

```bash
cd portal
pip install -r requirements.txt

# 환경변수 설정
export PORTAL_JWT_SECRET="dev-secret"
export PORTAL_INIT_USER="admin"
export PORTAL_INIT_PASSWORD="admin123"
export VICTORIAMETRICS_URL="http://localhost:8428"  # 로컬 VM이 있을 경우
export CONFIG_DIR="./config-dev"

uvicorn main:app --reload --port 8000
```

### 10.2 프론트엔드 로컬 실행

```bash
cd portal/frontend
npm install
npm run dev  # http://localhost:5173 (백엔드 http://localhost:8000 으로 프록시)
```

### 10.3 전체 스택 포함 실행

```bash
cd monitoring_msp
docker compose up -d
# msp-portal 컨테이너도 함께 실행됨
```

---

## 11. 주요 환경변수 참조

| 변수명 | 기본값 | 설명 |
|--------|--------|------|
| PORTAL_JWT_SECRET | (필수) | JWT 서명 키 |
| PORTAL_INIT_USER | admin | 초기 관리자 계정 |
| PORTAL_INIT_PASSWORD | changeme123 | 초기 관리자 비밀번호 |
| VICTORIAMETRICS_URL | http://victoriametrics:8428 | VM 내부 URL |
| ALERTMANAGER_URL | http://alertmanager:9093 | AM 내부 URL |
| CONFIG_DIR | /monitoring_msp/config | 설정 파일 루트 경로 |
| DB_PATH | /app/data/portal.db | SQLite DB 파일 경로 |
| TOKEN_EXPIRE_HOURS | 24 | JWT 토큰 유효 시간 |

---

## 12. 금지 패키지 목록

```
# requirements.txt에 추가 금지
paramiko     # SSH 클라이언트
fabric       # SSH 자동화
ansible      # 원격 서버 관리
axios        # (프론트엔드 package.json에도 추가 금지)
```

---

## 13. 참고: 기존 스택 파일 위치

수정이 필요할 때만 열람한다. 직접 수정하지 말고, 서비스 레이어(services/)를 통해 프로그램적으로 재생성한다.

```
monitoring_msp/
├── docker-compose.yml                           # 포털 서비스 추가 대상
├── config/
│   ├── alertmanager/
│   │   └── alertmanager.yml                     # services/alertmanager.py가 재생성
│   ├── vmalert/
│   │   └── rules/
│   │       └── host-alerts.yml                  # services/vmalert.py가 재생성
│   └── nginx/
│       └── nginx.conf                           # grafana-admin 서브도메인 추가 대상
└── portal/                                      # 이 디렉토리
```
