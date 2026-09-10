import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRankings, normalizeStalkRankings } from '../lib/providers/stalkchain-rankings';
const wallet='0x'+'a'.repeat(40), at=new Date().toISOString();
const body={data:{leaderboard:[{wallets:[wallet],realizedUsd:12,pnlUsd:9999,unrealizedUsd:9987,volumeUsd:100,trades:2,winratePct:80,basisIncomplete:true}],meta:{window:'7d',updatedAt:at}}};
test('fallback uses realized profit and original observation, not combined DEX value or lifetime win rate',()=>{const [row]=normalizeStalkRankings(body,'7d','2020-01-01T00:00:00.000Z');assert.equal(row.pnl,12);assert.equal(row.winRate,null);assert.equal(row.observedAt,at);assert.equal(row.basisIncomplete,true);});
test('mismatched period and multi-wallet group totals cannot pollute individual rankings',()=>{assert.throws(()=>normalizeStalkRankings(body,'24h',at));assert.equal(normalizeStalkRankings({...body,data:{...body.data,leaderboard:[{...body.data.leaderboard[0],wallets:[wallet,'0x'+'b'.repeat(40)]}]}},'7d',at).length,0);});
test('fresh Defined metrics win by wallet and period; old Defined snapshots yield to fallback',()=>{const stalk=normalizeStalkRankings(body,'7d',at), defined=[{...stalk[0],source:'Defined' as const,pnl:15}];assert.equal(mergeRankings(defined,stalk)[0].pnl,15);assert.equal(mergeRankings([{...defined[0],observedAt:'2020-01-01T00:00:00.000Z'}],stalk)[0].pnl,12);assert.equal(mergeRankings(defined,stalk).length,1);});
