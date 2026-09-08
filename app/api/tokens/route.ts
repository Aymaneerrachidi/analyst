import { ASSET_CATEGORIES, type AssetCategory } from "@/lib/presentation";
import { NextResponse } from "next/server";
import { intParam, noStore, oneOf, searchParam } from "@/lib/api";
import { listTokens, type TokenTab } from "@/lib/services/intelligence";
import { ensureFresh } from "@/lib/services/sync";
import { FLOW_WINDOWS, type FlowWindow } from "@/lib/providers/types";

const TABS: TokenTab[] = ["trending", "accumulating", "distributing", "traded", "new"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  await ensureFresh("trades", 8_000);
  const tokens = await listTokens({
    category: oneOf<AssetCategory>(searchParam(url, "category"), ASSET_CATEGORIES, "all"),
    window: oneOf<FlowWindow>(searchParam(url, "window"), FLOW_WINDOWS, "24h"),
    tab: oneOf(searchParam(url, "tab"), TABS, "trending"),
    limit: intParam(url, "limit", 50, 1, 200),
    offset: intParam(url, "offset", 0, 0, 10000),
    query: searchParam(url, "q"),
  });
  return NextResponse.json({ tokens }, noStore);
}
