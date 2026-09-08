# Robinhood trading coverage — 8 September 2026

The proposed integration covers Robinhood Chain (4663), not a single launchpad. Trading is not yet enabled in ANALYST. This audit compares documented venue support with read-only quotes. No approval or swap transaction was signed or sent.

## Provider and venue map

| Candidate | Documented Robinhood coverage | Current evidence |
| --- | --- | --- |
| 0x | Uniswap V2/V3/V4; SushiSwap V3; PancakeSwap V2/V3; SwapHood V2/V3; RobinSwap V3; Sheriff; Ramses variants; Ekubo variants; Up/UpCL; Bags and Pons V2 curves; Flap; Virtuals; additional sources below | Chain and sources documented. Our unauthenticated source request returned 401; token-level routing remains unverified. |
| Uniswap Trading API | Uniswap protocols and UniswapX on chain 4663 | Documented chain support. Not evidence of coverage for every external curve or v4 hook. Own API key absent. |
| Umbra | Uniswap V2/V3/V4, SushiSwap V3, up. venues and UniswapX described in its documentation | Public quote API tested against 16 recent tokens; 10 returned positive buy and reverse-sell quotes. This does not prove execution. |

The remaining sources listed by 0x include Alley/Catnip, Baseline, Fermi, Giga CL/Classic, Hanji, Kaliber, Kipseli, LiquidCore, Metric V1/V2, SectorOne and Swaap V2. This is provider-advertised coverage, not an independently verified census of every active DEX.

Sources: [0x changelog](https://docs.0x.org/changelog/2026/7/31), [Uniswap supported chains](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains), [Umbra documentation](https://www.umbra.finance/docs).

## Launchpad handling

- Pons V1 opens V3 liquidity; V2 has a curve stage and a graduated V4 stage. Detect the actual factory/version and pool state. [Contract source](https://github.com/ponsdotdev/ponsfamily/blob/main/README.md)
- Bags has a separate Robinhood integration and published contract ABIs. [Official developer announcement](https://t.me/s/bags_dev), [ABIs](https://github.com/bagsfm/bags-idl/tree/main/robinhood-abi)
- Flap publishes Robinhood mainnet contract integration fixtures. [Official repository](https://github.com/flap-sh/FlapVaultExample)
- Hoodlab documents a WETH/Uniswap V3 launch model. [Developer docs](https://hoodlab.app/docs.html)
- Other launchpad names, including HoodPump, must be resolved by verified contract and current trading venue. A familiar name or a token logo is not sufficient to select transaction calldata.

## Live quote audit

Results are in `routing-audit-2026-09-08.json`. The sample takes 16 unique tokens from the latest 200 ANALYST trades; it is biased toward current tracked-wallet activity and is not all Robinhood tokens.

Each buy requests 0.01 ETH of the token. A successful buy is followed by a quote selling the returned net quantity back to ETH. Quote-only checks do not establish wallet balances, allowances, eligibility, successful execution or future availability. Successful quotes included CONCERN, FIG, OUTDAY, HOODON and several stock-named contracts. These names do not verify issuer identity or user eligibility.

Umbra returned both directions for 10/16 tokens. All successful buy quotes reported `feeBps: 100` (1%). Its response gas field was zero; this must not be displayed as free gas. Failed quote requests are reported with their actual HTTP status/error, not labeled as proof that a token is unsellable. The sampled paths used V3 and V4 variants; other advertised venues were not exercised by this sample.

## Recommended implementation

Use 0x as the first candidate for broad routing, subject to authenticated token-level validation and total-fee comparison. Keep the integration behind a provider interface so missing routes can be handled by a second provider or verified direct adapters. Umbra is a tested candidate for comparison, not an unconditional default given its observed fee and sample gaps.

Maintain separate states: documented venue, indicative price available, wallet-specific quote available, simulation passed, transaction confirmed. Never turn a venue claim or a positive price response into an “all tokens tradable” badge.

Before enabling orders, validate chain, token addresses/decimals, exact input, recipient, spender, transaction target, minimum output, fees, expiry and simulation. Refresh when the user changes amount, wallet or chain. The user signs every approval and swap in their own wallet. Missing liquidity, unsupported venues and access restrictions require distinct UI states.

## Reproduce and unblock authenticated coverage

```powershell
node scripts/audit-routing.mjs --limit 16
node --env-file=.env.local scripts/audit-routing.mjs --limit 50
```

The second command can test 0x indicative buy/sell prices when `ZERO_EX_API_KEY` is configured locally. It never prints the key. For the deployed integration, provision the key in Vercel as a server-only variable. Obtain it from the [0x dashboard](https://dashboard.0x.org/). The script's authenticated branch has not run yet because no account key is configured. A dedicated chain RPC will also be needed for balances, simulation and receipt tracking.
