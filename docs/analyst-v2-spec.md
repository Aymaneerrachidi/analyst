# ANALYST V2 — ROBINHOOD CHAIN INTELLIGENCE + TRADING TERMINAL

You are an elite principal full-stack engineer, blockchain data engineer, quantitative analytics engineer, and product designer.

You are working on the EXISTING production web application:

https://analyst-orpin.vercel.app/

The product is called **Analyst**.

Do NOT rebuild the project from scratch.

First inspect the existing repository carefully, understand the architecture, routes, components, styling, database access, APIs, and current data model.

Then extend the existing product into a professional Robinhood Chain intelligence and execution terminal.

The product should feel like:

**KOLscan + smart-money terminal + wallet intelligence + token analytics + embedded trading, built specifically around Robinhood Chain.**

---

# 1. PRODUCT PURPOSE

Analyst helps a trader answer:

1. What tokens are moving?
2. Which good traders are buying?
3. Are multiple smart wallets accumulating?
4. Is this movement meaningful or noise?
5. Who created the token?
6. Are important holders connected?
7. Is there suspicious team/insider behavior?
8. What are the risks?
9. Why is the token pumping?
10. Can I buy it immediately?
11. After I buy, is the thesis getting stronger or weaker?
12. What are the best traders doing now?

The complete product loop should be:

DISCOVER
→ ANALYZE
→ VERIFY
→ TRADE
→ MONITOR
→ DISCUSS

---

# 2. NON-NEGOTIABLE ARCHITECTURE

Use the existing stack where possible.

Preferred stack:

Frontend:

* Next.js
* TypeScript
* Tailwind CSS
* existing Analyst design system/components
* Lucide icons
* existing animation library if already installed
* wagmi
* viem

Backend:

* Next.js route handlers for normal API requests
* Supabase PostgreSQL
* Railway worker for continuous blockchain indexing
* Redis/Upstash only where useful

Blockchain:

* Robinhood Chain
* mainnet chain ID: 4663
* Alchemy RPC
* Alchemy WebSocket

Data/enrichment:

* DexScreener
* Blockscout
* Robinhood official Stock Token API
* direct blockchain RPC
* Pons contracts
* Uniswap contracts/liquidity
* Base44 agent for "Why Is It Pumping?"

DO NOT introduce:

* X API
* OpenAI API
* 0x API
* expensive wallet intelligence APIs
* paid market-data APIs unless absolutely required
* custodial trading
* private-key storage
* server-side transaction signing

Analyst must remain non-custodial.

The user's wallet signs every transaction.

---

# 3. IMPORTANT COST ARCHITECTURE

We want the platform to remain extremely cheap to operate.

Therefore:

* fetch blockchain information centrally
* store it
* derive metrics ourselves
* cache expensive computations
* never repeat identical external API requests per user
* batch DexScreener requests
* cache Blockscout responses
* cache Base44 research
* compute smart-money intelligence internally
* compute trader rankings internally
* compute token signals internally

Do NOT make each browser independently poll APIs.

Architecture:

External data
↓
Analyst indexer
↓
Postgres
↓
Analyst API
↓
All users

One piece of data should normally be fetched once and reused.

---

# 4. FIRST: FIX EXISTING DATA TRUST ISSUES

Before adding new features, fix inconsistent metrics in the existing Analyst product.

Currently the same trader can sometimes show one PnL on the leaderboard and another PnL on their profile because different data sources/scopes are being displayed.

Create strict metric provenance.

Every important metric must carry:

* source
* period
* calculatedAt
* data completeness
* whether realized/unrealized
* whether imported or Analyst-computed

For example:

Source PnL
$1.4M
30D
DEFINED

Analyst Tracked PnL
+$4.63
SINCE SEP 6
ANALYST INDEXER

Never make two different scopes look like the same metric.

Prefer one canonical Analyst metric wherever sufficient historical data exists.

Also clean:

* `CONNECTING` states
* unavailable values
* `—` everywhere
* double `$` symbols
* "1 KOLs"
* "1 buys"
* inconsistent token price sections
* misleading "recent swaps" wording
* stablecoin/stock-token/memecoin mixing

Add asset classification:

* MEME
* STOCK TOKEN
* STABLECOIN
* OTHER

Allow filters.

For official Robinhood stock tokens, explicitly label:

"On-chain token market cap"

Do not make this look like the underlying corporation's market capitalization.

---

# 5. CORE DATA MODEL

Build proper normalized tables.

Minimum tables:

## tokens

* id
* chain_id
* address
* symbol
* name
* decimals
* asset_type
* deployer_address
* launch_platform
* created_at_chain
* discovered_at
* dex_pair_address
* metadata
* is_verified_stock_token
* active

Unique:
chain_id + address

---

## token_snapshots

Time-series snapshots.

Fields:

* token_id
* timestamp
* price_usd
* market_cap
* fdv
* liquidity_usd
* volume_5m
* volume_1h
* volume_6h
* volume_24h
* buys_5m
* sells_5m
* buyers_5m
* sellers_5m
* holder_count
* price_change_5m
* price_change_1h

Index heavily by:

token_id + timestamp

---

## raw_chain_events

Immutable raw events.

Store:

* block_number
* block_hash
* tx_hash
* log_index
* contract
* topics
* raw_data
* timestamp
* ingestion_version

Never silently mutate historical raw events.

---

## swaps

* tx_hash
* log_index
* timestamp
* wallet_address
* token_id
* side
* amount_token
* amount_quote
* usd_value
* execution_price
* dex
* pool_address
* block_number

Unique:
tx_hash + log_index

---

## wallets

* address
* first_seen
* last_seen
* wallet_type
* public_label
* display_name
* x_handle if manually known
* kol_verified boolean

Do not automatically call every wallet a KOL.

Default terminology:

**Tracked Trader**

Only show a KOL badge when a real public identity is confirmed.

---

## wallet_metrics

Metrics by period.

* wallet_id
* period
* realized_pnl
* unrealized_pnl
* total_pnl
* win_rate
* trades
* winning_trades
* losing_trades
* average_return
* median_return
* profit_factor
* max_drawdown
* average_hold_time
* median_hold_time
* average_entry_market_cap
* runner_hit_rate
* rug_rate
* early_entry_score
* consistency_score
* risk_score
* overall_score
* calculated_at

---

## wallet_token_positions

* wallet
* token
* amount
* cost_basis
* realized_pnl
* unrealized_pnl
* first_buy
* latest_buy
* latest_sell
* total_bought
* total_sold
* status

---

## wallet_edges

For Wallet Detective.

* wallet_a
* wallet_b
* relationship
* confidence
* evidence
* first_seen
* last_seen

Possible relationships:

FUNDED_BY
FUNDED
TRANSFERRED_TO
TRANSFERRED_FROM
SHARED_FUNDER
SAME_DEPLOYER_CLUSTER
REPEATED_COTRADING
SAME_LAUNCH_CLUSTER

Never label something as "insider" solely because of one weak relationship.

Use:

"Connected wallet"
"Potential team relationship"
"Suspicious cluster"

with confidence/evidence.

---

## token_signals

* token
* timestamp
* runner_score
* smart_money_score
* momentum_score
* holder_score
* liquidity_score
* risk_penalty
* narrative_score
* final_score
* signal_type
* reasons JSON
* version

---

## signal_outcomes

Used for backtesting.

* signal_id
* return_5m
* return_15m
* return_1h
* return_6h
* return_24h
* max_gain_1h
* max_gain_6h
* max_gain_24h
* max_drawdown_1h
* max_drawdown_24h

Never use future information when calculating the original signal.

---

## risk_assessments

* token
* timestamp
* overall_risk
* sell_simulation
* owner_permissions
* mint_permissions
* blacklist_possible
* pause_possible
* holder_concentration
* creator_holdings
* related_wallet_concentration
* liquidity_risk
* suspicious_creator_activity
* details JSON

---

## why_pumping_reports

* token
* generated_at
* market_snapshot_timestamp
* agent_version
* summary
* primary_catalyst
* catalysts JSON
* narrative
* social_context
* smart_money_context
* risks JSON
* confidence
* expires_at
* raw_agent_response

---

## alerts

* anonymous_user_id/wallet
* alert_type
* token
* trader
* threshold
* enabled
* destination
* created_at

---

## user_positions

For positions created through Analyst.

* wallet
* token
* entry_transaction
* entry_price
* entry_market_cap
* amount
* total_cost
* opened_at
* current_amount
* realized_pnl

---

## community tables

Keep existing social functionality but clean it up:

* comments
* trader_ratings
* token_threads
* follows
* watchlists

---

# 6. CONTINUOUS ROBINHOOD CHAIN INDEXER

Create a separate Railway worker.

It must remain alive continuously.

Use:

* viem
* Alchemy WebSocket
* fallback RPC polling
* reconnect logic
* exponential backoff
* block cursors
* reorg awareness
* duplicate protection
* structured logs

Monitor only useful contracts/events rather than every chain transaction.

Priority:

1. Pons contracts
2. known DEX routers/pools
3. tracked tokens
4. tracked trader wallets
5. tokens currently entering Runner Radar
6. relevant liquidity pools

Process:

WebSocket event
→ raw_chain_events
→ parser
→ normalized swaps/transfers
→ wallet positions
→ token metrics
→ signals
→ alerts

If WebSocket disconnects:

* reconnect
* recover missed block range via RPC
* continue from last confirmed block

Never silently lose blocks.

---

# 7. TOKEN DISCOVERY

Detect:

* Pons launches
* tokens appearing on supported DEX liquidity
* newly active tokens
* tokens receiving abnormal trading activity

Do NOT make the product a fresh-launch firehose.

Fresh launches are stored, but the primary product is:

**RUNNERS**

Tokens only become prominent once there is meaningful activity.

---

# 8. RUNNER RADAR

Create route:

`/radar`

Purpose:

Detect tokens transitioning from random activity into meaningful momentum.

Each radar card:

TOKEN
market cap
liquidity
1H change
volume acceleration
buyer acceleration
smart-money inflow
tracked traders buying
holder acceleration
risk
runner score
time since signal

Buttons:

ANALYZE
WHY PUMPING
BUY
WATCH

Example:

RUNNER DETECTED

$TOKEN
$740K MC
+118% 1H

Volume velocity: 6.2x
Buyer velocity: 3.1x
Smart money: +$38K
4 high-quality traders entered
Holder growth accelerating
Risk: Moderate

Runner Score: 86

Do not simply rank by percentage gain.

Suggested score inputs:

* volume acceleration
* unique buyer acceleration
* smart-money net inflow
* number of high-quality traders entering
* buy/sell imbalance
* holder growth
* liquidity quality
* market-cap range
* token age
* price acceleration
* concentration penalties
* risk penalties

Store exact score components.

Make the score explainable.

---

# 9. SMART MONEY CONSENSUS

Build our own smart-money engine.

Do not buy a smart-money API.

Each tracked trader gets a quality score based on:

* realized PnL
* consistency
* profit factor
* max drawdown
* win rate
* median trade
* runner hit rate
* early-entry performance
* rug avoidance
* sample size
* concentration of profits

Avoid ranking someone highly because of one lucky trade.

Apply minimum sample-size confidence.

Example trader:

404flipped
Overall: 91

PnL: 96
Consistency: 88
Early Entries: 94
Drawdown: 82
Win Rate: 78
Rug Avoidance: 97

Then calculate token consensus weighted by:

wallet quality
×
buy amount
×
entry timing
×
confidence

Token page example:

SMART MONEY

11 tracked traders buying
8 high-quality
3 medium-quality

Net inflow: +$82K
Median trader score: 87

Consensus: HIGH ACCUMULATION

Avoid terminology like guaranteed/bullish prediction.

Use:

LOW
WATCH
ACCUMULATION
HIGH ACCUMULATION
DISTRIBUTION

---

# 10. TRADER INTELLIGENCE

Upgrade `/traders`.

Leaderboard filters:

* 1D
* 7D
* 30D
* ALL
* PnL
* Consistency
* Early Entries
* Runner Hit Rate
* Win Rate
* Lowest Drawdown
* Most Active
* Most Followed

Profile sections:

Overview
Positions
Recent Trades
Best Trades
Worst Trades
Performance
Trading Style
Token Categories
Entry Market Caps
Holding Time
Wallet Connections
Followers
Comments

Automatically classify trading behavior:

EARLY BUYER
SCALPER
RUNNER HUNTER
LARGE-CAP TRADER
FAST FLIPPER
HIGH-RISK
CONSISTENT
DIAMOND HAND

Use objective thresholds.

Expose tooltip explaining why the classification exists.

---

# 11. WALLET DETECTIVE

Create reusable Wallet Detective engine.

Accessible from:

* trader profile
* token holder
* search
* token creator
* connected wallet graph

Analyze:

* funding source
* first funding transaction
* repeated transfer partners
* trading history
* PnL
* win rate
* best tokens
* worst tokens
* holding time
* preferred market-cap range
* launches participated in
* interactions with creators
* connected wallets
* recurring co-buying wallets

Display:

Wallet Summary
Behavior
Performance
Funding
Connections
Recent Activity
Related Tokens

Do not claim certainty when connections are heuristic.

Each relationship gets:

CONFIDENCE
EVIDENCE

Example:

Potential relationship — 82%

Evidence:

* same funding wallet
* funded within 4 minutes
* repeatedly bought same 7 launches
* tokens transferred between wallets

---

# 12. TEAM / CONNECTED HOLDER DETECTION

Token page:

HOLDER INTELLIGENCE

Top 10 ownership
Top 20 ownership
Creator holdings
Related-wallet holdings
Known smart-money holdings
DEX/liquidity holdings excluded appropriately

Detect clusters.

Example:

Creator
↓
Wallet A
├── Wallet B
└── Wallet C

Potential connected cluster:
17.8% supply

Confidence: High

Reasons:
Shared initial funding
Direct transfers
Repeated coordinated launches

Never automatically call this an "insider cluster".

Use cautious terminology.

---

# 13. TOKEN RISK ENGINE

Before trading, calculate risk.

Checks:

* can token be bought
* can token be sold
* dangerous owner privileges
* mint privileges
* pause functionality
* blacklist capability
* fee changes
* supply concentration
* creator holdings
* connected-holder concentration
* liquidity size
* liquidity changes
* creator selling
* abnormal transfers
* suspicious launch behavior

Display:

ANALYST RISK

Sellability        PASS
Mint control       PASS/WARN
Blacklist          PASS/WARN
Creator holdings   4.1%
Connected cluster  17.8%
Liquidity          HEALTHY
Creator activity   NORMAL

Risk Score
23 / 100

LOW RISK

Risk levels:

LOW
MODERATE
HIGH
EXTREME
UNKNOWN

Unknown must never silently become safe.

Trading UI should show risk immediately before transaction signing.

---

# 14. WHY IS THIS PUMPING? — BASE44 AGENT

We already have a Base44 research agent.

DO NOT implement X API.

DO NOT implement OpenAI directly.

Create server-side adapter:

`lib/base44-agent.ts`

Environment variables:

BASE44_AGENT_URL
BASE44_AGENT_KEY
BASE44_AGENT_ID if necessary

Never expose credentials in browser code.

Frontend:

[ WHY IS THIS PUMPING? ]

Request:

`POST /api/tokens/[address]/why-pumping`

Analyst should first gather quantitative context:

* chain
* CA
* token name
* symbol
* price
* current MC
* liquidity
* token age
* change 5m/1h/6h/24h
* volume
* volume acceleration
* buyer acceleration
* smart-money inflow
* tracked traders entered
* holder growth
* creator activity
* risk
* Runner Score
* important recent transactions

Send:

CA
+
quantitative context

to Base44.

Base44 handles external research/narrative/social/catalyst investigation.

Require structured JSON response:

{
"summary": "",
"primaryCatalyst": "",
"catalysts": [
{
"title": "",
"description": "",
"evidenceStrength": "strong|medium|weak"
}
],
"narrative": "",
"socialContext": "",
"smartMoneyContext": "",
"risks": [],
"confidence": 0
}

Validate using Zod.

If malformed, sanitize/fallback gracefully.

CACHE RESULT.

Normal cache:
5 minutes.

Reuse the same research report for every user.

Invalidate early if:

* MC changes materially
* major smart-money reversal
* large creator sell
* liquidity shock
* major new trader enters
* Runner Score materially changes

Display an Analyst-native report, not raw Base44 output.

---

# 15. EMBEDDED TRADING

Add wallet connection.

Support standard EVM wallets using:

* wagmi
* viem
* WalletConnect if existing setup allows
* injected wallets

Browsing never requires a wallet.

Only trading requires wallet connection.

Never request private keys.

Never custody funds.

Never sign transactions server-side.

---

## Trading panel

Every eligible token page gets:

BUY | SELL

Amount selector.

Quick amounts:

25%
50%
75%
MAX

Show:

You Pay
You Receive
Expected execution
Minimum received
Slippage
Price impact
Pool/route
Network
Estimated gas
Trading/pool fee
Risk status

Buttons:

BUY TOKEN
SELL TOKEN

---

## Routing

For first version:

Integrate relevant Pons and Uniswap liquidity directly.

Do not use 0x.

Read verified router/pool contracts and ABIs.

Do not guess contract addresses.

Put official addresses/config in network configuration/environment variables.

Quote on-chain.

Before submitting:

* verify network
* verify allowance
* obtain fresh quote
* simulate transaction
* calculate minimum output
* display price impact
* enforce user's slippage
* warn for dangerous price impact

After signing:

PENDING
→ CONFIRMED
→ update position

Store tx hash.

Never mark transaction successful before chain confirmation.

---

# 16. POSITION TRACKING

When a user trades through Analyst, automatically create/update their position.

Token page:

MY POSITION

Entry:
$612K MC

Amount:
1,240,000 TOKEN

Cost:
$420

Current value:
$552

PnL:
+$132
+31.4%

Realized:
+$0

Buttons:

SELL 25%
SELL 50%
SELL ALL

Also show entry timestamp and entry transaction.

Allow detection of external wallet balance changes so position state does not become completely wrong if the user trades elsewhere.

---

# 17. POSITION INTELLIGENCE

This is a core differentiator.

When someone enters a token, save the state of the thesis at entry:

* Runner Score
* smart-money consensus
* smart-money wallets holding
* creator state
* holder growth
* liquidity
* volume velocity
* risk
* important catalysts

Then continuously compare current state.

Example:

YOUR ENTRY

Signal: 87

NOW

Signal: 69 ↓

Changes since entry:

+ 3 tracked traders entered

* holder count +17%

- 404flipped sold 35%
- volume momentum slowing
  = creator unchanged

Show:

THESIS STRENGTHENING
THESIS STABLE
THESIS WEAKENING

This must be descriptive, explainable, and based on measurable data.

Do not generate direct personalized financial advice.

---

# 18. SMART ALERTS

Allow alerts for:

TOKEN:

* Runner Score crosses threshold
* smart-money inflow
* smart-money outflow
* large holder sell
* creator sell
* liquidity loss
* unusual volume
* holder acceleration
* MC threshold

TRADER:

* buys token
* sells token
* trade > threshold
* enters new token

POSITION:

* thesis weakening
* smart-money reversal
* creator sells
* liquidity risk
* major tracked trader exits

Start with:

* browser notifications
* Telegram optional
* Discord webhook optional

Implement event deduplication.

Never spam 20 notifications for the same event.

Aggregate when appropriate.

Example:

404flipped bought TOKEN 7 times in 42 sec
Total: $8,420

rather than seven alerts.

---

# 19. LIVE FEED IMPROVEMENTS

Current live feed must become signal-dense.

Aggregate repeated transactions:

Same wallet
+
same token
+
same side
+
within configurable short time window

Example:

ottabag
Bought TCAT 9x
$348 total
32 sec

[EXPAND]

Expanded view shows raw transactions.

Highlight:

LARGE
SMART MONEY
TOP TRADER
NEW POSITION
POSITION INCREASE
EXIT

Allow filters:

All
Smart Money
Large Trades
Traders I Follow
My Watchlist
Buys
Sells

---

# 20. HISTORICAL SIGNAL BACKTESTING

Every generated Runner/Smart Money signal must be stored.

Later calculate realized outcomes.

Page:

`/signals`

Example:

ANALYST RUNNER SCORE ≥ 80

Last 30 Days

Signals: 184

Reached +25%: 61%
Reached +50%: 42%
Reached +100%: 21%

Median max gain: +37%
Median max drawdown: -18%

Provide filters:

score
market-cap range
token age
risk
time period

IMPORTANT:

The signal's original inputs must use only data available at the signal timestamp.

Never recalculate historical signals using future information.

Backtesting should be credible.

---

# 21. NARRATIVE RADAR

Create:

`/narratives`

Do not depend on X API.

Use:

* Base44 research results
* token metadata
* launch descriptions
* social metadata already available
* manually curated narrative tags
* token relationships

Group tokens into narratives.

Example:

Robinhood mascots
Vlad-related
Stock-token memes
Pons ecosystem
AI
Political
Animals

Display:

Narrative
active tokens
aggregate volume acceleration
smart-money inflow
average Runner Score
number of runners
trend direction

Example:

ROBINHOOD MASCOTS

7 active tokens
+$182K smart-money flow
3 Runner signals
Volume +240%

TREND: HEATING UP

---

# 22. TOKEN COMPARISON

Allow selecting two tokens.

Route:

`/compare?tokens=A,B`

Compare:

* MC
* liquidity
* price momentum
* volume acceleration
* buyer acceleration
* holder growth
* smart-money flow
* high-quality traders holding
* Runner Score
* Risk Score
* creator history
* concentration

Use clear winner markers per category but never imply guaranteed performance.

---

# 23. WALLET/TOKEN INTELLIGENCE GRAPH

Add graph visualization.

Nodes:

* wallets
* traders
* tokens
* creators

Edges:

* bought
* sold
* funded
* transferred
* deployed
* connected
* shared funding
* co-trading

Example:

404flipped
│
├── TOKEN A
├── TOKEN B
└── TOKEN C
↑
itai

Allow:

click wallet → trader profile
click token → token page

Use progressive rendering.

Do not attempt to render thousands of nodes at once.

Default to strongest relationships.

---

# 24. FOLLOW TRADERS

Trader profile:

[FOLLOW]

Options:

Notify me when:

☑ buys
☑ sells
☑ trade > $X
☑ enters new position
☑ exits position

Follow does NOT mean automatic copy trading.

Do not implement automated copy trading in this version.

---

# 25. PERSONALIZED ALPHA FEED

Create:

`/feed`

No mandatory traditional signup.

Use anonymous browser profile initially.

If wallet connected, associate preferences with wallet where appropriate.

Feed contains:

* watched tokens
* followed traders
* Runner alerts
* smart-money events
* position changes
* Why Pumping reports
* narrative changes

Examples:

3 traders you follow entered TOKEN

TOKEN matches your watched setup:
$300K–$1M MC
Runner Score >80
High smart-money inflow

Top holder of TOKEN sold 11%

404flipped entered TOKEN

Rank based on relevance, freshness and signal strength.

---

# 26. COMMUNITY IMPROVEMENTS

Do NOT fake activity.

Instead create a system account:

ANALYST

It automatically generates discussion events for meaningful market activity.

Examples:

Analyst:
"5 high-quality tracked traders accumulated $42K of TOKEN in 18 minutes."

Analyst:
"TOKEN Runner Score crossed 80."

Analyst:
"404flipped reduced TOKEN position by 37%."

Users can reply.

Token pages get discussion threads.

Trader profiles retain ratings/comments.

Protect community endpoints with:

* rate limits
* spam detection
* basic abuse controls
* generated anonymous browser ID
* server-side validation

---

# 27. GLOBAL SEARCH

Upgrade search.

Search:

* token symbol
* token name
* contract
* trader name
* wallet
* narrative

Keyboard shortcut:

CMD/CTRL + K

Results grouped:

TOKENS
TRADERS
WALLETS
NARRATIVES

---

# 28. OVERVIEW DASHBOARD

Improve homepage.

Top section:

ROBINHOOD CHAIN STATUS

Tracked Traders
Tracked Tokens
24H Volume
Smart-Money Flow
Active Runners

Then:

HOT RUNNERS

SMART MONEY

TOP TRADERS

NARRATIVES

LIVE ACTIVITY

No meaningless vanity cards.

Every section should lead to an actionable page.

---

# 29. DESIGN REQUIREMENTS

Preserve the current Analyst visual identity.

Do NOT make it look like a generic crypto casino.

Style:

* professional SaaS
* Robinhood-inspired
* clean
* dark/light styling consistent with existing product
* restrained green
* strong typography
* dense but readable terminal data
* polished cards
* excellent tables
* subtle animation
* high information density
* responsive mobile experience

Do not overuse:

* giant gradients
* glowing neon
* random emojis
* glassmorphism everywhere
* huge empty hero sections

Think:

professional trading terminal
+
modern SaaS
+
Robinhood visual DNA

---

# 30. STATUS COLORS

Use semantic status styling consistently.

Examples:

Green:
healthy / accumulation / confirmed

Yellow:
moderate / warning / incomplete

Red:
high risk / distribution / failure

Neutral:
unknown / unavailable

Do not show missing data as zero.

UNKNOWN ≠ SAFE.

---

# 31. API ROUTES

Suggested APIs:

GET /api/overview

GET /api/tokens
GET /api/tokens/[address]
GET /api/tokens/[address]/trades
GET /api/tokens/[address]/holders
GET /api/tokens/[address]/smart-money
GET /api/tokens/[address]/risk
POST /api/tokens/[address]/why-pumping

GET /api/radar
GET /api/narratives

GET /api/traders
GET /api/traders/[address]
GET /api/traders/[address]/positions
GET /api/traders/[address]/trades
GET /api/traders/[address]/connections

GET /api/wallet/[address]/detective

GET /api/feed

POST /api/trade/quote
POST /api/trade/prepare

GET /api/positions/[wallet]

POST /api/alerts
DELETE /api/alerts/[id]

POST /api/follow
DELETE /api/follow

GET /api/signals/performance

GET /api/search

All endpoints:

* validate with Zod
* rate-limit where appropriate
* return typed JSON
* handle upstream failures cleanly
* never leak secrets
* cache where safe

---

# 32. DATA SOURCE FALLBACK

Do not make one provider a single point of failure.

Example:

PRICE:

1. DexScreener
2. pool-derived calculation

TOKEN METADATA:

1. on-chain contract
2. DexScreener
3. Blockscout

WALLET TRANSACTIONS:

1. local Analyst database
2. Alchemy/RPC
3. Blockscout

Always show stale timestamp if serving cached stale data.

Never fabricate missing data.

---

# 33. ENVIRONMENT VARIABLES

Create `.env.example`.

Example:

NEXT_PUBLIC_CHAIN_ID=4663

ALCHEMY_RPC_URL=
ALCHEMY_WS_URL=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

BASE44_AGENT_URL=
BASE44_AGENT_KEY=
BASE44_AGENT_ID=

BLOCKSCOUT_API_URL=

DEXSCREENER_BASE_URL=

PONS_FACTORY_ADDRESS=
PONS_ROUTER_ADDRESS=

UNISWAP_ROUTER_ADDRESS=
UNISWAP_QUOTER_ADDRESS=

TELEGRAM_BOT_TOKEN=

Never place secret credentials inside:

NEXT_PUBLIC_*

except values explicitly safe for browsers.

---

# 34. SECURITY

Absolutely mandatory:

* no private-key storage
* no seed phrase input
* no custodial wallet
* user signs transactions locally
* validate token address
* verify chain ID
* server-side API rate limiting
* sanitize community content
* prepared SQL only
* Supabase RLS where applicable
* secrets server-side only
* transaction simulation
* allowance protection
* slippage protection
* stale quote expiration
* CSRF protection where relevant
* abuse protection
* never trust client-provided PnL
* never trust client-provided transaction state

Do not request unlimited token approval by default if exact/limited approval is practical.

---

# 35. PERFORMANCE

Target:

Initial dashboard load:
fast.

Do not wait for Base44 research to render token page.

Why Pumping loads independently.

Use:

* SSR where appropriate
* React Query/SWR if already present
* database caching
* incremental updates
* WebSocket/SSE for live activity where appropriate
* pagination
* table virtualization for huge lists

Do not render 200+ leaderboard rows initially.

Use 25–50 per page or virtualized rows.

---

# 36. DATA FRESHNESS

Each important metric should expose timestamp.

Examples:

Updated 4s ago
Updated 1m ago

Different data can have different freshness requirements.

Live swaps:
seconds

prices:
seconds

holder counts:
minutes

wallet score:
minutes/hours

Why Pumping:
cached ~5m

Backtesting:
periodic background computation

---

# 37. TESTING

Create:

unit tests
integration tests
data parser tests
scoring tests
API tests
wallet/trading tests

Especially test:

* duplicate blockchain events
* websocket reconnect
* missed-block recovery
* chain reorg
* malformed Base44 response
* unavailable DexScreener
* stale quote
* high slippage
* transaction revert
* unknown token
* missing holder data
* trader with insufficient history
* wallet with one lucky trade
* smart-money score calculation
* Runner Score
* signal outcome correctness
* position accounting

Do not test trading with real money.

Use mocks/test environment/dry-run simulation.

---

# 38. OBSERVABILITY

Create structured logs for:

INDEXER
RPC
DEXSCREENER
BLOCKSCOUT
BASE44
SIGNALS
ALERTS
TRADING

Track:

* last indexed block
* WebSocket status
* RPC failures
* queue lag
* token count
* swap ingestion rate
* Base44 request failures
* alert failures
* stale tokens

Create internal health endpoint:

`/api/health`

Do not expose secrets or sensitive infrastructure.

---

# 39. IMPLEMENTATION ORDER

Do not attempt random features simultaneously.

Implement in this order:

## PHASE 0 — CLEAN EXISTING APP

* fix inconsistent metrics
* metric provenance
* clean missing states
* asset categories
* live-feed issues
* table pagination
* UI polish

## PHASE 1 — DATA FOUNDATION

* Postgres migrations
* raw events
* indexer
* swaps
* tokens
* wallets
* positions
* snapshots

## PHASE 2 — TRADER ENGINE

* PnL
* win rate
* profit factor
* drawdown
* wallet score
* classifications
* leaderboard

## PHASE 3 — SMART MONEY

* smart-money score
* accumulation
* distribution
* consensus
* token integration

## PHASE 4 — RUNNER RADAR

* momentum metrics
* Runner Score
* `/radar`
* signal storage

## PHASE 5 — WALLET INTELLIGENCE

* Wallet Detective
* wallet edges
* funding relationships
* holder clusters
* creator relationships

## PHASE 6 — RISK

* token risk engine
* simulations
* trading warnings

## PHASE 7 — BASE44

* Why Pumping adapter
* structured response
* caching
* token UI

## PHASE 8 — TRADING

* wallet connection
* quoting
* approvals
* Pons/Uniswap routing
* simulation
* signing
* transaction status
* positions

## PHASE 9 — MONITORING

* alerts
* position intelligence
* followed traders
* personalized feed

## PHASE 10 — INTELLIGENCE EXPANSION

* backtesting
* narratives
* token comparison
* relationship graph
* community system events

---

# 40. DEFINITION OF DONE

The build is complete when I can:

1. Open Analyst.
2. See active Robinhood Chain runners.
3. See WHY each token entered Radar.
4. Open any token.
5. See clean price/liquidity/volume data.
6. See smart-money activity.
7. See which strong traders are buying.
8. See creator/holder intelligence.
9. See related wallet clusters.
10. See risk information.
11. Press "Why Is This Pumping?"
12. Get a Base44-generated research report.
13. Connect an EVM wallet.
14. Get an on-chain trade quote.
15. Buy or sell without leaving Analyst.
16. See transaction status.
17. See my position.
18. See my PnL.
19. See whether the trade thesis strengthened/weakened.
20. Follow traders.
21. Create alerts.
22. View Trader Intelligence.
23. Open Wallet Detective.
24. Compare tokens.
25. See narrative trends.
26. Review historical Analyst signal performance.
27. View a personalized alpha feed.
28. Discuss tokens with other users.
29. Trust that the same metric means the same thing across all pages.

---

# 41. PRODUCT PRINCIPLES

Always prioritize:

SIGNAL > NOISE

ACTIONABLE > DECORATIVE

EXPLAINABLE > BLACK BOX

REAL DATA > PLACEHOLDERS

POINT-IN-TIME DATA > LEAKAGE

QUALITY TRADERS > RANDOM WALLETS

RUNNERS > RANDOM NEW DEPLOYS

NON-CUSTODIAL > CUSTODIAL

CHEAP SHARED INFRASTRUCTURE > PER-USER API CALLS

---

# 42. DO NOT DO THESE

Do not:

* redesign everything
* break existing working functionality
* fake data
* fake social activity
* invent wallet identities
* call every wallet a KOL
* use future information in historical scoring
* label uncertain relationships as insiders
* expose secrets
* send private keys anywhere
* execute trades without wallet confirmation
* implement X API
* implement OpenAI API
* implement 0x
* add expensive dependencies unnecessarily
* poll APIs individually from each client
* generate Why Pumping reports for every token automatically
* turn Radar into a list of every fresh deploy
* show unknown risk as safe
* claim an Analyst score predicts future returns

---

# 43. FINAL DELIVERY

Work directly in the existing repository.

After implementation:

1. Run lint.
2. Run TypeScript checks.
3. Run tests.
4. Run production build.
5. Fix all errors.
6. Verify critical routes.
7. Verify mobile layout.
8. Verify wallet connection.
9. Verify trade simulation.
10. Verify database migrations.
11. Verify Railway worker startup/recovery.
12. Verify Base44 integration.
13. Verify no API keys are client-exposed.

Then provide:

* files changed
* migrations created
* new API endpoints
* new routes
* environment variables required
* external setup required
* contracts/config that must be supplied
* tests performed
* remaining limitations

Do not stop after creating mock UI.

The goal is a functional product with real backend/data architecture.

If an external credential or contract address is unavailable, build the complete adapter/interface and clearly mark the exact environment variable required rather than inserting fake credentials or fake addresses.

The final result should make Analyst feel like a real **Robinhood Chain intelligence and trading terminal**, not a prototype.
