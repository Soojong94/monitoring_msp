import os
import httpx
import yaml
from services.docker_mgr import restart_container

CONFIG_DIR = os.getenv("CONFIG_DIR", "/monitoring_msp/config")
VMALERT_URL = os.getenv("VMALERT_URL", "http://vmalert:8180")
DEFAULT_THRESHOLDS = {"cpu": 90, "memory": 90, "disk": 90}


def get_vmalert_rules_path() -> str:
    path = os.path.join(CONFIG_DIR, "vmalert", "rules", "host-alerts.yml")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def _make_rule_group(name: str, customer_filter: str, cpu: int, mem: int, disk: int) -> dict:
    cf = customer_filter
    cf_strip = cf.lstrip(",")
    return {
        "name": name,
        "rules": [
            {
                "alert": "HighCPU",
                "expr": (
                    f'(100 - avg by(customer_id, server_name) '
                    f'(rate(node_cpu_seconds_total{{mode="idle"{cf}}}[5m])) * 100) > {cpu}'
                ),
                "for": "3m",
                "labels": {"severity": "warning"},
                "annotations": {
                    "summary": "High CPU on {{ $labels.server_name }}",
                    "description": f"CPU > {cpu}% for 3 minutes",
                },
            },
            {
                "alert": "HighMemory",
                "expr": (
                    f'(1 - node_memory_MemAvailable_bytes{{{cf_strip}}}'
                    f' / node_memory_MemTotal_bytes{{{cf_strip}}}) * 100 > {mem}'
                ),
                "for": "3m",
                "labels": {"severity": "warning"},
                "annotations": {
                    "summary": "High memory on {{ $labels.server_name }}",
                    "description": f"Memory > {mem}% for 3 minutes",
                },
            },
            {
                "alert": "HighDisk",
                "expr": (
                    f'(1 - node_filesystem_avail_bytes{{fstype!~"tmpfs|devtmpfs|overlay|squashfs"{cf}}}'
                    f' / node_filesystem_size_bytes{{fstype!~"tmpfs|devtmpfs|overlay|squashfs"{cf}}}) * 100 > {disk}'
                ),
                "for": "3m",
                "labels": {"severity": "warning"},
                "annotations": {
                    "summary": "High disk on {{ $labels.server_name }}",
                    "description": f"Disk > {disk}% for 3 minutes",
                },
            },
            {
                "alert": "ServerDown",
                "expr": f'(time() - max by (customer_id, server_name) (timestamp(node_uname_info{{{cf_strip}}}))) > 300',
                "for": "0m",
                "labels": {"severity": "critical"},
                "annotations": {
                    "summary": "Server {{ $labels.server_name }} is down",
                    "description": "No metrics received for more than 3 minutes",
                },
            },
        ],
    }


def generate_vmalert_rules(customers_thresholds: list[dict]) -> str:
    """customers_thresholds: [{ customer_id, cpu, memory, disk }]"""
    groups = []

    default_cust = [
        c for c in customers_thresholds
        if c["cpu"] == 90 and c["memory"] == 90 and c["disk"] == 90
    ]
    custom_cust = [
        c for c in customers_thresholds
        if not (c["cpu"] == 90 and c["memory"] == 90 and c["disk"] == 90)
    ]

    # Default group
    if not customers_thresholds:
        groups.append(_make_rule_group("host-alerts-default", "", 90, 90, 90))
    elif default_cust:
        ids = "|".join(c["customer_id"] for c in default_cust)
        cf = f',customer_id=~"{ids}"'
        groups.append(_make_rule_group("host-alerts-default", cf, 90, 90, 90))

    # Custom per-customer groups
    for c in custom_cust:
        cf = f',customer_id="{c["customer_id"]}"'
        groups.append(_make_rule_group(
            f"host-alerts-{c['customer_id']}", cf, c["cpu"], c["memory"], c["disk"]
        ))

    return yaml.dump({"groups": groups}, default_flow_style=False, allow_unicode=True)


async def apply_vmalert_rules(customers_thresholds: list[dict]) -> bool:
    path = get_vmalert_rules_path()
    content = generate_vmalert_rules(customers_thresholds)
    with open(path, "w") as f:
        f.write(content)
    # Hot-reload instead of restart (preserves pending alert state)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(f"{VMALERT_URL}/-/reload")
            return resp.status_code == 200
    except Exception:
        return await restart_container("msp-vmalert")
