# Vestaland CafeBazaar release readiness — 2026-10-14

## Current result
- App ID: `ir.vestaland.app`, Android version code `5`, version name `1.3.0`.
- CafeBazaar currently publicly lists `ir.vestaland.app` as version `1.0.1` (version code `2`), at https://cafebazaar.ir/app/ir.vestaland.app .
- The Pishkhan token in `CAFEBAZAR_API` authenticated successfully. Read-only endpoints `last-published`, `last-committed`, `last-uncommitted` returned HTTP 200. Published and committed package entries show `version_code=2`, `version_name=1.0.1`; no uncommitted release exists.
- GitHub Actions confirmed all four signing secrets are present and rebuilt the release **signed** APK/AAB successfully. Run: https://github.com/hsdarestani/vestaapp/actions/runs/38602696365 . Artifact: `vestaland-cafebazaar-1.3.0`.
- Listing screenshots are prepared at https://github.com/hsdarestani/vestaapp/actions/runs/38584526840 ; marketing text: `docs/bazaar-listing-fa.md`.

## BLOCKER: existing release uses prior signing identity
The latest signer is a **newly created keystore** (as reported during setup). Because this package is already published in CafeBazaar, it must be updated using the existing/previous signing key (or an officially approved key-migration route from CafeBazaar). **Do not upload or commit the newly signed version** before verifying signing certificate continuity.

Next actions:
1. Recover the original signing keystore from the earlier build machine, publisher server/backups, safe secrets vault or original CI artifacts (if available). Never store it in the repository.
2. Compare original published certificate fingerprint with the current release signer certificate; ensure they match before release. If previous private key cannot be recovered, contact CafeBazaar developer support to ask whether an official key reset or signing-key migration can be approved for this package.
3. Once signing continuity is resolved, rebuild signed APK, validate installation/upgrade and receipt security, then upload via Pishkhan API and submit for review.
4. Update the old store listing metadata and screenshots from `docs/bazaar-listing-fa.md`, in the authenticated developer dashboard.

## In-app subscriptions are not release-ready
- `BAZAAR_RSA_PUBLIC_KEY` is absent from the checked GitHub Actions secrets (read-only check run 38602771816).
- Receipt verification module (`backend/bazaar_verify.py`) requires separate **server-side** `BAZAAR_CLIENT_ID`, `BAZAAR_CLIENT_SECRET`, and `BAZAAR_REFRESH_TOKEN`; a Pishkhan publication token does not replace these.
- Test all market subscription SKUs, server-side verification, expiration and restoration before enabling subscription purchase UI.
- `MainActivity.java` currently references a 6-month SKU, but backend validation/frontend only implement monthly and quarterly. Do not expose the 6-month native subscription until those match.

## Important
This document records readiness only. No new APK/AAB was uploaded to CafeBazaar and no publication was submitted by the 2026-10-14 workflow checks.
