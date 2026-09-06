# Public launch checklist

Status: Vercel is now deployed. See [current Vercel operations](vercel-operations.md), which supersedes the original single-server assessment below. Real production ingestion, chart APIs and page loads have been verified. Vercel now has shared ingestion leases, persistent cloud caches, explicit migrations and configuration guards. Load capacity, moderation and disaster recovery remain unverified.

## Original single-server assessment (alternative to the current Vercel setup)

Use one always-on Node.js web service with managed PostgreSQL and persistent image/market caches. A Render Node web service is one compatible starting point. GitHub Pages cannot run this application's database and server routes.

1. Connect the GitHub repository to the host. Use Node 22, build `npm ci && npm run build`, and start `npm run start -- --hostname 0.0.0.0`. The host supplies `PORT`.
2. Provision managed PostgreSQL with backups, configure `DATABASE_URL`, and test restoring a backup. Never upload the local PGlite database as the production database. Import any community content you intend to retain through a reviewed migration; source sync only rebuilds upstream data.
3. On Render's native Node runtime, mount a persistent disk at `/opt/render/project/src/.data` for the current cache paths. This limits the service to one instance and causes downtime during deploys. Move caches to object storage/shared cache before horizontal scaling.
4. Set production environment variables below using the host's secret manager. Add a domain and verify HTTPS before enabling public posting.
5. Apply migrations once in a controlled release step with `npm run db:migrate`, using `DIRECT_URL` if a separate direct database connection is needed. The current code also migrates on connection startup: refactor that before running multiple replicas, and test both clean install and upgrade on managed PostgreSQL.
6. Schedule authenticated POST requests to `/api/internal/sync?kind=trades` every minute and `?kind=full` every 15 minutes. Include `Authorization: Bearer <INTERNAL_SYNC_SECRET>` from scheduler secrets. The scheduler must support POST; a GET-only cron integration does not match this endpoint. Monitor failures and overlap. For sustained ingestion, move sync/enrichment to a dedicated worker with a database-backed lock and retry policy.

Official host documentation: [Next.js web services](https://render.com/docs/deploy-nextjs-app), [persistent disk paths and limitations](https://render.com/docs/disks), [scheduled jobs](https://render.com/docs/cronjobs).

## Required production configuration

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATA_PROVIDER` | `kolhood` |
| `MARKET_DATA_PROVIDER` | `dexscreener` |
| `MARKET_DATA_CHAIN` | `robinhood` |
| `DATABASE_URL` | Managed PostgreSQL connection secret |
| `DIRECT_URL` | Direct migration connection, when required by your database host |
| `INTERNAL_SYNC_SECRET` | Independently generated random secret, at least 32 random bytes |
| `GUEST_HASH_SALT` | Another independently generated secret; keep stable across deploys |
| `NEXT_PUBLIC_APP_URL` | Your canonical HTTPS site URL; set before building |

Generate each secret separately with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Store it privately, never in GitHub source. `UPSTREAM_API_KEY` is optional and should only be supplied when your upstream agreement requires it. The application currently permits development defaults and mock mode in production, so add runtime deployment validation before public release; keep explicit isolated test mode available for CI.

## Fix before opening to everyone

- **Data reliability:** secure a supported data feed and permitted use of token/trader images. Current dependencies include KOLHOOD public routes, Dexscreener, GeckoTerminal, Pons page parsing/chart routes, and FxTwitter. Public endpoints can change or throttle. Replace fragile page parsing with a supported API or chain indexer. Coverage is incomplete; never fill gaps with fabricated statistics, historical candles or identity photos. Publish source, currency, freshness and availability information.
- **Ingestion:** reads currently start background sync and enrichment; locks are process-local. Separate scheduled ingestion from request serving, persist cursors/job state and use shared locks. Demonstrate that data stays current with no visitors, after restarts and during provider outages.
- **Abuse protection:** shared atomic rate limits for writes, trusted proxy/IP handling, request size limits and origin/CSRF review. Current guest counters and process-local IP limits are not a complete abuse boundary. Add an authenticated moderator interface and a process for reports, deletion and bans before enabling the public community.
- **Operations:** add health/readiness checks, structured error tracking and alerts for stale sync, upstream 429/5xx, database failures, disk growth and failed scheduled jobs. Configure cache size/retention limits, backups and a tested rollback procedure.
- **Release checks:** run `npm ci`, `npm run check`, `npm test`, `npx playwright install chromium`, and `npm run test:e2e`. Automated fixtures deliberately use mock data in an isolated test database. Also exercise real providers and managed PostgreSQL on an HTTPS staging site. Load-test expected traffic and inspect database connection limits (currently up to 10 per app process).
- **Public-facing readiness:** publish privacy/data-retention information, terms, source attribution, contact/reporting details and clear independent-brand disclosure. Review permissions for public redistribution of third-party data and images. The repository does not grant an explicit open-source reuse license.

## Launch acceptance

On staging, verify token lists and pagination, token price charts/currency labels, trader history, live freshness, search, posting/voting/reporting/deleting, mobile layouts and image fetch failures. Verify unauthorized sync requests fail, secrets never reach browser assets, backups restore, and a restart preserves required state. Run an outage simulation and a traffic test, then start a limited beta with monitoring before announcing broadly.

Buying hosting alone does not resolve the code and data-source items above. The GitHub push is not a deployment.
