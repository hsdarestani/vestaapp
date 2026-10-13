# Vestaland AI Worker

Deploy on your own Cloudflare account, separate from the WooCommerce server:

```bash
cd cloudflare
npx wrangler login
npx wrangler secret put AI_SHARED_SECRET
npx wrangler deploy
```

Set identical random 32+ character secret on the **Iranian server** as `CF_AI_SHARED_SECRET`, and the deployed HTTPS Worker endpoint as `CF_AI_WORKER_URL`. Keep this token and Worker URL out of frontend JS. Only backend/account_server.py may access the Worker. No consumer data, photos, phone numbers, or purchase details are forwarded to AI; only 18 item names/categories/colors and 240 chars of question.

Model: `@cf/meta/llama-3.2-1b-instruct`, 170 max generated tokens. Your own server applies per-phone per-day and global per-day quotas before forwarding. Defaults: trial 1/day, paid 2/day, global cap 240 calls/day, so 300 registered accounts can use app services but cannot all make unlimited AI requests. This cap is adjustable using `AI_GLOBAL_DAILY_LIMIT`. It is NOT a Cloudflare hard neuron cap and must be monitored against the Workers AI Free allocation (10,000 neurons/day); AI inference availability at 300 users cannot be guaranteed.

**Do not put shared secret in GitHub code or commit actual Wrangler credentials.**
