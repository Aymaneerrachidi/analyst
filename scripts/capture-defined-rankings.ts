import { config } from 'dotenv';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
config({ path: '.env.local', quiet: true });
async function main() {
  const { getDb, schema } = await import('../lib/db');
  const { eq, sql } = await import('drizzle-orm');
  const { normalizeLeaderboard } = await import('../lib/providers/leaderboard-data');
  const { normalizeDefinedImport } = await import('../lib/providers/defined-import');
  const { upsertTraders } = await import('../lib/services/sync');
  const { refreshPublicRankings } = await import('../lib/services/external-rankings');
  const db = await getDb();
  const [previous] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'leaderboard:defined-public'));
  if (!process.argv.includes('--capture-file') && previous && Date.now() - previous.updatedAt.getTime() < 55 * 60_000) { console.log('Hourly snapshot already captured.'); return; }
  const rows: unknown[] = [];
  const capturedAt = process.argv.includes('--capture-file') ? (await fs.stat('.vercel/defined-rh-filtered.json')).mtime.toISOString() : new Date().toISOString();
  if (process.argv.includes('--capture-file')) {
    const calls = JSON.parse(await fs.readFile('.vercel/defined-rh-filtered.json', 'utf8'));
    for (const c of calls) if (c.request.variables.input.filters.networkId === 4663) rows.push(...c.data.data.filterWallets.results);
  } else {
    // Use only the normal public page. No copied authorization headers, private
    // APIs, stealth plugins or challenge bypass. Failure preserves the snapshot.
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const pending: Promise<void>[] = [];
      page.on('response', response => {
        if (response.url() !== 'https://api.defined.fi/codex') return;
        pending.push((async () => {
          try {
            const q = response.request().postDataJSON();
            if (q.operationName !== 'DiscoverTradersFilterWallets' || q.variables?.input?.filters?.networkId !== 4663 || !response.ok()) return;
            const body = await response.json();
            if (Array.isArray(body.data?.filterWallets?.results)) rows.push(...body.data.filterWallets.results);
          } catch { /* Unrelated public responses are ignored. */ }
        })());
      });
      const response = await page.goto('https://www.defined.fi/traders', { timeout: 45_000 });
      if (!response?.ok()) throw new Error('Public ranking page unavailable');
      await page.getByText('Robinhood Chain', { exact: true }).click({ timeout: 15_000 });
      await page.waitForTimeout(4000);
      for (const resolution of ['24h', '7d']) {
        await page.getByRole('radio', { name: resolution, exact: true }).first().click();
        await page.waitForTimeout(3500);
      }
      await Promise.allSettled(pending);
    } finally { await browser.close(); }
  }
  const normalized = normalizeDefinedImport({ capturedAt, networkId: 4663, rows }, []);
  if (normalized.wallets.length < 10) throw new Error('Incomplete public snapshot; existing data retained');
  const metrics = normalizeLeaderboard(rows).map(r => ({ ...r, source: 'Defined' as const, observedAt: capturedAt }));
  const existing = new Set((await db.select({ id: schema.traders.id }).from(schema.traders)).map(t => t.id));
  await upsertTraders(db, normalized.traders.filter(t => !existing.has(t.wallet)));
  for (const t of normalized.traders) if (t.avatar) await db.update(schema.traders).set({ avatar: sql`coalesce(${schema.traders.avatar}, ${t.avatar})` }).where(eq(schema.traders.id, t.wallet));
  const value = { capturedAt, metrics, coverage: 'public-snapshot' };
  await db.insert(schema.appMeta).values({ key: 'leaderboard:defined-public', value }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value, updatedAt: new Date() } });
  console.log({ captured: normalized.wallets.length, ...await refreshPublicRankings() });
}
main().then(() => process.exit(0)).catch(e => { console.error(e instanceof Error ? e.message : 'Snapshot failed'); process.exit(1); });
