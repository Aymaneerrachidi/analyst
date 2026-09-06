import { NextResponse } from "next/server";
import { floatParam, intParam, noStore, oneOf, searchParam } from "@/lib/api";
import { listTrades, type TradeFilter } from "@/lib/services/intelligence";
import { ensureFresh, getFreshness } from "@/lib/services/sync";

const FILTERS: TradeFilter[] = ["all", "buys", "sells", "large", "top"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  await ensureFresh("trades", 8_000);
  const afterSeq = intParam(url, "after", -1, -1, Number.MAX_SAFE_INTEGER);
  const beforeSeq = intParam(url, "before", -1, -1, Number.MAX_SAFE_INTEGER);
  const [trades, freshness] = await Promise.all([
    listTrades({
      limit: intParam(url, "limit", 50, 1, 200),
      afterSeq: afterSeq >= 0 ? afterSeq : undefined,
      beforeSeq: beforeSeq >= 0 ? beforeSeq : undefined,
      filter: oneOf(searchParam(url, "filter"), FILTERS, "all"),
      minUsd: floatParam(url, "minUsd"),
      traderId: searchParam(url, "trader"),
      tokenAddress: searchParam(url, "token"),
      query: searchParam(url, "q"),
    }),
    getFreshness(),
  ]);
  return NextResponse.json({ trades, freshness }, noStore);
}
