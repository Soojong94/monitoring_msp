"""CSP 프로바이더 추상 베이스 클래스"""

from abc import ABC, abstractmethod
from typing import AsyncIterator

from collector.models.metric import Metric


class BaseProvider(ABC):
    """모든 CSP 프로바이더의 기본 클래스

    각 CSP(AWS, Azure, GCP, NCP)는 이 클래스를 상속하여
    collect_metrics, collect_cost, health_check를 구현한다.
    """

    def __init__(self, customer_id: str, config: dict) -> None:
        self.customer_id = customer_id
        self.config = config

    @abstractmethod
    async def collect_metrics(self) -> AsyncIterator[Metric]:
        """CSP 리소스 메트릭 수집 (CPU, Network, Disk 등)"""
        ...

    @abstractmethod
    async def collect_cost(self) -> AsyncIterator[Metric]:
        """CSP 비용 데이터 수집"""
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """CSP API 연결 상태 확인"""
        ...
