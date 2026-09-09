import { NextResponse } from 'next/server';
import { z } from 'zod';
import { noStore, parseJson } from '@/lib/api';
import { addressSchema } from '@/lib/trading/shared';
import { guardWrite } from '@/lib/social/write-guard';
import { positionsForWallet, recordPosition } from '@/lib/intelligence/positions';
export async function GET(req: Request) {
  const parsed = addressSchema.safeParse(new URL(req.url).searchParams.get('wallet'));
  if (!parsed.success) return NextResponse.json({ error: 'Valid wallet required.' }, { status: 400 });
  return NextResponse.json({ positions: await positionsForWallet(parsed.data) }, noStore);
}
export async function POST(req: Request) {
  const parsed = await parseJson(req, z.object({ wallet: addressSchema, token: addressSchema, hash: z.string().regex(/^0x[\da-fA-F]{64}$/).transform(v => v.toLowerCase() as `0x${string}`) }).strict());
  if (!parsed.ok) return parsed.response;
  const guard = await guardWrite(req, 'preferences'); if (!guard.ok) return guard.response;
  try { const result = await recordPosition(parsed.data.wallet, parsed.data.token, parsed.data.hash); return NextResponse.json(result, { ...noStore, status: result.status === 'pending' ? 202 : 200 }); }
  catch { return NextResponse.json({ error: 'Could not verify a confirmed direct-trade receipt for this wallet and token.' }, { status: 422 }); }
}
