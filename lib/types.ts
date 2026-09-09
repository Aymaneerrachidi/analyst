/** Public domain types consumed by pages, components and API responses. */
import type { Side, RankingPeriod, FlowWindow } from "@/lib/providers/types";

export type { Side, RankingPeriod, FlowWindow };

export interface AnalystTokenRef {
  address: string;
  symbol: string;
  name: string;
  image?: string | null;
}

export interface AnalystTraderRef {
  id: string;
  name: string;
  handle: string;
  wallet: string;
  avatar?: string | null;
}

export interface AnalystTrader extends AnalystTraderRef {
  statsSource?: "Defined" | "KOLHOOD" | "Analyst tracked";
  statsPeriod?: RankingPeriod;
  statsUpdatedAt?: string;
  twitterUrl?: string | null;
  pnl24h?: number | null;
  pnl7d?: number | null;
  pnl30d?: number | null;
  realizedPnl?: number | null;
  roi?: number | null;
  winRate?: number | null;
  trades?: number | null;
  buys?: number | null;
  sells?: number | null;
  avgTradeSize?: number | null;
  volumeUsd?: number | null;
  bestTradeUsd?: number | null;
  lastActive?: string | null;
  topToken?: AnalystTokenRef | null;
  rank?: number | null;
  communityRating?: number | null;
  ratingCount?: number;
}

export interface AnalystTrade {
  logIndex?: number;
  id: string;
  seq: number;
  traderId: string;
  trader: AnalystTraderRef;
  token: AnalystTokenRef;
  side: Side;
  amountUsd?: number | null;
  tokenAmount?: number | null;
  price?: number | null;
  realizedPnl?: number | null;
  timestamp: string;
  txHash?: string | null;
}

export interface ScoreBreakdown {
  score: number;
  quality: number;
  accumulation: number;
  breadth: number;
  conviction: number;
  momentum: number;
}

export interface AnalystToken extends AnalystTokenRef {
  hasWindowActivity?: boolean;
  category?: "memes" | "stocks" | "stablecoins" | "other";
  fdv?: number | null;
  price?: number | null;
  marketCap?: number | null;
  volume24h?: number | null;
  priceChange24h?: number | null;
  lastActivityAt?: string | null;

  window: FlowWindow;
  trackedTraders: number;
  traderBuys: number;
  traderSells: number;
  buyers: number;
  sellers: number;
  neutral: number;
  buyUsd: number;
  sellUsd: number;
  netAccumulation: number;
  topBuyer?: AnalystTraderRef | null;
  score: ScoreBreakdown;
  communityRating?: number | null;
  ratingCount?: number;
}

export interface Freshness {
  checkedAt?: string;
  lastTradeAt?: string | null;
  tradeAgeMs?: number | null;
  provider: "mock" | "kolhood" | "chain" | "alchemy" | "stalkchain";
  isMock: boolean;
  lastSyncAt: string | null;
  lastSyncOk: boolean;
  ageMs: number | null;
  status: "live" | "delayed" | "offline";
  trackedTraders: number;
}

export interface TraderTokenPosition {
  token: AnalystTokenRef;
  firstBuyAt?: string | null;
  lastBuyAt?: string | null;
  lastTradeAt?: string | null;
  buys: number;
  sells: number;
  boughtUsd: number;
  soldUsd: number;
  realizedPnl?: number | null;
  exposureUsd?: number | null;
}

export interface PnlPoint {
  t: string;
  value: number;
}

export interface TokenCandle {
  t: number;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume: number;
}

export interface TokenChartData {
  markers?: AnalystTrade[];
  window: FlowWindow;
  candles: TokenCandle[];
  activity: { t: number; buyUsd: number; sellUsd: number; buys: number; sells: number }[];
  source: "geckoterminal" | "pons" | "executions" | "mock" | "unavailable";
  priceUnit?: string;
  marketUrl: string | null;
  error?: string;
  fdv?: number | null;
  liquidityUsd?: number | null;
}

export type ContentRef =
  | { kind: "token"; label: string; href: string }
  | { kind: "trader"; label: string; href: string };

export interface GuestPublic {
  id: string;
  displayName: string;
}

export interface SocialPost {
  id: string;
  author: GuestPublic;
  body: string;
  refs: ContentRef[];
  upvotes: number;
  downvotes: number;
  score: number;
  replyCount: number;
  createdAt: string;
  myVote: 1 | -1 | 0;
  mine: boolean;
}

export interface SocialComment {
  id: string;
  author: GuestPublic;
  targetType: "token" | "trader" | "post";
  targetId: string;
  parentId: string | null;
  body: string;
  refs: ContentRef[];
  upvotes: number;
  downvotes: number;
  score: number;
  replyCount: number;
  createdAt: string;
  myVote: 1 | -1 | 0;
  mine: boolean;
  replies?: SocialComment[];
}

export interface RatingSummary {
  targetType: "token" | "trader";
  targetId: string;
  average: number | null;
  count: number;
  mine: number | null;
  distribution: number[]; // index 0..9 => score 1..10
}
