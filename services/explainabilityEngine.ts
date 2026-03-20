/**
 * Explainability engine (logic layer).
 * Plain-language reasons for buy/sell/goal/risk decisions. Critical when AI or rules recommend actions.
 */

/** Explain why a buy is allowed or blocked. */
export function explainBuyDecision(reasons: {
  allowed: boolean;
  emergencyFundMonths?: number;
  runwayMonths?: number;
  policyBlocked?: boolean;
  positionTooLarge?: boolean;
  sleeveFull?: boolean;
  override?: boolean;
}): string {
  if (reasons.override) return 'You chose to override policy. Proceed only if intentional.';
  if (reasons.allowed) {
    const parts: string[] = [];
    if (reasons.emergencyFundMonths != null && reasons.emergencyFundMonths >= 2)
      parts.push(`emergency fund at ${reasons.emergencyFundMonths.toFixed(1)} months`);
    if (reasons.runwayMonths != null && reasons.runwayMonths >= 2)
      parts.push(`runway at ${reasons.runwayMonths.toFixed(1)} months`);
    return parts.length ? `Buy allowed: ${parts.join(', ')}.` : 'Buy allowed by policy.';
  }
  const parts: string[] = [];
  if (reasons.policyBlocked) parts.push('trading policy blocks this buy');
  if (reasons.emergencyFundMonths != null && reasons.emergencyFundMonths < 2)
    parts.push(`emergency fund below 2 months (${reasons.emergencyFundMonths.toFixed(1)} mo)`);
  if (reasons.runwayMonths != null && reasons.runwayMonths < 2)
    parts.push(`cash runway below 2 months (${reasons.runwayMonths.toFixed(1)} mo)`);
  if (reasons.positionTooLarge) parts.push('position would exceed max weight');
  if (reasons.sleeveFull) parts.push('sleeve at or over target');
  return parts.length ? `Do not buy: ${parts.join('; ')}.` : 'Buy not recommended by policy.';
}

/** Explain sell recommendation. */
export function explainSellDecision(reasons: {
  score: number;
  reasons: string[];
  aboveTargetPct?: number;
  thesisBroken?: boolean;
  needCash?: boolean;
}): string {
  const r = reasons.reasons ?? [];
  if (r.length === 0) return `Sell score ${reasons.score}: no strong reason.`;
  const parts = r.map((x) => {
    if (x === 'max_weight' && reasons.aboveTargetPct != null)
      return `position ${reasons.aboveTargetPct.toFixed(1)}% above target`;
    if (x === 'thesis_broken') return 'thesis broken or review due';
    if (x === 'trim') return 'trim for rebalance or cash need';
    return x;
  });
  return `Sell score ${reasons.score}: ${parts.join('; ')}.`;
}

/** Explain goal delay or slippage. */
export function explainGoalDelay(reasons: {
  goalName: string;
  projectedDate?: string;
  targetDate?: string;
  gapPct?: number;
  allocPct?: number;
}): string {
  const parts: string[] = [];
  if (reasons.gapPct != null && reasons.gapPct > 0)
    parts.push(`${reasons.gapPct.toFixed(0)}% funding gap`);
  if (reasons.allocPct === 0) parts.push('0% allocation — assign savings % in Goals');
  if (reasons.projectedDate && reasons.targetDate && reasons.projectedDate > reasons.targetDate)
    parts.push(`projected completion after target (${reasons.projectedDate})`);
  return parts.length
    ? `"${reasons.goalName}": ${parts.join('; ')}.`
    : `"${reasons.goalName}": on track.`;
}

/** Explain risk score (e.g. portfolio or position). */
export function explainRiskScore(reasons: {
  score: number;
  factors?: string[];
}): string {
  const f = reasons.factors ?? [];
  if (f.length === 0) return `Risk score: ${reasons.score}.`;
  return `Risk score ${reasons.score}: ${f.join('; ')}.`;
}
