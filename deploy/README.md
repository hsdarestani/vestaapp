# Isolated Vestaapp deployment on the Vesta/Cutella server

## Architecture

The current production stack in `hsdarestani/vestacutella` includes Docker containers `vc-nginx`, `vc-vesta`, `vc-cutella`, and their MariaDBs on `vestacutella-backend`.

This repo adds ONLY:

- `vc-vestaapp-web`: isolated, read-only static application container
- `vc-vestaapp-market`: read-only public WooCommerce Store API proxy with an independent image cache in `/srv/vestaapp/data/images`
- A dedicated **app.vesta-cosmetics.ir** virtual host inserted into the existing Nginx config only after a successful preflight, then **nginx -t** and **reload** (not a restart).

**No database is shared or migrated.** Existing storefront domains, PHP services, MariaDB volumes and payment systems are not changed.

## Required preflight before remote deployment

1. Point `app.vesta-cosmetics.ir` to the new Vesta server in Cloudflare DNS (proxied if desired). Keep existing records for the root domain intact.
2. Supply an origin TLS cert **valid for app.vesta-cosmetics.ir**. Current vesta cert is reused if it already covers the hostname; otherwise provision `/srv/vestacutella/runtime/certs/app-vesta/fullchain.pem` and `privkey.pem`. This directory is under the existing `vc-nginx` certificate mount. Use Full (strict) in Cloudflare.
3. Confirm the Vestaapp GitHub Actions `HOST` and `PASS` secrets point to this production host and **not** the old `vestaland.smarbiz.sbs` host.
4. Keep the original Bazaar signing secrets: `BAZAAR_KEYSTORE_BASE64`, `BAZAAR_KEYSTORE_PASSWORD`, `BAZAAR_KEY_ALIAS`, `BAZAAR_KEY_PASSWORD`. For signed updates the same original signing key is mandatory.
5. Review the isolated deploy PR/changes and the GitHub Actions logs before releasing to Bazaar. A broken domain can leave the installed Android WebView on a blank screen.

## Deploy

The GitHub Action **Deploy isolated Vestaapp** (manual dispatch after preflight) uploads a curated archive and runs `deploy/rollout.sh`. The script validates Docker services and TLS *before* touching live Nginx, checks the app and market health, takes a timestamped backup of the Nginx config, and reloads only if `nginx -t` passes. It rolls back the app symlink on startup errors.

The live routing change is applied to `/srv/vestacutella/repo/infra/nginx.conf`. If that infrastructure repo is deployed or its Nginx config regenerated, make sure this marked `VESTAAPP ISOLATED ROUTING` block persists; ideally persist the route in the infrastructure repo after verification.

## Validation

- `https://app.vesta-cosmetics.ir/` loads pink wardrobe interface
- `https://app.vesta-cosmetics.ir/api/market/health` returns JSON `ok: true`
- `https://vesta-cosmetics.ir/` and `https://cutellashop.ir/` continue to load and checkout normally
- Adding a photo on Android opens the system image picker; adding/deleting items works
- Manual backup export/import works; community is absent
- Signed APK/AAB matches existing application ID and certificate

### Data warning

The app's new wardrobe and beauty items live in device IndexedDB until an authenticated data sync API is added. **WebView local data from the former vestaland.smarbiz.sbs origin will not automatically transfer** to the new host.
