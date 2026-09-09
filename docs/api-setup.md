# API and hosting setup

The replacement reads confirmed Robinhood Chain logs, stores them in our existing PostgreSQL database, and streams updates through an always-running worker. It cannot recover social names/photos from chain logs alone or guarantee zero latency. Historical coverage starts at the configured block. These instructions apply to the V2 worker release, not the currently deployed legacy release.

## 1. Alchemy: required chain access

Open https://dashboard.alchemy.com/ and create an app for **Robinhood Chain mainnet (4663)**, not testnet. Copy the app's HTTP and WebSocket endpoints. For historical indexing, enable an archive-capable endpoint and check your request allowance.

Set these on Railway; also set the HTTP URL on Vercel for quote simulation, balances and receipt verification:

```dotenv
ALCHEMY_RPC_URL=https://robinhood-mainnet.g.alchemy.com/v2/YOUR_KEY
ALCHEMY_WS_URL=wss://robinhood-mainnet.g.alchemy.com/v2/YOUR_KEY
```

Official network/provider instructions: https://docs.robinhood.com/chain/connecting/. Public RPC is rate-limited and unsuitable as our production feed. The public sequencer feed is not interchangeable with a JSON-RPC WebSocket endpoint.

## 2. Railway: required continuous collector

Create an account at https://railway.com/. Create a project/service from **Aymaneerrachidi/analyst** once the V2 worker branch is available. Use repository root `/`, configuration file **worker/railway.toml**, and Dockerfile **worker/Dockerfile**. Run one replica initially; keep the service continuously running. Do not enable sleeping/serverless mode for this collector.

In the service Variables tab, add:

| Variable | Value/source |
| --- | --- |
| `DATA_PROVIDER` | `chain` |
| `DATABASE_URL` | Existing production PostgreSQL connection, same database as Vercel |
| `ALCHEMY_RPC_URL`, `ALCHEMY_WS_URL` | Alchemy app endpoints above |
| `INDEXER_SECRET` | Generate a new random secret; same value on Vercel |
| `INDEXER_START_BLOCK` | Agreed historical coverage start; choose before starting/backfilling, not a guessed number |
| `INDEXER_CONFIRMATIONS` | `6` |
| `INDEXER_BATCH_BLOCKS` | `50` initially; tune only after throughput testing |
| `INDEXER_POLL_MS` | `4000` |
| `MARKET_DATA_PROVIDER` | `dexscreener` |
| `MARKET_DATA_CHAIN` | `robinhood` |

Generate the worker secret locally with Node:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Set the verified contract configuration below on Railway and Vercel. Then generate a public HTTPS domain for the worker, targeting its assigned `PORT` (or 8080 when no PORT is assigned). Copy its origin, for example `https://YOUR-SERVICE.up.railway.app`. Railway configuration documentation: https://docs.railway.com/variables and https://docs.railway.com/networking/public-networking.

## 3. Vercel: connect the site after worker validation

Project **analyst → Settings → Environment Variables → Production**:

```dotenv
DATA_PROVIDER=chain
INDEXER_URL=https://YOUR-SERVICE.up.railway.app
INDEXER_SECRET=SAME_SECRET_AS_RAILWAY
ALCHEMY_RPC_URL=YOUR_ALCHEMY_HTTP_ENDPOINT
```

Keep existing `DATABASE_URL`, `DIRECT_URL`, `GUEST_HASH_SALT`, `INTERNAL_SYNC_SECRET` and `NEXT_PUBLIC_APP_URL` stable. No new database account is required. Do not add any secret with a `NEXT_PUBLIC_` prefix. Redeploy after environment changes: https://vercel.com/docs/environment-variables.

**Do not switch the production site to chain mode until migrations, worker health, coverage and web read paths have been verified.** The token outage hotfix can ship independently. Disable the old KOLHOOD scheduler after the replacement is validated; chain mode explicitly rejects legacy sync calls.

## Verified contract settings (not API keys)

These deployments were checked against public source records and Robinhood mainnet RPC on September 8, 2026. Recheck bytecode pins during rollout. V3 quote simulation succeeded; this is not proof of every trading route.

```dotenv
WRAPPED_NATIVE_ADDRESS=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
PONS_V1_FACTORY_ADDRESS=0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB
PONS_FACTORY_ADDRESS=0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e
PONS_FACTORY_CODE_HASH=0x89a27da6f703e0a7cdd4f233e7cb57604ff75b164530962d3ff7cf8483a67d84
UNISWAP_FACTORY_ADDRESS=0x1f7d7550B1b028f7571E69A784071F0205FD2EfA
UNISWAP_ROUTER_ADDRESS=0xCaf681a66D020601342297493863E78C959E5cb2
UNISWAP_ROUTER_CODE_HASH=0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc
UNISWAP_QUOTER_ADDRESS=0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7
UNISWAP_QUOTER_CODE_HASH=0x3db0868d945e9304c9bc6a8b2181948109ea617647142f3c4083e14393496a28
```

Leave V4 router settings unset until its deployed ABI and simulations are verified. `VERIFIED_POOL_ADDRESSES` can seed existing pools; factory discovery alone discovers launches in the indexed block range, not every historical pool. `USD_QUOTE_ADDRESSES` must contain verified quote-token addresses, never symbols or guessed stablecoins.

## Optional services and honest coverage

- **Dexscreener**: public market API; no app API key setting is required. Prices/images depend on actual indexed token coverage. `DEXSCREENER_BASE_URL=https://api.dexscreener.com`. Reference: https://docs.dexscreener.com/api/reference.
- **Blockscout**: `BLOCKSCOUT_API_URL` must point to an accessible explorer API. The default Robinhood host returned 403 during testing; verify access before relying on holder/source information. An Alchemy key does not unlock this API.
- **Base44 research**: optional `BASE44_AGENT_URL`, `BASE44_AGENT_KEY`, optional `BASE44_AGENT_ID`. A generic dashboard key alone is insufficient: the endpoint must implement [our HTTP contract](base44-contract.md). Core feed does not require it.
- **Stock metadata**: `STOCK_TOKEN_API_URL` is optional; it does not make stock tokens universally tradable.
- **0x, X and direct OpenAI keys**: not required by the V2 execution/feed architecture.
- **Trader names and photos**: preserve already imported authentic profiles. New wallet identities need a verified social/profile source or user-supplied profile verification. RPC cannot produce these facts; never fabricate them.

## What remains before launch

Apply the additive database migration on staging first, test restore, configure the worker, seed/discover pools, backfill chosen history, verify cursor catch-up and restart recovery, then test web pages against its real data. Generic V4 coverage, complete historical accounting, canonical pagination and additional alert types are still implementation work, not issues solved by buying API keys. See [the release gates](v2-operations.md).
