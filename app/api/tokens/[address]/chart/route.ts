import { NextResponse } from "next/server";
import { jsonError, oneOf, searchParam } from "@/lib/api";
import { tokenExists } from "@/lib/services/exists";
import { ensureFresh } from "@/lib/services/sync";
import { getTokenChart } from "@/lib/services/token-chart";
import { FLOW_WINDOWS, type FlowWindow } from "@/lib/providers/types";

export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  await ensureFresh("trades", 8_000);
  if (!(await tokenExists(address))) return jsonError(404, "Token not found.");
  const window = oneOf<FlowWindow>(searchParam(new URL(req.url), "window"), FLOW_WINDOWS, "24h");
  return NextResponse.json(await getTokenChart(address, window), { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" } });
}
