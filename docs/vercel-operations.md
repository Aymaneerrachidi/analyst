# Vercel deployment

Production URL: https://analyst-orpin.vercel.app

The app uses Vercel Hobby in `iad1`, a dedicated Neon Free PostgreSQL database, a private Vercel Blob store, and Upstash QStash Free for authenticated POST scheduling. No minute-frequency Vercel cron is configured.

## Runtime behavior

- On Vercel, `DATABASE_URL`, live provider settings, HTTPS app URL and strong secrets are required. Configure these for every deployed environment; previews require their own database and secrets.
- Source images are stored in private Blob and served through the existing validated image proxy. Set `BLOB_READ_WRITE_TOKEN` through the store integration. Existing local source images were copied to the store; future images are cached as requested.
- Market and launchpad metadata caches use PostgreSQL `app_meta` on Vercel. The scheduled route removes entries untouched for seven days. Local development retains filesystem caching.
- Browsers connect directly to KOLHOOD's public Socket.IO `trade:new` stream. A single shared connection drives trade lists and the connection indicator throughout the site. Events appear without waiting for a database write; source snapshots reconcile reconnects. Transaction/wallet/token/side identity reconciles stream rows with later database rows without duplicate entries. Pause/resume and filters apply to stream events.
- Read requests do not trigger ingestion on Vercel. QStash saves history and refreshes analytics independently of immediate trade display. Token metadata enrichment uses Next.js `after` so unfinished enrichment remains attached to the request lifecycle, within its duration limit.
- A shared PostgreSQL lease prevents concurrent ingestion jobs. A terminated function's lease expires after six minutes. Sync has a 300-second function limit. Full jobs must continue to fit that limit as coverage grows; split ingestion into checkpointed batches before exceeding it.
- Migrations do not run automatically on Vercel request startup. Run `npm run db:migrate` with production `DIRECT_URL` supplied securely before releasing schema changes.

## Schedules and limits

QStash schedules `analyst-trades` every two minutes, and `analyst-full` at minutes 1, 16, 31 and 46. Each sends POST to `/api/internal/sync?kind=trades|full` with the secret Authorization header. Nominal usage is 816 deliveries daily, below QStash Free's 1,000/day allowance; retries also count. Monitor failures and quotas. These jobs persist data; they do not determine browser trade latency. LIVE means the public source socket is connected, and RECONNECTING means it is unavailable. Database freshness remains separate in `/api/freshness`. No system can promise zero upstream or network delay.

Rotate the scheduler's forwarded Authorization header whenever `INTERNAL_SYNC_SECRET` changes. QStash credentials and production environment files must never be committed. `CRON_SECRET` is not used in this external-scheduler setup.

## Verification and maintenance

Verified on 2026-09-06: successful full production sync (1,954 imported trades in 28 seconds), 107 tracked traders, real GeckoTerminal and Pons chart responses, shared PostgreSQL cache entries, and a successful unauthenticated browser visit to the main pages. Copied 684 cached original source images to private Blob. The sync endpoint rejects requests without its secret. Local build/typecheck/lint, 11 regression tests and five browser/API tests passed.

Check `/api/freshness` for provider `kolhood`, `isMock: false`, a recent successful sync, and populated trader counts. An unauthenticated POST to the sync endpoint must return 401. Inspect QStash delivery logs for successful scheduled calls, and Vercel runtime logs for failures. Check real token charts and currency labels, source images, search, and community writes after releases.

Local checks: `npm run check`, `npm test`, `npm run test:e2e`. Browser fixtures run only on the isolated local test database. Do not point fixture tests at production.

The [public launch checklist](production-launch.md) still applies: moderation, shared abuse limits, restore drills, load tests and supported data-source agreements remain work before a broad public launch. Free plans have usage limits; hosting does not make unavailable upstream images or historical prices available.
