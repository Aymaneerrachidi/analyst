import { NextResponse } from "next/server";
import { jsonError, noStore, oneOf, searchParam } from "@/lib/api";
import { getTrader, getTraderPnlSeries, getTraderPositions, getTraderRanks } from "@/lib/services/intelligence";
import { ensureFresh, refreshTraderProfiles } from "@/lib/services/sync";
import { RANKING_PERIODS, type RankingPeriod } from "@/lib/providers/types";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  await ensureFresh("trades", 8_000);
  await refreshTraderProfiles([id]);
  const period = oneOf<RankingPeriod>(searchParam(url, "period"), RANKING_PERIODS, "30d");
  const trader = await getTrader(id, period);
  if (!trader) return jsonError(404, "Trader not found.");
  const [ranks, positions, series] = await Promise.all([getTraderRanks(id), getTraderPositions(id), getTraderPnlSeries(id, period)]);
  return NextResponse.json({ trader, ranks, positions, series, period }, noStore);
}
