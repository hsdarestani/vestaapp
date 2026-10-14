# Vestaland CafeBazaar release status — 2026-10-14

## Verified and successfully staged
- **App:** `ir.vestaland.app`; Android `versionCode=5`, `versionName=1.3.0`.
- **Original signing key recovered:** `vestaland-signing-backup.zip`, alias `vestaland`. No private key, password or keystore was committed to GitHub.
- **SHA256 signer (original 1.0.1 AAB = new 1.3.0 APK):** `7220E3B8AB418045E84091269B495339AE6971A998C005CF6E84142EA73C8077`.
- **Signed build passed:** https://github.com/hsdarestani/vestaapp/actions/runs/38611752348 — downloadable artifact `vestaland-cafebazaar-1.3.0` with signed APK and AAB.
- **CafeBazaar API authenticated** with `CAFEBAZAR_API`, and the existing published/committed baseline remains version `1.0.1` (code `2`).
- **SUCCESS:** a draft release was created through Pishkhan, and the **signed APK 1.3.0 successfully uploaded**. API `last-uncommitted` confirmed `packages[].version_code = 5`. Workflow run: https://github.com/hsdarestani/vestaapp/actions/runs/38612977739 .
- **NOT submitted/published yet:** no API `commit` or `auto_publish` call was made. Public store listing continues to show v1.0.1 at https://cafebazaar.ir/app/ir.vestaland.app .

## Next release steps
1. In CafeBazaar's authenticated developer dashboard, update the old community-themed store **title, description, screenshots and privacy disclosures** to match the new wardrobe / beauty organizer version. Proposed text: `docs/bazaar-listing-fa.md`. Screenshot artifact: https://github.com/hsdarestani/vestaapp/actions/runs/38584526840 .
2. Confirm that the newly uploaded `1.3.0` APK is visible in the draft in the developer dashboard.
3. Before `commit` and auto-publish, review the upgrade behavior and avoid advertising any unfinished paid subscriptions. Then submit the draft for Bazaar review through the dashboard or explicitly through the API.
4. Follow review status through the Bazaar panel. Do not claim the app is updated live until version `1.3.0` appears publicly.

## Subscriptions still not ready
- `BAZAAR_RSA_PUBLIC_KEY` was absent in the latest checked Actions Secrets.
- A server-side Bazaar receipt verifier requires `BAZAAR_CLIENT_ID`, `BAZAAR_CLIENT_SECRET`, and `BAZAAR_REFRESH_TOKEN`; these are not interchangeable with Pishkhan API token.
- Keep Bazaar paid subscription UI disabled until native billing SKUs, server-side verification, subscription expiry and restoration are tested. `MainActivity.java` has a 6-month SKU but frontend/backend do not yet fully support that plan.
