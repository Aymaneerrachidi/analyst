# Public data and interface rollout — 10 September 2026

Production: https://analyst-orpin.vercel.app

## Delivered

- Defined public Robinhood rankings take priority by wallet and period. The collector visits the normal public page, selects Robinhood, and captures the monthly, daily and weekly views. Only network 4663 records are accepted. It does not reuse site credentials or bypass access challenges.
- The Railway worker runs the collector hourly in a short-lived Chromium session, independently of visitors. A persisted hourly attempt limit prevents restart loops. Failed collections retain original snapshot timestamps.
- Stalkchain supplements wallets absent from Defined. Rankings use realizedUsd, never the combined realized/unrealized DEX headline. Multi-wallet group totals are excluded from individual-wallet metrics. Its lifetime win rate is not mislabeled as a daily/weekly win rate. Incomplete cost basis is disclosed.
- Hourly ranking snapshots retain five days of history. Fresh Defined metrics win over Stalkchain; older Defined metrics yield when the fallback has that wallet and period. Otherwise the older snapshot remains visible with its real timestamp.
- Runner Radar is replaced by the Research workspace. Token and research pages use the configured, shared Base44 pipeline. The obsolete why-pumping endpoint forwards to that pipeline locally.
- Compact chart markers show actual portraits where available, with B/S labels otherwise. Nearby trades group by side, remain selectable, and reposition with chart scrolling, resizing and price-scale interaction. Candles remain actual provider observations.
- Added cached holder evidence from HoodExplorer. The application caps this provider at six token checks (12 requests) per minute globally, with a five-minute shared cache. This is our conservative cap, not a promised provider allowance. Burn addresses are excluded; unidentified pools/exchanges may remain in the sample. No contract-safety guarantee is inferred.
- Removed All Time leaderboard tabs and feed status badges. Original trade and ranking timestamps remain visible.
- Expanded the image proxy's observed-host allowlist and allowed at most two redirects to approved HTTPS hosts. Export: .data/image-export/manifest.json. At export: 231 trader images and 1,434 token images downloaded; 68 traders and 2,105 tokens had no image source, and 23 source images could not be retrieved. No replacement portraits or logos were generated.

## Verification

- Both application builds and TypeScript checks passed; lint passed.
- 49 regression/chain/trading/intelligence checks passed, plus seven market/ranking checks.
- All 16 browser tests passed: chart refresh recovery including a painted single point, trade details, following, alerts, filters, search, mobile layout, community CRUD, preference isolation and simulated wallet approval/rejection flows.
- Live production audit: 11 page routes returned 200 without page errors; research, token and leaderboard layouts fit a 390px screen. Tokens/trades/rankings/chart/research APIs returned 200. The PONS chart returned 96 actual GeckoTerminal candles. A Stalkchain fallback profile retained its leaderboard PnL. Holder inspection returned 20 accounts. A new Base44 report returned six observations and six risks for the requested token.
- Railway deployment 099c76c3-e7f0-40c5-9e35-54b9c0e21b41 succeeded. Its own public-page capture at 21:45:26 UTC produced 108 Defined wallets; the combined refresh completed at 21:46 UTC with 132 wallets (108 Defined, 24 Stalkchain).

## Remaining practical limits

No additional key is required for these changes. Public-page collection has no availability guarantee and can break when Defined changes its site or restricts access. Authenticated Codex access remains the supported alternative for guaranteed API integration; it is not configured or required for this fallback.

Stalkchain is still the main upstream feed, supplemented by the existing MadeOnSol integration. During the live check it was about two minutes behind. The worker delivers received records immediately, but cannot make the upstream publish earlier. Alchemy continuous polling remains disabled.

HoodExplorer adds holder and metadata coverage; it does not reconstruct verified swaps or complete trader cost basis. RobinX's free report was also investigated, but the inspected holder snapshot was dated July 29, so it was not used as current evidence. CloudOnRH focuses on stock-token markets rather than KOL transaction history.

Missing logos and incomplete histories cannot be filled honestly without an additional source. Wallet transaction tests use isolated simulated wallet interactions; no real funded swap was broadcast during QA. This verification does not certify every contract as safe or guarantee future third-party uptime.
