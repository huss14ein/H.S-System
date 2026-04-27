/**
 * One-off / bonus allocation split: emergency buffer first, then split the remainder
 * between goals (weighted by funding gaps) and long-term investing using the same
 * annual surplus scale as the Goal funding cockpit — no magic constants.
 */

export type WindfallAllocationPct = {
  emergencyPct: number;
  goalsPct: number;
  investPct: number;
  /** Lines explaining the math (for UI transparency). */
  derivationLines: string[];
};

/**
 * @param weightedGoalGapSum — Σ (gap × priority weight) for open goals (same weights as Goals UI).
 * @param annualSurplusAnchorSar — rolling 12‑month net cashflow total (same as Goal funding cockpit input).
 */
export function computeWindfallAllocationPct(args: {
  emergencyRunwayMonths: number;
  weightedGoalGapSum: number;
  annualSurplusAnchorSar: number;
}): WindfallAllocationPct {
  const m = Number(args.emergencyRunwayMonths);
  const W = Math.max(0, Number(args.weightedGoalGapSum) || 0);
  const A = Math.max(1, Number(args.annualSurplusAnchorSar) || 0);

  let emergencyPct = 10;
  if (Number.isFinite(m)) {
    if (m < 2) emergencyPct = 35;
    else if (m < 4) emergencyPct = 25;
    else if (m < 6) emergencyPct = 15;
  }

  const R = Math.max(0, 100 - emergencyPct);
  const denom = W + A;
  const goalsFloat = denom > 0 ? (R * W) / denom : 0;
  const goalsPct = Math.max(0, Math.round(goalsFloat));
  let investPct = Math.max(0, R - goalsPct);
  let sum = emergencyPct + goalsPct + investPct;
  const drift = 100 - sum;
  investPct += drift;

  const lines: string[] = [
    `Emergency ${emergencyPct}% — tiered by liquid runway (~${Number.isFinite(m) ? m.toFixed(1) : '—'} mo).`,
    `Remaining ${R}% splits between goals and investing by weighted gaps (${W.toFixed(0)} SAR) vs annual surplus anchor (${A.toFixed(0)} SAR — same 12‑month net as the cockpit).`,
    `Goals ${goalsPct}% · Investing ${investPct}% — share of the ${R}% slice follows W : A = ${W.toFixed(0)} : ${A.toFixed(0)}.`,
  ];

  return { emergencyPct, goalsPct, investPct, derivationLines: lines };
}
