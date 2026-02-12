# ============================================
# MSP Monitoring - Grafana (Dashboard Baked)
# ============================================

FROM grafana/grafana:10.4.0

# 프로비저닝 설정 bake
COPY config/grafana/provisioning/ /etc/grafana/provisioning/

# 대시보드 JSON bake
COPY config/grafana/dashboards/ /var/lib/grafana/dashboards/

# 기본 설정
ENV GF_SECURITY_ADMIN_USER=admin
ENV GF_SECURITY_ADMIN_PASSWORD=changeme
ENV GF_USERS_ALLOW_SIGN_UP=false
ENV GF_AUTH_ANONYMOUS_ENABLED=false
ENV GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH=/var/lib/grafana/dashboards/msp-overview.json

EXPOSE 3000
