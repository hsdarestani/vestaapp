#!/usr/bin/env bash
# Scoped deploy: Vestaapp static and account services only.
set -Eeuo pipefail
umask 027
BASE=/srv/vestaapp
DIR="$(readlink -f "$BASE/current")"
[[ "$DIR" == "$BASE"/releases/* ]] || { echo "Unexpected release"; exit 1; }
ARCHIVE=/tmp/vestaland-commerce-release.tgz
ENVFILE="$BASE/secrets/account.env"
test -s "$ARCHIVE" && test -s "$ENVFILE"
for c in vc-nginx vc-vesta vc-cutella vc-db-vesta vc-db-cutella vc-vestaapp-web vc-vestaapp-market; do
  test "$(docker inspect -f '{{.State.Status}}' "$c")" = running || { echo "$c unhealthy; no changes"; exit 1; }
done
mkdir -p "$BASE/data/accounts" "$BASE/backups"
chown 10001:10001 "$BASE/data/accounts"
chmod 700 "$BASE/data/accounts" "$BASE/secrets"
chmod 600 "$ENVFILE"
STAGE="$(mktemp -d "$BASE/commerce.XXXXXXXX")"
BACKUP="$BASE/backups/commerce-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$BACKUP"
trap 'rm -rf "$STAGE"' EXIT
tar -xzf "$ARCHIVE" -C "$STAGE"
files=(public/index.html public/app.js public/styles.css public/commerce.js public/commerce.css public/sw.js backend/account_server.py deploy/account.Dockerfile deploy/compose.yml deploy/app-nginx.conf)
for file in "${files[@]}"; do
  test -s "$STAGE/$file" || { echo "Missing $file"; exit 1; }
done
for file in "${files[@]}"; do
  mkdir -p "$BACKUP/$(dirname "$file")"
  if [[ -f "$DIR/$file" ]]; then cp -p "$DIR/$file" "$BACKUP/$file"; fi
done
restore(){
  set +e
  echo "Reverting Vestaland-only changes. Stores and database containers untouched."
  for file in "${files[@]}"; do
    if [[ -s "$BACKUP/$file" ]]; then cp -p "$BACKUP/$file" "$DIR/$file"; else rm -f "$DIR/$file"; fi
  done
  docker compose -p vestaapp -f "$DIR/deploy/compose.yml" up -d --no-deps --force-recreate app
}
for file in "${files[@]}"; do
  cp -p "$STAGE/$file" "$DIR/$file"
  chmod 644 "$DIR/$file"
done
chmod 755 "$DIR/public" "$DIR/backend" "$DIR/deploy"
docker compose -p vestaapp -f "$DIR/deploy/compose.yml" config -q || { restore; exit 1; }
if ! docker compose -p vestaapp -f "$DIR/deploy/compose.yml" up -d --no-deps --build account; then restore; exit 1; fi
sleep 4
if ! docker exec vc-vestaapp-account python3 -c "import urllib.request,json; r=json.load(urllib.request.urlopen('http://127.0.0.1:8777/api/account/health',timeout=4)); assert r['ok']"; then restore; exit 1; fi
if ! docker compose -p vestaapp -f "$DIR/deploy/compose.yml" up -d --no-deps --force-recreate app; then restore; exit 1; fi
sleep 3
if ! docker exec vc-vestaapp-web wget -qO- http://127.0.0.1:8080/ | grep -q 'commerce.js'; then restore; exit 1; fi
if ! docker exec vc-vestaapp-web wget -qO- http://127.0.0.1:8080/api/account/config | grep -q 'trial_days'; then restore; exit 1; fi
for host in vesta-cosmetics.ir cutellashop.ir; do
  code="$(curl --noproxy '*' -sS -o /dev/null --max-time 15 --resolve "$host:443:127.0.0.1" -w '%{http_code}' "https://$host/")"
  [[ "$code" = 200 || "$code" = 301 || "$code" = 302 ]] || { restore; exit 1; }
  echo "$host HTTP=$code"
done
echo "SUCCESS: Vestaapp services updated. Store services untouched."
