import { NextResponse } from "next/server";
import { noStore } from "@/lib/api";
import { ensureFresh, getFreshness } from "@/lib/services/sync";

export async function GET() {
  await ensureFresh("trades", 8_000);
  const freshness = await getFreshness();
  return NextResponse.json(freshness, noStore);
}
