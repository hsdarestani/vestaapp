#!/usr/bin/env bash
# Cosmetic, static-only Vestaland release. Never restart shared Nginx or WooCommerce.
set -Eeuo pipefail
umask 027
BASE=/srv/vestaapp
RELEASE="$(readlink -f "$BASE/current")"
PUBLIC="$RELEASE/public"
ARCHIVE=/tmp/vestaland-visual-assets.tar.gz
[[ "$RELEASE" == "$BASE"/releases/* && -s "$PUBLIC/index.html" ]]
test -s "$ARCHIVE"
for c in vc-nginx vc-vesta vc-cutella vc-db-vesta vc-db-cutella vc-vestaapp-web vc-vestaapp-market vc-vestaapp-account; do
  test "$(docker inspect -f '{{.State.Status}}' "$c")" = running
done
mounted="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/usr/share/nginx/html"}}{{println .Source}}{{end}}{{end}}' vc-vestaapp-web | xargs)"
test "$(readlink -f "$mounted")" = "$PUBLIC"
STAGE="$(mktemp -d "$BASE/ui-visual-stage.XXXXXXXX")"
BACKUP="$BASE/backups/ui-visual-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$BACKUP"
trap 'rm -rf "$STAGE"' EXIT
tar -xzf "$ARCHIVE" -C "$STAGE"
files=(index.html app.js styles.css commerce.js commerce.css sw.js assets/illustrations/onboarding.svg assets/illustrations/selfcare.svg assets/illustrations/market.svg assets/illustrations/market-wow.svg assets/illustrations/gate-wow.svg)
for file in "${files[@]}"; do
  test -s "$STAGE/$file" || { echo "Missing staged static file: $file"; exit 1; }
  if test -f "$PUBLIC/$file"; then
    mkdir -p "$BACKUP/$(dirname "$file")"
    cp -p "$PUBLIC/$file" "$BACKUP/$file"
  fi
done
grep -q 'v=20261013-visual2' "$STAGE/index.html"
grep -q 'vestaland-soft-visual-20261013-v2' "$STAGE/sw.js"
grep -q 'یه عکس بگیر تا مشخصات' "$STAGE/index.html"
if grep -q 'به Cloudflare ارسال' "$STAGE/index.html"; then
  echo 'Old technical text is still present'; exit 1
fi
rollback(){
  echo "Restoring only Vestaland static files"
  for file in "${files[@]}"; do
    if test -s "$BACKUP/$file"; then
      cp -p "$BACKUP/$file" "$PUBLIC/.$(basename "$file").rollback"
      chmod 644 "$PUBLIC/.$(basename "$file").rollback"
      mv -f "$PUBLIC/.$(basename "$file").rollback" "$PUBLIC/$file"
    else rm -f "$PUBLIC/$file"; fi
  done
}
for file in "${files[@]}"; do
  mkdir -p "$PUBLIC/$(dirname "$file")"
  tmp="$PUBLIC/.$(basename "$file").new"
  cp "$STAGE/$file" "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$PUBLIC/$file"
done
for file in index.html app.js styles.css commerce.js commerce.css sw.js; do
  docker exec vc-vestaapp-web wget -qO- "http://127.0.0.1:8080/$file" >/tmp/vestaland-ui-check || { rollback; exit 1; }
done
for file in onboarding.svg selfcare.svg market.svg market-wow.svg gate-wow.svg; do
  if ! docker exec vc-vestaapp-web wget -qO- "http://127.0.0.1:8080/assets/illustrations/$file" | grep -q '<svg'; then
    echo "Illustration unavailable: $file"; rollback; exit 1
  fi
done
if ! docker exec vc-vestaapp-web wget -qO- http://127.0.0.1:8080/ | grep -q '20261013-visual2'; then
  rollback; exit 1
fi
if ! docker exec vc-vestaapp-web wget -qO- http://127.0.0.1:8080/api/account/health | grep -q '"ok":true'; then
  rollback; exit 1
fi
for host in vesta-cosmetics.ir cutellashop.ir; do
  code="$(curl --noproxy '*' --max-time 15 -sS -o /dev/null --resolve "$host:443:127.0.0.1" -w '%{http_code}' "https://$host/")"
  echo "$host HTTP=$code"
  [[ "$code" == 200 || "$code" == 301 || "$code" == 302 ]] || { rollback; exit 1; }
done
echo 'SUCCESS: Vestaland copy, navigation and image assets updated with zero store container restarts.'
