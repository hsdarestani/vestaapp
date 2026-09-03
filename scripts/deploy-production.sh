#!/usr/bin/env bash
set -euo pipefail

DOMAIN="vestaland.smarbiz.sbs"
ROOT="/var/www/$DOMAIN"
API_PORT="8765"
MARKET_PORT="8766"
PAYMENT_PORT="8767"
PACKAGE="/tmp/vestaland-site.tgz"

if ! command -v nginx >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx certbot openssl python3
  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl start nginx
fi

DETECTED="$(nginx -T 2>/dev/null | awk -v d="$DOMAIN" '$0 ~ "server_name[[:space:]].*" d {hit=1} hit && $1=="root" {gsub(";","",$2); print $2; exit}' || true)"
[ -n "$DETECTED" ] && ROOT="$DETECTED"

mkdir -p "$ROOT" /var/lib/vestaland /etc/vestaland
tar -xzf "$PACKAGE" -C "$ROOT"
rm -f "$PACKAGE"
rm -f "$ROOT/assets/market-payment-hamoon.js"
chown -R www-data:www-data "$ROOT" /var/lib/vestaland 2>/dev/null || true
find "$ROOT" -type d -exec chmod 755 {} \;
find "$ROOT" -type f -exec chmod 644 {} \;

cat > /etc/systemd/system/vestaland-api.service <<SERVICE
[Unit]
Description=Vestaland Community API V3
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=$ROOT
EnvironmentFile=-/etc/vestaland/bazaar.env
ExecStart=/usr/bin/python3 $ROOT/backend/server_v3.py --host 127.0.0.1 --port $API_PORT --db /var/lib/vestaland/vestaland.db
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SERVICE

cat > /etc/systemd/system/vestaland-market.service <<SERVICE
[Unit]
Description=Vestaland Live WooCommerce Market API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=$ROOT
ExecStart=/usr/bin/python3 $ROOT/backend/market_server.py --host 127.0.0.1 --port $MARKET_PORT
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SERVICE

cat > /etc/systemd/system/vestaland-market-payment.service <<SERVICE
[Unit]
Description=Vestaland Marketplace Payment API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=$ROOT
ExecStart=/usr/bin/python3 $ROOT/backend/market_payment_server.py --host 127.0.0.1 --port $PAYMENT_PORT --db /var/lib/vestaland/market-payments.db
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable vestaland-api.service vestaland-market.service vestaland-market-payment.service >/dev/null 2>&1 || true
systemctl restart vestaland-api.service
systemctl restart vestaland-market.service
systemctl restart vestaland-market-payment.service

for i in $(seq 1 12); do
  API_OK=0; MARKET_OK=0; PAYMENT_OK=0
  curl -fsS --max-time 2 "http://127.0.0.1:$API_PORT/api/v3/health" | grep -q '"ok":true' && API_OK=1 || true
  curl -fsS --max-time 2 "http://127.0.0.1:$MARKET_PORT/api/market/health" | grep -q '"ok":true' && MARKET_OK=1 || true
  curl -fsS --max-time 2 "http://127.0.0.1:$PAYMENT_PORT/api/market-payment/health" | grep -q '"ok":true' && PAYMENT_OK=1 || true
  if [ "$API_OK" = 1 ] && [ "$MARKET_OK" = 1 ] && [ "$PAYMENT_OK" = 1 ]; then
    echo "Vestaland services healthy."
    break
  fi
  if [ "$i" = 12 ]; then
    systemctl status vestaland-api.service vestaland-market.service vestaland-market-payment.service --no-pager || true
    journalctl -u vestaland-api.service -n 80 --no-pager || true
    exit 1
  fi
  sleep 1
done

CONF="/etc/nginx/sites-available/$DOMAIN"
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
CERT_OK=0
if [ -s "$CERT_DIR/fullchain.pem" ] && [ -s "$CERT_DIR/privkey.pem" ]; then
  CERT_OK=1
fi

cat > "$CONF" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    root $ROOT;
    index index.html;

    location /.well-known/acme-challenge/ { root $ROOT; try_files \$uri =404; }
    location /api/market-payment/ {
        proxy_pass http://127.0.0.1:$PAYMENT_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 45s;
        add_header Cache-Control "no-store" always;
    }
    location /api/market/ {
        proxy_pass http://127.0.0.1:$MARKET_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 45s;
        add_header Cache-Control "no-store" always;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:$API_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
        add_header Cache-Control "no-store" always;
    }
    location = /sw.js { add_header Cache-Control "no-cache"; try_files \$uri =404; }
    location = /index.html { add_header Cache-Control "no-cache"; try_files \$uri =404; }
    location / { try_files \$uri \$uri/ /index.html; }
    location ~* \\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|webmanifest)$ {
        expires -1;
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
        try_files \$uri =404;
    }
}
NGINX

ln -sfn "$CONF" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

if [ "$CERT_OK" -ne 1 ]; then
  if certbot certonly --webroot -w "$ROOT" -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email; then
    CERT_OK=1
  fi
fi

if [ "$CERT_OK" -eq 1 ]; then
  CERT="$CERT_DIR/fullchain.pem"
  KEY="$CERT_DIR/privkey.pem"
else
  CERT="/etc/ssl/certs/$DOMAIN.crt"
  KEY="/etc/ssl/private/$DOMAIN.key"
  if [ ! -s "$CERT" ] || [ ! -s "$KEY" ]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 365 -keyout "$KEY" -out "$CERT" -subj "/CN=$DOMAIN" >/dev/null 2>&1
  fi
fi

cat >> "$CONF" <<NGINX

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $DOMAIN;
    root $ROOT;
    index index.html;
    ssl_certificate $CERT;
    ssl_certificate_key $KEY;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;

    location /api/market-payment/ {
        proxy_pass http://127.0.0.1:$PAYMENT_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 45s;
        add_header Cache-Control "no-store" always;
    }
    location /api/market/ {
        proxy_pass http://127.0.0.1:$MARKET_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 45s;
        add_header Cache-Control "no-store" always;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:$API_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
        add_header Cache-Control "no-store" always;
    }
    location = /sw.js { add_header Cache-Control "no-cache"; try_files \$uri =404; }
    location = /index.html { add_header Cache-Control "no-cache"; try_files \$uri =404; }
    location / { try_files \$uri \$uri/ /index.html; }
    location ~* \\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|webmanifest)$ {
        expires -1;
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
        try_files \$uri =404;
    }
}
NGINX

nginx -t
systemctl reload nginx

echo "API V3: $(curl -fsS http://127.0.0.1:$API_PORT/api/v3/health)"
echo "Market: $(curl -fsS http://127.0.0.1:$MARKET_PORT/api/market/health)"
echo "Market payment: $(curl -fsS http://127.0.0.1:$PAYMENT_PORT/api/market-payment/health)"
