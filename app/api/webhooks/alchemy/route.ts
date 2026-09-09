import { getDb, schema } from "@/lib/db";
import { receiveAlchemyWebhook } from "@/lib/indexer/alchemy-webhook";
import { recordDelivery } from '@/lib/indexer/webhook-control';

export const runtime = "nodejs";

export async function POST(request: Request) {
  return receiveAlchemyWebhook(request, {
    signingKey: process.env.ALCHEMY_WEBHOOK_SIGNING_KEY ?? "",
    webhookId: process.env.ALCHEMY_WEBHOOK_ID ?? "",
    network: process.env.ALCHEMY_WEBHOOK_NETWORK ?? "",
  }, async (id, event, bytes) => {
    await recordDelivery(bytes);
    const db = await getDb();
    await db.insert(schema.appMeta).values({
      key: `alchemy-inbox:${id}`,
      value: { status: "pending", receivedAt: new Date().toISOString(), bytes, event },
    }).onConflictDoNothing();
  });
}
