"""Mock CSP Metrics Exporter for MSP Monitoring.

Replaces the real CSP collector during local testing.
Serves Prometheus-format metrics on port 9091.
"""

import math
import random
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# ---------------------------------------------------------------------------
# Mock customer definitions
# ---------------------------------------------------------------------------

CUSTOMERS = [
    {
        "customer_id": "alpha",
        "name": "Alpha Corp",
        "csp": "aws",
        "region": "ap-northeast-2",
        "servers": [
            {"resource_id": "web-01", "instance_type": "t3.medium"},
            {"resource_id": "web-02", "instance_type": "t3.medium"},
            {"resource_id": "db-01", "instance_type": "r5.large"},
        ],
        "cpu_base": 35,
        "cpu_amp": 15,
        "mem_base": 50,
        "mem_amp": 10,
        "cost_scale": 1.0,
    },
    {
        "customer_id": "beta",
        "name": "Beta Inc",
        "csp": "aws",
        "region": "ap-northeast-2",
        "servers": [
            {"resource_id": "app-01", "instance_type": "c5.xlarge"},
            {"resource_id": "app-02", "instance_type": "c5.xlarge"},
        ],
        "cpu_base": 78,
        "cpu_amp": 7,
        "mem_base": 65,
        "mem_amp": 10,
        "cost_scale": 1.4,
    },
    {
        "customer_id": "gamma",
        "name": "Gamma LLC",
        "csp": "aws",
        "region": "us-east-1",
        "servers": [
            {"resource_id": "web-01", "instance_type": "m5.xlarge"},
            {"resource_id": "api-01", "instance_type": "m5.xlarge"},
            {"resource_id": "db-01", "instance_type": "r5.2xlarge"},
            {"resource_id": "batch-01", "instance_type": "c5.2xlarge"},
        ],
        "cpu_base": 45,
        "cpu_amp": 20,
        "mem_base": 60,
        "mem_amp": 15,
        "cost_scale": 3.2,
    },
    {
        "customer_id": "delta",
        "name": "Delta Co",
        "csp": "aws",
        "region": "ap-northeast-2",
        "servers": [
            {"resource_id": "web-01", "instance_type": "t3.small"},
            {"resource_id": "db-01", "instance_type": "t3.medium"},
        ],
        "cpu_base": 25,
        "cpu_amp": 10,
        "mem_base": 40,
        "mem_amp": 8,
        "cost_scale": 0.5,
    },
    {
        "customer_id": "epsilon",
        "name": "Epsilon Ltd",
        "csp": "aws",
        "region": "ap-northeast-2",
        "servers": [
            {"resource_id": "web-01", "instance_type": "t3.medium"},
            {"resource_id": "web-02", "instance_type": "t3.medium"},
            {"resource_id": "db-01", "instance_type": "r5.large"},
        ],
        "cpu_base": 12,
        "cpu_amp": 5,
        "mem_base": 20,
        "mem_amp": 5,
        "cost_scale": 1.1,
    },
]

# Base daily costs per AWS service (USD)
SERVICE_COSTS = {
    "AmazonEC2": 8.50,
    "AmazonS3": 2.30,
    "AmazonRDS": 6.80,
}

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _wave(base: float, amplitude: float, period_minutes: float = 60.0) -> float:
    """Return a realistic time-varying value using sine wave + noise."""
    t = time.time()
    wave = math.sin(2 * math.pi * t / (period_minutes * 60))
    noise = random.uniform(-amplitude * 0.2, amplitude * 0.2)
    return max(0.0, base + amplitude * wave + noise)


# ---------------------------------------------------------------------------
# Metric generation
# ---------------------------------------------------------------------------


def _fmt(name: str, labels: dict, value: float) -> str:
    """Format a single Prometheus metric line."""
    label_str = ",".join(f'{k}="{v}"' for k, v in labels.items())
    return f"{name}{{{label_str}}} {value:.4f}"


def generate_metrics() -> str:
    """Generate all Prometheus metrics for every mock customer."""
    lines: list[str] = []

    for cust in CUSTOMERS:
        cid = cust["customer_id"]
        csp = cust["csp"]
        region = cust["region"]
        servers = cust["servers"]

        # --- CSP Resource Metrics (per server) ---
        for srv in servers:
            rid = srv["resource_id"]
            itype = srv["instance_type"]

            base_labels = {
                "customer_id": cid,
                "csp": csp,
                "region": region,
                "resource_id": rid,
            }
            full_labels = {**base_labels, "instance_type": itype}

            # CPU
            cpu = _wave(cust["cpu_base"], cust["cpu_amp"], period_minutes=45)
            cpu = min(100.0, max(0.0, cpu))
            lines.append(_fmt("msp_csp_cpu_utilization", full_labels, cpu))

            # Memory
            mem = _wave(cust["mem_base"], cust["mem_amp"], period_minutes=90)
            mem = min(100.0, max(0.0, mem))
            lines.append(_fmt("msp_csp_memory_utilization", base_labels, mem))

            # Network
            net_in = _wave(5_000_000, 2_000_000, period_minutes=30)
            lines.append(_fmt("msp_csp_network_in_bytes", base_labels, net_in))
            net_out = _wave(3_000_000, 1_500_000, period_minutes=30)
            lines.append(_fmt("msp_csp_network_out_bytes", base_labels, net_out))

            # Disk
            disk_r = _wave(1_000_000, 500_000, period_minutes=120)
            lines.append(_fmt("msp_csp_disk_read_bytes", base_labels, disk_r))
            disk_w = _wave(800_000, 400_000, period_minutes=120)
            lines.append(_fmt("msp_csp_disk_write_bytes", base_labels, disk_w))

        # --- Instance counts ---
        cust_labels = {"customer_id": cid, "csp": csp}
        total_instances = len(servers)
        # Epsilon has unused resources: one server is stopped
        if cid == "epsilon":
            running = total_instances - 1
        else:
            running = total_instances

        lines.append(_fmt("msp_csp_instance_count", cust_labels, float(total_instances)))
        lines.append(_fmt("msp_csp_instance_running", cust_labels, float(running)))

        # --- Cost Metrics ---
        monthly_total = 0.0
        day_of_month = time.localtime().tm_mday

        for service, base_daily in SERVICE_COSTS.items():
            cost_labels = {"customer_id": cid, "csp": csp, "service": service}

            daily = _wave(
                base_daily * cust["cost_scale"],
                base_daily * cust["cost_scale"] * 0.1,
                period_minutes=1440,
            )
            lines.append(_fmt("msp_csp_cost_daily", cost_labels, daily))

            # Monthly accumulated = daily average * days elapsed
            monthly = daily * day_of_month
            lines.append(_fmt("msp_csp_cost_monthly", cost_labels, monthly))
            monthly_total += monthly

        lines.append(_fmt("msp_csp_cost_monthly_total", cust_labels, monthly_total))

        # --- Collector Health ---
        lines.append(_fmt("msp_collector_up", cust_labels, 1.0))
        scrape_dur = _wave(0.8, 0.3, period_minutes=10)
        lines.append(
            _fmt("msp_collector_last_scrape_duration_seconds", cust_labels, scrape_dur)
        )

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# HTTP Handler
# ---------------------------------------------------------------------------


class _QuietHandler(BaseHTTPRequestHandler):
    """HTTP handler that suppresses per-request log messages."""

    def log_message(self, format, *args):  # noqa: A002
        """Suppress default request logging."""
        pass

    def do_GET(self):
        if self.path == "/metrics":
            body = generate_metrics().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/healthz":
            body = b"ok"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            body = b"Not Found"
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

PORT = 9091
BIND = "0.0.0.0"

if __name__ == "__main__":
    print(f"Mock CSP metrics exporter starting on {BIND}:{PORT}", flush=True)
    print(f"  /metrics  - Prometheus metrics for {len(CUSTOMERS)} customers", flush=True)
    print(f"  /healthz  - Health check endpoint", flush=True)

    server = HTTPServer((BIND, PORT), _QuietHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.", flush=True)
        server.server_close()
