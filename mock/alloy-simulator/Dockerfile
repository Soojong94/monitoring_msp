# ============================================
# MSP Monitoring - Mock Alloy Agent Simulator
# ============================================
# 로컬 테스트용: Grafana Alloy 에이전트를 시뮬레이션하여
# node_exporter 스타일 메트릭을 VictoriaMetrics에 push

FROM python:3.11-alpine

WORKDIR /app
COPY main.py .

CMD ["python", "-u", "main.py"]
