# Free-data rollout — 10 September 2026

## Connected services

| Feature | Service | Configuration / operating limit |
| --- | --- | --- |
| Tracked wallet feed | Stalkchain public feed and recent wallet history | Existing Railway consumer. Provider-reported trades; can be delayed. |
| Supplemental Robinhood KOL trades | MadeOnSol | `MADEONSOL_API_KEY` on Railway. Feed every 15 minutes, three net-flow snapshots hourly: planned 168 requests/day; persisted hard stop at 180 of the free 200/day. |
| Supplemental trade attribution | Robinhood public RPC | Receipts only, no block scanning or Alchemy usage. Calls spaced 2.5 seconds apart, shared ceiling of 24/minute. Only matching net token movement to/from the reported wallet is accepted. This validates direction, not the provider's historical USD valuation. |
| Token prices / images | Dexscreener and existing market enrichers | Public endpoints, caching; missing source images remain missing. |
| Market history | GeckoTerminal, Pons, DexPaprika fallback | Shared GeckoTerminal ceiling 25/minute; DexPaprika 12/minute. Pool metadata cached 10 minutes and Paprika candles 60 seconds. Quote-token candles retain their actual unit (e.g. USDG), never converted using today's USD quote. |
| Leaderboard | Analyst recorded-swap analytics | Hourly snapshots retained five days; 24h/7d/30d windows. Partial recorded history, not a newly fetched Defined leaderboard. MadeOnSol net flow is stored separately and never presented as realized PnL. |
| AI token research | Supplied Base44 agent | Vercel `BASE44_AGENT_API_BASE`, `BASE44_AGENT_API_KEY`, `BASE44_AGENT_CONVERSATION_ID`. On-demand reports, no access code. 15-minute report reuse, 50/day global cap, serialized requests. Only a new structured response matching the request UUID and token can be displayed; conversation history stays server-side. |
| In-app swaps | Existing 0x integration | `ZERO_EX_API_KEY` on Vercel. Route availability and wallet confirmation still required. |
| Persistence / background worker | Supabase / Railway | Existing `DATABASE_URL`, `DIRECT_URL`, `INDEXER_URL`, `INDEXER_SECRET`; unchanged credentials. |

No Codex purchase or new Alchemy plan is required for this rollout. Railway and database hosting remain subject to their own account allowances.

## Coverage limits

The free MadeOnSol feed itself is delayed and limited to its recent window. Polling every 15 minutes cannot promise every trade during a busy interval. Receipt filtering deliberately excludes intermediate router assets and transactions whose wallet attribution cannot be confirmed. Custodial or proxy-held positions may be omitted. Stalkchain remains provider-reported, rather than independently receipt-verified for every historical record.

A 10 September inventory counted 24,313 stored trades (all with transaction hashes), 18,417 with prices, 19,097 with quantities, 3,368 tokens (1,441 source images), and 224 traders (208 avatars). These are an inventory at that time, not a promise of complete coverage; later imports and receipt quarantine change the totals. Realized PnL, entry price and holding duration are limited by missing historical purchases/quantities.

Other sources investigated: DexPaprika Robinhood pools, OHLCV and transactions respond without a key. Its transaction sender/recipient may be a router, so pool transactions are not blindly assigned to KOL wallets. KOLScan endpoints returned 500; Blockscout public reads returned 403 in this environment; CabalSpy needs an account/key and confirmed Robinhood endpoint coverage before integration. None is represented as an active reliable fallback.

## Verification

Production build, TypeScript and lint pass. 25 regression tests, 7 swap validation tests and 2 chart/research validation tests pass. Browser tests cover navigation, mobile width, filters, following, custom alerts, chart refresh failure/recovery, KOL marker selection, community interactions, trade preview, wallet rejection and exact token approvals. All 12 browser scenarios passed after correcting UTC hydration and updating canvas-chart assertions (the final overview scenario rerun separately).

The Base44 agent returned a correlated structured token report in a real connectivity test. MadeOnSol authenticated feed and 24h/7d/30d net-flow endpoints responded successfully. Token directions are checked before supplemental ingestion; this is not a blanket audit of every historical trade or USD value.

## Source documentation

- https://madeonsol.com/api-docs
- https://madeonsol.com/developer
- https://docs.dexpaprika.com/api-reference/pools/get-ohlcv-data-for-a-pool-pair
- https://dexpaprika.com/api/pricing?chain=robinhood
- https://docs.robinhood.com/chain/connecting/
- https://docs.cabalspy.xyz/pricing
