"""MSP Multi-CSP Collector - Entrypoint

Phase 1: /metrics, /healthz 엔드포인트만 제공 (실제 수집은 mock이 대체)
Phase 2: 실제 CSP API 연동 + 주기적 수집 스케줄러
"""

import asyncio
import logging

from aiohttp import web

from collector.config import LOG_LEVEL, METRICS_PORT

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


async def handle_healthz(request: web.Request) -> web.Response:
    return web.Response(text="ok")


async def handle_metrics(request: web.Request) -> web.Response:
    # Phase 2: 실제 수집된 메트릭 반환
    # Phase 1: 빈 메트릭 (mock exporter가 대체)
    return web.Response(
        text="# MSP CSP Collector - Phase 2에서 실제 메트릭 제공 예정\n",
        content_type="text/plain",
    )


async def main() -> None:
    app = web.Application()
    app.router.add_get("/healthz", handle_healthz)
    app.router.add_get("/metrics", handle_metrics)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", METRICS_PORT)
    await site.start()

    logger.info("CSP Collector started on port %d", METRICS_PORT)
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
