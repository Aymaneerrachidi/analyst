# Free Robinhood wallet sources — September 9, 2026

Live HTTP/browser checks, approximately 04:14–04:22 UTC. Availability is a point-in-time observation, not a service guarantee.

| Source | Verified result | Suitable use |
| --- | --- | --- |
| [Stalkchain](https://stalkchain.com/robinhood/kols) | Public leaderboard and feed returned 200 without login. 24 labeled wallets. Chain status lag was 67–96 seconds; latest KOL trade was 03:22:52 UTC while chain trades reached 04:14:49 UTC. | Supplemental identities and history. Quiet tracked wallets and incomplete coverage must be distinguished from indexer delay. |
| [Kolosseum](https://kolosseum.fun/) | Public Robinhood leaderboard returned 89 identities / 91 wallets. Metadata declared `mock:false`, no degraded chains, and 300-second refresh. | Wallet discovery; not a zero-delay execution feed. |
| [Defined](https://www.defined.fi/traders) | Direct HTTP hit a security checkpoint; normal Playwright browsing loaded the public page. Robinhood filter returned two pages / 100 wallets. Next page timed out. | Additional Robinhood wallets. Capture is partial, not the complete directory. |
| [KOLScan](https://kolscan.fun/) | Public status, trades and leaderboard endpoints returned 500. | Not a working replacement at check time. |
| [MadeOnSol](https://madeonsol.com/api-docs) | Documentation specifies a five-minute delay on free KOL feed access. | Does not satisfy the requested low latency on free access. |
| [CabalSpy](https://cabalspy.xyz/) | Official site documents Robinhood support and a free tier for testing; production plans start at $49/month. | Candidate requiring account/quota evaluation, not verified as a free production feed. |

## Applied wallet discovery

Production started with 204 traders. Imports ran in this order:

- Kolosseum: 91 addresses, 44 new, 47 already present.
- Defined: 100 addresses, 7 new, 93 already present.
- Stalkchain: 24 addresses, 5 new, 19 already present.

Result: 260 unique trader addresses. Preserve existing names and photos; fill absent photos/social links only from the source. Store per-source labels and capture times in `app_meta`, and register addresses in `wallets` without marking ownership verified. No provider PnL, invented trades, or synthetic photos were imported. Additional identities do not imply complete history or a restored live pipeline.

`scripts/import-public-wallets.ts` validates chain ID 4663, address format, capture time and source; previews by default and applies an atomic, batched import when explicitly selected:

```sh
node --conditions=react-server --import tsx scripts/import-public-wallets.ts snapshot.json env-file preview
node --conditions=react-server --import tsx scripts/import-public-wallets.ts snapshot.json env-file apply
```

Snapshot shape: `{source, url, chainId:4663, capturedAt, rows:[{wallet,name,avatar?,twitterUrl?}]}`. Source must be Defined, Stalkchain or Kolosseum. Raw captures remain in ignored local files.

## Free infrastructure constraint

The broad Railway indexer is stopped (public health endpoint returns application-not-found), so it is not continuing to drain Alchemy quota. The supplied plan has 300 CU/s throughput and 30M CU/month. A full month averages about 11.6 CU/s; merely reducing bursts below 300 CU/s is insufficient. Do not restart broad block/pool indexing on that plan.

A replacement needs measured, address-filtered ingestion, bounded retries, monthly budget accounting and explicit gap recovery. Public website endpoints have no verified production API contract. These discoveries do not establish zero latency or make the full V2 rollout production ready.
