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
} from "drizzle-orm/pg-core";

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
