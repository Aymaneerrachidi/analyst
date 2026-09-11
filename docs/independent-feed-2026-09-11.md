# Independent Robinhood trade feed

The Railway worker now supports a direct public-RPC feed alongside the existing Stalkchain consumer. This implementation was inspired by the public FomoPulse architecture, not a dependency on its hosted trade feed or credentials.

## Data path

- PublicNode WebSocket: two ERC20 Transfer subscriptions filtered to the Fomo wallet roster. Five-second block-number heartbeat, reconnects, and five-block eligibility delay.
- PublicNode HTTP: transaction receipts, canonical block timestamps, and cached ERC20 precision/labels.
- Official Robinhood HTTP: two filtered getLogs scans, up to 500 blocks per scan range. PublicNode rejects this method; OrdoFi was behind the live head during testing, so neither is used for recovery.
- One shared database lease prevents two deployed consumers from spending the request budget simultaneously. At most 60 HTTP RPC requests per rolling minute, spaced at least 1.1 seconds; log scans at least 1.5 seconds. WebSocket heartbeats are separate small requests. No Alchemy calls or credentials.
- A durable cursor advances only after every receipt in the range has been processed and persisted. Live work is interleaved with historical recovery. Existing execution uniqueness prevents duplicate counting across sources and restarts.
- FomoPulse public trader identities are refreshed daily and deduplicated by wallet; no hosted PnL is imported. The direct roster is capped at 350 (294 at verification). Other existing wallets remain on Stalkchain backup coverage.

## What counts as a trade

A successful, non-removed receipt must contain a swap from the canonical Uniswap v4 PoolManager and movement of the target token at that manager. Require one tracked wallet, one non-USDG net asset, and an opposing USDG cash delta. Relay settlement requires an exact single token boundary and one cash leg. Ambiguous bundles, NFT transfers, gifts and unrelated token transfers are excluded. This is conservative v4 coverage, not a claim to decode every DEX or routing shape.

Amounts come from raw integer receipt values and contract decimals. USDG conversion uses agreement between at least three liquid Dexscreener pairs; it does not hard-code a dollar peg. If the quote is unavailable, USD price stays unknown. Previously unpriced public records can be repaired on restart. Reorg removal notifications retract this worker's own executions.

## Operations

`PUBLIC_RPC_FEED_ENABLED=0` disables the independent consumer for rollback; Stalkchain continues. No new paid API key is required. Existing DATABASE_URL and INDEXER_SECRET remain required by the combined worker.

Inspect `/health` on Railway: `independent` reports connection, tracked wallets, cursor, pending queue, request count, last progress and insertion latency. Database keys: `public-feed:worker`, `public-feed:cursor`, `public-feed:discovery`, `public-feed:lease`. The website freshness endpoint selects recent independent health before backup health. The browser continues its existing incremental trade requests/SSE.

## Verification

- Decoder tests cover direct buys/sells, relay settlement, unpriced USD conversion, failed/removed receipts, NFTs, shared relays and ambiguous multi-token attribution.
- Regression suite: 25 tests passed. Updated the outdated directory fixture to match the already-shipped complete-market/trending rules.
- Production website build, worker bundle and TypeScript checks passed before rollout.
- Live receipt checks reproduced real cash legs and token quantities. During a bounded 294-wallet test, current executions were persisted approximately 6?10 seconds after their block timestamp, while recovery progressed. This is a measurement, not a latency guarantee.
- Public providers can throttle or go offline. Full historical PnL, non-v4 coverage and instant execution across every wallet are not claimed.

References: https://github.com/itsnex1s/fomopulse-robinhood-chain-tape ; https://developers.uniswap.org/docs/protocols/v4/deployments

Final pre-deploy check: 61 stored independent executions, all priced, zero duplicate execution groups. Candidate production browser received incremental rows with HTTP 200 and no JavaScript errors; recovery reached the current head.
