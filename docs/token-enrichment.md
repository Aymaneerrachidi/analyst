# Token market enrichment

The shared live-feed worker refreshes recent tokens and rotates through the complete token inventory every minute. Each cycle makes at most two public Dexscreener requests (30 addresses each). A failed cycle backs off five minutes and retains its rotation checkpoint. No Alchemy requests or API key are used.

Exact Robinhood chain and base-token address matches only. The deepest reported liquidity pool supplies current quotes. Missing fields preserve existing values; unlisted tokens remain unknown. Observations use collection time and never rewrite historical trade execution prices. Metadata and images can update even without a usable price.

Run parser checks with `node --conditions=react-server --import tsx --test scripts/market-data.test.ts`. Inspect the `markets:dexscreener` app metadata record for the last successful scan, counts and inventory cursor. At 30 inventory tokens per minute, a 3,000-token sweep takes about 100 minutes; the 30 most recently active tokens are also checked every minute.
