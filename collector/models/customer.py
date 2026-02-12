"""고객 정의 모델"""

from dataclasses import dataclass, field


@dataclass
class Customer:
    """관리 대상 고객"""

    id: str
    name: str
    csp: str  # aws, azure, gcp, ncp
    environment: str = "production"
    regions: list[str] = field(default_factory=list)
    collect: list[str] = field(default_factory=lambda: ["ec2", "cost"])
    credentials: dict[str, str] = field(default_factory=dict)
