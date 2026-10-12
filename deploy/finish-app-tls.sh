#!/usr/bin/env bash
set -Eeuo pipefail
umask 027
DOMAIN="app.vesta-cosmetics.ir"
CONF="/srv/vestacutella/repo/infra/nginx.conf"
CERTS="/srv/vestacutella/runtime/certs"
BACKUPS="/srv/vestaapp/backups"
CERT="$CERTS/app-vesta/fullchain.pem"
KEY="$CERTS/app-vesta/privkey.pem"
FAILED=0
CHANGED=0

rollback(){
  local code=$?
  if [ "$code" -ne 0 ] && [ "$CHANGED" = 1 ]; then
    echo "FINAL SSL UPDATE FAILED: restoring the previous Nginx vhost safely."
    cat "$BACKUP" > "$CONF"
    docker exec vc-nginx nginx -t && docker exec vc-nginx nginx -s reload || true
    for h in vesta-cosmetics.ir cutellashop.ir; do
      curl --noproxy '*' -sS -o /dev/null -w "RESTORED $h HTTP=%{http_code}\n" --max-time 12 --resolve "$h:443:127.0.0.1" "https://$h/" || true
    done
  fi
}
trap rollback EXIT
test "$(id -u)" -eq 0
test -s "$CERT" && test -s "$KEY" && test -s "$CONF"
openssl x509 -in "$CERT" -noout -checkhost "$DOMAIN" | grep -Fq "does match certificate"
for container in vc-nginx vc-vesta vc-cutella vc-db-vesta vc-db-cutella vc-vestaapp-web vc-vestaapp-market; do
  test "$(docker inspect -f '{{.State.Status}}' "$container")" = running
done
test "$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' vc-nginx)" = infra
docker exec vc-nginx nginx -t
# Verify the mounted configuration is the same inode as the host file.
host_inode="$(stat -c %i "$CONF")"
container_inode="$(docker exec vc-nginx stat -c %i /etc/nginx/nginx.conf)"
test "$host_inode" = "$container_inode" || { echo "STALE BIND MOUNT: refusing to change configuration"; exit 1; }
mkdir -p "$BACKUPS"
BACKUP="$BACKUPS/app-ssl-before-$(date -u +%Y%m%dT%H%M%SZ).conf"
cp -p "$CONF" "$BACKUP"
python3 - "$CONF" "$BACKUPS/app-ssl-candidate.conf" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2])
d=p.read_text()
b='    # BEGIN VESTAAPP ISOLATED ROUTING'
e='    # END VESTAAPP ISOLATED ROUTING'
assert d.count(b)==1 and d.count(e)==1, 'Missing or duplicate app-vhost markers'
start=d.index(b); stop=d.index(e,start)+len(e)
app=d[start:stop]
assert app.count('server_name app.vesta-cosmetics.ir;')==2
for f in ['fullchain.pem','privkey.pem']:
    old=f'/etc/nginx/certs/vesta/{f}'
    new=f'/etc/nginx/certs/app-vesta/{f}'
    assert app.count(old)==1, f'Expected one old TLS path for {f}'
    app=app.replace(old,new,1)
old='    return 301 https://app.vesta-cosmetics.ir$request_uri;'
assert app.count(old)==1
app=app.replace(old,'''    location ^~ /.well-known/acme-challenge/ {
      proxy_pass http://vc-vestaapp-web:8080;
      proxy_set_header Host $host;
    }
    location / { return 301 https://app.vesta-cosmetics.ir$request_uri; }''',1)
target.write_text(d[:start]+app+d[stop:])
PY
# Validate exact replacement config outside the live Nginx container.
docker run --rm --network vestacutella-backend \
  -v "$BACKUPS/app-ssl-candidate.conf:/etc/nginx/nginx.conf:ro" \
  -v "$CERTS:/etc/nginx/certs:ro" \
  nginx:1.27-alpine nginx -t
# Preserve inode of file bind-mounted into vc-nginx, so NO container recreation needed.
cat "$BACKUPS/app-ssl-candidate.conf" > "$CONF"
CHANGED=1
docker exec vc-nginx nginx -t
docker exec vc-nginx nginx -s reload
# Reload is asynchronous: old nginx workers can briefly present the previous certificate.
success=0
for i in $(seq 1 35); do
  if curl --noproxy '*' --fail --silent --show-error --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" -o /tmp/vestaapp-ssl-index.html 2>/tmp/vestaapp-ssl-err; then
    if grep -q 'وستالند' /tmp/vestaapp-ssl-index.html; then
      success=1
      echo "TLS + app homepage verified on retry $i."
      break
    fi
  fi
  sleep 1
done
if [ "$success" != 1 ]; then
  cat /tmp/vestaapp-ssl-err || true
  echo "App TLS not ready within 35 seconds."
  exit 1
fi
curl --noproxy '*' --fail --silent --show-error --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/market/health" | grep -q '"ok":true'
for h in vesta-cosmetics.ir cutellashop.ir; do
  code="$(curl --noproxy '*' -sS --max-time 20 -o /dev/null --resolve "$h:443:127.0.0.1" -w '%{http_code}' "https://$h/")"
  echo "$h HTTP=$code"
  [[ "$code" =~ ^(200|301|302)$ ]] || exit 1
done
for c in vc-vesta vc-cutella vc-db-vesta vc-db-cutella; do
  docker inspect -f '{{.Name}} {{.State.Status}}' "$c"
done
CHANGED=0
trap - EXIT
echo "SUCCESS: App hostname TLS and storefront health verified. Existing storefront containers NOT restarted."
