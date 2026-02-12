# ============================================
# MSP Monitoring - Nginx (Auth Baked)
# ============================================

FROM nginx:1.25-alpine

ARG BASIC_AUTH_USER=admin
ARG BASIC_AUTH_PASSWORD=changeme

# htpasswd 생성 후 빌드 도구 제거
RUN apk add --no-cache apache2-utils \
    && htpasswd -bc /etc/nginx/.htpasswd "${BASIC_AUTH_USER}" "${BASIC_AUTH_PASSWORD}" \
    && apk del apache2-utils

# Nginx 설정 bake
COPY config/nginx/nginx.conf /etc/nginx/nginx.conf
RUN rm -f /etc/nginx/conf.d/default.conf

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:80/health || exit 1
