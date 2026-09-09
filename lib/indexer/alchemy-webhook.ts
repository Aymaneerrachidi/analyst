import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const activity = z.object({
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  blockNum: z.string().regex(/^0x[0-9a-fA-F]+$/),
  fromAddress: address,
  toAddress: address,
}).passthrough();
const envelope = z.object({
  id: z.string().min(1).max(160),
  webhookId: z.string().min(1).max(160),
  createdAt: z.string().datetime(),
  type: z.literal("ADDRESS_ACTIVITY"),
  event: z.object({ network: z.string(), activity: z.array(activity).max(5000) }).passthrough(),
}).passthrough();

export const MAX_WEBHOOK_BYTES = 1_000_000;

export function verifyAlchemySignature(raw: string, signature: string | null, signingKey: string) {
  if (!signingKey || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", signingKey).update(raw, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function parseAlchemyWebhook(raw: string, webhookId: string, network: string) {
  const parsed = envelope.parse(JSON.parse(raw));
  if (!webhookId || !network || parsed.webhookId !== webhookId || parsed.event.network !== network) throw new Error("Unexpected webhook source");
  return parsed;
}

// A durable inbox, not a trade decoder. Transfer direction alone is not proof
// of a swap. The consumer must verify receipts before publishing trade rows.
export async function receiveAlchemyWebhook(request: Request, settings: { signingKey: string; webhookId: string; network: string }, save: (id: string, event: z.infer<typeof envelope>) => Promise<void>) {
  if (!settings.signingKey || !settings.webhookId || !settings.network) return Response.json({ error: "Webhook not configured" }, { status: 503 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Missing body" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_WEBHOOK_BYTES) { await reader.cancel(); return Response.json({ error: "Payload too large" }, { status: 413 }); }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!verifyAlchemySignature(raw, request.headers.get("x-alchemy-signature"), settings.signingKey)) return Response.json({ error: "Invalid signature" }, { status: 401 });
  let event: z.infer<typeof envelope>;
  try { event = parseAlchemyWebhook(raw, settings.webhookId, settings.network); }
  catch { return Response.json({ error: "Invalid webhook event" }, { status: 400 }); }
  try { await save(`${event.webhookId}:${event.id}`, event); }
  catch { return Response.json({ error: "Persistence unavailable" }, { status: 503 }); }
  return Response.json({ accepted: true });
}
