#!/usr/bin/env bash
# Activate Vestaapp TLS using HTTP-01 while only recreating the shared nginx proxy.
set -Eeuo pipefail
umask 027
DOMAIN=app.vesta-cosmetics.ir
EXPECT_IP=193.177.242.64
BASE=/srv/vestaapp
INFRA=/srv/vestacutella
CONF=$INFRA/repo/infra/nginx.conf
INFRA_COMPOSE=$INFRA/repo/infra/docker-compose.yml
APP_COMPOSE=$BASE/current/deploy/compose.yml
APP_NGINX=$BASE/current/deploy/app-nginx.conf
TMP=/tmp/vestaapp-activation
CERTS=$INFRA/runtime/certs
LE=$BASE/data/letsencrypt
WEBROOT=$BASE/data/acme
CERT_NAME=app.vesta-cosmetics.ir
BACKUP=$BASE/backups/nginx-before-app-$(date -u +%Y%m%dT%H%M%SZ).conf
stage=precheck
rollback_needed=0
rollback(){
  code=$?
  if [[ $code -ne 0 && $rollback_needed -eq 1 ]]; then
    set +e
    echo "Activation failed at stage $stage. Restoring pre-activation store Nginx configuration."
    cat "$BACKUP" > "$CONF"
    docker exec vc-nginx nginx -t && docker exec vc-nginx nginx -s reload
    if [[ $? -ne 0 ]]; then
      docker compose -p infra -f "$INFRA_COMPOSE" up -d --no-deps --no-build --force-recreate nginx
    fi
    for c in vc-vesta vc-cutella vc-db-vesta vc-db-cutella; do docker inspect -f '{{.Name}} {{.State.Status}}' "$c" || true; done
    echo "Store Nginx original configuration restored."
  fi
}
trap rollback EXIT
[[ $(id -u) -eq 0 ]]
[[ -s "$CONF" && -s "$INFRA_COMPOSE" && -s "$APP_COMPOSE" && -s "$APP_NGINX" ]]
[[ -s "$TMP/app-nginx.conf" && -s "$TMP/compose.yml" ]]
[[ "$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}')" == "$EXPECT_IP" ]]
[[ "$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' vc-nginx)" == "infra" ]]
for c in vc-nginx vc-vesta vc-cutella vc-db-vesta vc-db-cutella vc-vestaapp-web vc-vestaapp-market; do
  [[ "$(docker inspect -f '{{.State.Status}}' "$c")" == "running" ]]
done
docker compose -p infra -f "$INFRA_COMPOSE" config -q
mkdir -p "$BASE/backups" "$LE" "$WEBROOT/.well-known/acme-challenge" "$TMP"
chmod 755 "$WEBROOT" "$WEBROOT/.well-known" "$WEBROOT/.well-known/acme-challenge"
cp -p "$CONF" "$BACKUP"
cp -p "$APP_COMPOSE" "$BASE/backups/compose-before-app-acme-$(date -u +%Y%m%dT%H%M%SZ).yml"
cp -p "$APP_NGINX" "$BASE/backups/app-nginx-before-acme-$(date -u +%Y%m%dT%H%M%SZ).conf"
echo "Preflight: storefront and databases running; existing config backed up."
# Pull before touching the shared proxy so download failures have no effect on stores.
stage=certbot-image
docker pull certbot/certbot:latest
stage=app-acme-route
cat "$TMP/app-nginx.conf" > "$APP_NGINX"
cat "$TMP/compose.yml" > "$APP_COMPOSE"
docker compose -p vestaapp -f "$APP_COMPOSE" config -q
docker compose -p vestaapp -f "$APP_COMPOSE" up -d --no-deps --no-build --force-recreate app
token="vestaapp-probe-$(date -u +%s)-$$"
printf '%s\n' "$token" > "$WEBROOT/.well-known/acme-challenge/$token"
# The activation umask is 027: nginx runs as an unprivileged user and cannot
# read a 0640 token. HTTP-01 challenge files are public and must be 0644.
chmod 644 "$WEBROOT/.well-known/acme-challenge/$token"
[[ "$(docker exec vc-vestaapp-web wget -qO- "http://127.0.0.1:8080/.well-known/acme-challenge/$token")" == "$token" ]]
echo "Isolated Vestaapp ACME webroot responds correctly."
stage=candidate
python3 - "$CONF" "$TMP/candidate-nginx.conf" <<'PY'
import pathlib,sys
path=pathlib.Path(sys.argv[1]); candidate=pathlib.Path(sys.argv[2])
data=path.read_text()
begin='    # BEGIN VESTAAPP ISOLATED ROUTING'
end='    # END VESTAAPP ISOLATED ROUTING'
assert data.count(begin)==1 and data.count(end)==1, "App routing marker missing/ambiguous"
start=data.index(begin); stop=data.index(end,start)+len(end)
app=data[start:stop]
old='    return 301 https://app.vesta-cosmetics.ir$request_uri;'
assert app.count(old)==1 and app.count('ssl_certificate /etc/nginx/certs/vesta/fullchain.pem;')==1
new='''    location ^~ /.well-known/acme-challenge/ {
      proxy_pass http://vc-vestaapp-web:8080;
      proxy_set_header Host $host;
    }
    location / {
      return 301 https://app.vesta-cosmetics.ir$request_uri;
    }'''
app=app.replace(old,new,1)
candidate.write_text(data[:start]+app+data[stop:])
PY
docker run --rm --network vestacutella-backend \
  -v "$TMP/candidate-nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$CERTS:/etc/nginx/certs:ro" \
  nginx:1.27-alpine nginx -t
echo "Candidate proxy config passed isolated Nginx validation."
stage=nginx-recreate
rollback_needed=1
# In-place write preserves original host inode, then a SINGLE nginx-only compose recreate
# is necessary to replace the former stale bind mount. Do not recreate WordPress or DB.
cat "$TMP/candidate-nginx.conf" > "$CONF"
docker compose -p infra -f "$INFRA_COMPOSE" up -d --no-deps --no-build --force-recreate nginx
docker exec vc-nginx nginx -t
for c in vc-vesta vc-cutella vc-db-vesta vc-db-cutella; do
  [[ "$(docker inspect -f '{{.State.Status}}' "$c")" == "running" ]]
done
for host in cutellashop.ir vesta-cosmetics.ir; do
  code="$(curl -sS -o /dev/null --max-time 15 --resolve "$host:443:127.0.0.1" -w '%{http_code}' "https://$host/")"
  [[ "$code" == "200" || "$code" == "301" || "$code" == "302" ]] || { echo "Store $host unhealthy ($code)" >&2; exit 1; }
  echo "Store $host responds HTTP $code after Nginx-only recreate."
done
check="$(curl -fsS --max-time 12 --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/.well-known/acme-challenge/$token")"
[[ "$check" == "$token" ]]
rm -f "$WEBROOT/.well-known/acme-challenge/$token"
echo "Public-route ACME challenge works through Nginx."
stage=cert-issue
docker run --rm \
  -v "$WEBROOT:/var/www/acme" \
  -v "$LE:/etc/letsencrypt" \
  certbot/certbot:latest certonly --webroot \
  --webroot-path /var/www/acme \
  --cert-name "$CERT_NAME" \
  -d "$DOMAIN" \
  --non-interactive --agree-tos --register-unsafely-without-email \
  --keep-until-expiring --preferred-challenges http
CRT="$LE/live/$CERT_NAME/fullchain.pem"
KEY="$LE/live/$CERT_NAME/privkey.pem"
[[ -s "$CRT" && -s "$KEY" ]]
openssl x509 -in "$CRT" -noout -checkhost "$DOMAIN" | grep -Fq "does match certificate"
mkdir -p "$CERTS/app-vesta"
install -m 644 "$CRT" "$CERTS/app-vesta/fullchain.pem"
install -m 600 "$KEY" "$CERTS/app-vesta/privkey.pem"
stage=tls-config
python3 - "$CONF" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1])
d=p.read_text()
begin='    # BEGIN VESTAAPP ISOLATED ROUTING'
end='    # END VESTAAPP ISOLATED ROUTING'
start=d.index(begin); stop=d.index(end,start)+len(end)
app=d[start:stop]
for name in ['fullchain.pem','privkey.pem']:
    old=f'/etc/nginx/certs/vesta/{name}'
    new=f'/etc/nginx/certs/app-vesta/{name}'
    assert app.count(old)==1
    app=app.replace(old,new,1)
# Write in-place so Nginx mount sees the new config, never os.replace.
with p.open('w') as f:f.write(d[:start]+app+d[stop:])
PY
docker exec vc-nginx nginx -t
docker exec vc-nginx nginx -s reload
stage=verify
# Nginx must present the new certificate; never bypass certificate verification.
curl -fsS --max-time 20 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" | grep -q 'وستالند'
curl -fsS --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/market/health" | grep -q '"ok":true'
for host in cutellashop.ir vesta-cosmetics.ir; do
  code="$(curl -sS -o /dev/null --max-time 15 --resolve "$host:443:127.0.0.1" -w '%{http_code}' "https://$host/")"
  [[ "$code" == "200" || "$code" == "301" || "$code" == "302" ]] || exit 1
  echo "Verified store $host HTTP $code."
done
echo '=== Existing store containers (should be unchanged) ==='
for c in vc-vesta vc-cutella vc-db-vesta vc-db-cutella; do docker inspect -f '{{.Name}} {{.Id}} {{.State.Status}}' "$c"; done
rollback_needed=0
trap - EXIT
echo "SUCCESS: app.vesta-cosmetics.ir HTTPS certificate and isolated app are live."
