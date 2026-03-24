import os
import ssl
import socket
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
import httpx

from auth import get_current_user, require_admin
from services.docker_mgr import get_all_container_statuses, restart_container

router = APIRouter(prefix="/system", tags=["system"])

VM_URL = os.getenv("VICTORIAMETRICS_URL", "http://victoriametrics:8428")

MANAGED_CONTAINERS = [
    "msp-victoriametrics",
    "msp-grafana",
    "msp-alertmanager",
    "msp-vmalert",
    "msp-nginx",
    "msp-portal",
]

RESTARTABLE = {
    "victoriametrics": "msp-victoriametrics",
    "grafana": "msp-grafana",
    "alertmanager": "msp-alertmanager",
    "vmalert": "msp-vmalert",
    "nginx": "msp-nginx",
}


def _get_cert_expiry(hostname: str) -> dict:
    try:
        ctx = ssl.create_default_context()
        with ctx.wrap_socket(socket.socket(), server_hostname=hostname) as s:
            s.settimeout(5)
            s.connect((hostname, 443))
            cert = s.getpeercert()
            expiry_str = cert["notAfter"]
            expiry = datetime.strptime(expiry_str, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
            days_left = (expiry - datetime.now(timezone.utc)).days
            return {"hostname": hostname, "expires_at": expiry.isoformat(), "days_left": days_left}
    except Exception as e:
        return {"hostname": hostname, "error": str(e)}


@router.get("/status")
async def get_status(user: dict = Depends(get_current_user)):
    containers = await get_all_container_statuses(MANAGED_CONTAINERS)

    storage = {}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{VM_URL}/api/v1/status/tsdb")
            if resp.status_code == 200:
                storage = resp.json().get("data", {})
    except Exception:
        pass

    cert = _get_cert_expiry("grafana.tbit.co.kr")

    return {
        "containers": containers,
        "storage": storage,
        "certificate": cert,
    }


@router.post("/restart/{service}", dependencies=[Depends(require_admin)])
async def restart_service(service: str):
    container_name = RESTARTABLE.get(service)
    if not container_name:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service}")

    ok = await restart_container(container_name)
    return {"service": service, "restarted": ok}
