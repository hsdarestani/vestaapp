# Vestaland Commerce — staged deployment checklist (not live yet)

This feature is currently on `feature/auth-subscriptions-ai-native-orders` and [PR #3](https://github.com/hsdarestani/vestaapp/pull/3). **Do not publish before verifying real login/SMS, payments, checkout and consumer app-policy compliance.** The installed app still works as before.

## Why use separate services?

- Existing `vc-nginx`, both WordPress containers, databases and previous store purchases are untouched.
- `vc-vestaapp-account` is a separate unprivileged Python service on `vestacutella-backend`; SQLite stored at `/srv/vestaapp/data/accounts`. Never expose account DB/port to public internet.
- Browser calls `/api/account/`; app Nginx proxies to internal account container. The internal account service is the only caller permitted to place Woo Store API orders and spend Workers AI quota.
- Each **physical product** order goes into its original WooCommerce, paid through its **existing gateway**: Vesta currently `wc_zibal` and Cutella currently `WC_ZPal`. No new independent store order database is source of truth.
- **App web/PWA digital subscriptions** use dedicated Zibal merchant gateway. The **CafeBazaar Android app** routes digital subscription payment through the native Bazaar SDK, validates the token against CafeBazaar developer API, and must not grant premium via localStorage. These must be tested before release.
- All account, trials, subscriptions, pricing and AI quota decisions happen on server, including first verified 7-day trial per phone; no client-side expiry override.

## GitHub Actions secrets to prepare

In https://github.com/hsdarestani/vestaapp/settings/secrets/actions

Already present from old deploy: `HOST`, `PASS`, `SSH_KNOWN_HOSTS` (verify they still point to 193.177.242.64).

**For Iranian SMS verification (SMS.ir)**:
- `SMSIR_API_KEY`: SMS.ir API access key (ideally independent from both storefronts).
- `SMSIR_TEMPLATE_ID`: approved pattern/template ID accepting parameter `Code` and six digits.
- `VESTALAND_OTP_PEPPER`: new random 32+ character string, for hashing verification codes; don't reuse WordPress secret.

**For app subscription payments via Zibal (web only)**:
- `ZIBAL_MERCHANT`: Zibal merchant credential; use a merchant verified for the app domain `https://app.vesta-cosmetics.ir` and callback path `/api/account/subscription/callback`.

**For Cloudflare AI**:
- `CLOUDFLARE_API_TOKEN`: scoped Worker edit/deploy permission for only the intended account.
- `CLOUDFLARE_ACCOUNT_ID`: Worker account ID.
- `CF_AI_SHARED_SECRET`: independent new random 32+ character server-to-server secret. Must match Cloudflare Worker secret `AI_SHARED_SECRET`.
- `CF_AI_WORKER_URL`: actual `https://...workers.dev` URL obtained after deploying the Worker (don't guess).

**For CafeBazaar native subscription verification**:
- `BAZAAR_CLIENT_ID`
- `BAZAAR_CLIENT_SECRET`
- `BAZAAR_REFRESH_TOKEN`
- Keep original Android signing secrets; existing app ID `ir.vestaland.app`. In Bazaar create/confirm subscription SKUs `vestaland_sub_1m`, `vestaland_sub_3m` and matching prices. Ensure Developer API access token refresh scope permits subscription receipt validation.

**Optional, for reading current customer Woo order status** (rather than only the creation-time status): 
- `VESTA_WC_CONSUMER_KEY`, `VESTA_WC_CONSUMER_SECRET`
- `CUTELLA_WC_CONSUMER_KEY`, `CUTELLA_WC_CONSUMER_SECRET`

Use **read-only** Woo REST API keys for order status. Secrets should never appear in client JS, repository files, logs, or screenshots.

## Cloudflare costs / quotas

- Text-only small model `@cf/meta/llama-3.2-1b-instruct`; 18 short item labels, 170 max tokens, 240 character question.
- Quotas: trial 1 recommendation/day; paid 2/day; global 240/day (configurable). At least 300 user accounts can exist, but **not every account is guaranteed daily AI access**; maximum 240 AI requests/day shared by all. Cloudflare Workers AI has an additional, independently metered **10,000 neurons/day free**; monitor/adjust actual usage and lower caps when necessary.
- If budget free quota is exhausted, AI must return a controlled unavailable message without affecting wardrobe or storefront checkout.

## Before enabling

1. Obtain and add SMS, Zibal, Cloudflare, Bazaar secrets **without posting their values in chat**.
2. Test SMS.ir OTP with a dedicated test mobile (including rate limiting).
3. Deploy Worker manually via `Deploy Vestaland Cloudflare AI` after secrets, verify a single low-token response and quota.
4. Prepare server env file `/srv/vestaapp/secrets/account.env` from `deploy/account.env.example`, mode 0600, and backup DB independently; see `deploy/deploy-commerce.sh`.
5. Deploy only the new isolated account and app containers after preflight; re-test both storefronts' checkout and email notifications.
6. Make **a low-price real Woo test order** separately per store to ensure each plugin's Woo Store API checkout route works; disabled by `APP_CHECKOUT_ENABLED=0` until passed.
7. Make **a real Zibal subscription test payment** and verify amount/callback/idempotency/expiry. Test Bazaar purchase through native SDK and independent CafeBazaar Developer API verification before publishing Android update.
8. Ensure automated daily certificate renewal and backups. Configure abuse budgets and SMS limits.
9. Prepare customer-facing plan terms/refund policy and privacy notice before selling subscriptions.

### Operational notes

There is no permission to modify or migrate existing WooCommerce customer accounts. App mobile OTP account is separate, tied to phone, and Woo order IDs are linked only after app checkout. For old Woo customers, implement verified identity mapping only with explicit consent and a protected association flow.

**Don't** use the current legacy `scripts/deploy-production.sh` on this shared server. It was built for old infrastructure.
