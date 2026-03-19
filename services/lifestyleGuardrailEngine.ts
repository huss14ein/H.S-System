/**
 * Lifestyle guardrail logic (logic layer).
 *
 * Purpose: prevent wealth erosion by gating discretionary spending based on
 * liquidity safety, savings discipline, and goal health.
 */

export interface LifestyleGuardrailInput {
  emergencyFundMonths: number; // liquid runway for "no panic"
  runwayMonths: number; // cash runway months
  savingsRatePct: number; // 0..100
  discretionaryProposedAmount?: number;
  /** Goal slippage: positive means behind; 0 means on track. */
  goalSlippagePct?: number;
  /** Savings/EF safety threshold to allow discretionary upgrades. */
  emergencyMinimumMonths?: number; // default 2.0
  savingsMinimumPct?: number; // default 5%
  /** Cap: bonus shouldn't consume more than this % of its intended job. */
  bonusMaxSharePct?: number; // default 60%
}

export function discretionarySpendApproval(args: LifestyleGuardrailInput): {
  allowed: boolean;
  reason?: string;
} {
  const ef = Number.isFinite(args.emergencyFundMonths) ? args.emergencyFundMonths : 0;
  const runway = Number.isFinite(args.runwayMonths) ? args.runwayMonths : 0;
  const savingsRatePct = Number.isFinite(args.savingsRatePct) ? args.savingsRatePct : 0;
  const emergencyMinimumMonths = args.emergencyMinimumMonths ?? 2.0;
  const savingsMinimumPct = args.savingsMinimumPct ?? 5;

  if (ef < emergencyMinimumMonths || runway < emergencyMinimumMonths) {
    return { allowed: false, reason: 'Emergency liquidity is below minimum; discretionary spend is gated.' };
  }
  if (savingsRatePct < savingsMinimumPct) {
    return { allowed: false, reason: 'Savings rate is below threshold; discretionary upgrades are gated.' };
  }
  // If goals are significantly behind, we can still allow but recommend deferral.
  const slippage = Number.isFinite(args.goalSlippagePct) ? (args.goalSlippagePct as number) : 0;
  if (slippage > 10) {
    return { allowed: false, reason: 'Goal slippage is high; discretionary spend should be delayed.' };
  }
  return { allowed: true };
}

export function lifestyleGuardrailCheck(args: LifestyleGuardrailInput): {
  ok: boolean;
  flags: string[];
} {
  const flags: string[] = [];
  const efMin = args.emergencyMinimumMonths ?? 2.0;
  const savMin = args.savingsMinimumPct ?? 5;

  const ef = Number.isFinite(args.emergencyFundMonths) ? args.emergencyFundMonths : 0;
  const runway = Number.isFinite(args.runwayMonths) ? args.runwayMonths : 0;
  const sr = Number.isFinite(args.savingsRatePct) ? args.savingsRatePct : 0;

  if (ef < efMin) flags.push('Emergency fund below minimum');
  if (runway < efMin) flags.push('Runway below minimum');
  if (sr < savMin) flags.push('Savings rate below minimum');

  const ok = flags.length === 0;
  return { ok, flags };
}

export function bonusUsePolicyCheck(args: {
  bonusAmount: number;
  /** How much of the bonus would otherwise be used for discretionary upgrades. */
  discretionaryShareAmount: number;
  /** Percent of bonus allowed to be used on discretionary. */
  bonusMaxSharePct?: number; // default 60
}): { allowed: boolean; maxDiscretionaryAmount: number; reason?: string } {
  const bonusMaxSharePct = args.bonusMaxSharePct ?? 60;
  const bonus = Math.max(0, Number(args.bonusAmount) || 0);
  const desired = Math.max(0, Number(args.discretionaryShareAmount) || 0);
  const maxDiscretionaryAmount = (bonus * bonusMaxSharePct) / 100;
  if (desired > maxDiscretionaryAmount) {
    return {
      allowed: false,
      maxDiscretionaryAmount,
      reason: 'Bonus discretionary share exceeds policy cap; route the remainder to goals or reserves.',
    };
  }
  return { allowed: true, maxDiscretionaryAmount };
}

