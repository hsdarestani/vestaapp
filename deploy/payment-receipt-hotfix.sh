#!/usr/bin/env bash
# Scoped billing UI and private receipt API update. No storefront/DB/ingress changes.
set -Eeuo pipefail
umask 027
BASE=/srv/vestaapp
RELEASE="$(readlink -f "$BASE/current")"
[[ "$RELEASE" == "$BASE"/releases/* ]] || { echo 'Unexpected app release path'; exit 1; }
ARCHIVE=/tmp/vestaland-payment-receipt-hotfix.tgz
test -s "$ARCHIVE" && test -s "$BASE/secrets/account.env"
for name in vc-nginx vc-vesta vc-cutella vc-db-vesta vc-db-cutella vc-vestaapp-web vc-vestaapp-market vc-vestaapp-account; do
  test "$(docker inspect -f '{{.State.Status}}' "$name")" = running || { echo "Container preflight failed: $name"; exit 1; }
done
test "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' vc-vestaapp-account)" = vestaapp
STAGE="$(mktemp -d "$BASE/receipt-stage.XXXXXXXX")"
BACKUP="$BASE/backups/receipt-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$BACKUP"
tar -xzf "$ARCHIVE" -C "$STAGE"
FILES='public/index.html public/sw.js public/commerce.js public/commerce.css backend/account_server.py'
for name in $FILES; do
  test -s "$STAGE/$name" && test -s "$RELEASE/$name" || { echo "Missing hotfix asset $name"; exit 1; }
  mkdir -p "$BACKUP/$(dirname "$name")"
  cp -p "$RELEASE/$name" "$BACKUP/$name"
done
grep -q '20261014-receipt1' "$STAGE/public/index.html"
grep -q 'vestaland-receipt-20261014-v1' "$STAGE/public/sw.js"
grep -q 'function paymentSuccessView' "$STAGE/public/commerce.js"
grep -q 'def last_verified_payment' "$STAGE/backend/account_server.py"
changed=0
rollback(){
  code=$?
  if [[ "$code" -ne 0 && "$changed" = 1 ]]; then
    echo 'Rollback: only Vestaland receipt files and account container.'
    for name in $FILES; do
      cp -p "$BACKUP/$name" "$RELEASE/.$(basename "$name").rollback"
      mv -f "$RELEASE/.$(basename "$name").rollback" "$RELEASE/$name"
    done
    docker compose -p vestaapp -f "$RELEASE/deploy/compose.yml" up -d --no-deps --build account || true
  fi
  rm -rf "$STAGE"
}
trap rollback EXIT
for name in $FILES; do
  cp -p "$STAGE/$name" "$RELEASE/.$(basename "$name").release"
  chmod 644 "$RELEASE/.$(basename "$name").release"
  mv -f "$RELEASE/.$(basename "$name").release" "$RELEASE/$name"
done
changed=1
docker compose -p vestaapp -f "$RELEASE/deploy/compose.yml" up -d --no-deps --build account
# Allow isolated account API a short readiness window after Docker recreate.
ready=0
for i in $(seq 1 35); do
  if docker exec vc-vestaapp-account python3 -c "import json,urllib.request; assert json.load(urllib.request.urlopen('http://127.0.0.1:8777/api/account/health',timeout=4))['ok']" >/dev/null 2>&1; then
    ready=1
    echo "Account API healthy after restart (check $i)."
    break
  fi
  sleep 1
done
test "$ready" = 1 || { echo 'Account API did not become healthy within readiness window'; exit 1; }
status=000
for i in $(seq 1 15); do
  status="$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' --max-time 9 --resolve app.vesta-cosmetics.ir:443:127.0.0.1 https://app.vesta-cosmetics.ir/api/account/subscription/latest || true)"
  if [ "$status" = 401 ]; then break; fi
  sleep 1
done
test "$status" = 401 || { echo "New private receipt API not protected or ready, HTTP=$status"; exit 1; }
curl --noproxy '*' -fsS --max-time 12 --resolve app.vesta-cosmetics.ir:443:127.0.0.1 https://app.vesta-cosmetics.ir/ -o /tmp/vestaland-receipt-html
grep -q '20261014-receipt1' /tmp/vestaland-receipt-html
curl --noproxy '*' -fsS --max-time 12 --resolve app.vesta-cosmetics.ir:443:127.0.0.1 'https://app.vesta-cosmetics.ir/commerce.js?v=20261014-receipt1' -o /tmp/vestaland-receipt-js
grep -q 'function paymentSuccessView' /tmp/vestaland-receipt-js
for host in vesta-cosmetics.ir cutellashop.ir; do
  status="$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' --max-time 15 --resolve "$host:443:127.0.0.1" "https://$host/")"
  echo "$host HTTP=$status"
  [[ "$status" = 200 || "$status" = 301 || "$status" = 302 ]] || exit 1
done
for name in vc-vesta vc-cutella vc-db-vesta vc-db-cutella vc-vestaapp-market; do
  test "$(docker inspect -f '{{.State.Status}}' "$name")" = running
done
changed=0
rm -f "$ARCHIVE"
echo 'SUCCESS: Private Zibal receipt confirmation deployed; stores and databases intact.'
