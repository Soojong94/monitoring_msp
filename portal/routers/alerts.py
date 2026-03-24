import os
import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from typing import Optional
from database import get_db
from models import CustomerEmail, AlertThreshold, AlertHistory
from schemas import AlertConfigUpdate, AlertConfigResponse, EmailEntry, ThresholdConfig, AddEmailRequest
from auth import get_current_user, require_admin
from services import alertmanager as am_svc
from services import vmalert as vm_svc

router = APIRouter(prefix="/alerts", tags=["alerts"])

AM_URL = os.getenv("ALERTMANAGER_URL", "http://alertmanager:9093")


def _get_config(customer_id: str, db: Session) -> AlertConfigResponse:
    emails = db.query(CustomerEmail).filter(CustomerEmail.customer_id == customer_id).all()
    threshold = db.query(AlertThreshold).filter(AlertThreshold.customer_id == customer_id).first()

    return AlertConfigResponse(
        customer_id=customer_id,
        emails=[EmailEntry(id=e.id, email=e.email, enabled=bool(e.enabled)) for e in emails],
        thresholds=ThresholdConfig(
            cpu=threshold.cpu if threshold else 90,
            memory=threshold.memory if threshold else 90,
            disk=threshold.disk if threshold else 90,
        ),
    )


def _build_customers_for_am(db: Session) -> list[dict]:
    emails = db.query(CustomerEmail).filter(CustomerEmail.enabled == 1).all()
    customers = {}
    for e in emails:
        if e.customer_id not in customers:
            customers[e.customer_id] = []
        customers[e.customer_id].append(e.email)
    return [{"customer_id": cid, "emails": elist} for cid, elist in customers.items()]


def _build_thresholds_for_vmalert(db: Session) -> list[dict]:
    thresholds = db.query(AlertThreshold).all()
    return [
        {"customer_id": t.customer_id, "cpu": t.cpu, "memory": t.memory, "disk": t.disk}
        for t in thresholds
    ]


@router.get("/customers")
async def list_vm_customers(user: dict = Depends(get_current_user)):
    """VictoriaMetrics에서 실제 데이터가 있는 customer_id 목록 반환"""
    from services.victoriametrics import get_customers
    try:
        return await get_customers()
    except Exception:
        return []


@router.get("/config", response_model=list[AlertConfigResponse])
def list_configs(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    from models import CustomerEmail, AlertThreshold
    customer_ids = {e.customer_id for e in db.query(CustomerEmail.customer_id).distinct()}
    threshold_ids = {t.customer_id for t in db.query(AlertThreshold.customer_id).distinct()}
    all_ids = customer_ids | threshold_ids
    return [_get_config(cid, db) for cid in sorted(all_ids)]


@router.get("/config/{customer_id}", response_model=AlertConfigResponse)
def get_config(customer_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return _get_config(customer_id, db)


@router.put("/config/{customer_id}", dependencies=[Depends(require_admin)])
async def update_config(
    customer_id: str,
    body: AlertConfigUpdate,
    db: Session = Depends(get_db),
):
    if body.thresholds is not None:
        t = db.query(AlertThreshold).filter(AlertThreshold.customer_id == customer_id).first()
        if t:
            t.cpu = body.thresholds.cpu
            t.memory = body.thresholds.memory
            t.disk = body.thresholds.disk
        else:
            t = AlertThreshold(
                customer_id=customer_id,
                cpu=body.thresholds.cpu,
                memory=body.thresholds.memory,
                disk=body.thresholds.disk,
            )
            db.add(t)

    db.commit()

    # Apply configs
    am_customers = _build_customers_for_am(db)
    vm_thresholds = _build_thresholds_for_vmalert(db)

    am_ok = await am_svc.apply_alertmanager_config(am_customers)
    vm_ok = await vm_svc.apply_vmalert_rules(vm_thresholds)

    return {
        "message": "Config updated",
        "restarted": {
            "alertmanager": am_ok,
            "vmalert": vm_ok,
        }
    }


@router.post("/config/{customer_id}/emails", dependencies=[Depends(require_admin)])
async def add_email(
    customer_id: str,
    body: AddEmailRequest,
    db: Session = Depends(get_db),
):
    existing = db.query(CustomerEmail).filter(
        CustomerEmail.customer_id == customer_id,
        CustomerEmail.email == body.email,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already exists")

    email = CustomerEmail(customer_id=customer_id, email=body.email, enabled=1)
    db.add(email)
    db.commit()
    db.refresh(email)

    # Re-apply alertmanager config
    am_customers = _build_customers_for_am(db)
    await am_svc.apply_alertmanager_config(am_customers)

    return EmailEntry(id=email.id, email=email.email, enabled=True)


@router.delete("/config/{customer_id}/emails/{email_id}", dependencies=[Depends(require_admin)])
async def delete_email(
    customer_id: str,
    email_id: int,
    db: Session = Depends(get_db),
):
    email = db.query(CustomerEmail).filter(
        CustomerEmail.id == email_id,
        CustomerEmail.customer_id == customer_id,
    ).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")

    db.delete(email)
    db.commit()

    am_customers = _build_customers_for_am(db)
    await am_svc.apply_alertmanager_config(am_customers)

    return {"message": "Email deleted"}


@router.delete("/config/{customer_id}", dependencies=[Depends(require_admin)])
async def delete_customer_config(
    customer_id: str,
    db: Session = Depends(get_db),
):
    db.query(CustomerEmail).filter(CustomerEmail.customer_id == customer_id).delete()
    db.query(AlertThreshold).filter(AlertThreshold.customer_id == customer_id).delete()
    db.commit()

    am_customers = _build_customers_for_am(db)
    vm_thresholds = _build_thresholds_for_vmalert(db)

    am_ok = await am_svc.apply_alertmanager_config(am_customers)
    vm_ok = await vm_svc.apply_vmalert_rules(vm_thresholds)

    return {
        "message": "Customer config deleted",
        "restarted": {"alertmanager": am_ok, "vmalert": vm_ok},
    }


@router.patch("/config/{customer_id}/emails/{email_id}", dependencies=[Depends(require_admin)])
async def toggle_email(
    customer_id: str,
    email_id: int,
    db: Session = Depends(get_db),
):
    email = db.query(CustomerEmail).filter(
        CustomerEmail.id == email_id,
        CustomerEmail.customer_id == customer_id,
    ).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")

    email.enabled = 0 if email.enabled else 1
    db.commit()

    am_customers = _build_customers_for_am(db)
    await am_svc.apply_alertmanager_config(am_customers)

    return EmailEntry(id=email.id, email=email.email, enabled=bool(email.enabled))


@router.get("/firing")
async def get_firing_alerts(user: dict = Depends(get_current_user)):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{AM_URL}/api/v2/alerts?active=true&silenced=false")
            resp.raise_for_status()
            alerts = resp.json()
            result = []
            for a in alerts:
                labels = a.get("labels", {})
                result.append({
                    "customer_id": labels.get("customer_id", ""),
                    "server_name": labels.get("server_name", ""),
                    "alert_name": labels.get("alertname", ""),
                    "severity": labels.get("severity", ""),
                    "starts_at": a.get("startsAt", ""),
                    "status": a.get("status", {}).get("state", ""),
                })
            return result
    except Exception as e:
        return []


@router.post("/webhook")
async def alert_webhook(payload: dict, db: Session = Depends(get_db)):
    """alertmanager webhook 수신 → alert_history 저장"""
    for alert in payload.get("alerts", []):
        labels = alert.get("labels", {})
        annotations = alert.get("annotations", {})
        fingerprint = alert.get("fingerprint", "")
        status = alert.get("status", "firing")
        starts_at = alert.get("startsAt", "")
        ends_at = alert.get("endsAt", "")

        if status == "firing":
            existing = db.query(AlertHistory).filter(
                AlertHistory.fingerprint == fingerprint,
                AlertHistory.resolved_at == None,
            ).first()
            if not existing:
                db.add(AlertHistory(
                    fingerprint=fingerprint,
                    customer_id=labels.get("customer_id", ""),
                    server_name=labels.get("server_name", ""),
                    alert_name=labels.get("alertname", ""),
                    status="firing",
                    severity=labels.get("severity", ""),
                    message=annotations.get("description", ""),
                    started_at=starts_at,
                ))
        elif status == "resolved":
            existing = db.query(AlertHistory).filter(
                AlertHistory.fingerprint == fingerprint,
                AlertHistory.resolved_at == None,
            ).first()
            if existing:
                existing.status = "resolved"
                existing.resolved_at = ends_at if not ends_at.startswith("0001") else None

    db.commit()
    return {"ok": True}


@router.get("/history")
def get_alert_history(
    customer_id: Optional[str] = None,
    server_name: Optional[str] = None,
    status: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 200,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    q = db.query(AlertHistory)
    if customer_id:
        q = q.filter(AlertHistory.customer_id == customer_id)
    if server_name:
        q = q.filter(AlertHistory.server_name == server_name)
    if status:
        q = q.filter(AlertHistory.status == status)
    if from_date:
        q = q.filter(AlertHistory.started_at >= from_date)
    if to_date:
        q = q.filter(AlertHistory.started_at <= to_date + "T23:59:59Z")
    return q.order_by(AlertHistory.id.desc()).limit(limit).all()
