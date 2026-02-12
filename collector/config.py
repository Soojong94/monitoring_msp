"""CSP Collector 설정"""

import os


VM_URL: str = os.environ.get("VM_URL", "http://victoriametrics:8428")
COLLECTION_INTERVAL: int = int(os.environ.get("COLLECTION_INTERVAL", "300"))
LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "INFO")
METRICS_PORT: int = int(os.environ.get("METRICS_PORT", "9091"))
