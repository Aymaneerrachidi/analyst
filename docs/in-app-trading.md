# In-app trading

Every token page has a Buy/Sell panel directly beneath the chart. It reads token decimals and balances from Robinhood mainnet (4663), previews an exact input amount, and displays the route, provider fee and slippage floor. No token allowlist limits the panel to pons. A token still needs a supported route and usable liquidity.

## Launch state without the API key

`ZERO_EX_API_KEY` is not configured; the owner deferred adding it. Production therefore provides live Umbra quote previews and a link that carries the selected token, direction and amount to Umbra. The UI explicitly says execution happens there. It does not expose Umbra calldata for signing in ANALYST.

Umbra returned buy and sell quotes for 10 of 16 sampled tokens in the separate routing audit. That is sampled quote coverage, not proof of execution or all-chain coverage. Its Robinhood fee was 1%, included in the displayed net output. We could not independently obtain the deployed Robinhood router's source/ABI: the linked public repository contained PulseChain contracts, Sourcify had no matching deployment, and Blockscout returned an access challenge. Until that can be resolved, Umbra remains a preview/handoff provider here.

## Activate 0x execution later

1. Create the application's own key at https://dashboard.0x.org/.
2. Add `ZERO_EX_API_KEY` to the Vercel project's Production environment and redeploy. Never prefix this key with `NEXT_PUBLIC_`.
3. Optionally set `ROBINHOOD_RPC_URL` to a dedicated mainnet endpoint for server metadata, balances and registry reads. The browser uses its connected wallet for simulation and the public mainnet endpoint for receipt monitoring.
4. Run `node --env-file=.env.local scripts/audit-routing.mjs --limit 50` with the same account's key configured locally. Check actual buy/sell coverage, quota, fees, launchpad curve tokens and restricted assets under that account's access plan.
5. Validate authenticated firm quotes and the app's transaction decoding on mainnet without sending. The owner should then perform a small buy and sell in their own wallet, check receipts and balance changes, and verify rejection and insufficient-gas behavior. No real transaction has been submitted during implementation.

Adding the key activates the 0x adapter. Authenticated 0x quote behavior is **not yet live-verified**, because the key is deferred. Unsupported quote encodings, a paused registry, unusual approval contracts, provider restrictions and absent liquidity fail closed. There are no direct custom bonding-curve adapters or claims that every token is tradable.

## Wallet flow

- EIP-6963 wallet discovery with an injected-wallet fallback. On mobile, use a wallet browser; WalletConnect QR pairing is not included.
- Explicit connection, Robinhood network switch/add, on-chain balances and precision validation. No keys, phrases or private wallet material are stored.
- Review obtains a fresh wallet-specific quote. Amount, direction, slippage, wallet or network changes invalidate review. Quotes expire before a signing request; the on-chain minimum remains the protection while a wallet confirmation is open. The API does not supply a universal on-chain deadline.
- Standard token sells approve only the entered amount to the fixed 0x AllowanceHolder. Existing insufficient nonzero allowances require a separate reset, then an exact approval. Approval and swap are separate wallet confirmations. Nonstandard approvals and Permit2-only routes are not supported.
- Both server and client decode AllowanceHolder and Settler calls, compare tokens, input, native value, recipient and encoded minimum, and verify the settlement target against the current/previous on-chain registry. A paused registry fails before previous-deployment fallback.
- The connected wallet simulates the operation and estimates gas. The review displays the buffered gas estimate and checks available ETH. Simulation runs again immediately before the wallet request. A successful simulation cannot guarantee execution after market state changes.
- Pending/confirmed/reverted state and explorer link are shown. Pending receipt checks use the fixed Robinhood RPC so changing wallet networks cannot change the receipt's chain. Receipt display is session-local; users should retain the explorer link before closing the page.

## API and operations

`GET /api/trading?token=0x…&account=0x…` reads assets. `POST /api/trading` accepts only `{token, side, amount, slippageBps, account?, mode}` with `mode` set to `preview` or `review`. Amount is a decimal string; the server resolves precision itself. The endpoint never accepts caller-supplied transaction targets, calldata or approval spenders and never broadcasts transactions.

Responses are uncached; requests have timeouts, bounded JSON bodies, same-origin checks and an instance-local IP quota. Set a Vercel firewall rate limit for `/api/trading` and monitor the 0x account quota before a high-traffic launch. The local quota is not global across serverless instances. No application swap fee is requested; any provider-returned fee is disclosed in review.

Validation: `npm run test:trading`, `npx playwright test tests/trading.spec.ts`, existing regressions, typecheck, lint and production build. Browser tests use isolated synthetic wallet/API fixtures and never sign or send on a real network. Separate live probes verified real PONS metadata plus buy/sell Umbra quotes through the implemented server adapter.

Contract references: [0x contracts](https://docs.0x.org/docs/core-concepts/contracts), [deployment registry and Robinhood AllowanceHolder](https://github.com/0xProject/0x-settler), [AllowanceHolder interface](https://github.com/0xProject/0x-settler/blob/master/src/allowanceholder/IAllowanceHolder.sol), [Settler interface](https://github.com/0xProject/0x-settler/blob/master/src/interfaces/ISettlerTakerSubmitted.sol), [Umbra Robinhood API](https://www.umbra.finance/docs).
