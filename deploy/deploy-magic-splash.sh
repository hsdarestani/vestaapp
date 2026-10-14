#!/usr/bin/env bash
# Vestaland magical splash: update ONLY static website files.
# Never restart shared Nginx, WooCommerce, MariaDB, marketplace or account API.
set -Eeuo pipefail
umask 027
PUBLIC="$(readlink -f /srv/vestaapp/current/public)"
[[ "$PUBLIC" == /srv/vestaapp/releases/*/public ]] || { echo "Unexpected public directory"; exit 1; }
ARCHIVE=/tmp/vestaland-magic-splash.tgz
test -s "$ARCHIVE"
for c in vc-nginx vc-vesta vc-cutella vc-db-vesta vc-db-cutella vc-vestaapp-web vc-vestaapp-market vc-vestaapp-account; do
  [[ "$(docker inspect -f '{{.State.Status}}' "$c")" = running ]] || { echo "Preflight: $c unavailable"; exit 1; }
done
mount="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/usr/share/nginx/html"}}{{println .Source}}{{end}}{{end}}' vc-vestaapp-web | xargs)"
[[ "$(readlink -f "$mount")" == "$PUBLIC" ]] || { echo "Static files not mounted by expected web container"; exit 1; }
STAGE="$(mktemp -d /srv/vestaapp/magic-splash-stage.XXXXXX)"
BACKUP="/srv/vestaapp/backups/magic-splash-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$BACKUP"
FILES='index.html app.js commerce.js sw.js splash.js splash.css'
changed=0
finish(){
  code=$?
  if [[ "$code" != 0 && "$changed" = 1 ]]; then
    echo "Rollback of splash-only static assets."
    for name in $FILES; do
      if [[ -s "$BACKUP/$name" ]]; then
        cp "$BACKUP/$name" "$PUBLIC/.$name.rollback"
        chmod 644 "$PUBLIC/.$name.rollback"
        mv -f "$PUBLIC/.$name.rollback" "$PUBLIC/$name"
      else
        rm -f "$PUBLIC/$name"
      fi
    done
  fi
  rm -rf "$STAGE"
}
trap finish EXIT
tar -xzf "$ARCHIVE" -C "$STAGE"
for name in $FILES; do
  test -s "$STAGE/$name" || { echo "Missing release asset $name"; exit 1; }
  if [[ -s "$PUBLIC/$name" ]]; then cp -p "$PUBLIC/$name" "$BACKUP/$name"; fi
done
grep -q 'id="entrySplash"' "$STAGE/index.html"
grep -q 'splash.js?v=20261014-voice2' "$STAGE/index.html"
grep -q 'vestaland-voice-20261014-v2' "$STAGE/sw.js"
grep -q 'MIN_MS=5600' "$STAGE/splash.js"
grep -q 'entry-bow-wrap' "$STAGE/splash.css"
for name in $FILES; do
  cp "$STAGE/$name" "$PUBLIC/.$name.release"
  chmod 644 "$PUBLIC/.$name.release"
  mv -f "$PUBLIC/.$name.release" "$PUBLIC/$name"
done
changed=1
# Verify origin endpoints through existing app nginx, without recreating any container.
for name in index.html splash.css splash.js app.js commerce.js sw.js; do
  docker exec vc-vestaapp-web wget -qO- "http://127.0.0.1:8080/$name" > "$STAGE/origin-$name"
  test -s "$STAGE/origin-$name"
done
grep -q 'id="entrySplash"' "$STAGE/origin-index.html"
grep -q 'MIN_MS=5600' "$STAGE/origin-splash.js"
grep -q 'vestaland-voice-20261014-v2' "$STAGE/origin-sw.js"
# Check app API is untouched and still healthy.
curl --noproxy '*' -fsS --max-time 12 --resolve app.vesta-cosmetics.ir:443:127.0.0.1 https://app.vesta-cosmetics.ir/api/account/health > "$STAGE/account-health"
grep -q '"ok":true' "$STAGE/account-health"
for h in vesta-cosmetics.ir cutellashop.ir; do
  code="$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' --max-time 18 --resolve "$h:443:127.0.0.1" "https://$h/")"
  echo "$h HTTP=$code"
  [[ "$code" = 200 || "$code" = 301 || "$code" = 302 ]] || exit 1
done
changed=0
rm -f "$ARCHIVE"
echo "SUCCESS: 5.6s magical splash deployed; store, account, DB and ingress containers unchanged."
