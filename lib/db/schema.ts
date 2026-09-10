import {
  pgTable,
  text,
  integer,
  doublePrecision,
  timestamp,
  boolean,
  bigserial,
  serial,
  jsonb,
  uniqueIndex,
  index,
  bigint,
} from "drizzle-orm/pg-core";
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Intelligence layer (synced from the data provider)
// ---------------------------------------------------------------------------

export const traders = pgTable(
  "traders",
  {
    id: text("id").primaryKey(), // lowercase wallet address
    wallet: text("wallet").notNull(),
    name: text("name").notNull(),
    handle: text("handle").notNull(),
    avatar: text("avatar"),
    twitterUrl: text("twitter_url"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    totalTrades: integer("total_trades").notNull().default(0),
    buys: integer("buys").notNull().default(0),
    sells: integer("sells").notNull().default(0),
    realizedPnl: doublePrecision("realized_pnl"),
    winRate: doublePrecision("win_rate"),
    avgTradeSize: doublePrecision("avg_trade_size"),
    volumeUsd: doublePrecision("volume_usd"),
    bestTradeUsd: doublePrecision("best_trade_usd"),
    nativeBalance: doublePrecision("native_balance"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("traders_handle_idx").on(t.handle), index("traders_pnl_idx").on(t.realizedPnl)],
);

export const traderSnapshots = pgTable(
  "trader_snapshots",
  {
    id: serial("id").primaryKey(),
    traderId: text("trader_id")
      .notNull()
      .references(() => traders.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // 24h | 7d | 30d | all
    pnl: doublePrecision("pnl").notNull().default(0),
    roi: doublePrecision("roi"),
    trades: integer("trades").notNull().default(0),
    buys: integer("buys").notNull().default(0),
    sells: integer("sells").notNull().default(0),
    volumeUsd: doublePrecision("volume_usd"),
    bestTradeUsd: doublePrecision("best_trade_usd"),
    winRate: doublePrecision("win_rate"),
    rank: integer("rank"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trader_snapshots_unique").on(t.traderId, t.period),
    index("trader_snapshots_period_rank").on(t.period, t.rank),
  ],
);

export const tokens = pgTable(
  "tokens",
  {
    address: text("address").primaryKey(), // lowercase
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    image: text("image"),
    price: doublePrecision("price"),
    marketCap: doublePrecision("market_cap"),
    fdv: doublePrecision("fdv"),
    volume24h: doublePrecision("volume_24h"),
    priceChange24h: doublePrecision("price_change_24h"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tokens_symbol_idx").on(t.symbol), index("tokens_last_activity_idx").on(t.lastActivityAt)],
);

export const tokenSnapshots = pgTable(
  "token_snapshots",
  {
    id: serial("id").primaryKey(),
    tokenAddress: text("token_address")
      .notNull()
      .references(() => tokens.address, { onDelete: "cascade" }),
    window: text("window").notNull(), // 1h | 6h | 24h | 7d
    trackedTraders: integer("tracked_traders").notNull().default(0),
    buyers: integer("buyers").notNull().default(0),
    sellers: integer("sellers").notNull().default(0),
    neutral: integer("neutral").notNull().default(0),
    buys: integer("buys").notNull().default(0),
    sells: integer("sells").notNull().default(0),
    buyUsd: doublePrecision("buy_usd").notNull().default(0),
    sellUsd: doublePrecision("sell_usd").notNull().default(0),
    netFlowUsd: doublePrecision("net_flow_usd").notNull().default(0),
    topBuyerId: text("top_buyer_id"),
    score: integer("score").notNull().default(0),
    scoreQuality: integer("score_quality").notNull().default(0),
    scoreAccumulation: integer("score_accumulation").notNull().default(0),
    scoreBreadth: integer("score_breadth").notNull().default(0),
    scoreConviction: integer("score_conviction").notNull().default(0),
    scoreMomentum: integer("score_momentum").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("token_snapshots_unique").on(t.tokenAddress, t.window),
    index("token_snapshots_window_score").on(t.window, t.score),
  ],
);

export const trades = pgTable(
  "trades",
  {
    id: text("id").primaryKey(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    traderId: text("trader_id")
      .notNull()
      .references(() => traders.id, { onDelete: "cascade" }),
    tokenAddress: text("token_address")
      .notNull()
      .references(() => tokens.address, { onDelete: "cascade" }),
    side: text("side").notNull(), // BUY | SELL
    amountUsd: doublePrecision("amount_usd"),
    tokenAmount: doublePrecision("token_amount"),
    price: doublePrecision("price"),
    nativeAmount: doublePrecision("native_amount"),
    realizedPnl: doublePrecision("realized_pnl"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    txHash: text("tx_hash"),
    dex: text("dex"),
  },
  (t) => [
    index("trades_timestamp_idx").on(t.timestamp),
    index("trades_seq_idx").on(t.seq),
    index("trades_trader_idx").on(t.traderId, t.timestamp),
    index("trades_token_idx").on(t.tokenAddress, t.timestamp),
    uniqueIndex("trades_execution_identity").on(t.txHash, t.traderId, t.tokenAddress, t.side),
  ],
);

export const traderTokenStats = pgTable(
  "trader_token_stats",
  {
    id: serial("id").primaryKey(),
    traderId: text("trader_id")
      .notNull()
      .references(() => traders.id, { onDelete: "cascade" }),
    tokenAddress: text("token_address")
      .notNull()
      .references(() => tokens.address, { onDelete: "cascade" }),
    firstBuyAt: timestamp("first_buy_at", { withTimezone: true }),
    lastBuyAt: timestamp("last_buy_at", { withTimezone: true }),
    lastTradeAt: timestamp("last_trade_at", { withTimezone: true }),
    buys: integer("buys").notNull().default(0),
    sells: integer("sells").notNull().default(0),
    boughtUsd: doublePrecision("bought_usd").notNull().default(0),
    soldUsd: doublePrecision("sold_usd").notNull().default(0),
    realizedPnl: doublePrecision("realized_pnl"),
    exposureUsd: doublePrecision("exposure_usd"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trader_token_stats_unique").on(t.traderId, t.tokenAddress),
    index("trader_token_stats_token").on(t.tokenAddress),
  ],
);

export const dataSourceSyncs = pgTable("data_source_syncs", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  kind: text("kind").notNull(), // full | trades
  status: text("status").notNull(), // running | ok | error
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  tradesUpserted: integer("trades_upserted").notNull().default(0),
  error: text("error"),
});

// ---------------------------------------------------------------------------
// Community layer (guest-authored)
// ---------------------------------------------------------------------------

export const guests = pgTable(
  "guests",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    displayName: text("display_name").notNull(),
    isSeed: boolean("is_seed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("guests_token_hash_unique").on(t.tokenHash)],
);

export const posts = pgTable(
  "posts",
  {
    id: text("id").primaryKey(),
    guestId: text("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    bodyHash: text("body_hash").notNull(),
    ipHash: text("ip_hash"),
    upvotes: integer("upvotes").notNull().default(0),
    downvotes: integer("downvotes").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("posts_created_idx").on(t.createdAt), index("posts_guest_idx").on(t.guestId, t.createdAt)],
);

export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    guestId: text("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(), // token | trader | post
    targetId: text("target_id").notNull(),
    parentId: text("parent_id"),
    body: text("body").notNull(),
    bodyHash: text("body_hash").notNull(),
    ipHash: text("ip_hash"),
    upvotes: integer("upvotes").notNull().default(0),
    downvotes: integer("downvotes").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("comments_target_idx").on(t.targetType, t.targetId, t.createdAt),
    index("comments_parent_idx").on(t.parentId),
    index("comments_guest_idx").on(t.guestId, t.createdAt),
  ],
);

export const votes = pgTable(
  "votes",
  {
    id: text("id").primaryKey(),
    guestId: text("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(), // post | comment
    targetId: text("target_id").notNull(),
    value: integer("value").notNull(), // 1 | -1
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("votes_unique").on(t.guestId, t.targetType, t.targetId),
    index("votes_guest_time_idx").on(t.guestId, t.updatedAt),
  ],
);

export const ratings = pgTable(
  "ratings",
  {
    id: text("id").primaryKey(),
    guestId: text("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(), // token | trader
    targetId: text("target_id").notNull(),
    score: integer("score").notNull(), // 1..10
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ratings_unique").on(t.guestId, t.targetType, t.targetId),
    index("ratings_target_idx").on(t.targetType, t.targetId),
    index("ratings_guest_time_idx").on(t.guestId, t.updatedAt),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    guestId: text("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(), // post | comment
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    details: text("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reports_unique").on(t.guestId, t.targetType, t.targetId)],
);

export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// V2 chain history is additive. Existing provider tables remain readable during rollout.
export const chainBlocks = pgTable("chain_blocks", {
  id: text("id").primaryKey(), chainId: integer("chain_id").notNull(),
  number: bigint("number", { mode: "number" }).notNull(), hash: text("hash").notNull(), parentHash: text("parent_hash").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(), canonical: boolean("canonical").notNull().default(true),
}, t => [uniqueIndex("chain_blocks_hash_unique").on(t.chainId, t.hash), index("chain_blocks_height_idx").on(t.chainId, t.number)]);

export const rawChainEvents = pgTable("raw_chain_events", {
  id: text("id").primaryKey(), chainId: integer("chain_id").notNull(), blockNumber: bigint("block_number", { mode: "number" }).notNull(),
  blockHash: text("block_hash").notNull(), txHash: text("tx_hash").notNull(), logIndex: integer("log_index").notNull(),
  contract: text("contract").notNull(), topics: jsonb("topics").notNull(), rawData: text("raw_data").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(), ingestionVersion: integer("ingestion_version").notNull(),
}, t => [uniqueIndex("raw_chain_events_identity").on(t.chainId, t.blockHash, t.txHash, t.logIndex), index("raw_chain_events_block_idx").on(t.chainId, t.blockNumber)]);

export const chainCursors = pgTable("chain_cursors", {
  name: text("name").primaryKey(), chainId: integer("chain_id").notNull(), startBlock: bigint("start_block", { mode: "number" }).notNull(),
  blockNumber: bigint("block_number", { mode: "number" }).notNull(), blockHash: text("block_hash"),
  status: text("status").notNull().default("starting"), wsStatus: text("ws_status").notNull().default("disconnected"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), details: jsonb("details").notNull().default({}),
});

export const liquidityPools = pgTable("liquidity_pools", {
  address: text("address").primaryKey(), chainId: integer("chain_id").notNull().default(4663),
  token0: text("token0").notNull(), token1: text("token1").notNull(), dex: text("dex").notNull(),
  kind: text("kind").notNull(), fee: integer("fee"), factory: text("factory").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(), codeHash: text("code_hash").notNull(), active: boolean("active").notNull().default(true),
}, t => [index("liquidity_pools_token_idx").on(t.token0, t.token1)]);

export const wallets = pgTable("wallets", {
  address: text("address").primaryKey(), chainId: integer("chain_id").notNull().default(4663),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(), lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  walletType: text("wallet_type").notNull().default("unknown"), publicLabel: text("public_label"), displayName: text("display_name"), xHandle: text("x_handle"), kolVerified: boolean("kol_verified").notNull().default(false),
});

export const chainSwaps = pgTable("chain_swaps", {
  seq: bigint('seq', { mode: 'number' }).notNull().default(sql`nextval('trades_seq_seq')`),
  id: text("id").primaryKey(), chainId: integer("chain_id").notNull(), txHash: text("tx_hash").notNull(), logIndex: integer("log_index").notNull(),
  blockNumber: bigint("block_number", { mode: "number" }).notNull(), blockHash: text("block_hash").notNull(), timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  walletAddress: text("wallet_address").notNull(), tokenAddress: text("token_address").notNull(), quoteAddress: text("quote_address").notNull(),
  side: text("side").notNull(), amountToken: text("amount_token").notNull(), amountQuote: text("amount_quote").notNull(),
  usdValue: doublePrecision("usd_value"), executionPrice: doublePrecision("execution_price"), dex: text("dex").notNull(), poolAddress: text("pool_address").notNull(),
  attribution: text("attribution").notNull().default("transaction initiator"),
}, t => [uniqueIndex("chain_swaps_seq_unique").on(t.seq), uniqueIndex("chain_swaps_tx_log_unique").on(t.chainId, t.txHash, t.logIndex), index("chain_swaps_wallet_time").on(t.walletAddress, t.timestamp), index("chain_swaps_token_time").on(t.tokenAddress, t.timestamp)]);

export const chainTransfers = pgTable("chain_transfers", {
  id: text("id").primaryKey(), chainId: integer("chain_id").notNull(), txHash: text("tx_hash").notNull(), logIndex: integer("log_index").notNull(),
  blockNumber: bigint("block_number", { mode: "number" }).notNull(), blockHash: text("block_hash").notNull(), timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  tokenAddress: text("token_address").notNull(), from: text("from_address").notNull(), to: text("to_address").notNull(), amountRaw: text("amount_raw").notNull(),
}, t => [index("chain_transfers_from_idx").on(t.from, t.timestamp), index("chain_transfers_to_idx").on(t.to, t.timestamp)]);

export const tokenProfiles = pgTable("token_profiles", {
  address: text("address").primaryKey(), chainId: integer("chain_id").notNull().default(4663), decimals: integer("decimals"),
  assetType: text("asset_type").notNull().default("OTHER"), deployerAddress: text("deployer_address"), launchPlatform: text("launch_platform"),
  createdAtChain: timestamp("created_at_chain", { withTimezone: true }), discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  dexPairAddress: text("dex_pair_address"), metadata: jsonb("metadata").notNull().default({}), isVerifiedStockToken: boolean("is_verified_stock_token").notNull().default(false), active: boolean("active").notNull().default(true),
}, t => [uniqueIndex("token_profiles_chain_address").on(t.chainId, t.address)]);

export const marketObservations = pgTable("market_observations", {
  id: bigserial("id", { mode: "number" }).primaryKey(), tokenAddress: text("token_address").notNull(), timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  priceUsd: doublePrecision("price_usd"), marketCap: doublePrecision("market_cap"), fdv: doublePrecision("fdv"), liquidityUsd: doublePrecision("liquidity_usd"),
  volume5m: doublePrecision("volume_5m"), volume1h: doublePrecision("volume_1h"), volume6h: doublePrecision("volume_6h"), volume24h: doublePrecision("volume_24h"),
  buys5m: integer("buys_5m"), sells5m: integer("sells_5m"), buyers5m: integer("buyers_5m"), sellers5m: integer("sellers_5m"),
  holderCount: integer("holder_count"), priceChange5m: doublePrecision("price_change_5m"), priceChange1h: doublePrecision("price_change_1h"),
  source: text("source").notNull(), completeness: jsonb("completeness").notNull().default({}),
}, t => [uniqueIndex("market_observations_unique").on(t.tokenAddress, t.timestamp, t.source), index("market_observations_token_time").on(t.tokenAddress, t.timestamp)]);

export const walletMetrics = pgTable("wallet_metrics", {
  id: text("id").primaryKey(), walletAddress: text("wallet_address").notNull(), period: text("period").notNull(),
  realizedPnl: doublePrecision("realized_pnl"), unrealizedPnl: doublePrecision("unrealized_pnl"), totalPnl: doublePrecision("total_pnl"),
  winRate: doublePrecision("win_rate"), trades: integer("trades").notNull(), winningTrades: integer("winning_trades").notNull(), losingTrades: integer("losing_trades").notNull(),
  averageReturn: doublePrecision("average_return"), medianReturn: doublePrecision("median_return"), profitFactor: doublePrecision("profit_factor"), maxDrawdown: doublePrecision("max_drawdown"),
  averageHoldTime: doublePrecision("average_hold_time"), medianHoldTime: doublePrecision("median_hold_time"), averageEntryMarketCap: doublePrecision("average_entry_market_cap"),
  runnerHitRate: doublePrecision("runner_hit_rate"), rugRate: doublePrecision("rug_rate"), earlyEntryScore: doublePrecision("early_entry_score"), consistencyScore: doublePrecision("consistency_score"), riskScore: doublePrecision("risk_score"), overallScore: doublePrecision("overall_score"),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull(), provenance: jsonb("provenance").notNull(), details: jsonb("details").notNull().default({}),
}, t => [uniqueIndex("wallet_metrics_period_unique").on(t.walletAddress, t.period), index("wallet_metrics_ranking_idx").on(t.period, t.overallScore)]);

export const walletTokenPositions = pgTable("wallet_token_positions", {
  id: text("id").primaryKey(), wallet: text("wallet").notNull(), token: text("token").notNull(), amount: text("amount"), costBasis: doublePrecision("cost_basis"),
  realizedPnl: doublePrecision("realized_pnl"), unrealizedPnl: doublePrecision("unrealized_pnl"), firstBuy: timestamp("first_buy", { withTimezone: true }), latestBuy: timestamp("latest_buy", { withTimezone: true }), latestSell: timestamp("latest_sell", { withTimezone: true }),
  totalBought: doublePrecision("total_bought"), totalSold: doublePrecision("total_sold"), status: text("status").notNull(), details: jsonb("details").notNull().default({}), calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull(),
}, t => [uniqueIndex("wallet_token_positions_unique").on(t.wallet, t.token)]);

export const walletEdges = pgTable("wallet_edges", {
  id: text("id").primaryKey(), walletA: text("wallet_a").notNull(), walletB: text("wallet_b").notNull(), relationship: text("relationship").notNull(), confidence: doublePrecision("confidence").notNull(), evidence: jsonb("evidence").notNull(),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(), lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
}, t => [index("wallet_edges_a_idx").on(t.walletA), index("wallet_edges_b_idx").on(t.walletB)]);

export const tokenSignals = pgTable("token_signals", {
  id: text("id").primaryKey(), token: text("token").notNull(), timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  runnerScore: doublePrecision("runner_score"), smartMoneyScore: doublePrecision("smart_money_score"), momentumScore: doublePrecision("momentum_score"), holderScore: doublePrecision("holder_score"), liquidityScore: doublePrecision("liquidity_score"), riskPenalty: doublePrecision("risk_penalty"), narrativeScore: doublePrecision("narrative_score"), finalScore: doublePrecision("final_score"),
  signalType: text("signal_type").notNull(), reasons: jsonb("reasons").notNull(), inputs: jsonb("inputs").notNull(), version: text("version").notNull(),
}, t => [index("token_signals_token_time").on(t.token, t.timestamp), index("token_signals_time_idx").on(t.timestamp)]);

export const signalOutcomes = pgTable("signal_outcomes", {
  signalId: text("signal_id").primaryKey().references(() => tokenSignals.id),
  return5m: doublePrecision("return_5m"), return15m: doublePrecision("return_15m"), return1h: doublePrecision("return_1h"), return6h: doublePrecision("return_6h"), return24h: doublePrecision("return_24h"),
  maxGain1h: doublePrecision("max_gain_1h"), maxGain6h: doublePrecision("max_gain_6h"), maxGain24h: doublePrecision("max_gain_24h"), maxDrawdown1h: doublePrecision("max_drawdown_1h"), maxDrawdown24h: doublePrecision("max_drawdown_24h"),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull(), coverage: jsonb("coverage").notNull(),
});

export const riskAssessments = pgTable("risk_assessments", {
  id: text("id").primaryKey(), token: text("token").notNull(), timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  overallRisk: text("overall_risk").notNull(), score: doublePrecision("score"), sellSimulation: text("sell_simulation").notNull().default("UNKNOWN"),
  ownerPermissions: jsonb("owner_permissions"), mintPermissions: text("mint_permissions"), blacklistPossible: text("blacklist_possible"), pausePossible: text("pause_possible"),
  holderConcentration: doublePrecision("holder_concentration"), creatorHoldings: doublePrecision("creator_holdings"), relatedWalletConcentration: doublePrecision("related_wallet_concentration"), liquidityRisk: text("liquidity_risk"), suspiciousCreatorActivity: jsonb("suspicious_creator_activity"), details: jsonb("details").notNull(),
}, t => [index("risk_assessments_token_time").on(t.token, t.timestamp)]);

export const whyPumpingReports = pgTable("why_pumping_reports", {
  id: text("id").primaryKey(), token: text("token").notNull(), generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(), marketSnapshotTimestamp: timestamp("market_snapshot_timestamp", { withTimezone: true }).notNull(),
  agentVersion: text("agent_version").notNull(), summary: text("summary").notNull(), primaryCatalyst: text("primary_catalyst").notNull(), catalysts: jsonb("catalysts").notNull(),
  narrative: text("narrative").notNull(), socialContext: text("social_context").notNull(), smartMoneyContext: text("smart_money_context").notNull(), risks: jsonb("risks").notNull(), confidence: doublePrecision("confidence").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), rawAgentResponse: jsonb("raw_agent_response").notNull(), context: jsonb("context").notNull(),
}, t => [index("why_pumping_token_time").on(t.token, t.generatedAt)]);

export const userPositions = pgTable("user_positions", {
  id: text("id").primaryKey(), wallet: text("wallet").notNull(), token: text("token").notNull(), entryTransaction: text("entry_transaction").notNull(),
  entryPrice: doublePrecision("entry_price"), entryMarketCap: doublePrecision("entry_market_cap"), amount: text("amount").notNull(), totalCost: doublePrecision("total_cost"), openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  currentAmount: text("current_amount"), realizedPnl: doublePrecision("realized_pnl"), thesis: jsonb("thesis").notNull(), receiptBlock: bigint("receipt_block", { mode: "number" }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, t => [uniqueIndex("user_positions_receipt_unique").on(t.wallet, t.token, t.entryTransaction), index("user_positions_wallet_idx").on(t.wallet)]);

export const userPreferences = pgTable("user_preferences", {
  guestId: text("guest_id").primaryKey().references(() => guests.id), wallet: text("wallet"), follows: jsonb("follows").notNull().default([]), watchlist: jsonb("watchlist").notNull().default([]), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const alertRules = pgTable("alert_rules", {
  id: text("id").primaryKey(), guestId: text("guest_id").notNull().references(() => guests.id), alertType: text("alert_type").notNull(), token: text("token"), trader: text("trader"),
  threshold: doublePrecision("threshold"), enabled: boolean("enabled").notNull().default(true), destination: text("destination").notNull().default("browser"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), config: jsonb("config").notNull().default({}),
}, t => [index("alert_rules_guest_idx").on(t.guestId)]);
export const alertDeliveries = pgTable("alert_deliveries", {
  id: text("id").primaryKey(), ruleId: text("rule_id").notNull().references(() => alertRules.id, { onDelete: "cascade" }), guestId: text("guest_id").notNull(), eventKey: text("event_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), payload: jsonb("payload").notNull(), readAt: timestamp("read_at", { withTimezone: true }),
}, t => [uniqueIndex("alert_delivery_unique").on(t.ruleId, t.eventKey), index("alert_delivery_guest_idx").on(t.guestId, t.createdAt)]);

export type TraderRow = typeof traders.$inferSelect;
export type TraderSnapshotRow = typeof traderSnapshots.$inferSelect;
export type TokenRow = typeof tokens.$inferSelect;
export type TokenSnapshotRow = typeof tokenSnapshots.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;
export type TraderTokenStatsRow = typeof traderTokenStats.$inferSelect;
export type GuestRow = typeof guests.$inferSelect;
export type PostRow = typeof posts.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type VoteRow = typeof votes.$inferSelect;
export type RatingRow = typeof ratings.$inferSelect;
