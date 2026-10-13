#!/usr/bin/env bash
# Fix ONLY Vestaland's new artwork directories; do not touch shop containers.
set -Eeuo pipefail
umask 027
BASE=/srv/vestaapp
LIVE="$(readlink -f "$BASE/current")"
PUBLIC="$LIVE/public"
[[ "$LIVE" == "$BASE"/releases/* ]] || { echo "Unexpected release"; exit 1; }
[[ -d "$PUBLIC/assets/illustrations" && -f "$PUBLIC/assets/illustrations/selfcare.svg" ]] || { echo "Artwork missing"; exit 1; }
for name in vc-nginx vc-vesta vc-cutella vc-db-vesta vc-db-cutella vc-vestaapp-web vc-vestaapp-market vc-vestaapp-account; do
  [[ "$(docker inspect -f '{{.State.Status}}' "$name")" == "running" ]] || { echo "$name not running"; exit 1; }
done
before_assets="$(stat -c '%a' "$PUBLIC/assets")"
before_illustrations="$(stat -c '%a' "$PUBLIC/assets/illustrations")"
undo(){
  chmod "$before_assets" "$PUBLIC/assets" || true
  chmod "$before_illustrations" "$PUBLIC/assets/illustrations" || true
  echo "Failed image check; original directory modes restored"
}
trap 'if [[ "${done_success:-0}" != "1" ]]; then undo; fi' EXIT
# Files already have 0644. Nginx workers (non-root) must TRAVERSE both dirs.
chmod 755 "$PUBLIC/assets" "$PUBLIC/assets/illustrations"
for file in onboarding.svg selfcare.svg market.svg market-wow.svg gate-wow.svg; do
  output="$(docker exec -u nginx vc-vestaapp-web wget -qO- "http://127.0.0.1:8080/assets/illustrations/$file")" || { echo "Cannot read $file"; exit 1; }
  [[ "$output" == *"<svg"* ]] || { echo "$file returned HTML, not SVG"; exit 1; }
  code="$(curl --noproxy '*' -k -sS -o /tmp/vesta-image-check -w '%{http_code} %{content_type}' --max-time 14 --resolve app.vesta-cosmetics.ir:443:127.0.0.1 "https://app.vesta-cosmetics.ir/assets/illustrations/$file")"
  [[ "$code" == "200 image/svg+xml"* ]] && grep -q '<svg' /tmp/vesta-image-check || { echo "Bad live image response $file: $code"; exit 1; }
  echo "$file served as SVG"
done
for host in vesta-cosmetics.ir cutellashop.ir; do
  code="$(curl --noproxy '*' -k -sS -o /dev/null --max-time 15 --resolve "$host:443:127.0.0.1" -w '%{http_code}' "https://$host/")"
  echo "$host HTTP=$code"
  [[ "$code" == 200 || "$code" == 301 || "$code" == 302 ]] || exit 1
done
done_success=1
echo "SUCCESS: Vestaland image delivery restored; shops unchanged and no containers restarted"
