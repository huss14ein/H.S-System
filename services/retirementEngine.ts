/**
 * Retirement and long-term independence logic (logic layer).
 *
 * These functions intentionally keep assumptions explicit so users can edit
 * inputs later from UI.
 */

export type RetirementRiskCase = 'conservative' | 'moderate' | 'aggressive';

export interface RetirementInputs {
  /** Future monthly spending needed in today's currency (or base). */
  futureMonthlyNeed: number;
  /** Inflation rate used to grow needs into nominal future value. */
  inflationRatePct: number; // e.g. 3.5
  /** Years until retirement. */
  yearsToRetirement: number;
  /** Current retirement corpus (invested). */
  currentCorpus: number;
  /** Safe withdrawal rate (SWR) percent, e.g. 3.5% */
  safeWithdrawalRatePct: number;
}

export function safeWithdrawalEstimate(args: {
  riskCase: RetirementRiskCase;
  /** If provided, overrides default SWR mapping. */
  overriddenSafeWithdrawalRatePct?: number;
}): { safeWithdrawalRatePct: number; label: string } {
  const rate = (() => {
    if (args.overriddenSafeWithdrawalRatePct != null) return args.overriddenSafeWithdrawalRatePct;
    if (args.riskCase === 'conservative') return 3.0;
    if (args.riskCase === 'moderate') return 3.5;
    return 4.0;
  })();
  return { safeWithdrawalRatePct: rate, label: `SWR ${rate.toFixed(2)}% (${args.riskCase})` };
}

export function retirementTargetValue(args: RetirementInputs): {
  targetCorpus: number;
  targetMonthlyNeedNominal: number;
} {
  const inflation = (Number(args.inflationRatePct) || 0) / 100;
  const years = Math.max(0, Number(args.yearsToRetirement) || 0);
  const futureMonthlyNeedNominal = Math.max(0, args.futureMonthlyNeed) * Math.pow(1 + inflation, years);
  const swr = Math.max(1e-9, Number(args.safeWithdrawalRatePct) || 0) / 100;
  const annualNeedNominal = futureMonthlyNeedNominal * 12;
  const targetCorpus = annualNeedNominal / swr;
  return { targetCorpus, targetMonthlyNeedNominal: futureMonthlyNeedNominal };
}

export function retirementFundingGap(args: RetirementInputs): {
  gap: number;
  currentCorpus: number;
  targetCorpus: number;
} {
  const { targetCorpus } = retirementTargetValue(args);
  const currentCorpus = Math.max(0, Number(args.currentCorpus) || 0);
  return { gap: Math.max(0, targetCorpus - currentCorpus), currentCorpus, targetCorpus };
}

export function retirementProjection(args: {
  currentCorpus: number;
  monthlyContribution: number;
  yearsToRetirement: number;
  expectedAnnualReturnPct: number;
}): { projectedCorpus: number } {
  const r = (Number(args.expectedAnnualReturnPct) || 0) / 100 / 12;
  const n = Math.max(0, Math.floor((Number(args.yearsToRetirement) || 0) * 12));
  const pmt = Number(args.monthlyContribution) || 0;
  let corpus = Math.max(0, Number(args.currentCorpus) || 0);
  for (let i = 0; i < n; i++) {
    corpus = corpus * (1 + r) + pmt;
  }
  return { projectedCorpus: corpus };
}

