import { NextResponse } from "next/server";
import { intParam, noStore, oneOf, searchParam } from "@/lib/api";
import { listTraders, type TraderFilter } from "@/lib/services/intelligence";
import { ensureFresh } from "@/lib/services/sync";
import { RANKING_PERIODS, type RankingPeriod } from "@/lib/providers/types";

const FILTERS: TraderFilter[] = ["all", "memecoins", "volume", "active", "winrate"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  await ensureFresh("trades", 8_000);
  const traders = await listTraders({
    period: oneOf<RankingPeriod>(searchParam(url, "period"), RANKING_PERIODS, "30d"),
    filter: oneOf(searchParam(url, "filter"), FILTERS, "all"),
    limit: intParam(url, "limit", 50, 1, 500),
    query: searchParam(url, "q"),
    offset: intParam(url, "offset", 0, 0, 10000),
  });
  return NextResponse.json({ traders }, noStore);
}
