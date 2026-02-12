# ============================================
# MSP Monitoring - Mock CSP Metrics Exporter
# ============================================
# 로컬 테스트용: CSP Collector 대신 더미 메트릭 생성

FROM python:3.11-alpine

WORKDIR /app
COPY main.py .

EXPOSE 9091

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:9091/healthz || exit 1

CMD ["python", "-u", "main.py"]
