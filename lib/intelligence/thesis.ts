import type { TokenIntelligence } from './token-context';
export function compareThesis(entry: TokenIntelligence | null, current: TokenIntelligence | null) {
  if (!entry || !current) return { status: 'NOT MEASURED', changes: ['A point-in-time entry snapshot and current observations are required.'], coverage: 'incomplete' };
  const changes: string[] = []; let stronger = 0, weaker = 0;
  if (entry.runner.score != null && current.runner.score != null) { const change = current.runner.score - entry.runner.score; if (Math.abs(change) >= 15) { changes.push(`Runner score changed by ${change > 0 ? '+' : ''}${change} points.`); if (change > 0) stronger++; else weaker++; } }
  if (entry.liquidity != null && entry.liquidity > 0 && current.liquidity != null) { const change = (current.liquidity / entry.liquidity - 1) * 100; if (Math.abs(change) >= 20) { changes.push(`Observed liquidity changed by ${change.toFixed(1)}%.`); if (change > 0) stronger++; else weaker++; } }
  if (entry.consensus.smartMoneyNet != null && current.consensus.smartMoneyNet != null && entry.consensus.smartMoneyNet * current.consensus.smartMoneyNet < 0) { changes.push(`Smart-money flow reversed to ${current.consensus.smartMoneyNet < 0 ? 'net selling' : 'net buying'}.`); if (current.consensus.smartMoneyNet < 0) weaker++; else stronger++; }
  if (['HIGH', 'EXTREME'].includes(current.risk.level) && current.risk.level !== entry.risk.level) { weaker++; changes.push(`Risk assessment changed to ${current.risk.level}.`); }
  const known = entry.runner.score != null && current.runner.score != null && entry.liquidity != null && current.liquidity != null;
  return { status: weaker > stronger ? 'WEAKENING' : stronger > weaker ? 'STRENGTHENING' : known ? 'STABLE IN MEASURED INPUTS' : 'NOT MEASURED', changes: changes.length ? changes : ['No material change in comparable measured inputs.'], coverage: 'partial monitored evidence; not an instruction to buy, hold or sell' };
}
