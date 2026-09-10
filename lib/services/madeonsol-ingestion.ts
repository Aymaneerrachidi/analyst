import 'server-only';
import { z } from 'zod';
import { eq, inArray, sql } from 'drizzle-orm';
import { getDb,schema } from '@/lib/db';
import { madeTradeSchema,parseMadeTrade } from '@/lib/providers/madeonsol';
import { insertTrades } from './sync';
import { reserveProviderRequest } from '@/lib/providers/request-budget';
import { receiptSupportsTrade } from '@/lib/providers/receipt-direction';

const receipts = new Map<string, { at: number; value: unknown }>();
async function receipt(hash: string): Promise<unknown> {
  const cached = receipts.get(hash);
  if (cached && Date.now() - cached.at < 3_600_000) return cached.value;
  // Public RPC is used only for the bounded supplemental feed, never for a
  // block scan. Space calls and share the ceiling across worker instances.
  await new Promise(resolve => setTimeout(resolve, 2500));
  if (!await reserveProviderRequest('supplemental-receipts', 24)) return null;
  const response = await fetch('https://rpc.mainnet.chain.robinhood.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  const body = await response.json();
  if (!body.result) return null;
  if (receipts.size >= 2000) receipts.delete(receipts.keys().next().value!);
  receipts.set(hash, { at: Date.now(), value: body.result });
  return body.result;
}

async function request(path:string) {
  const db=await getDb(),day=new Date().toISOString().slice(0,10);
  const rows=await db.insert(schema.appMeta).values({key:'madeonsol:budget',value:{day,count:1}}).onConflictDoUpdate({target:schema.appMeta.key,set:{value:sql`jsonb_build_object('day',${day}::text,'count',case when ${schema.appMeta.value}->>'day'=${day} then (${schema.appMeta.value}->>'count')::int+1 else 1 end)`,updatedAt:new Date()},setWhere:sql`${schema.appMeta.value}->>'day'<>${day} or (${schema.appMeta.value}->>'count')::int < 180`}).returning({key:schema.appMeta.key});
  if(!rows.length)throw new Error('MadeOnSol daily budget reached');
  const response=await fetch('https://madeonsol.com/api/v1'+path,{headers:{authorization:`Bearer ${process.env.MADEONSOL_API_KEY}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`MadeOnSol HTTP ${response.status}`);
  return response.json();
}
export async function refreshMadeOnSol() {
  if(!process.env.MADEONSOL_API_KEY)return {inserted:0};
  const db=await getDb();
  const [checkpoint]=await db.select().from(schema.appMeta).where(eq(schema.appMeta.key,'madeonsol:refresh'));
  if(checkpoint&&Date.now()-checkpoint.updatedAt.getTime()<15*60_000)return {inserted:0};
  // Persist attempts before requesting: restarting the worker cannot spend the
  // daily free allowance again. 96 feeds + 72 ranking snapshots/day = 168.
  await db.insert(schema.appMeta).values({key:'madeonsol:refresh',value:{status:'refreshing'}}).onConflictDoUpdate({target:schema.appMeta.key,set:{value:{status:'refreshing'},updatedAt:new Date()}});
  const feed=z.object({chain:z.literal('robinhood'),trades:z.array(z.unknown())}).parse(await request('/rhc/kol/feed?limit=100'));
  const known=new Set((await db.select({id:schema.traders.id}).from(schema.traders)).map(t=>t.id));
  const trades=[];
  for(const raw of feed.trades){const result=madeTradeSchema.safeParse(raw);if(!result.success)continue;const r=result.data;
    if(!known.has(r.evm_address)&&r.kol_name?.trim()&&known.size<500){await db.insert(schema.traders).values({id:r.evm_address,wallet:r.evm_address,name:r.kol_name.trim(),handle:r.kol_name.trim().toLowerCase().replace(/[^a-z0-9_]/g,''),twitterUrl:r.kol_twitter??null}).onConflictDoNothing();known.add(r.evm_address);}
    if(!known.has(r.evm_address))continue;const trade=parseMadeTrade(raw);if(trade)trades.push(trade);
  }
  const hashes = [...new Set(trades.map(trade => trade.txHash!))];
  const stored = hashes.length ? await db.select({ hash: schema.trades.txHash, wallet: schema.trades.traderId, token: schema.trades.tokenAddress, side: schema.trades.side }).from(schema.trades).where(inArray(schema.trades.txHash, hashes)) : [];
  const existing = new Set(stored.map(row => `${row.hash}:${row.wallet}:${row.token}:${row.side}`));
  const candidates = trades.filter(trade => !existing.has(`${trade.txHash}:${trade.wallet}:${trade.tokenAddress}:${trade.side}`));
  const verified = [];
  for (const trade of candidates) {
    try { if (receiptSupportsTrade(await receipt(trade.txHash!), trade)) verified.push(trade); } catch { /* Unavailable receipts are not treated as verified trades. */ }
  }
  const inserted=await insertTrades(db,verified);
  const value={at:new Date().toISOString(),source:'MadeOnSol',received:feed.trades.length,accepted:verified.length,alreadyStored:trades.length-candidates.length,unconfirmed:candidates.length-verified.length,inserted,lastTradeAt:verified.map(t=>t.timestamp).sort().at(-1)??(checkpoint?.value as {lastTradeAt?:string}|undefined)?.lastTradeAt??null,partial:true,expectedDelayMinutes:5,verification:'receipt-direction; USD valuation remains provider-reported'};
  await db.update(schema.appMeta).set({value,updatedAt:new Date()}).where(eq(schema.appMeta.key,'madeonsol:refresh'));
  const hour=new Date().toISOString().slice(0,13);
  const [snap]=await db.select().from(schema.appMeta).where(eq(schema.appMeta.key,'madeonsol:rankings'));
  try { if((snap?.value as {hour?:string}|undefined)?.hour!==hour){
    const periods:Record<string,unknown>={};for(const period of ['24h','7d','30d']){const result=z.object({chain:z.literal('robinhood'),leaderboard:z.array(z.unknown())}).parse(await request(`/rhc/kol/leaderboard?period=${period}&limit=100`));periods[period]=result.leaderboard;}
    const snapshot={hour,at:new Date().toISOString(),metric:'native-net-flow-not-pnl',periods};
    await db.insert(schema.appMeta).values({key:'madeonsol:rankings',value:snapshot}).onConflictDoUpdate({target:schema.appMeta.key,set:{value:snapshot,updatedAt:new Date()}});
  } } catch { /* Ranking availability must not discard a successful feed import. */ }
  return {inserted};
}
