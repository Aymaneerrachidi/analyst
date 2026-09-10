import { tokenHolderEvidence } from '@/lib/services/token-holder-evidence';
export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[\da-f]{40}$/i.test(address)) return Response.json({ error: 'Invalid token address' }, { status: 400 });
  return Response.json(await tokenHolderEvidence(address.toLowerCase()), { headers: { 'Cache-Control': 'private, max-age=30' } });
}
