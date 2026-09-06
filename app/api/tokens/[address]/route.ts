import { NextResponse } from "next/server";
import { jsonError, noStore, oneOf, searchParam } from "@/lib/api";
import { getToken, getTokenTopTraders } from "@/lib/services/intelligence";
import { ensureFresh, refreshTokenMarketData, refreshTokenTraders } from "@/lib/services/sync";
import { FLOW_WINDOWS, type FlowWindow } from "@/lib/providers/types";

export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const url = new URL(req.url);
  await ensureFresh("trades", 8_000);
  await Promise.all([refreshTokenMarketData(address), refreshTokenTraders(address)]);
  const window = oneOf<FlowWindow>(searchParam(url, "window"), FLOW_WINDOWS, "24h");
  const token = await getToken(address, window);
  if (!token) return jsonError(404, "Token not found.");
  const topTraders = await getTokenTopTraders(address);
  return NextResponse.json({ token, topTraders }, noStore);
}
