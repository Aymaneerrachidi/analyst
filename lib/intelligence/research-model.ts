import { z } from 'zod';
const paragraph = z.string().trim().min(1).max(4000);
export const researchSchema = z.object({
  summary: paragraph, primaryCatalyst: paragraph,
  catalysts: z.array(z.object({ title: z.string().trim().min(1).max(200), description: paragraph, evidenceStrength: z.enum(['strong', 'medium', 'weak']) })).max(12),
  narrative: z.string().trim().max(4000), socialContext: z.string().trim().max(4000), smartMoneyContext: z.string().trim().max(4000),
  risks: z.array(z.string().trim().min(1).max(1000)).max(20), confidence: z.number().finite().min(0).max(100),
});
export type ResearchReport = z.infer<typeof researchSchema>;
export interface ResearchFingerprint { marketCap: number | null; liquidity: number | null; netFlow: number | null; runnerScore: number | null; creatorSellUsd: number | null; qualifiedBuyers: number }
export function researchChanged(before: ResearchFingerprint, after: ResearchFingerprint) {
  const material = (a: number | null, b: number | null, pct: number) => a != null && b != null && Math.abs(b - a) >= Math.max(1, Math.abs(a) * pct);
  return material(before.marketCap, after.marketCap, 0.2) || material(before.liquidity, after.liquidity, 0.2)
    || (before.netFlow != null && after.netFlow != null && before.netFlow * after.netFlow < 0 && Math.abs(after.netFlow - before.netFlow) >= 1000)
    || (before.runnerScore != null && after.runnerScore != null && Math.abs(before.runnerScore - after.runnerScore) >= 15)
    || (after.creatorSellUsd != null && after.creatorSellUsd - (before.creatorSellUsd ?? 0) >= 1000)
    || after.qualifiedBuyers > before.qualifiedBuyers;
}
