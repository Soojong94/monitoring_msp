"""통일된 메트릭 모델 (CSP-agnostic)"""

from dataclasses import dataclass, field


@dataclass
class Metric:
    """CSP 종류에 관계없이 동일한 형식의 메트릭"""

    name: str
    value: float
    labels: dict[str, str] = field(default_factory=dict)
    timestamp_ms: int | None = None

    def to_prometheus_line(self) -> str:
        label_str = ",".join(
            f'{k}="{v}"' for k, v in sorted(self.labels.items())
        )
        ts = f" {self.timestamp_ms}" if self.timestamp_ms else ""
        return f"{self.name}{{{label_str}}} {self.value}{ts}"
