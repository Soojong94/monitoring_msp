# ============================================
# MSP Monitoring - CSP Collector
# ============================================
# 멀티CSP 메트릭 수집기 (AWS, Azure, GCP, NCP)

FROM python:3.11-alpine

WORKDIR /app

COPY collector/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY collector/ .

EXPOSE 9091

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:9091/healthz || exit 1

CMD ["python", "main.py"]
