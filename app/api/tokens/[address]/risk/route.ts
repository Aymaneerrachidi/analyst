import { NextResponse } from 'next/server';
import { addressSchema } from '@/lib/trading/shared';
import { assessTokenRisk } from '@/lib/intelligence/risk';
import { noStore } from '@/lib/api';
export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const parsed = addressSchema.safeParse((await params).address);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid token address.' }, { status: 400 });
  return NextResponse.json(await assessTokenRisk(parsed.data), noStore);
}
