/**
 * Normalized upstream contract. Every data source (mock, KOLHOOD, a future indexer)
 * must produce these shapes; the rest of ANALYST never touches provider-specific fields.
 */

export type Side = "BUY" | "SELL";
export type RankingPeriod = "24h" | "7d" | "30d" | "all";
export type FlowWindow = "1h" | "6h" | "24h" | "7d";

export const RANKING_PERIODS: RankingPeriod[] = ["24h", "7d", "30d", "all"];
export const FLOW_WINDOWS: FlowWindow[] = ["1h", "6h", "24h", "7d"];

export interface UpstreamTrader {
  wallet: string;
  name: string;
  handle?: string;
  avatar?: string;
  twitterUrl?: string;
  pnl24h?: number;
}

export interface UpstreamTraderProfile {
  wallet: string;
  name: string;
  avatar?: string;
  handle?: string;
  twitterUrl?: string;
  recentTrades?: UpstreamTrade[];
  realizedPnl?: number;
  volumeUsd?: number;
  totalTrades?: number;
  winRate?: number;
  bestTradeUsd?: number;
  nativeBalance?: number;
  holdings: { tokenAddress: string; symbol: string; usdValue?: number }[];
}

export interface UpstreamRankingRow {
  wallet: string;
  name: string;
  twitterUrl?: string;
  pnl: number;
  trades: number;
  buys: number;
  sells: number;
  bestTradeUsd?: number;
  roi?: number;
  winRate?: number;
}

export interface UpstreamTrade {
  id: string;
  txHash?: string;
  wallet: string;
  side: Side;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName?: string;
  amountUsd?: number;
  tokenAmount?: number;
  price?: number;
  nativeAmount?: number;
  dex?: string;
  timestamp: string; // ISO
}

export interface UpstreamTokenActivity {
  address: string;
  symbol: string;
  name?: string;
  image?: string;
  lastActivityAt?: string;
  kolCount?: number;
  netInflowUsd?: number;
  volume24hUsd?: number;
  price?: number;
  marketCap?: number;
  priceChange24h?: number;
}

export interface FetchTradesOptions {
  limit: number;
  /** ISO timestamp; providers that support it return only newer trades. */
  after?: string;
}

export interface DataProvider {
  readonly name: "mock" | "kolhood";
  /** True only for synthetic data. Surfaces in the UI so mock data is never mistaken for production data. */
  readonly isMock: boolean;
  fetchTraders(): Promise<UpstreamTrader[]>;
  fetchLeaderboard(period: RankingPeriod): Promise<UpstreamRankingRow[]>;
  fetchTrades(opts: FetchTradesOptions): Promise<UpstreamTrade[]>;
  fetchTraderProfile(wallet: string): Promise<UpstreamTraderProfile | null>;
  fetchTokenActivity(): Promise<UpstreamTokenActivity[]>;
}
