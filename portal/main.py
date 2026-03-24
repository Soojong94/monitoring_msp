import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import text

from database import engine, SessionLocal, Base
from models import PortalUser
from auth import hash_password
from routers import auth as auth_router
from routers import servers as servers_router
from routers import alerts as alerts_router
from routers import agent as agent_router
from routers import system as system_router
from routers import users as users_router
from routers import grafana as grafana_router


def _migrate(db):
    """기존 테이블에 신규 컬럼 추가 (없을 때만)"""
    migrations = [
        "ALTER TABLE alert_thresholds ADD COLUMN retention_days INTEGER DEFAULT 1095",
        "ALTER TABLE alert_history ADD COLUMN fingerprint TEXT",
    ]
    for sql in migrations:
        try:
            db.execute(text(sql))
            db.commit()
        except Exception:
            db.rollback()


def init_db():
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    _migrate(db)
    try:
        # Create initial admin user if not exists
        init_user = os.getenv("PORTAL_INIT_USER", "admin")
        init_pass = os.getenv("PORTAL_INIT_PASSWORD", "changeme123")

        existing = db.query(PortalUser).filter(PortalUser.username == init_user).first()
        if not existing:
            user = PortalUser(
                username=init_user,
                password_hash=hash_password(init_pass),
                role="admin",
            )
            db.add(user)
            db.commit()
            print(f"[portal] Created initial user: {init_user}")
        else:
            # Always sync password from env var on startup
            existing.password_hash = hash_password(init_pass)
            db.commit()
            print(f"[portal] Synced password for user: {init_user}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="MSP Monitoring Portal", lifespan=lifespan)

# API routers
app.include_router(auth_router.router, prefix="/api")
app.include_router(servers_router.router, prefix="/api")
app.include_router(alerts_router.router, prefix="/api")
app.include_router(agent_router.router, prefix="/api")
app.include_router(system_router.router, prefix="/api")
app.include_router(users_router.router, prefix="/api")
app.include_router(grafana_router.router, prefix="/api")

# Frontend static files
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "frontend", "dist")

if os.path.exists(FRONTEND_DIST):
    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
else:
    @app.get("/")
    def root():
        return {"message": "MSP Portal API running. Frontend not built yet."}
