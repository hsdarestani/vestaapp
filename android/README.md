# Vestaland — CafeBazaar Android build

This directory contains the Android wrapper used for CafeBazaar distribution.

- Package: `ir.vestaland.app`
- Version name: `1.0.0`
- Version code: `1`
- Target SDK: `36`
- Production URL: `https://vestaland.smarbiz.sbs/`

## Signing

Never commit the signing keystore to the repository. Configure these GitHub Actions secrets:

- `BAZAAR_KEYSTORE_BASE64`
- `BAZAAR_KEYSTORE_PASSWORD`
- `BAZAAR_KEY_ALIAS`
- `BAZAAR_KEY_PASSWORD`

Then run **Build CafeBazaar Android** from GitHub Actions. The workflow creates both a signed APK and AAB as the `vestaland-cafebazaar-1.0.0` artifact.

The same signing key must be kept for every future CafeBazaar update.

## Payments

The web/PWA version continues to use Hamoon Cloud / Zibal. The CafeBazaar Android wrapper intentionally blocks that external checkout for in-app subscription purchases until CafeBazaar Billing is configured. After the first package is uploaded in the Bazaar developer panel, create the subscription SKUs and provide the Bazaar RSA/public key so native Bazaar billing can be enabled.
