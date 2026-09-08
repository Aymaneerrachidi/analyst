# Public-site audit fixes

The supplied twelve-point audit was addressed without replacing missing market data with generated values.

| Audit issue | Change |
| --- | --- |
| Conflicting trader metrics | Leaderboard and profile read the same selected-period snapshot. Source, period and captured date identify imported Defined statistics. No lifetime fallback fills a missing period metric. |
| Conflicting tracked PnL | Tracked charts and performance tables explicitly cover partial recorded history. Source totals never become chart samples. Unknown realized PnL is excluded; pre-observation zero buckets are omitted. |
| Token SSR mismatch | The server supplies the known market quote and actual recorded trades from the last day. Timeline counts describe recorded swaps; price markers still require execution prices. |
| Initial connection state | Server-rendered status shows last sync. The browser's actual socket connection controls LIVE; reconnection remains explicit. |
| Mixed token categories | All, Memes, Stock-linked, Stablecoins, Other and Newly tracked filters run before pagination. Memes is the default. Categories describe symbols, not verified issuer affiliations; unknown assets stay in Other and All. Newly tracked is first observation, not an asserted launch date. |
| Company/token valuations | Token detail and monitor valuations explicitly describe on-chain token MC / token FDV. |
| Directional score language | Activity labels replace bullish/bearish score labels. Buy/sell-share text describes flow direction. |
| Repetitive live transactions | Same trader, contract and direction are grouped within 60 seconds. Expandable rows retain every original transaction. Unknown values are excluded from totals and labeled as partial. |
| Missing fields | Entirely unsupported trade price/PnL and trader rating/buy-sell columns disappear. Imported buy/sell counts are not fabricated. |
| Terminology and polish | Tracked traders replaces KOL labels, counts handle singular forms, repeated dollar prefixes are normalized, and absent prices do not show a misleading percentage. |
| Empty community | A trusted Analyst system identity publishes a genuine notable completed 30-minute interval after ingestion. Requires at least three buyers, $1,000 positive recorded net flow and known USD values for every included trade. At most one thread per interval; exact contract references, no synthetic votes or users. No qualifying activity means no generated post. |
| Abuse controls | Atomic PostgreSQL budgets per hashed IP and guest cover posts, comments, votes, ratings, reports and identity changes. Existing moderation, cooldowns, duplicate protection and HttpOnly identity remain. Cross-site writes and JSON bodies above 64 KiB are rejected. |
| Large leaderboard | 25 rows per page; next-page probe, stable ordering and URL-preserved period/filter/search. |

## Verification

Regression tests exercise source consistency, missing period metrics, burst boundaries/unknown values, concurrent durable limits and deterministic system event publishing, alongside the existing data, chart and community tests. Browser checks cover period/filter navigation, request guards, chart refresh failure/recovery, following, alerts, trade markers, live controls, mobile layouts, community writes and wallet review.

The deployment verification report is `production-audit-2026-09-08.json`.

## Operational limits

- Defined entries remain captured snapshots until a new authorized import supplies them; badges expose their dates. Partial transaction reconstruction is not full historical accounting.
- Socket delivery follows the upstream broadcast. Persisted analytics follow the configured QStash schedule. Neither promises zero network or upstream delay.
- Missing source prices, images, quantities or history remain unavailable. Category inference is conservative and should eventually use provider-backed classifications by contract.
- Anonymous browser identity is rate limited, not proof of a unique human; optional wallet-signature identity remains future work. Shared-network users share an IP budget. Vercel overwrites the client IP forwarding header, as documented in its [request headers reference](https://vercel.com/docs/headers/request-headers). Other hosting proxies must enforce equivalent trusted headers.
- No schema migration is required: budgets and event provenance use `app_meta`; expired budgets are removed during successful sync. Monitor scheduled sync and system event failure logs.
- Continue the launch checklist in `production-launch.md`: traffic testing, restore drills, operational alerts and owner-approved public policies are operational acceptance work, not guaranteed by a clean build.
