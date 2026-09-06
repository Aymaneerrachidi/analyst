# ANALYST — technical design (2026-09-06)

Product spec: see the original brief (KOLSCAN-style social intelligence layer for Robinhood Chain traders). This document records the technical decisions made to implement it.

## Upstream findings (kolhood.io, inspected 2026-09-06)

KOLHOOD is a Next.js app whose own frontend calls these same-origin JSON routes. They are public (no auth, `Access-Control-Allow-Origin: *`, no robots.txt):

| Route | Shape |
| --- | --- |
| `GET /api/trades?limit=N` | `{ data: Trade[], source }` — id, tx_hash, wallet_address, action buy/sell, token_address, token_symbol, token_name, eth_amount, token_amount (always 0), usd_value, dex, timestamp |
| `GET /api/wallets/list` | `Wallet[]` — address, name, twitter, local_avatar, pnl_24h, recentTrades[] |
| `GET /api/wallets/:address/profile` | `{ kol, native_balance, summary { realized_pnl_usd, total_volume_usd, total_trades, win_rate, top_win_usd }, holdings[], recent_trades[] }` |
| `GET /api/leaderboard?period=24h|7d|30d|all` | `{ data: Row[] }` — wallet_address, wallet_name, wallet_twitter, total_pnl_usd, total_trades, buy_count, sell_count, best_trade_usd |
| `GET /api/tokens/trending` | `{ data: Token[] }` — token_address, token_symbol, latest_activity, kol_count, kol_net_inflow (ETH), volume_24h (USD), kols_activity[] |

Not available upstream: token price, market cap, token amounts (always 0), per-trade realized PnL. These are optional in the normalized model and rendered as unavailable rather than faked. Explorer: `https://explorer.robinhood.com`.

## Architecture

```
provider (mock | kolhood)  →  sync service  →  Postgres (Drizzle)  →  services  →  RSC pages + /api routes  →  client (TanStack Query polling)
```

- **Provider layer** (`lib/providers`): `DataProvider` interface with normalized upstream types. `kolhood.ts` wraps the routes above; `mock.ts` is a deterministic generator (20 traders, 30 tokens, 500 historical trades, continuous synthetic live trades). Selected by `DATA_PROVIDER`.
- **Sync** (`lib/services/sync.ts`): upserts traders, tokens, trades; computes per-window token snapshots (buys/sells/net flow/Analyst Score components), trader snapshots per period, trader-token stats. Triggered by `POST /api/internal/sync` (secret-protected) and by throttled sync-on-read so the app is alive in dev without a cron.
- **Database**: Drizzle `pg-core` schema. Driver is `postgres` when `DATABASE_URL` is set (Supabase/Postgres), otherwise embedded PGlite in `.data/pglite` so the project runs immediately after clone. Migrations in `drizzle/` run automatically at boot.
- **Guests**: HttpOnly cookie with a random token; only its SHA-256 hash is stored. IP is hashed with a server salt and never stored raw.
- **Anti-spam**: DB-backed sliding-window limits per guest, in-memory limits per IP hash, cooldowns, duplicate detection, honeypot, URL cap, moderation hook, reports.
- **Live**: clients poll `/api/trades?after=<cursor>` every 5 s. Live indicator reads server freshness; shows DELAYED when last successful sync is older than the freshness threshold.
- **Analyst Score**: 0–100, components stored separately (quality 30, accumulation 25, breadth 20, conviction 15, momentum 10). Community rating (1–10) is a separate concept.
