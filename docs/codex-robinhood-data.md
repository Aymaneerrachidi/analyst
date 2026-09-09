# Robinhood wallet data through Codex

Verified September 9, 2026 against fresh public Defined trader-page responses and Codex documentation. Codex is the blockchain data provider, unrelated to OpenAI Codex.

| Product data | Supported Codex endpoint | Robinhood scope |
| --- | --- | --- |
| Daily / weekly / monthly rankings | filterWallets | filters.networkId = 4663 |
| Per-token realized PnL, bought/sold USD, counts, holding duration | filterTokenWallets | input.networkId = 4663 and explicit wallets |
| Current token holdings / valuations | balances | input.networks = [4663] |
| Wallet summary / PnL | detailedWalletStats | request Robinhood network scope, reject other network output |
| Historical PnL chart / calendar | walletChart | Robinhood scope; preserve returned timestamps and window |
| Transaction history | getTokenEventsForMaker | query.networkId = 4663, maker, cursor |
| Live wallet swaps | onEventsCreatedByMaker | Robinhood maker subscription; validate each event networkId |
| Token metadata / market stats / candles | tokens, filterTokens, getTokenBars | network ID 4663 in IDs/filters |

Defined's frontend uses aggregateWalletStats and aggregateWalletChart wrappers as well. Public wrappers are not assumed to be available on a customer API key; use documented wallet endpoints and test entitlement/schema before rollout.

## Access and cost

Create an account at https://dashboard.codex.io/. The current pricing page https://www.codex.io/pricing lists Growth at $350/month, 1M monthly requests, including wallet analytics and WebSockets. The Almost Free plan excludes wallet balances, wallet PnL, top traders and streaming. Subscription deliveries count toward monthly requests too. No paid plan has been purchased or activated here.

Add CODEX_API_KEY to the Railway source worker, server-side only. Current implemented consumers refresh rankings every 15 minutes and one tracked wallet's token performance per minute (up to ten pages of 50 tokens). Failures retain snapshots and back off. The wallet rotation is deliberately conservative and is not advertised as real-time.

## What is connected

- Dexscreener refresh runs independently, using its public API and no Alchemy credits.
- Public Defined profile captures import only Robinhood wallet/token metrics and validated swap events. They remain explicitly dated, partial snapshots.
- Profit by token on the trader page uses separate 24h, 7d and 30d snapshots. It does not combine partial local PnL with the external token totals.
- Rankings and token-performance API refresh code is ready for our own credential. It is inactive without that credential.

## Remaining for a full source replacement

Holdings/PnL-chart consumers and the live Codex wallet stream are not yet connected. With an entitled key, verify one Robinhood wallet against the public UI, paginate its history and holdings, subscribe to its swaps, and measure delivery usage before expanding to the tracked roster. Use one backend fan-out to website viewers, persist event identities and recovery cursors, retain last good snapshots, and enforce a monthly event budget. Never poll all wallets from every browser. Never use a current token price to invent historical execution prices or missing cost basis.

The public site is usable for snapshots, but page capture is not a guaranteed continuous API or complete history. Anonymous protected API requests require authentication. No private Defined credentials are reused.
