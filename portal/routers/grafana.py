import os
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from auth import require_admin

router = APIRouter(prefix="/grafana", tags=["grafana"])

GRAFANA_URL = os.getenv("GRAFANA_URL", "http://grafana:3000")
GRAFANA_ADMIN_USER = os.getenv("GRAFANA_ADMIN_USER", "admin")
GRAFANA_ADMIN_PASSWORD = os.getenv("GRAFANA_ADMIN_PASSWORD", "changeme")


def _auth():
    return (GRAFANA_ADMIN_USER, GRAFANA_ADMIN_PASSWORD)


class GrafanaUserCreate(BaseModel):
    name: str
    login: str
    email: str
    password: str
    role: str = "Viewer"


class GrafanaPasswordReset(BaseModel):
    password: str


class GrafanaRoleUpdate(BaseModel):
    role: str


async def _request(method: str, path: str, **kwargs):
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.request(method, f"{GRAFANA_URL}{path}", auth=_auth(), **kwargs)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise HTTPException(status_code=resp.status_code, detail=detail)
        return resp.json() if resp.text else {}


@router.get("/users", dependencies=[Depends(require_admin)])
async def list_users():
    users = await _request("GET", "/api/users")
    # 각 유저의 org role 포함해서 반환
    org_users = await _request("GET", "/api/org/users")
    role_map = {u["userId"]: u["role"] for u in org_users}
    for u in users:
        u["orgRole"] = role_map.get(u["id"], "-")
    return users


@router.post("/users", dependencies=[Depends(require_admin)])
async def create_user(body: GrafanaUserCreate):
    # 유저 생성
    user = await _request("POST", "/api/admin/users", json={
        "name": body.name,
        "login": body.login,
        "email": body.email,
        "password": body.password,
    })
    user_id = user.get("id")
    # org role 설정
    if body.role in ("Admin", "Editor", "Viewer") and user_id:
        try:
            await _request("PATCH", f"/api/org/users/{user_id}", json={"role": body.role})
        except Exception:
            pass
    return user


@router.delete("/users/{user_id}", dependencies=[Depends(require_admin)])
async def delete_user(user_id: int):
    return await _request("DELETE", f"/api/admin/users/{user_id}")


@router.put("/users/{user_id}/password", dependencies=[Depends(require_admin)])
async def reset_password(user_id: int, body: GrafanaPasswordReset):
    return await _request("PUT", f"/api/admin/users/{user_id}/password", json={"password": body.password})


@router.patch("/users/{user_id}/role", dependencies=[Depends(require_admin)])
async def update_role(user_id: int, body: GrafanaRoleUpdate):
    if body.role not in ("Admin", "Editor", "Viewer"):
        raise HTTPException(status_code=400, detail="Role must be Admin, Editor, or Viewer")
    return await _request("PATCH", f"/api/org/users/{user_id}", json={"role": body.role})
