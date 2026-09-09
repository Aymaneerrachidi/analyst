import { NextResponse } from "next/server";
import { addressSchema } from "@/lib/trading/shared";
import { getWalletIntelligence } from "@/lib/intelligence/service";
import { noStore, oneOf } from "@/lib/api";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const address = addressSchema.safeParse((await params).id);
  if (!address.success) return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
  const period = oneOf(new URL(req.url).searchParams.get('period') ?? undefined, ['24h', '7d', '30d', 'all'] as const, '30d');
  return NextResponse.json({ intelligence: await getWalletIntelligence(address.data, period), period }, noStore);
}
