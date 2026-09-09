# Alchemy Address Activity setup

Operational check, 2026-09-09: the production receiver is deployed with the real webhook ID, signing key and `ROBINHOOD_MAINNET` configured. The pilot has one address. Notify API authentication succeeded. Unsigned POST returned 401; a signed invalid envelope returned 400 without storage. A 30-second live pilot yielded no stored events and was then paused; the Notify API confirmed `is_active:false`. Real event delivery is therefore still unverified. No plan upgrade or broad indexer restart occurred.

Receiver: `POST https://analyst-orpin.vercel.app/api/webhooks/alchemy`.

Create an Address Activity webhook on Robinhood Chain Mainnet, named `ANALYST - wallet pilot`. Start with one tracked wallet: `0x6078ee8a93697c6d67863fcbff77141d9ab358b2` (inquixit). Do not use the Ethereum addresses or network from the dashboard's generic example payload.

Required server environment:

- `ALCHEMY_WEBHOOK_SIGNING_KEY`: the specific webhook's signing key.
- `ALCHEMY_WEBHOOK_ID`: its actual ID, not the example ID.
- `ALCHEMY_WEBHOOK_NETWORK`: the exact Robinhood network identifier supplied by Alchemy.
- `DATABASE_URL`: the existing application database.

The receiver returns 503 until those three webhook settings are configured, 401 for invalid signatures, and 400 for wrong networks/webhook IDs. Therefore the dashboard's Test URL cannot pass before configuration. Never disable signature verification to make a dashboard test pass.

An app RPC key does not manage webhooks: programmatic creation/pause requires the separate Webhooks Auth Token (`ALCHEMY_NOTIFY_AUTH_TOKEN`, stored locally/server-side only).

The receiver stores signed events in a durable, deduplicated `app_meta` inbox under `alchemy-inbox:`. It acknowledges only after database persistence. It does not create trades or update feed freshness. A receipt-verifying consumer, quota monitoring and gap recovery must be implemented and verified before calling the pipeline live. Keep the broad block indexer stopped and keep this account on Free. No paid upgrade is authorized by this setup.

Validation: `node --import tsx --test scripts/alchemy-webhook.test.ts` tests signatures, source validation, payload size, missing configuration and retryable database failure.
