import { NextResponse } from "next/server";
import { addressSchema } from "@/lib/trading/shared";
import { tokenContext } from "@/lib/intelligence/token-context";
import { noStore } from "@/lib/api";
export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const parsed = addressSchema.safeParse((await params).address);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid token address.' }, { status: 400 });
  const context = await tokenContext(parsed.data);
  if (!context) return NextResponse.json({ error: 'Token not found.' }, { status: 404 });
  return NextResponse.json({ consensus: context.consensus, runner: context.runner, observedAt: context.observedAt }, noStore);
}
