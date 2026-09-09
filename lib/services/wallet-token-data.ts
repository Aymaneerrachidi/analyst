import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { normalizeWalletTokens, WALLET_TOKENS_QUERY, type WalletTokenMetric } from '@/lib/providers/wallet-token-data';

type Snapshot = { capturedAt: string; partial: boolean; metrics: WalletTokenMetric[] };
export async function saveWalletTokenSnapshot(wallet: string, rows: unknown, capturedAt: string, partial = true) {
  const metrics = normalizeWalletTokens(rows, wallet);
  if (!metrics.length || !Number.isFinite(Date.parse(capturedAt)) || Date.parse(capturedAt) > Date.now() + 60_000) throw new Error('Invalid wallet snapshot');
  const db = await getDb();
  const [tracked] = await db.select({ id: schema.traders.id }).from(schema.traders).where(eq(schema.traders.id, wallet.toLowerCase()));
  if (!tracked) throw new Error('Wallet is not tracked');
  const tokens = [...new Map(metrics.map(row => [row.address, { address: row.address, name: row.name, symbol: row.symbol }])).values()];
  await db.insert(schema.tokens).values(tokens).onConflictDoNothing();
  const value: Snapshot = { capturedAt, partial, metrics };
  await db.insert(schema.appMeta).values({ key: `wallet:token-performance:${tracked.id}`, value, updatedAt: new Date(capturedAt) }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value, updatedAt: new Date(capturedAt) }, setWhere: sql`${schema.appMeta.updatedAt} <= ${capturedAt}::timestamptz` });
  return { tokens: new Set(metrics.map(r => r.address)).size };
}
export async function getWalletTokenSnapshot(wallet: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, `wallet:token-performance:${wallet.toLowerCase()}`));
  return row ? row.value as Snapshot : null;
}

/** Own API credentials; bounded pagination. Existing snapshots survive errors. */
export async function refreshWalletTokenSnapshot(wallet: string) {
  if (!/^0x[0-9a-f]{40}$/i.test(wallet)) throw new Error('Invalid wallet');
  if (!process.env.CODEX_API_KEY) return { status: 'credentials-required' };
  const rows: unknown[] = [];
  let partial = true;
  for (let offset = 0; offset < 500; offset += 50) {
    const response = await fetch('https://graph.codex.io/graphql', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: process.env.CODEX_API_KEY }, body: JSON.stringify({ query: WALLET_TOKENS_QUERY, variables: { input: { wallets: [wallet], networkId: 4663, limit: 50, offset, rankings: [{ attribute: 'realizedProfitUsd30d', direction: 'DESC' }] } } }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Wallet analytics unavailable');
    const body = await response.json();
    const page = body.data?.filterTokenWallets?.results;
    if (body.errors || !Array.isArray(page)) throw new Error('Invalid wallet analytics response');
    rows.push(...page);
    if (page.length < 50) { partial = false; break; }
  }
  if (!rows.length) return { status: 'empty' };
  return { status: 'ready', ...await saveWalletTokenSnapshot(wallet, rows, new Date().toISOString(), partial) };
}
