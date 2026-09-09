# Stalkchain Robinhood source

The September 9 source change uses Stalkchain's public Robinhood Socket.IO
`robinhood_live` room and `robinhood.live.v1` projections. A single Railway worker
filters activity to the saved trader roster and persists it before telling browsers
to refresh Analyst's snapshot. Browsers do not connect to Stalkchain or KOLHOOD.

The public KOL feed is reconciled every 20 seconds. Wallet activity is recovered
sequentially (100 recent records per wallet, at most one request every three
seconds). Reconnects request replay from the persisted source cursor. This is
recent-history recovery, not a guarantee of complete history: public replay and
activity endpoints are bounded and have no production SLA established here.

Stalkchain identities are permitted alongside KOLHOOD and Defined by the stored
source policy. Wallet addresses deduplicate identities. Existing names and images
are preserved; missing avatars/social links can be filled from Stalkchain.
Ownership is not independently verified. Trades remain provider-reported.

The source's `priceIsSane: false` or rejected price-quality flag suppresses USD
valuation and execution price. Missing data is not replaced with zeros. Its
observed chain delay was around 60–90 seconds; the UI must not call that zero-lag.

## Deployment

Railway builds `worker/stalkchain.ts` using `worker/Dockerfile`. Required server
variables: `DATABASE_URL`, `INDEXER_SECRET` (at least 32 characters),
`DATA_PROVIDER=kolhood`, `WEBHOOK_FEED_ENABLED=1`, `LIVE_FEED_SOURCE=stalkchain`.
The provider flag retains compatibility with legacy tables; ingestion is owned
by the worker and the old KOLHOOD scheduler becomes a no-op.

Vercel also needs `INDEXER_URL` pointing to Railway and the same `INDEXER_SECRET`,
plus `WEBHOOK_FEED_ENABLED=1` and `LIVE_FEED_SOURCE=stalkchain`.
No Alchemy credential is required by the Stalkchain worker. The Alchemy webhook
and original broad indexer remain stopped. `worker/webhook.ts` is an alternative
implementation under development; it is not the deployed worker or a verified
replacement for unsupported pool types.

Checks: `node --import tsx --test scripts/stalkchain.test.ts`, typecheck, lint,
production build, and bounded actual-source ingestion. Runtime `/health` reports
source age, imported count and backlog. `app_meta` stores the source cursor,
worker heartbeat and per-wallet recent-history status.
