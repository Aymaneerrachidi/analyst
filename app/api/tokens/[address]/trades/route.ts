import { NextResponse } from "next/server";
import { intParam, noStore } from "@/lib/api";
import { listTrades } from "@/lib/services/intelligence";
import { ensureFresh } from "@/lib/services/sync";

export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const url = new URL(req.url);
  await ensureFresh("trades", 8_000);
  const afterSeq = intParam(url, "after", -1, -1, Number.MAX_SAFE_INTEGER);
  const trades = await listTrades({
    tokenAddress: address,
    limit: intParam(url, "limit", 30, 1, 200),
    afterSeq: afterSeq >= 0 ? afterSeq : undefined,
  });
  return NextResponse.json({ trades }, noStore);
}
