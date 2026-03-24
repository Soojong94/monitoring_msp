from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from database import get_db
from models import ServerAlias, InactiveServer
from schemas import ServerAliasUpdate, ServerInfo
from auth import get_current_user, require_admin
from services import victoriametrics as vm

router = APIRouter(prefix="/servers", tags=["servers"])


@router.get("", response_model=list[ServerInfo])
async def list_servers(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    try:
        all_servers = await vm.get_all_series()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

    inactive_set = {
        (r.customer_id, r.server_name)
        for r in db.query(InactiveServer).all()
    }
    aliases = {
        (a.customer_id, a.server_name): a
        for a in db.query(ServerAlias).all()
    }

    result = []
    for s in all_servers:
        key = (s["customer_id"], s["server_name"])
        is_inactive = key in inactive_set

        if is_inactive and not include_inactive:
            continue

        alias = aliases.get(key)
        last_seen = await vm.get_server_last_seen(s["customer_id"], s["server_name"])
        online = await vm.is_server_online(last_seen)

        result.append(ServerInfo(
            customer_id=s["customer_id"],
            server_name=s["server_name"],
            display_customer=alias.display_customer if alias else None,
            display_server=alias.display_server if alias else None,
            notes=alias.notes if alias else None,
            online=online,
            last_seen=last_seen,
            inactive=is_inactive,
        ))

    return result


@router.put("/{customer_id}/{server_name}/alias", dependencies=[Depends(require_admin)])
def set_alias(
    customer_id: str,
    server_name: str,
    body: ServerAliasUpdate,
    db: Session = Depends(get_db),
):
    alias = db.query(ServerAlias).filter(
        ServerAlias.customer_id == customer_id,
        ServerAlias.server_name == server_name,
    ).first()

    if alias:
        if body.display_customer is not None:
            alias.display_customer = body.display_customer
        if body.display_server is not None:
            alias.display_server = body.display_server
        if body.notes is not None:
            alias.notes = body.notes
        alias.updated_at = datetime.now(timezone.utc).isoformat()
    else:
        alias = ServerAlias(
            customer_id=customer_id,
            server_name=server_name,
            display_customer=body.display_customer,
            display_server=body.display_server,
            notes=body.notes,
        )
        db.add(alias)

    db.commit()
    return {"message": "Alias updated"}


@router.delete("/{customer_id}/{server_name}", dependencies=[Depends(require_admin)])
async def delete_server(
    customer_id: str,
    server_name: str,
    purge: bool = Query(False),
    db: Session = Depends(get_db),
):
    if purge:
        success = await vm.delete_series(customer_id, server_name)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete metrics from VictoriaMetrics")
        # Also remove from inactive if present
        db.query(InactiveServer).filter(
            InactiveServer.customer_id == customer_id,
            InactiveServer.server_name == server_name,
        ).delete()
        db.commit()
        return {"message": "Server metrics purged from VictoriaMetrics"}
    else:
        existing = db.query(InactiveServer).filter(
            InactiveServer.customer_id == customer_id,
            InactiveServer.server_name == server_name,
        ).first()
        if not existing:
            inactive = InactiveServer(
                customer_id=customer_id,
                server_name=server_name,
                deactivated_at=datetime.now(timezone.utc).isoformat(),
            )
            db.add(inactive)
            db.commit()
        return {"message": "Server deactivated (metrics retained)"}


@router.post("/{customer_id}/{server_name}/restore", dependencies=[Depends(require_admin)])
def restore_server(
    customer_id: str,
    server_name: str,
    db: Session = Depends(get_db),
):
    db.query(InactiveServer).filter(
        InactiveServer.customer_id == customer_id,
        InactiveServer.server_name == server_name,
    ).delete()
    db.commit()
    return {"message": "Server restored"}
