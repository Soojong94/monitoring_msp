"""AWS CloudWatch + Cost Explorer 프로바이더

Phase 2에서 실제 boto3 연동 구현 예정.
현재는 구조만 준비.
"""

from typing import AsyncIterator

from collector.models.metric import Metric
from collector.providers.base import BaseProvider


class AWSProvider(BaseProvider):
    """AWS CloudWatch + Cost Explorer 메트릭 수집"""

    async def collect_metrics(self) -> AsyncIterator[Metric]:
        # Phase 2: boto3 CloudWatch GetMetricData
        # EC2 CPU, Network, Disk, StatusCheck
        # RDS Connections, CPU, FreeableMemory
        # Lambda Invocations, Errors, Duration
        raise NotImplementedError("Phase 2에서 구현 예정")
        yield  # type: ignore[misc]

    async def collect_cost(self) -> AsyncIterator[Metric]:
        # Phase 2: boto3 Cost Explorer GetCostAndUsage
        raise NotImplementedError("Phase 2에서 구현 예정")
        yield  # type: ignore[misc]

    async def health_check(self) -> bool:
        # Phase 2: boto3 STS GetCallerIdentity
        return False
