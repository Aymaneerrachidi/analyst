import { NextResponse } from 'next/server';
import { addressSchema } from '@/lib/trading/shared';
import { walletDetective } from '@/lib/intelligence/wallet-detective';
import { noStore } from '@/lib/api';
export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const parsed = addressSchema.safeParse((await params).address);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid wallet address.' }, { status: 400 });
  return NextResponse.json(await walletDetective(parsed.data), noStore);
}
