# Live data and interface verification

Verified on the local site on 2026-09-06. Source coverage is a point-in-time measurement, not a guarantee that every upstream will remain available.

- Inspected 686 token records across paginated results. 623 had source prices; 528 had published image URLs.
- Downloaded and validated 515 token images and 103 of 107 trader photos. Missing/deleted/blocked files are omitted. No generated avatars remain.
- GeckoTerminal supplies USD OHLCV. Pons supplies actual price samples when indexer history is missing. Pons samples retain the original quote currency and do not invent open/high/low values.
- Verified a live iFold chart with six real samples in AAPL units, and zero browser errors.
- Live mode is the default. Seeded community posts and ratings are excluded from live reads. Synthetic fixtures are confined to explicit development/test mode.

## Layout, typography and UI review

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| Medium | components/tokens/token-table.tsx | Eleven columns with repeated missing-value dashes | Seven grouped columns; explicit valuation labels; mobile records | Shared alignment and grouping make real market data easier to scan. |
| Medium | components/common/avatar.tsx | Generated portraits and token emblems | Cached source images; absent images omitted | Published identity replaces invented imagery. |
| Medium | components/tokens/token-chart.tsx | Activity could automatically replace the price view | Price is the default; two real history sources with currency labels | Users can distinguish prices from wallet volume. |
| Medium | app/globals.css | Uneven heading wraps and small mobile inputs | Balanced headings; 16px mobile inputs | Text remains legible without input-triggered zoom. |
| Medium | lib/services/intelligence.ts | Slow enrichment blocked the token table | Bounded initial wait and periodic refresh of received data | External image latency no longer stalls the page. |

Browser checks: no horizontal overflow at 1440, 900, 720, 390 or 320 CSS pixels; phone RTL mirror also fits. Source-image data URIs: zero. Real token and chart screenshots are in `.playwright-mcp/real-*.png`.

Not verified: native browser 200% zoom, translated content, animation replay at 10% speed. Responsive reflow was checked at 720 CSS pixels, but this is not a claim of native zoom verification.

Approve for the inspected layouts and states. Remaining source coverage gaps are not replaced with invented values or pictures.

## Local database recovery

A development-server reload exposed an invalid PostgreSQL checkpoint in the embedded PGlite database. Recovery was performed only on `.data/pglite-recovery-copy`; the original `.data/pglite` remains untouched for investigation. The recovered copy retained 1 post and 2 comments. A full live-source resync imported 2,014 trades, bringing the recovered database to 2,493 trades, and closed cleanly. `.env.local` now selects the recovered copy through `PGLITE_DATA_DIR`.

The running site subsequently returned HTTP 200 with provider `kolhood`, `isMock: false`, and a fresh `live` status. Sync now checkpoints PGlite, and shutdown hooks close the embedded client. WAL recovery cannot guarantee retention of every uncheckpointed transaction; source resync rebuilds recoverable trade history, while the original files remain available.
