#!/bin/bash
# ============================================
# MSP Monitoring - HTTPS 설정 (Let's Encrypt)
# ============================================
# 사용법: bash scripts/setup-https.sh <도메인> <이메일>
# 예시:   bash scripts/setup-https.sh monitoring.example.com admin@example.com
#
# 사전 조건:
#   - 도메인이 이 서버 IP로 DNS A 레코드 설정되어 있을 것
#   - 포트 80, 443 방화벽 허용
#   - Docker 실행 중, monitoring_msp repo가 ~/monitoring_msp에 있을 것

set -e

DOMAIN="${1:-}"
EMAIL="${2:-}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---- 입력 검증 ----
if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "사용법: $0 <도메인> <이메일>"
    echo "예시:   $0 monitoring.example.com admin@example.com"
    exit 1
fi

cd "$PROJECT_DIR"

echo "================================================"
echo " MSP Monitoring HTTPS 설정"
echo " 도메인 : $DOMAIN"
echo " 이메일 : $EMAIL"
echo "================================================"
echo ""

# ---- 1. 인증서 발급 ----
echo "[1/5] Let's Encrypt 인증서 발급..."

# 현재 nginx는 8880에 바인딩 → 포트 80은 비어 있음, certbot standalone 사용 가능
docker run --rm \
    -v /etc/letsencrypt:/etc/letsencrypt \
    -v /var/log/letsencrypt:/var/log/letsencrypt \
    -p 80:80 \
    certbot/certbot certonly \
    --standalone \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN"

echo "✓ 인증서 발급 완료: /etc/letsencrypt/live/$DOMAIN/"
echo ""

# ---- 2. nginx.conf → HTTPS 버전으로 교체 ----
echo "[2/5] nginx.conf 업데이트 (HTTP→HTTPS 리다이렉트 + SSL)..."

cat > config/nginx/nginx.conf << NGINXEOF
# ============================================
# MSP Monitoring - Nginx Configuration (HTTPS)
# ============================================

worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 256;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format main '\$remote_addr - \$remote_user [\$time_local] '
                    '"\$request" \$status \$body_bytes_sent '
                    '"\$http_referer" "\$http_user_agent"';
    access_log /var/log/nginx/access.log main;

    sendfile    on;
    keepalive_timeout 65;

    gzip on;
    gzip_types text/plain application/json application/javascript text/css;
    gzip_min_length 1000;

    # 보안 헤더
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Rate limiting
    limit_req_zone \$binary_remote_addr zone=login:10m rate=5r/s;

    upstream grafana {
        server grafana:3000;
    }

    upstream victoriametrics {
        server victoriametrics:8428;
    }

    # -----------------------------------------------
    # HTTP (포트 80)
    # 에이전트 write 엔드포인트는 HTTP 유지 (기존 에이전트 호환)
    # 나머지는 HTTPS 리다이렉트
    # -----------------------------------------------
    server {
        listen 80;
        server_name ${DOMAIN};

        location /health {
            access_log off;
            return 200 '{"status":"ok"}';
            add_header Content-Type application/json;
        }

        location /api/v1/write {
            proxy_pass http://victoriametrics;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            client_max_body_size 10m;
        }

        location /api/v1/import/ {
            proxy_pass http://victoriametrics;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            client_max_body_size 10m;
        }

        location / {
            return 301 https://\$host\$request_uri;
        }
    }

    # -----------------------------------------------
    # HTTPS (포트 443)
    # -----------------------------------------------
    server {
        listen 443 ssl;
        server_name ${DOMAIN};

        ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
        ssl_protocols       TLSv1.2 TLSv1.3;
        ssl_ciphers         HIGH:!aNULL:!MD5;
        ssl_session_cache   shared:SSL:10m;
        ssl_session_timeout 10m;

        location /health {
            access_log off;
            return 200 '{"status":"ok"}';
            add_header Content-Type application/json;
        }

        location /api/v1/write {
            proxy_pass http://victoriametrics;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            client_max_body_size 10m;
        }

        location /api/v1/import/ {
            proxy_pass http://victoriametrics;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            client_max_body_size 10m;
        }

        location / {
            auth_basic "MSP Monitoring - Login Required";
            auth_basic_user_file /etc/nginx/.htpasswd;
            limit_req zone=login burst=10 nodelay;

            proxy_pass http://grafana;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_set_header Authorization "";

            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection "upgrade";

            proxy_connect_timeout 60s;
            proxy_read_timeout 300s;
        }

        location /api/ {
            proxy_pass http://grafana;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_set_header Authorization "";
        }

        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$ {
            proxy_pass http://grafana;
            proxy_set_header Host \$host;
            expires 7d;
            add_header Cache-Control "public, immutable";
        }
    }
}
NGINXEOF

echo "✓ nginx.conf 업데이트 완료"
echo ""

# ---- 3. docker-compose.override.yml 생성 (cert 볼륨 + 포트 80/443) ----
echo "[3/5] docker-compose.override.yml 생성 (인증서 마운트 + 표준 포트)..."

cat > docker-compose.override.yml << OVERRIDEEOF
# HTTPS 인증서 설정 (setup-https.sh 자동 생성 — 수동 편집 금지)
services:
  nginx:
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /etc/letsencrypt:/etc/letsencrypt:ro
OVERRIDEEOF

echo "✓ docker-compose.override.yml 생성 완료"
echo ""

# ---- 4. 인증서 자동 갱신 cron 설정 ----
echo "[4/5] 인증서 자동 갱신 cron 설정 (매월 1일, 15일 03:00)..."

RENEW_SCRIPT="/root/renew-letsencrypt.sh"
cat > "$RENEW_SCRIPT" << RENEWEOF
#!/bin/bash
# Let's Encrypt 인증서 갱신 (cron 실행용)
set -e
cd $PROJECT_DIR

# nginx 중단 → 갱신 → 재빌드 → 시작
docker compose stop nginx

docker run --rm \\
    -v /etc/letsencrypt:/etc/letsencrypt \\
    -v /var/log/letsencrypt:/var/log/letsencrypt \\
    -p 80:80 \\
    certbot/certbot renew --standalone --quiet

docker compose build nginx
docker compose up -d nginx

echo "[\$(date)] 인증서 갱신 완료" >> /var/log/letsencrypt/renew-cron.log
RENEWEOF
chmod +x "$RENEW_SCRIPT"

# 기존 동일 cron 제거 후 등록
(crontab -l 2>/dev/null | grep -v "renew-letsencrypt"; \
 echo "0 3 1,15 * * $RENEW_SCRIPT >> /var/log/letsencrypt/renew-cron.log 2>&1") | crontab -

echo "✓ cron 등록 완료"
echo ""

# ---- 5. nginx 재빌드 및 재시작 ----
echo "[5/5] nginx 재빌드 및 재시작..."

docker compose build nginx
docker compose up -d nginx

echo ""
echo "================================================"
echo " ✅ HTTPS 설정 완료!"
echo "================================================"
echo " 접속 URL : https://$DOMAIN"
echo ""
echo " ⚠ 에이전트 REMOTE_WRITE_URL을 아래로 변경하세요:"
echo "   http://$DOMAIN/api/v1/write  (HTTP 유지 가능)"
echo "   또는"
echo "   https://$DOMAIN/api/v1/write (HTTPS)"
echo "================================================"
