export type CheckState = 'PRESENT' | 'NOT_DETECTED' | 'UNKNOWN';
export interface RiskEvidence {
  verifiedSource: boolean | null; proxy: boolean | null; owner: string | null;
  mint: CheckState; blacklist: CheckState; pause: CheckState;
  top10: number | null; creatorPercent: number | null; liquidityUsd: number | null;
  creatorSellUsd: number | null; sellSimulation: 'PASS' | 'FAIL' | 'UNKNOWN';
}
/** A known hazard can raise risk with incomplete coverage; missing checks never lower it. */
export function classifyRisk(e: RiskEvidence) {
  const flags: string[] = [];
  let hazard = 0;
  if (e.sellSimulation === 'FAIL') { hazard += 80; flags.push('The tested sell simulation reverted; the reason must be reviewed.'); }
  if (e.blacklist === 'PRESENT') { hazard += 30; flags.push('The published ABI exposes a blacklist-related function.'); }
  if (e.mint === 'PRESENT') { hazard += 20; flags.push('The published ABI exposes a mint-related function.'); }
  if (e.pause === 'PRESENT') { hazard += 15; flags.push('The published ABI exposes a pause-related function.'); }
  if (e.top10 != null && e.top10 >= 50) { hazard += 25; flags.push('The ten largest sampled non-pool accounts hold at least 50% of total supply.'); }
  if (e.creatorPercent != null && e.creatorPercent >= 10) { hazard += 20; flags.push('The identified creator holds at least 10% of supply.'); }
  if (e.liquidityUsd != null && e.liquidityUsd < 5000) { hazard += 25; flags.push('Reported liquidity is below $5,000.'); }
  if (e.creatorSellUsd != null && e.creatorSellUsd > 1000) { hazard += 15; flags.push('More than $1,000 of recorded creator sells in the last hour.'); }
  const checks = [e.verifiedSource != null, e.proxy != null, e.owner != null, e.mint !== 'UNKNOWN', e.blacklist !== 'UNKNOWN', e.pause !== 'UNKNOWN', e.top10 != null, e.creatorPercent != null, e.liquidityUsd != null, e.sellSimulation !== 'UNKNOWN'];
  const coverage = checks.filter(Boolean).length / checks.length;
  const complete = coverage === 1 && e.verifiedSource === true && e.proxy === false;
  const score = hazard > 0 || complete ? Math.min(100, hazard) : null;
  const level = hazard >= 75 ? 'EXTREME' : hazard >= 45 ? 'HIGH' : hazard >= 20 ? 'MODERATE' : complete ? 'LOW' : 'UNKNOWN';
  return { level, score, coverage, flags, methodology: 'ABI capabilities are indicators, not proof of exploitability. An absent selector does not prove safety. Sell simulation is specific to an account, amount and block.' };
}

export function holderConcentration(rows: { address: string; raw: string }[], supply: bigint, excluded: Set<string>) {
  if (supply <= BigInt(0)) return { top10: null, top20: null, holders: [] };
  const holders = rows.filter(r => !excluded.has(r.address.toLowerCase())).sort((a, b) => BigInt(a.raw) > BigInt(b.raw) ? -1 : BigInt(a.raw) < BigInt(b.raw) ? 1 : 0);
  const percent = (n: bigint) => Number(n * BigInt(1_000_000) / supply) / 10_000;
  // A response exceeding on-chain supply is inconsistent, not a >100% concentration.
  if (rows.reduce((s, r) => s + BigInt(r.raw), BigInt(0)) > supply) return { top10: null, top20: null, holders: [] };
  return { top10: percent(holders.slice(0, 10).reduce((s, r) => s + BigInt(r.raw), BigInt(0))), top20: percent(holders.slice(0, 20).reduce((s, r) => s + BigInt(r.raw), BigInt(0))), holders: holders.slice(0, 20).map(r => ({ ...r, percent: percent(BigInt(r.raw)) })) };
}
