# Supabase recovery — September 10, 2026

Production now uses Supabase project `annwtrmbqqgqwwmznpun` after Neon's
data-transfer quota blocked all database queries. Both local workspaces and the
Railway consumer use its session pooler on port 5432. Vercel uses the transaction
pooler on port 6543; `DIRECT_URL` retains the session endpoint for migrations.
Connection strings and passwords belong only in environment settings.

The September 9 PostgreSQL backup was restored without dropping the old database.
Saved public trader identities, rankings and wallet-token breakdowns were imported,
and the Stalkchain worker resumed bounded recent-history recovery and ingestion.
Records created after the backup may still be missing: the quota-blocked Neon
database cannot currently supply a complete final export. Keep it until that gap
can be checked. Imported historical leaderboard snapshots are not a continuously
updated Defined feed; ongoing full portfolio metrics still require Codex access.

All 34 application tables have RLS enabled and access revoked from Supabase's
anonymous/authenticated Data API roles. The existing server-owned guest identity
and authorization checks remain responsible for application writes.

Vercel uses node-postgres with `attachDatabasePool`, two connections per instance,
five-second idle cleanup, ten-second connection acquisition and fifteen-second
query timeouts. Supabase TLS is verified with its published root CA. This replaces
the persistent postgres.js sockets that intermittently hung server-rendered pages.
The long-running worker keeps its three-connection postgres.js pool.

The worker deduplicates replayed trades before writing, persists its heartbeat
every fifteen seconds, recomputes analytics every fifteen minutes, and enriches
token inventory in batches of thirty. Browser snapshots request only records
after the last sequence. These measures reduce database traffic, but free-tier
capacity still depends on visitors, retention and upstream activity; monitor
Supabase storage and egress usage.

No Alchemy polling is active. Stalkchain remains a public source with variable
delay and bounded history. Charts and swap quotes use their existing live market
providers. Do not claim zero-delay, complete cost basis, or guaranteed liquidity
for every token. Never substitute current prices for historical execution prices.

Validation: production build and type checking; isolated regression, trading and
browser flows; live local and production route checks; real chart candles, swap
previews, worker health and event-stream checks. Wallet signing and funded swaps
are not executed by automated deployment verification.
