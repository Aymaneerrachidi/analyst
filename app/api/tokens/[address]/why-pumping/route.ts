import { NextResponse } from 'next/server';
import { addressSchema } from '@/lib/trading/shared';
import { whyPumping } from '@/lib/base44-agent';
import { guardWrite } from '@/lib/social/write-guard';
import { noStore } from '@/lib/api';
export async function POST(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const parsed = addressSchema.safeParse((await params).address);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid token address.' }, { status: 400 });
  const guard = await guardWrite(req, 'research');
  if (!guard.ok) return guard.response;
  const result = await whyPumping(parsed.data);
  return NextResponse.json(result, { ...noStore, status: result.status === 'not_found' ? 404 : result.status === 'not_configured' || result.status === 'unavailable' ? 503 : result.status === 'pending' ? 202 : 200 });
}
