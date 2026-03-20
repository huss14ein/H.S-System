/**
 * Rule-based scores 0–100 for prioritization (deterministic; tune thresholds in UI later).
 */

export interface BuyScoreInput {
  emergencyFundMonths?: number;
  runwayMonths?: number;
  maxPositionPct?: number;
  currentPositionPct?: number;
  driftFromTargetPct?: number;
}

export function buyScore(i: BuyScoreInput): number {
  let s = 50;
  const ef = i.emergencyFundMonths ?? 6;
  const run = i.runwayMonths ?? 6;
  if (ef >= 3 && run >= 3) s += 15;
  else if (ef < 1 || run < 1) s -= 25;
  const maxP = i.maxPositionPct ?? 20;
  const cur = i.currentPositionPct ?? 0;
  if (cur >= maxP) s -= 20;
  const drift = Math.abs(i.driftFromTargetPct ?? 0);
  if (drift > 5) s += 10;
  return Math.max(0, Math.min(100, Math.round(s)));
}

export type SellReason = 'trim' | 'thesis_broken' | 'max_weight' | 'rebalance';

export function sellScore(input: {
  aboveTargetWeightPct?: number;
  thesisBroken?: boolean;
  needCash?: boolean;
}): { score: number; reasons: SellReason[] } {
  const reasons: SellReason[] = [];
  let s = 20;
  if (input.aboveTargetWeightPct && input.aboveTargetWeightPct > 5) {
    s += 25;
    reasons.push('max_weight');
  }
  if (input.thesisBroken) {
    s += 35;
    reasons.push('thesis_broken');
  }
  if (input.needCash) {
    s += 15;
    reasons.push('trim');
  }
  return { score: Math.max(0, Math.min(100, s)), reasons };
}

export type CapitalUse = 'debt' | 'emergency_fund' | 'goals' | 'invest' | 'buffer';

export function rankCapitalUses(amount: number): { use: CapitalUse; amount: number; rationale: string }[] {
  const a = Math.max(0, amount);
  return [
    { use: 'debt', amount: a * 0.25, rationale: 'High-interest debt first' },
    { use: 'emergency_fund', amount: a * 0.35, rationale: '3–6 months expenses' },
    { use: 'goals', amount: a * 0.2, rationale: 'Named goals' },
    { use: 'invest', amount: a * 0.15, rationale: 'Long-term growth' },
    { use: 'buffer', amount: a * 0.05, rationale: 'Discretionary buffer' },
  ];
}

export function rankWatchlistIdeas(
  items: { symbol: string; userScore?: number; signalScore?: number }[]
): { symbol: string; rank: number; note: string }[] {
  return items
    .map((it) => {
      const u = it.userScore ?? 50;
      const sig = it.signalScore ?? 50;
      const rank = u * 0.6 + sig * 0.4;
      return { symbol: it.symbol, rank, note: `blend ${rank.toFixed(0)}` };
    })
    .sort((a, b) => b.rank - a.rank)
    .map((x, i) => ({ ...x, note: `#${i + 1} ${x.note}` }));
}
