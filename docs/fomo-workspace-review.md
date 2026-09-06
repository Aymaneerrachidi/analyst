# Workspace review — 6 September 2026

Reviewed the signed-in Fomo interface in the browser, with the user's permission. Reference captures are local, ignored files; no Fomo artwork, private session data, balances, or user posts are shipped in ANALYST.

| Reference area | Observed structure | ANALYST implementation |
| --- | --- | --- |
| Robinhood PONS token and BNB elon token | Persistent discovery column, token header, chart, activity below, insight/order column | Persistent market discovery; chart-first token workspace; compact metrics and right-side tracked-wallet insights |
| Token discovery | Trending, most held, launch stages, watchlist, chain selector | Existing Robinhood token filters; market discovery search; local watchlist |
| Swaps, holders, thesis | Independent tabbed tables under the chart | Swaps, active traders, discussion tabs; active traders are not mislabeled as all holders |
| Leaderboard | Time windows, trader ranking, separate clan rankings | Existing performance filters and ranking periods; additional Defined wallets and source dates |
| Feed and alerts | Social posts, wallet trades, size filters, followed traders | Existing live filtered wallet stream and community feed |
| Profile | Identity, performance chart, positions, trade history, follows | Compact trader profiles with token history, swaps, discussion tabs and provenance |
| Search | Search stays accessible across the workspace | Existing keyboard search and compact discovery filtering |
| Public home, blog, answers, affiliates | Public education and acquisition pages, separate from terminal | Reviewed for navigation context; no copied marketing pages or invented affiliate program |

Primary references: [Fomo Robinhood trading](https://fomo.family/tokens/robinhood/0x39dbed3a2bd333467115de45665cc57f813c4571), [Fomo BNB trading](https://fomo.family/tokens/bnb/0xed3e8541bc9ea3283aaab57dea11528b0875c116), [Defined traders](https://www.defined.fi/traders).

## Design decisions

Keep ANALYST's black, muted green surfaces, lime `#ccff00`, and pink-red sell indicators. Geist remains the interface font, with tabular numbers for changing values. The desktop market rail is 250px; token analytics use a flexible chart column and a 260px insight column. Narrow screens stack those panels and retain bottom navigation. Watchlist entries persist on the current device and can be removed; no account is implied.

Fomo's deposit, withdrawal, order execution, account system, private follows, clans, and referral payouts are not implemented. They need separate product/backend integrations. The external Fomo token link opens its real trading interface. No simulated orders, wallet balances, or fabricated holders are presented.

## Data coverage

The Defined capture contains 100 named Robinhood wallets, using network ID 4663. The import added 97 wallets, merged three existing wallet addresses, and inserted 2,768 additional transaction/token/side groups. There were 2,799 validated groups before cross-source deduplication. Source photos were verified for 87 identities, including a resolved ENS avatar and repairs from matching public Twitter profiles. Absent photos are not replaced with invented portraits. Profiles supplied their most recent public event page, not complete lifetime history. Other chains are excluded.

The importer groups distinct log indices within each transaction, wallet, token and side, then reuses existing transaction identities. Codex's `quoteToken` identifies the token of interest. Amount times historical unit price must agree with historical USD value. Source documentation: [getTokenEvents](https://docs.codex.io/api-reference/queries/gettokenevents).

Defined's 1-day, 1-week and 30-day metrics map to the corresponding ranking windows. One-year data is never labeled all-time. Unavailable buy/sell breakdowns remain unavailable. Each imported ranking shows its source date. Partial history on trader profiles is identified explicitly.

Run a reviewed capture through the reusable importer:

```powershell
node --conditions=react-server --import tsx scripts/import-defined.ts wallets.json history.json path/to/environment-file
```

Capture files must contain the public records in the validated envelope shape in `lib/providers/defined-import.ts`. They must never contain authentication headers, cookies or API keys. Capture files and production environment files remain outside version control.

The existing public KOLHOOD Socket.IO feed continues delivering `trade:new` events directly. The Defined import is a dated snapshot, not a second live stream. Continuous Defined/Codex updates require the project's own data-service account/key and an authenticated ingestion/subscription integration; a Fomo browser login does not provide that API access. No website-issued API token is reused in production.

When market providers have no historical chart, tokens with recorded USD execution prices show a labeled execution-price series. Points come only from historical trade prices or historical USD value divided by actual token quantity. No current-price substitution, invented OHLC, or fabricated candles are used. Tokens without either market history or priced trades retain an explicit unavailable state.
