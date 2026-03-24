import os
from datetime import datetime, timezone
from typing import Optional
import httpx

VM_URL = os.getenv("VICTORIAMETRICS_URL", "http://victoriametrics:8428")
TIMEOUT = 5.0


async def get_customers() -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(f"{VM_URL}/api/v1/label/customer_id/values")
            resp.raise_for_status()
            data = resp.json()
            return [c for c in data.get("data", []) if c]
    except httpx.TimeoutException:
        raise Exception("VictoriaMetrics timeout")
    except httpx.HTTPError as e:
        raise Exception(f"VictoriaMetrics error: {e}")


async def get_all_series() -> list[dict]:
    """Get all server series from node_uname_info."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(
                f"{VM_URL}/api/v1/series",
                params={"match[]": "node_uname_info"}
            )
            resp.raise_for_status()
            data = resp.json()
            servers = []
            seen = set()
            for s in data.get("data", []):
                key = (s.get("customer_id", ""), s.get("server_name", ""))
                if key not in seen and key[0] and key[1]:
                    seen.add(key)
                    servers.append({
                        "customer_id": key[0],
                        "server_name": key[1],
                    })
            return servers
    except Exception as e:
        raise Exception(f"VictoriaMetrics error: {e}")


async def get_server_last_seen(customer_id: str, server_name: str) -> Optional[str]:
    """Get last metric timestamp for a server."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(
                f"{VM_URL}/api/v1/query",
                params={
                    "query": f'node_uname_info{{customer_id="{customer_id}",server_name="{server_name}"}}'
                }
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("data", {}).get("result", [])
            if not results:
                return None
            ts = results[0]["value"][0]
            return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    except Exception:
        return None


async def is_server_online(last_seen: Optional[str]) -> bool:
    if not last_seen:
        return False
    try:
        dt = datetime.fromisoformat(last_seen)
        now = datetime.now(timezone.utc)
        return (now - dt).total_seconds() < 300
    except Exception:
        return False


async def delete_series(customer_id: str, server_name: str) -> bool:
    """Delete all metrics for a server from VictoriaMetrics."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{VM_URL}/api/v1/admin/tsdb/delete_series",
                params={"match[]": f'{{customer_id="{customer_id}",server_name="{server_name}"}}'}
            )
            return resp.status_code in (204, 200)
    except Exception:
        return False


async def get_customer_avg_cpu(customer_id: str) -> float:
    query = (
        f'avg(100 - avg by(server_name) '
        f'(rate(node_cpu_seconds_total{{mode="idle",customer_id="{customer_id}"}}[5m])) * 100)'
    )
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(f"{VM_URL}/api/v1/query", params={"query": query})
            data = resp.json()
            results = data.get("data", {}).get("result", [])
            if results:
                return round(float(results[0]["value"][1]), 1)
    except Exception:
        pass
    return 0.0


async def get_customer_avg_memory(customer_id: str) -> float:
    query = (
        f'avg((1 - node_memory_MemAvailable_bytes{{customer_id="{customer_id}"}}'
        f' / node_memory_MemTotal_bytes{{customer_id="{customer_id}"}}) * 100)'
    )
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(f"{VM_URL}/api/v1/query", params={"query": query})
            data = resp.json()
            results = data.get("data", {}).get("result", [])
            if results:
                return round(float(results[0]["value"][1]), 1)
    except Exception:
        pass
    return 0.0
