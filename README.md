# ANALYST

**See what the best traders on Robinhood are buying.**

[Open ANALYST](https://analyst-orpin.vercel.app) · [Vercel operations](docs/vercel-operations.md)

ANALYST is a public social-intelligence layer for Robinhood Chain: top traders, live tracked trades, token accumulation, an explainable Analyst Score, and a lightweight community (comments, ratings, posts) that needs no account.

It is an independent analytics and community platform. It is not affiliated with or endorsed by Robinhood. Nothing here is financial advice.

## Quick start

```bash
npm install
cp .env.example .env.local   # defaults to the live KOLHOOD data source
npm run dev
```

Open http://localhost:3000. The first request runs migrations against an embedded Postgres (PGlite in `./.data/pglite`) and performs the initial data sync, so it takes ~10–15 s. Everything after that is fast.

No external database, no API keys, no accounts.

## Data sources

Set `DATA_PROVIDER` in `.env.local`:

| Value | What it is |
| --- | --- |
| `kolhood` (default) | Live data from the public JSON routes that [kolhood.io](https://kolhood.io) serves to its own frontend: `/api/trades`, `/api/wallets/list`, `/api/wallets/:address/profile`, `/api/leaderboard?period=`, `/api/tokens/trending`. Only these observed, publicly reachable routes are used. |
| `mock` | Deterministic synthetic data (20 traders, 30 tokens, ~800 trades, continuous synthetic live trades) for offline development. The UI shows a **MOCK DATA** badge; ids are prefixed `mock-`. It can never be mistaken for live data. |

KOLHOOD supplies wallet profiles, rankings and recent trades. Dexscreener enriches live token prices and market metrics; GeckoTerminal supplies token logos and OHLCV price history on Robinhood Chain. Every token page includes selectable price and tracked-flow charts. Pons launchpad chart history is a second price source when GeckoTerminal lacks candles. Its original quote currency is retained, so current exchange rates never masquerade as historical USD prices. Price is the default chart view; recorded wallet flow is a separate selectable view. Unverified market caps stay unavailable; FDV is labeled separately. Realized PnL is computed with an average-cost model only when token amounts exist; otherwise the UI shows USD in/out.

Token logos and trader avatars use source images where available, downloaded and cached locally from verified source URLs; absent or broken images are omitted. Profile history is imported and deduplicated against the global feed; holdings alone are not presented as zero-trade activity. Rankings refresh every 15 minutes, and incremental sync updates derived activity statistics.

The provider contract lives in `lib/providers/types.ts`. Adding a new source means implementing `DataProvider` and registering it in `lib/providers/index.ts`.

## Architecture

```
provider (mock | kolhood) → sync (lib/services/sync.ts) → Postgres (Drizzle) → services → RSC pages + /api → client polling
```

- **Sync**: `POST /api/internal/sync?kind=full|trades` with `Authorization: Bearer $INTERNAL_SYNC_SECRET` for schedulers. Reads also trigger a throttled sync (every 8 s at most) so the app stays live without a cron.
- **Database**: Drizzle `pg-core` schema in `lib/db/schema.ts`. Uses `DATABASE_URL` (Postgres/Supabase) when set, otherwise embedded PGlite. Migrations in `drizzle/` run automatically at boot. `npm run db:generate` after schema changes.
- **Analyst Score** (`lib/services/score.ts`): 0–100 from five stored components — trader quality 30%, net accumulation 25%, breadth 20%, conviction 15%, momentum 10%. Explained in a popover on every score. Community ratings (1–10) are a separate, clearly labelled metric.
- **Guests**: anonymous HttpOnly cookie; only a salted SHA-256 hash is stored. IPs are hashed, never stored raw.
- **Anti-spam**: per-guest DB-backed sliding windows, per-IP in-memory limiter, cooldown, duplicate detection, honeypot field, URL cap, content policy, reports. Thresholds are env-configurable.
- **Live**: clients poll `/api/trades?after=<seq>` every 5 s; new rows insert at the top. The indicator shows **LIVE** only when the last successful sync is under 60 s old, otherwise **DELAYED**.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run check` | typecheck + lint + build |
| `npm test` | Isolated database regression tests for sync, PnL and atomic voting |
| `npm run test:e2e` | Browser checks on port 3120 using mock data and `.data/playwright`; run build first |
| `npm run sync` | Boot DB, run a full sync, print a summary (smoke test) |
| `npm run db:generate` | Generate a Drizzle migration from the schema |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` (Postgres) |

## Deploying

The current deployment runs on Vercel Hobby with Neon PostgreSQL, private Vercel Blob images, PostgreSQL metadata caches, and an external QStash scheduler. See [Vercel operations](docs/vercel-operations.md) for configuration and limits. GitHub Pages cannot run this application.

Set `DATABASE_URL`, `INTERNAL_SYNC_SECRET`, `GUEST_HASH_SALT`, and the HTTPS `NEXT_PUBLIC_APP_URL`, keeping live providers enabled. Vercel also needs the Blob store integration. QStash sends authenticated **POST** requests for trades every two minutes and full refreshes every 15 minutes. Shared ingestion leases and Vercel configuration checks are implemented. Moderation tooling, monitoring and staging/load verification remain [launch work](docs/production-launch.md).

## Routes

`/` home · `/live` live trades · `/traders` leaderboard · `/trader/[wallet]` profile · `/tokens` token monitor · `/token/[address]` token page · `/social` feed · `/social/[id]` thread.

API: `GET /api/trades`, `/api/traders`, `/api/traders/:id`, `/api/traders/:id/trades`, `/api/tokens`, `/api/tokens/:address`, `/api/tokens/:address/trades`, `/api/search`, `/api/social`, `/api/comments`, `/api/ratings`, `/api/freshness`, `/api/me`; `POST /api/social`, `/api/comments`, `/api/votes`, `/api/ratings`, `/api/reports`, `/api/me`; `DELETE /api/comments/:id`, `/api/social/:id`.

Source images are cached in `.data/source-images`, market responses in `.data/market-cache`, and contract-matched launchpad metadata in `.data/launchpad-cache`. Pons page metadata supplements logos and spot valuations missing from indexers. Fully diluted valuation is distinct from verified circulating market cap. Token browsing is paginated so records beyond the first 100 remain reachable. Live reads exclude seeded community posts and ratings.
