#!/usr/bin/env bash
# Only update static Vestaapp assets; NEVER touch store containers, Nginx or DB.
set -Eeuo pipefail
umask 027
BASE=/srv/vestaapp
PUBLIC="$(readlink -f "$BASE/current/public")"
PACKAGE=/tmp/vestaapp-profile-assets.tar.gz
[[ -n "$PUBLIC" && "$PUBLIC" == "$BASE"/releases/*/public ]]
[[ -f "$PUBLIC/index.html" && -s "$PUBLIC/app.js" && -s "$PUBLIC/styles.css" && -s "$PUBLIC/sw.js" ]]
[[ -s "$PACKAGE" ]]
for c in vc-nginx vc-vesta vc-cutella vc-db-vesta vc-db-cutella vc-vestaapp-web vc-vestaapp-market; do
  [[ "$(docker inspect -f '{{.State.Status}}' "$c")" == "running" ]] || { echo "$c isn't running; no files changed"; exit 1; }
done
mounted="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/usr/share/nginx/html"}}{{println .Source}}{{end}}{{end}}' vc-vestaapp-web | xargs)"
[[ "$(readlink -f "$mounted")" == "$PUBLIC" ]] || { echo "App container not using the expected public directory"; exit 1; }
STAGE="$(mktemp -d "$BASE/profile-stage.XXXXXX")"
BACKUP="$BASE/backups/profile-assets-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$BACKUP"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT
tar -xzf "$PACKAGE" -C "$STAGE"
assets=(index.html app.js styles.css sw.js)
for file in "${assets[@]}"; do
  [[ -s "$STAGE/$file" ]] || { echo "Missing asset: $file"; exit 1; }
  cp -p "$PUBLIC/$file" "$BACKUP/$file"
done
grep -q '20261012-profile2' "$STAGE/index.html"
grep -q 'id="profileForm"' "$STAGE/app.js"
grep -q 'profile-banner' "$STAGE/styles.css"
grep -q 'vestaland-personal-profile-v2' "$STAGE/sw.js"
rollback(){
  echo "Rolling back only Vestaapp static assets."
  for file in "${assets[@]}"; do
    if [[ -s "$BACKUP/$file" ]]; then
      cp "$BACKUP/$file" "$PUBLIC/.$file.rollback"
      chmod 644 "$PUBLIC/.$file.rollback"
      mv -f "$PUBLIC/.$file.rollback" "$PUBLIC/$file"
    fi
  done
}
for file in "${assets[@]}"; do
  cp "$STAGE/$file" "$PUBLIC/.$file.release"
  chmod 644 "$PUBLIC/.$file.release"
  mv -f "$PUBLIC/.$file.release" "$PUBLIC/$file"
done
if ! docker exec vc-vestaapp-web wget -qO- http://127.0.0.1:8080/app.js | grep -q 'profileForm'; then
  rollback; exit 1
fi
if ! docker exec vc-vestaapp-web wget -qO- http://127.0.0.1:8080/styles.css | grep -q 'profile-banner'; then
  rollback; exit 1
fi
if ! docker exec vc-vestaapp-web wget -qO- http://127.0.0.1:8080/ | grep -q '20261012-profile2'; then
  rollback; exit 1
fi
for host in vesta-cosmetics.ir cutellashop.ir; do
  code="$(curl --noproxy '*' -sS --max-time 15 -o /dev/null --resolve "$host:443:127.0.0.1" -w '%{http_code}' "https://$host/")" || code=000
  if [[ "$code" != 200 && "$code" != 301 && "$code" != 302 ]]; then
    echo "Unexpected health check for $host: $code"; rollback; exit 1
  fi
  echo "$host HTTP $code"
done
rm -f "$PACKAGE"
echo 'Vestaapp profile updated; store Nginx, WordPress, and DB containers unchanged.'
