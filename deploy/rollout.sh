#!/usr/bin/env bash
# Intentionally never alters Vesta/Cutella containers, databases, or store domains.
set -Eeuo pipefail
umask 027
DOMAIN="app.vesta-cosmetics.ir"
BASE="/srv/vestaapp"
STORE_ROOT="/srv/vestacutella"
NGINX_CONF="$STORE_ROOT/repo/infra/nginx.conf"
PACKAGE="/tmp/vestaapp-release.tgz"
[ "$(id -u)" -eq 0 ] || { echo "ERROR: root required" >&2; exit 1; }
[ -s "$PACKAGE" ] || { echo "ERROR: release package missing" >&2; exit 1; }
[ -s "$NGINX_CONF" ] || { echo "ERROR: store nginx config missing" >&2; exit 1; }
docker network inspect vestacutella-backend >/dev/null
docker inspect vc-nginx >/dev/null
docker inspect vc-vesta >/dev/null
docker inspect vc-cutella >/dev/null

CERT_SOURCE=""
for src in app-vesta vesta; do
  CRT="$STORE_ROOT/runtime/certs/$src/fullchain.pem"
  KEY="$STORE_ROOT/runtime/certs/$src/privkey.pem"
  if [ -s "$CRT" ] && [ -s "$KEY" ] && openssl x509 -in "$CRT" -noout -checkhost "$DOMAIN" >/dev/null 2>&1; then
    CERT_SOURCE="$src"; break
  fi
done
if [ -z "$CERT_SOURCE" ]; then
  echo "SAFE STOP: no origin TLS certificate covers $DOMAIN. Existing stores not touched." >&2
  echo "Install an origin certificate under $STORE_ROOT/runtime/certs/app-vesta/{fullchain.pem,privkey.pem}, then retry." >&2
  exit 8
fi

mkdir -p "$BASE/releases" "$BASE/data/images"
chown -R 10001:10001 "$BASE/data/images"
CURRENT=""
[ ! -L "$BASE/current" ] || CURRENT="$(readlink -f "$BASE/current")"
[ ! -e "$BASE/current" ] || [ -L "$BASE/current" ] || { echo "ERROR: current is not a symlink" >&2; exit 1; }
RELEASE="$BASE/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$RELEASE/public"
tar -xzf "$PACKAGE" -C "$RELEASE"
for asset in index.html styles.css app.js sw.js icon.svg manifest.webmanifest; do
  test -s "$RELEASE/$asset"
  mv "$RELEASE/$asset" "$RELEASE/public/"
done
test -s "$RELEASE/deploy/compose.yml"
test -s "$RELEASE/backend/market_server.py"
ln -s "$RELEASE" "$BASE/current.next"
mv -Tf "$BASE/current.next" "$BASE/current"

rollback_app(){
  echo "Rolling back application symlink" >&2
  if [ -n "$CURRENT" ]; then
    ln -sfn "$CURRENT" "$BASE/current"
    docker compose -f "$BASE/current/deploy/compose.yml" up -d --build --force-recreate || true
  else
    rm -f "$BASE/current"
    docker rm -f vc-vestaapp-web vc-vestaapp-market >/dev/null 2>&1 || true
  fi
}
if ! docker compose -f "$BASE/current/deploy/compose.yml" up -d --build --force-recreate; then
  rollback_app
  exit 1
fi
if ! docker exec vc-vestaapp-web wget -qO- http://127.0.0.1:8080/ | grep -q 'وستالند'; then
  rollback_app
  echo "ERROR: application HTTP check failed" >&2
  exit 1
fi
if ! docker exec vc-vestaapp-market python3 -c "import urllib.request; assert b'ok' in urllib.request.urlopen('http://127.0.0.1:8766/api/market/health',timeout=5).read()"; then
  rollback_app
  echo "ERROR: market API check failed" >&2
  exit 1
fi

BACKUP="$NGINX_CONF.vestaapp.$(date -u +%Y%m%dT%H%M%S).bak"
cp -p "$NGINX_CONF" "$BACKUP"
export NGINX_CONF CERT_SOURCE
python3 - <<'PY'
import os,pathlib
path=pathlib.Path(os.environ['NGINX_CONF'])
source=os.environ['CERT_SOURCE']
data=path.read_text()
begin='    # BEGIN VESTAAPP ISOLATED ROUTING'
end='    # END VESTAAPP ISOLATED ROUTING'
if begin in data and end in data:
    first=data.index(begin)
    last=data.index(end,first)+len(end)
    data=data[:first]+data[last:]
elif begin in data or end in data:
    raise SystemExit('Unbalanced Vestaapp markers; refusing edit')
pos=data.rfind('}')
if pos<0:raise SystemExit('Invalid nginx.conf')
block='''    # BEGIN VESTAAPP ISOLATED ROUTING
  server {
    listen 80;
    server_name app.vesta-cosmetics.ir;
    return 301 https://app.vesta-cosmetics.ir$request_uri;
  }
  server {
    listen 443 ssl;
    http2 on;
    server_name app.vesta-cosmetics.ir;
    ssl_certificate /etc/nginx/certs/SOURCE/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/SOURCE/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    location / {
      proxy_pass http://vc-vestaapp-web:8080;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $http_cf_connecting_ip;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto https;
      proxy_read_timeout 90s;
    }
  }
    # END VESTAAPP ISOLATED ROUTING
'''.replace('/SOURCE/','/'+source+'/')
path.write_text(data[:pos].rstrip()+'\n'+block+'\n'+data[pos:])
PY

if ! docker exec vc-nginx nginx -t; then
  cp -p "$BACKUP" "$NGINX_CONF"
  docker exec vc-nginx nginx -t || true
  rollback_app
  echo "ERROR: nginx check failed; store routing restored" >&2
  exit 1
fi
if ! docker exec vc-nginx nginx -s reload; then
  cp -p "$BACKUP" "$NGINX_CONF"
  docker exec vc-nginx nginx -s reload || true
  rollback_app
  exit 1
fi
rm -f "$PACKAGE"
echo "App isolated deployment complete: $DOMAIN"
echo "Existing Vesta and Cutella containers have NOT been restarted."
