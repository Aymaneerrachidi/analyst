import 'server-only';
import { and, eq, inArray, like, lt } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import type { AnalystTrader, RankingPeriod } from '@/lib/types';
import { LEADERBOARD_QUERY, normalizeLeaderboard, type RankingMetric } from '@/lib/providers/leaderboard-data';
import { mergeRankings, normalizeStalkRankings } from '@/lib/providers/stalkchain-rankings';
import { stalkGet } from '@/lib/providers/stalkchain';

type Snapshot = { capturedAt: string; metrics: RankingMetric[]; coverage: 'tracked-wallets' | 'public-snapshot' | 'recorded-swaps' | 'combined' };
export async function rankingStatus() {
  const db = await getDb();
  const [saved] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'leaderboard:rankings'));
  if (!saved) return null;
  const snapshot = saved.value as Snapshot;
  return { capturedAt: snapshot.capturedAt, wallets: new Set(snapshot.metrics.map(r => r.wallet)).size, automatic: snapshot.coverage !== 'public-snapshot', partial: snapshot.coverage === 'recorded-swaps', intervalMinutes: 60 };
}
export async function saveRankingSnapshot(rows: unknown, capturedAt: string, coverage: Snapshot['coverage']) {
  if (!Number.isFinite(Date.parse(capturedAt)) || Date.parse(capturedAt) > Date.now() + 60_000) throw new Error('Invalid ranking timestamp');
  const metrics = normalizeLeaderboard(rows);
  if (!metrics.length) throw new Error('Empty ranking response');
  const db = await getDb();
  const allowed = new Set((await db.select({ id: schema.traders.id }).from(schema.traders)).map(t => t.id));
  const value: Snapshot = { capturedAt, coverage, metrics: metrics.filter(r => allowed.has(r.wallet)) };
  if (!value.metrics.length) throw new Error('No tracked wallets in ranking response');
  await db.insert(schema.appMeta).values({ key: 'leaderboard:rankings', value }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value, updatedAt: new Date() } });
  return { wallets: new Set(value.metrics.map(r => r.wallet)).size, periods: ['24h', '7d', '30d'] };
}

export async function externalRankings(opts: { period?: RankingPeriod; filter?: string; query?: string; limit?: number; offset?: number }): Promise<AnalystTrader[] | null> {
  const db = await getDb();
  const [saved] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'leaderboard:rankings'));
  if (!saved) return null;
  const snapshot = saved.value as Snapshot;
  const period = opts.period ?? '30d';
  let metrics = snapshot.metrics.filter(r => r.period === period);
  if (!metrics.length) return [];
  const profiles = await db.select().from(schema.traders).where(inArray(schema.traders.id, metrics.map(r => r.wallet)));
  const profilesById = new Map(profiles.map(p => [p.id, p]));
  const q = opts.query?.toLowerCase();
  if (opts.filter === 'winrate') metrics = metrics.filter(r => r.trades !== null && r.trades >= 5 && r.winRate !== null);
  if (opts.filter === 'memecoins') {
    const history = new Set((await db.select({ wallet: schema.traderTokenStats.traderId }).from(schema.traderTokenStats)).map(r => r.wallet));
    metrics = metrics.filter(r => history.has(r.wallet));
  }
  const score = (r: RankingMetric) => opts.filter === 'winrate' ? r.winRate : opts.filter === 'volume' ? r.volumeUsd : opts.filter === 'active' ? r.trades : r.pnl;
  metrics.sort((a, b) => (score(b) ?? -Infinity) - (score(a) ?? -Infinity) || a.wallet.localeCompare(b.wallet));
  const ranks = new Map(metrics.map((r, i) => [r.wallet, i + 1]));
  if (q) metrics = metrics.filter(r => { const p = profilesById.get(r.wallet); return p && [p.name, p.handle, p.wallet].some(s => s.toLowerCase().includes(q)); });
  const offset = Math.max(0, opts.offset ?? 0);
  return metrics.slice(offset, offset + Math.min(500, opts.limit ?? 50)).flatMap((r) => {
    const p = profilesById.get(r.wallet); if (!p) return [];
    return [{ id: p.id, wallet: p.wallet, name: p.name, handle: p.handle, avatar: p.avatar, twitterUrl: p.twitterUrl,
      pnl24h: snapshot.metrics.find(m => m.wallet === p.id && m.period === '24h')?.pnl ?? null,
      pnl7d: snapshot.metrics.find(m => m.wallet === p.id && m.period === '7d')?.pnl ?? null,
      pnl30d: snapshot.metrics.find(m => m.wallet === p.id && m.period === '30d')?.pnl ?? null,
      realizedPnl: r.pnl, roi: r.roi, winRate: r.winRate, trades: r.trades, buys: r.buys ?? null, sells: r.sells ?? null,
      volumeUsd: r.volumeUsd, avgTradeSize: r.volumeUsd !== null && r.trades ? r.volumeUsd / r.trades : null,
      bestTradeUsd: r.bestTradeUsd ?? null, topToken: null, lastActive: p.lastActiveAt?.toISOString() ?? null,
      rank: ranks.get(r.wallet)!, statsSource: r.source ?? (snapshot.coverage === 'recorded-swaps' ? 'Analyst tracked' as const : 'Defined' as const), statsPeriod: period, statsUpdatedAt: r.observedAt ?? snapshot.capturedAt, basisIncomplete: r.basisIncomplete }];
  });
}

/** Own API credentials only. Failed refreshes retain the last complete snapshot. */
export async function refreshExternalRankings() {
  if (!process.env.CODEX_API_KEY) return refreshPublicRankings();
  const db = await getDb();
  const wallets = (await db.select({ id: schema.traders.id }).from(schema.traders)).map(t => t.id);
  const rows: unknown[] = [];
  for (let i = 0; i < wallets.length; i += 100) {
    const response = await fetch('https://graph.codex.io/graphql', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: process.env.CODEX_API_KEY },
      body: JSON.stringify({ query: LEADERBOARD_QUERY, variables: { input: { filters: { networkId: 4663 }, wallets: wallets.slice(i, i + 100), limit: 100 } } }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Ranking refresh unavailable');
    const body = await response.json();
    if (body.errors || !Array.isArray(body.data?.filterWallets?.results)) throw new Error('Invalid ranking response');
    rows.push(...body.data.filterWallets.results);
  }
  const result = await saveRankingSnapshot(rows, new Date().toISOString(), 'tracked-wallets');
  let activityChecks = 0;
  if (process.env.BLOCKSCOUT_PRO_API_KEY) {
    const leaders = normalizeLeaderboard(rows).filter(r => r.period === '7d').sort((a, b) => b.pnl - a.pnl).slice(0, 3);
    for (const leader of leaders) {
      try {
        const url = new URL(`https://api.blockscout.com/4663/api/v2/addresses/${leader.wallet}/transactions`);
        url.searchParams.set('apikey', process.env.BLOCKSCOUT_PRO_API_KEY);
        const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
        if (!response.ok) continue;
        const body = await response.json();
        if (!Array.isArray(body.items)) continue;
        const hashes = body.items.filter((t: { hash?: string; from?: { hash?: string }; to?: { hash?: string } }) => /^0x[\da-f]{64}$/i.test(t.hash ?? '') && [t.from?.hash?.toLowerCase(), t.to?.hash?.toLowerCase()].includes(leader.wallet)).map((t: { hash: string }) => t.hash);
        const value = { at: new Date().toISOString(), hashes, scope: 'recent activity only; not independent PnL verification' };
        await db.insert(schema.appMeta).values({ key: `leaderboard:activity:${leader.wallet}`, value }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value, updatedAt: new Date() } });
        if (hashes.length) activityChecks++;
      } catch { /* Preserve ranking snapshot when explorer access fails. */ }
    }
  }
  return { status: 'updated', ...result, activityChecks };
}

/** Hourly, reproducible rankings from our recorded swap history. Never relabel
 * an old public leaderboard as freshly fetched, or combine its PnL with ours. */
export async function snapshotRecordedRankings() {
  const db = await getDb();
  const rows = await db.select().from(schema.traderSnapshots).where(inArray(schema.traderSnapshots.period, ['24h', '7d', '30d']));
  const latest = Math.max(0, ...rows.map(row => row.computedAt.getTime()));
  // Historical imports share this table. Only the latest local computation
  // belongs in this snapshot; older source rows must not acquire a fresh date.
  const active = rows.filter(row => row.trades > 0 && Number.isFinite(row.pnl) && latest - row.computedAt.getTime() < 120_000 && Date.now() - row.computedAt.getTime() < 2 * 3_600_000);
  if (!active.length) return { status: 'awaiting-recorded-trades' };
  const now = new Date();
  const computedAt = new Date(Math.min(...active.map(row => row.computedAt.getTime())));
  if (now.getTime() - computedAt.getTime() > 2 * 3_600_000) return { status: 'analytics-stale' };
  const value: Snapshot = { capturedAt: computedAt.toISOString(), coverage: 'recorded-swaps', metrics: active.map(row => ({ wallet: row.traderId, period: row.period as RankingMetric['period'], pnl: row.pnl, roi: row.roi, winRate: row.winRate, trades: row.trades, volumeUsd: row.volumeUsd, buys: row.buys, sells: row.sells, bestTradeUsd: row.bestTradeUsd })) };
  const [previous] = await db.select().from(schema.appMeta).where(eq(schema.appMeta.key, 'leaderboard:rankings'));
  if (previous && (previous.value as Snapshot).coverage === 'public-snapshot') await db.insert(schema.appMeta).values({ key: 'leaderboard:public-backup', value: previous.value }).onConflictDoNothing();
  const key = `leaderboard:hour:${now.toISOString().slice(0, 13)}`;
  await db.insert(schema.appMeta).values({ key, value }).onConflictDoNothing();
  await db.insert(schema.appMeta).values({ key: 'leaderboard:rankings', value }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value, updatedAt: now } });
  await db.delete(schema.appMeta).where(and(like(schema.appMeta.key, 'leaderboard:hour:%'), lt(schema.appMeta.updatedAt, new Date(now.getTime() - 5 * 86_400_000))));
  return { status: 'updated', wallets: new Set(active.map(row => row.traderId)).size, partial: true, capturedAt: value.capturedAt };
}

/** Three public requests per hour; a failed window retains its original timestamp. */
export async function refreshPublicRankings() {
  const db = await getDb();
  const saved = await db.select().from(schema.appMeta).where(inArray(schema.appMeta.key, ['leaderboard:defined-public', 'leaderboard:rankings']));
  const previous = saved.find(r => r.key === 'leaderboard:rankings')?.value as Snapshot | undefined;
  const defined = saved.find(r => r.key === 'leaderboard:defined-public')?.value as Snapshot | undefined;
  const stalk: RankingMetric[] = [];
  for (const period of ['24h', '7d', '30d'] as const) {
    try { stalk.push(...normalizeStalkRankings(await stalkGet(`kols/leaderboard?window=${period}&sort=pnl&limit=100`), period, new Date().toISOString())); }
    catch { stalk.push(...(previous?.metrics ?? []).filter(r => r.period === period && r.source === 'Stalkchain')); }
  }
  const metrics = mergeRankings(defined?.metrics ?? [], stalk);
  if (!metrics.length) return { status: 'unavailable', retained: Boolean(previous) };
  const now = new Date();
  const value: Snapshot = { capturedAt: now.toISOString(), coverage: 'combined', metrics };
  await db.insert(schema.appMeta).values({ key: 'leaderboard:rankings', value }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value, updatedAt: now } });
  await db.insert(schema.appMeta).values({ key: `leaderboard:hour:${now.toISOString().slice(0,13)}`, value }).onConflictDoNothing();
  await db.delete(schema.appMeta).where(and(like(schema.appMeta.key, 'leaderboard:hour:%'), lt(schema.appMeta.updatedAt, new Date(now.getTime() - 5 * 86_400_000))));
  return { status: 'updated', wallets: new Set(metrics.map(r => r.wallet)).size, defined: metrics.filter(r => r.source === 'Defined').length, stalkchain: metrics.filter(r => r.source === 'Stalkchain').length };
}
