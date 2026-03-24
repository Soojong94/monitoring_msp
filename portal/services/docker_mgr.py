import httpx


async def get_container_status(container_name: str) -> dict:
    try:
        transport = httpx.AsyncHTTPTransport(uds="/var/run/docker.sock")
        async with httpx.AsyncClient(transport=transport, base_url="http://docker") as client:
            resp = await client.get(f"/containers/{container_name}/json")
            if resp.status_code == 404:
                return {"name": container_name, "status": "not_found", "running": False}
            data = resp.json()
            return {
                "name": container_name,
                "status": data["State"]["Status"],
                "running": data["State"]["Running"],
                "started_at": data["State"]["StartedAt"],
            }
    except Exception as e:
        return {"name": container_name, "status": "unknown", "running": False, "error": str(e)}


async def restart_container(container_name: str) -> bool:
    try:
        transport = httpx.AsyncHTTPTransport(uds="/var/run/docker.sock")
        async with httpx.AsyncClient(transport=transport, base_url="http://docker") as client:
            resp = await client.post(f"/containers/{container_name}/restart", timeout=30.0)
            return resp.status_code == 204
    except Exception:
        return False


async def get_all_container_statuses(names: list[str]) -> list[dict]:
    results = []
    for name in names:
        results.append(await get_container_status(name))
    return results
