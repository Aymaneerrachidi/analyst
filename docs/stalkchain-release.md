# Current Stalkchain release: setup and remaining data requirements

Verified 2026-09-09. Website: https://analyst-orpin.vercel.app

The production website is on main (application release afd8ab2); its continuously running Railway worker is deployed from feat/independent-chain-pipeline (f3cee9b). Do not deploy the entire experimental V2 website over main just to update the worker. Both use the same managed database.

## Already configured

| Service | Where | Configuration | Purpose |
| --- | --- | --- | --- |
| Stalkchain shared feed | Railway | LIVE_FEED_SOURCE=stalkchain; WEBHOOK_FEED_ENABLED=1 | Public trade stream and rolling recent wallet history; no API key |
| Worker connection | Vercel | INDEXER_URL; INDEXER_SECRET | Shared authenticated live updates; secret matches Railway |
| Managed PostgreSQL | Both | DATABASE_URL | Shared token, trader, trade and community records |
| Token market enrichment | Worker | MARKET_DATA_PROVIDER=dexscreener; MARKET_DATA_CHAIN=robinhood | Public token quotes and images, no key |
| Trading quotes/routes | Vercel | ZERO_EX_API_KEY | Existing 0x key; available routes depend on token/liquidity/provider access |
| Token metadata and wallet balances for trading | Vercel | ROBINHOOD_RPC_URL optional | Uses configured public Robinhood RPC when unset; no Alchemy scanning |
| Persistent image cache | Vercel | BLOB_READ_WRITE_TOKEN | Connected Vercel Blob store |
| Scheduler | Vercel / Upstash | QSTASH_TOKEN and signing keys | Already present; the Railway worker handles current live ingestion |
| Application secrets | Vercel | GUEST_HASH_SALT; INTERNAL_SYNC_SECRET; NEXT_PUBLIC_APP_URL | Already configured; preserve existing secrets |

WEBHOOK_FEED_ENABLED is a compatibility switch disabling old KOLHOOD sync. It does not mean the Alchemy webhook is active. That webhook remains paused; the current worker makes no Alchemy calls.

## API accounts if needed

- 0x: https://dashboard.0x.org/ — already configured. Store replacement keys as ZERO_EX_API_KEY in Vercel Production and redeploy. No wallet private key belongs in app environment variables.
- Blockscout: https://dev.blockscout.com/ — optional BLOCKSCOUT_PRO_API_KEY on Railway. Current implementation only cross-checks recent transactions when external rankings refresh; adding this key alone does not replace the trade feed or create complete PnL.
- Codex, deferred: https://dashboard.codex.io/ — CODEX_API_KEY on Railway. Rankings and token-performance refresh are implemented behind this credential. Holdings, historical PnL charts and the replacement live wallet stream still require integration and verification with an entitled key.
- Dedicated Robinhood RPC, optional: provision a Robinhood MAINNET endpoint with a provider and set ROBINHOOD_RPC_URL on Vercel if public RPC capacity becomes insufficient for user trading reads. Do not restart the retired broad Alchemy indexer.

## Honest coverage

224 tracked wallets. Stalkchain source latency varies and the UI reports delayed when appropriate. Dexscreener refreshes the 30 most recently active tokens plus 30 rotating inventory tokens per minute, with backoff on failure. Unlisted assets and invalid source prices remain unknown.

The Defined leaderboard and per-token performance are dated public snapshots for 50 traders, not automatically refreshed data while CODEX_API_KEY is absent. Recent public swap imports are partial. Current token prices are never substituted for historical execution prices.

No additional API key is needed to continue running this interim release. No combination of the currently configured keys guarantees complete holdings, accurate full-history PnL, every token chart, every executable token route or zero-delay trades. Those are provider coverage/integration limits, not just missing environment variables.

## Checks

Production trade, token, freshness and trading-asset endpoints returned 200. Railway health returned 200 with the Stalkchain consumer active. Production browser check verified the Profit by token table and no page exceptions. Builds, TypeScript, lint and source parser tests passed during release. These checks do not constitute a signed on-chain swap or a full production-load test.
