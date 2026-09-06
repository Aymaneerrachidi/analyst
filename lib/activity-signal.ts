import type { AnalystToken } from "@/lib/types";
/** A reproducible activity screen, not an expected-return model. */
export function activitySignal(token: AnalystToken, now: number) {
  const age = now - Date.parse(token.lastActivityAt ?? "");
  const total = token.buyUsd + token.sellUsd;
  const checks = [
    { label: "Recorded activity within 10 minutes", met: Number.isFinite(age) && age >= 0 && age <= 600_000 },
    { label: "At least 3 more buyers than sellers", met: token.buyers - token.sellers >= 3 },
    { label: "At least 65% of tracked USD volume is buying", met: total > 0 && token.buyUsd / total >= 0.65 },
    { label: "At least $1,000 net tracked inflow", met: token.netAccumulation >= 1000 },
    { label: "Analyst score of 70 or higher", met: token.score.score >= 70 },
    { label: "A positive token price is available", met: token.price != null && Number.isFinite(token.price) && token.price > 0 },
  ];
  return { green: checks.every(c => c.met), checks };
}
