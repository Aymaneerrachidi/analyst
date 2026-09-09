import { listTrades } from '@/lib/services/intelligence';
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json({ trades: await listTrades({ limit: 100 }) }, { headers: { 'cache-control': 'no-store' } });
}
