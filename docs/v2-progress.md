# V2 implementation and verification ledger

The complete supplied brief is preserved in `analyst-v2-spec.md`. Extend the existing application; preserve real data and non-custodial signing. New requirements replace 0x with direct verified DEX routing. Credentials unavailable tonight must fail closed with exact setup instructions.

## Baseline

Phase 0 audit fixes: committed `9d47876`, deployed to production on 2026-09-08. Local typecheck, lint, build, 24 regression tests, seven trading tests and 12 browser scenarios passed. Production dependency audit: zero vulnerabilities. Live source/profile consistency and desktop/mobile routes checked; final audit report is being completed.

## Current implementation (September 9)

The V2 code includes the additive schema, V2/V3/curve ingestion, atomic cursor/reorg recovery, shared stream, market/chart pipeline, computed metrics with coverage, smart-money and Runner signals, risk/evidence panels, Base44 contract adapter, direct trading adapters, positions, preferences, alerts and new intelligence pages. These are implemented components, not a completed production acceptance claim.

The independent token-directory outage fix is deployed as `4ea1e61`. Production returned stored tokens for the 24-hour window and correctly identified its latest trade as September 7 after rollout. KOLHOOD remains stalled.

Chain mode now explicitly disables legacy imports, removes the worker's upstream socket, measures freshness from the confirmed cursor, and reconciles canonical fills on incremental trade polls. Three dedicated integration tests cover source isolation, cursor freshness and filter-preserving canonical polling.

Required account/environment setup is in `api-setup.md`. Open coding and operational acceptance items are in `v2-operations.md`. Phase boxes below mean full acceptance, not merely that code exists. Alchemy/Railway and a staging PostgreSQL migration are not yet configured or verified.

## Delivery order

- [x] Phase 0: source consistency, missing states, categories, grouping, pagination, community guards.
- [ ] Phase 1: additive PostgreSQL schema, immutable raw events, canonical blocks, verified pools, normalized swaps/transfers, continuous recoverable worker, shared live delivery, snapshots.
- [ ] Phase 2: internally computed period metrics, sample confidence, classifications and trader UI.
- [ ] Phase 3: weighted smart-money consensus with explainable coverage.
- [ ] Phase 4: point-in-time Runner scoring, stored signals and Radar.
- [ ] Phase 5: wallet detective, evidence-backed edges, creators and holders.
- [ ] Phase 6: risk checks with unknown coverage, pre-signing presentation.
- [ ] Phase 7: authenticated Base44 adapter, validated reports, shared cache and token UI.
- [ ] Phase 8: verified direct Pons/Uniswap configuration, quote/simulation, exact approvals, wallet confirmation, receipt-verified positions.
- [ ] Phase 9: position comparisons, durable preferences/alerts, personalized feed.
- [ ] Phase 10: signal outcomes, narratives, comparison, bounded relationship graph, search/dashboard integration.
- [ ] Full acceptance: parser/reorg/recovery/accounting/scoring/API/UI/wallet/security tests, migrations, worker dry run, live provider checks, deployment and morning setup list.

## Architecture decisions

Retain Next.js, existing components, viem, Drizzle and PostgreSQL. The current managed Neon database is PostgreSQL; additive migrations also support a Supabase PostgreSQL connection without requiring browser database credentials or an unnecessary database move. Existing rolling `token_snapshots` stay intact; immutable observation history uses a separate time-series table. Existing imported rankings remain labeled source snapshots until sufficient indexed history exists.

Direct contract adapters must not guess Robinhood deployments or ABIs. Missing verified router/factory configuration disables only the affected route. Chain indexing requires an explicit starting block and records its coverage. No server-side signing or real-money test transactions.
