import { NextResponse } from 'next/server';
import { indexedTradeSnapshot } from '@/lib/intelligence/live';
import { listTrades } from '@/lib/services/intelligence';
import { mergeLiveTrades } from '@/lib/client/live-trades';
import { noStore } from '@/lib/api';
export async function GET() {
  const [indexed, imported] = await Promise.all([indexedTradeSnapshot(), listTrades({ limit: 100 })]);
  return NextResponse.json({ trades: mergeLiveTrades(imported, indexed, 100) }, noStore);
}
