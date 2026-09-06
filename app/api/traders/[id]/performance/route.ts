import { getPerformance } from "@/lib/services/performance";
import { noStore } from "@/lib/api";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^0x[\da-f]{40}$/i.test(id)) return Response.json({ error: "Invalid wallet" }, { status: 400 });
  return Response.json({ positions: await getPerformance(id) }, noStore);
}
