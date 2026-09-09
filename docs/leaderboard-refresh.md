# Leaderboard refresh

The leaderboard and trader profiles read one saved ranking snapshot, independent
of partial trade-history analytics. Daily, weekly and monthly realized PnL,
ROI, win rate and trade counts come from the same period in that snapshot.
Missing PnL excludes a wallet; missing metrics stay unknown. One-year results are
never relabeled as all-time. Search preserves the ranking position.

The UI polls Analyst every 30 seconds and shows the actual snapshot capture time
and coverage. Provider names are kept in internal provenance, not displayed as
badges. A manually captured public snapshot is labeled as saved; polling does not
make its values fresh. September 9 bootstrap: 50 currently tracked wallets from
Defined's public Robinhood trader page, with 24h/7d/30d metrics.

The Railway worker can refresh all tracked wallets every 15 minutes using our
own `CODEX_API_KEY`. The `filterWallets` endpoint needs wallet analytics access
(the Codex documentation currently specifies Growth or Enterprise). Obtain an
account/key at https://dashboard.codex.io/ and add it to Railway's source worker.
No purchase or plan upgrade was made. Without the key, the saved snapshot stays
available and automatic external ranking refresh remains unconnected.

For optional recent-transaction cross-checks, obtain a free API key at
https://dev.blockscout.com/ and add `BLOCKSCOUT_PRO_API_KEY` to Railway. The worker
checks up to three leading wallets per refresh using chain ID 4663. This confirms
recent wallet activity only; it does not independently reconstruct PnL or prove
complete cost-basis history. Supported-chain access must be tested with the key.

Direct anonymous checks returned Defined API 401 and Blockscout API 403. Neither
protected endpoint is bypassed. Keys remain server-side. Failed refreshes retain
the last valid snapshot. Status is recorded in `leaderboard:refresh`; transaction
checks are recorded separately under `leaderboard:activity:<wallet>`.

Validation: `node --import tsx --test scripts/leaderboard-data.test.ts`, typecheck,
lint, production build, source snapshot import and browser checks.
