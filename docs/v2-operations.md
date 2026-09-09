# V2 operations and remaining release gates

This document describes the V2 working tree. It does not certify a production rollout. The existing Vercel site remains on the preceding release until the continuous worker and its data coverage are verified.

## Configuration needed

| Location | Settings | Purpose |
| --- | --- | --- |
| Railway worker | `DATABASE_URL` | Existing managed PostgreSQL database; use a runtime role without migration privileges. |
| Railway worker | `ALCHEMY_RPC_URL`, `ALCHEMY_WS_URL` | Robinhood Chain mainnet, chain ID 4663. Keep these server-only. |
| Railway worker | `INDEXER_START_BLOCK` | Explicit historical coverage start; changing this does not reset an existing cursor. |
| Railway worker and Vercel | `INDEXER_SECRET` | Same independent random secret of at least 32 characters. |
| Vercel | `INDEXER_URL` | HTTPS origin of the worker. Enable only after worker validation. |
| Worker and Vercel | Verified Pons/Uniswap addresses and code hashes in `.env.example` | Direct routing and pool discovery. Contracts must belong to chain 4663. |
| Worker and Vercel | `BASE44_AGENT_URL`, `BASE44_AGENT_KEY`; optional `BASE44_AGENT_ID` | Optional research. See `base44-contract.md` for the actual HTTP contract. |
| Worker and Vercel | `BLOCKSCOUT_API_URL` | An accessible official API endpoint. The default host returned HTTP 403 during live verification. Missing explorer evidence stays unknown. |

Use `DATA_PROVIDER=chain` for the replacement rollout. Keep `GUEST_HASH_SALT` stable. See `api-setup.md` for account and environment instructions. The V2 execution path no longer calls 0x. Never put RPC, database, worker or research credentials in `NEXT_PUBLIC_*` settings.

## Deployment order

1. Back up PostgreSQL and verify restore access. Test additive migration `0002_analyst_v2_foundation.sql` on a staging copy. Local PGlite migration tests are not a managed-PostgreSQL restore rehearsal.
2. Apply migrations once with `npm run db:migrate` using the migration connection. Vercel and the production worker do not run startup migrations.
3. Create a Railway service from this repository, with root directory at the repository root and config file `worker/railway.toml`. It builds `worker/Dockerfile`. Use one replica initially. Runtime is Node 22 with `ANALYST_WORKER=1`.
4. Run `npm run worker:check` with the runtime environment. It prints missing setting names only. A nonzero exit means configuration is incomplete.
5. Start the worker; check `/health`, database cursor advancement, `v2:pipeline` stage status, reconnect behavior and crash recovery. Verify that sustained ingestion outruns chain growth under representative swap volume.
6. Configure Vercel's worker origin and matching secret. Deploy the web release and test `/api/health`, `/api/events`, snapshots, token/trader pages and real quotes. `/api/health.launchReady` checks basic operational readiness, not every product acceptance criterion.
7. Disable the old external sync schedule only after the chain worker has caught up and the replacement read paths are verified. Chain mode disables legacy imports; existing imported history remains stored. Keep the old deployment available for rollback.

## Data and recovery

- Confirmed logs are fetched in ranges of at most ten blocks. Contiguous batches and their cursor commit atomically. Replays are idempotent.
- Reorganizations retain raw observations and original signal inputs, remove orphaned derived swaps/transfers, invalidate risk/relationship caches, and suspend affected receipt-backed positions.
- A reorganization deeper than the retained recovery window stops cursor advancement for operator review. Do not delete raw history to force recovery.
- Indexing, analytics and shared-cache fills use database leases. Each analytics stage records failure independently. WebSocket silence becomes reconnecting; a recent HTTP sync does not prove a trade source has advanced.
- Market snapshots rotate through stored tokens, with priority for active tokens. Charts are centrally refreshed for active and requested tokens. Web requests in worker mode use stored observations and queue chart demand.
- No server signs transactions. Read-only quote tests and wallet mocks are not real-money execution tests. Users confirm exact approvals, Permit2 authorization where required, and swaps separately.

## Verified evidence

- `direct-rpc-smoke.json`: real Uniswap V3 quote on Robinhood Chain; no financial transaction sent.
- `indexer-rpc-smoke.json`: 20 actual confirmed blocks committed in an isolated local database. The sample contained no swaps; this does not establish production throughput under load.
- Automated tests cover accounting, partial history, source isolation, cache concurrency, atomic batch failure, replay, reorg evidence, direct calldata tampering, exact approval, rejection, mobile navigation, chart recovery and anonymous preference isolation.

## Open product acceptance work

These are not all configuration issues. Do not describe the entire supplied specification as complete until they are resolved:

- Live Railway/Alchemy recovery and sustained-load validation; managed PostgreSQL migration/restore verification.
- Generic V4 pool indexing/routing, verified Universal Router ABI version, and broader multi-hop/non-native quote routing. Current verified live coverage is the tested V3 path; Pons curve and graduated-Pons V4 adapters require their own deployment and simulation validation.
- Complete historical basis and receipt-backed unrealized performance; evidence-based runner hit/rug rates. Missing metrics remain unmeasured.
- Explorer pagination/coverage, holder growth snapshots and live Base44 contract acceptance.
- Full canonical cursor pagination and complete historical read-model parity with imported source tables.
- Additional runner/creator/thesis alert types, cross-tab preference conflict handling and complete narrative/search integration.
- Representative browser/SSE fan-out load, retention sizing, staging rollback and failure drills.

Production must not be advertised as zero-delay, universally tradable, or fully tested on the strength of a clean build alone.
