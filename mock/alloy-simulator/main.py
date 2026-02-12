"""
Alloy Simulator - 표준 node_exporter 메트릭을 VictoriaMetrics로 push.

실제 Grafana Alloy(prometheus.exporter.unix)가 보내는 것과 동일한
메트릭명/라벨을 사용하여 대시보드 호환성 보장.

5개 고객 × 2-4 서버 (14대) 시뮬레이션.
"""

import math
import os
import random
import time
import urllib.request
import urllib.error

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

VM_URL: str = os.environ.get("VM_URL", "http://victoriametrics:8428")
PUSH_INTERVAL: int = int(os.environ.get("PUSH_INTERVAL", "15"))

# ---------------------------------------------------------------------------
# Server definitions
# ---------------------------------------------------------------------------

SERVERS: list[tuple[str, str, str]] = [
    # alpha — 3 servers
    ("alpha", "web-01", "web"),
    ("alpha", "web-02", "web"),
    ("alpha", "db-01", "db"),
    # beta — 2 servers (high CPU)
    ("beta", "app-01", "app"),
    ("beta", "app-02", "app"),
    # gamma — 4 servers
    ("gamma", "web-01", "web"),
    ("gamma", "api-01", "api"),
    ("gamma", "db-01", "db"),
    ("gamma", "batch-01", "batch"),
    # delta — 2 servers
    ("delta", "web-01", "web"),
    ("delta", "db-01", "db"),
    # epsilon — 3 servers
    ("epsilon", "web-01", "web"),
    ("epsilon", "web-02", "web"),
    ("epsilon", "db-01", "db"),
]

# (ram_bytes, disk_bytes, num_cpus)
ROLE_SPECS: dict[str, tuple[int, int, int]] = {
    "web":   (8  * 1024**3, 50  * 1024**3, 4),
    "db":    (16 * 1024**3, 200 * 1024**3, 8),
    "app":   (8  * 1024**3, 50  * 1024**3, 4),
    "api":   (8  * 1024**3, 50  * 1024**3, 4),
    "batch": (32 * 1024**3, 500 * 1024**3, 8),
}

ENVIRONMENT = "production"

# ---------------------------------------------------------------------------
# Cumulative counter state (per server)
# ---------------------------------------------------------------------------


class ServerState:
    """서버별 누적 카운터 상태."""

    def __init__(self, num_cpus: int) -> None:
        self.num_cpus = num_cpus
        self.cpu_seconds: dict[str, float] = {}
        for cpu in range(num_cpus):
            for mode in ("idle", "user", "system", "iowait", "nice", "softirq"):
                self.cpu_seconds[f"{cpu}:{mode}"] = random.uniform(10000, 50000)
        self.net_rx_bytes: float = random.uniform(1e9, 5e9)
        self.net_tx_bytes: float = random.uniform(5e8, 2e9)

    def advance_cpu(self, cpu_pct: float, interval: float) -> None:
        busy = cpu_pct / 100.0
        for cpu in range(self.num_cpus):
            self.cpu_seconds[f"{cpu}:idle"] += (1.0 - busy) * interval
            self.cpu_seconds[f"{cpu}:user"] += busy * 0.55 * interval
            self.cpu_seconds[f"{cpu}:system"] += busy * 0.30 * interval
            self.cpu_seconds[f"{cpu}:iowait"] += busy * 0.10 * interval
            self.cpu_seconds[f"{cpu}:nice"] += busy * 0.03 * interval
            self.cpu_seconds[f"{cpu}:softirq"] += busy * 0.02 * interval

    def advance_network(self, rx_rate: float, tx_rate: float, interval: float) -> None:
        self.net_rx_bytes += rx_rate * interval
        self.net_tx_bytes += tx_rate * interval


_states: dict[str, ServerState] = {}


def _get_state(customer_id: str, server_name: str, role: str) -> ServerState:
    key = f"{customer_id}:{server_name}"
    if key not in _states:
        _, _, num_cpus = ROLE_SPECS[role]
        _states[key] = ServerState(num_cpus)
    return _states[key]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_start_ts: float = time.time()


def _wave(
    base: float,
    amplitude: float,
    period_seconds: float = 300.0,
    phase: float = 0.0,
    noise: float = 0.0,
) -> float:
    elapsed = time.time() - _start_ts
    sine = math.sin(2 * math.pi * elapsed / period_seconds + phase)
    return base + amplitude * sine + random.uniform(-noise, noise)


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def _phase_for(customer_id: str, server_name: str) -> float:
    h = hash(f"{customer_id}:{server_name}")
    return (h % 1000) / 1000.0 * 2 * math.pi


def _fmt(value: float) -> str:
    if value == int(value) and abs(value) < 1e15:
        return str(int(value))
    return f"{value:.2f}"


# ---------------------------------------------------------------------------
# Metric generation (표준 node_exporter 호환)
# ---------------------------------------------------------------------------


def _build_server_metrics(
    customer_id: str,
    server_name: str,
    role: str,
    ts_ms: int,
) -> list[str]:
    ram_total, disk_total, num_cpus = ROLE_SPECS[role]
    phase = _phase_for(customer_id, server_name)
    state = _get_state(customer_id, server_name, role)
    lines: list[str] = []

    bl = (
        f'customer_id="{customer_id}",'
        f'server_name="{server_name}",'
        f'environment="{ENVIRONMENT}"'
    )

    # ---- node_uname_info (discovery용) ------------------------------------
    lines.append(
        f'node_uname_info{{{bl},'
        f'nodename="{server_name}",'
        f'sysname="Linux",'
        f'release="5.15.0-generic"'
        f'}} 1 {ts_ms}'
    )

    # ---- CPU (누적 카운터: node_cpu_seconds_total) -------------------------
    if customer_id == "beta":
        cpu_pct = _clamp(_wave(80.0, 10.0, 240, phase, 3.0))
    else:
        cpu_pct = _clamp(_wave(35.0, 15.0, 300, phase, 5.0))

    state.advance_cpu(cpu_pct, PUSH_INTERVAL)

    for cpu in range(num_cpus):
        for mode in ("idle", "user", "system", "iowait", "nice", "softirq"):
            val = state.cpu_seconds[f"{cpu}:{mode}"]
            lines.append(
                f'node_cpu_seconds_total{{{bl},cpu="{cpu}",mode="{mode}"}} '
                f'{_fmt(val)} {ts_ms}'
            )

    # ---- Memory (게이지) ---------------------------------------------------
    if role == "db":
        mem_pct = _clamp(_wave(65.0, 10.0, 600, phase, 3.0))
    elif role == "batch":
        mem_pct = _clamp(_wave(55.0, 15.0, 360, phase, 4.0))
    else:
        mem_pct = _clamp(_wave(45.0, 12.0, 300, phase, 4.0))

    mem_avail = int(ram_total * (1.0 - mem_pct / 100.0))
    mem_free = int(mem_avail * 0.3)
    mem_buffers = int(mem_avail * 0.1)
    mem_cached = int(mem_avail * 0.4)

    lines.append(f"node_memory_MemTotal_bytes{{{bl}}} {ram_total} {ts_ms}")
    lines.append(f"node_memory_MemAvailable_bytes{{{bl}}} {mem_avail} {ts_ms}")
    lines.append(f"node_memory_MemFree_bytes{{{bl}}} {mem_free} {ts_ms}")
    lines.append(f"node_memory_Buffers_bytes{{{bl}}} {mem_buffers} {ts_ms}")
    lines.append(f"node_memory_Cached_bytes{{{bl}}} {mem_cached} {ts_ms}")

    # ---- Filesystem (게이지) -----------------------------------------------
    fs_labels = f'{bl},mountpoint="/",fstype="ext4",device="/dev/sda1"'

    if customer_id == "gamma" and server_name == "batch-01":
        fs_pct = _clamp(_wave(90.0, 5.0, 900, phase, 1.0))
    elif role == "db":
        fs_pct = _clamp(_wave(55.0, 8.0, 600, phase, 2.0))
    else:
        fs_pct = _clamp(_wave(40.0, 10.0, 300, phase, 3.0))

    fs_avail = int(disk_total * (1.0 - fs_pct / 100.0))
    lines.append(f"node_filesystem_size_bytes{{{fs_labels}}} {disk_total} {ts_ms}")
    lines.append(f"node_filesystem_avail_bytes{{{fs_labels}}} {fs_avail} {ts_ms}")

    # ---- Network (누적 카운터) ----------------------------------------------
    net_labels = f'{bl},device="eth0"'
    rx_rate = max(0.0, _wave(5_000_000, 3_000_000, 180, phase, 500_000))
    tx_rate = max(0.0, _wave(2_000_000, 1_500_000, 200, phase + 1.0, 300_000))
    state.advance_network(rx_rate, tx_rate, PUSH_INTERVAL)

    lines.append(
        f"node_network_receive_bytes_total{{{net_labels}}} "
        f"{_fmt(state.net_rx_bytes)} {ts_ms}"
    )
    lines.append(
        f"node_network_transmit_bytes_total{{{net_labels}}} "
        f"{_fmt(state.net_tx_bytes)} {ts_ms}"
    )

    # ---- Load average (게이지) ----------------------------------------------
    load1 = max(0.0, cpu_pct / 100.0 * num_cpus + random.uniform(-0.3, 0.3))
    load5 = max(0.0, cpu_pct / 100.0 * num_cpus * 0.9 + random.uniform(-0.2, 0.2))
    lines.append(f"node_load1{{{bl}}} {_fmt(load1)} {ts_ms}")
    lines.append(f"node_load5{{{bl}}} {_fmt(load5)} {ts_ms}")

    # ---- Uptime (게이지) ----------------------------------------------------
    uptime = int(time.time() - _start_ts) + random.randint(86400, 864000)
    lines.append(f"node_uptime_seconds{{{bl}}} {uptime} {ts_ms}")

    return lines


def build_all_metrics() -> str:
    ts_ms = int(time.time() * 1000)
    all_lines: list[str] = []
    for customer_id, server_name, role in SERVERS:
        all_lines.extend(
            _build_server_metrics(customer_id, server_name, role, ts_ms)
        )
    return "\n".join(all_lines) + "\n"


# ---------------------------------------------------------------------------
# Push loop
# ---------------------------------------------------------------------------


def push_metrics(payload: str) -> None:
    url = f"{VM_URL}/api/v1/import/prometheus"
    data = payload.encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "text/plain"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        _ = resp.read()


def main() -> None:
    print(
        f"[alloy-simulator] Starting — target={VM_URL}, "
        f"interval={PUSH_INTERVAL}s, servers={len(SERVERS)}",
        flush=True,
    )
    while True:
        payload = build_all_metrics()
        try:
            push_metrics(payload)
            print(
                f"[alloy-simulator] Pushed {len(SERVERS)} servers "
                f"({len(payload)} bytes)",
                flush=True,
            )
        except (urllib.error.URLError, OSError) as exc:
            print(f"[alloy-simulator] Push failed: {exc}", flush=True)
        time.sleep(PUSH_INTERVAL)


if __name__ == "__main__":
    main()
