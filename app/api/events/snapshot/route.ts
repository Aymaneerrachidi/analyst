import { NextResponse } from 'next/server';
import { listTrades } from '@/lib/services/intelligence';
import { noStore } from '@/lib/api';
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('after');
  const after = raw === null ? undefined : Number(raw);
  if (after !== undefined && (!Number.isSafeInteger(after) || after < 0)) return NextResponse.json({ error: 'Invalid cursor' }, { status: 400, ...noStore });
  try {
    return NextResponse.json({ trades: await listTrades({ limit: 100, afterSeq: after }) }, noStore);
  } catch {
    return NextResponse.json({ error: 'Market data is temporarily unavailable.' }, { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '60' } });
  }
}
