# Token directory availability hotfix

Incident observed September 8, 2026: the public default token API returned an empty array despite 1,750 stored tokens. The latest imported trade and the upstream feed both stopped at `2026-09-07T03:46:09.979Z`. No stored trades remained in the 24-hour window. The database contained 1,324 seven-day token snapshots, but no shorter-window snapshots.

The list previously started from the selected-window activity snapshots. It now starts from stored token records, left-joins activity for the exact selected window, and keeps missing-window tokens visible. Real market quotes remain available. Missing-window scores and flow are labeled "Not rated" and "No recorded activity"; older activity is never relabeled as current. Accumulation/distribution filters still require observed matching flow. The default category is All.

Freshness now includes the latest recorded trade timestamp separately from successful sync time. A quiet source is visibly marked, even when polling succeeds or the transport remains connected. This hotfix does not repair the external upstream publisher; independent chain ingestion is separate V2 work.

Regression coverage verifies that a stored token with only a seven-day snapshot stays visible in 24h, retains its real price, does not inherit older buys, and remains excluded from an unmatched accumulating filter.
