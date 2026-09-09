import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

export async function pauseWebhook() {
  if (!process.env.ALCHEMY_NOTIFY_TOKEN || !process.env.ALCHEMY_WEBHOOK_ID) throw new Error('Pause credentials missing');
  const response = await fetch('https://dashboard.alchemy.com/api/update-webhook', {
    method: 'PUT', headers: { 'content-type': 'application/json', 'X-Alchemy-Token': process.env.ALCHEMY_NOTIFY_TOKEN },
    body: JSON.stringify({ webhook_id: process.env.ALCHEMY_WEBHOOK_ID, is_active: false }), signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Webhook pause failed');
}

export async function recordDelivery(bytes: number) {
  const db = await getDb();
  const day = new Date().toISOString().slice(0, 10);
  // Count every signed delivery, including duplicate deliveries. 2x bandwidth
  // allowance leaves headroom for provider billing overhead and failed deliveries.
  const cu = Math.ceil(bytes * 0.08);
  await db.insert(schema.appMeta).values({ key: `alchemy-usage:${day}`, value: { cu } })
    .onConflictDoUpdate({ target: schema.appMeta.key, set: { value: sql`jsonb_build_object('cu', coalesce((${schema.appMeta.value}->>'cu')::bigint, 0) + ${cu})`, updatedAt: new Date() } });
  const rows = await db.select({ value: schema.appMeta.value }).from(schema.appMeta).where(eq(schema.appMeta.key, 'alchemy-worker'));
  const state = rows[0]?.value as { at?: string; status?: string } | undefined;
  if (process.env.ALCHEMY_NOTIFY_TOKEN && (!state?.at || Date.now() - Date.parse(state.at) > 90_000 || state.status === 'paused')) await pauseWebhook();
}
