import type { FinancialData } from '../types';
import type { CashflowStressSignals } from './householdBudgetStress';
import { computeHouseholdStressFromData } from './householdBudgetStress';
import { getPerformanceSnapshots, calculatePerformanceMetrics } from './wealthUltraPerformance';

export type RiskLane = 'Cautious' | 'Balanced' | 'Opportunity';

export interface RiskLaneContext {
  lane: RiskLane;
  reasons: string[];
  suggestedProfile: 'Conservative' | 'Moderate' | 'Aggressive';
}

export function deriveRiskLaneFromHousehold(
  stress: CashflowStressSignals | null | undefined,
  emergencyFundMonths: number
): RiskLaneContext {
  if (!stress) {
    return {
      lane: emergencyFundMonths >= 6 ? 'Balanced' : 'Cautious',
      reasons: ['Household stress data unavailable; defaulting from emergency fund coverage.'],
      suggestedProfile: emergencyFundMonths >= 6 ? 'Moderate' : 'Conservative',
    };
  }

  const reasons: string[] = [];
  let lane: RiskLane = 'Balanced';

  if (stress.level === 'high') {
    lane = 'Cautious';
    reasons.push('High household cashflow stress.');
  } else if (stress.level === 'medium') {
    lane = emergencyFundMonths >= 4 ? 'Balanced' : 'Cautious';
    reasons.push('Medium household cashflow stress.');
  } else {
    lane = emergencyFundMonths >= 6 ? 'Opportunity' : 'Balanced';
    reasons.push('Low household stress and stable cashflow.');
  }

  if (emergencyFundMonths < 3) {
    lane = 'Cautious';
    reasons.push('Emergency fund below 3 months of expenses.');
  } else if (emergencyFundMonths >= 9 && lane !== 'Cautious') {
    lane = 'Opportunity';
    reasons.push('Emergency fund covers 9+ months of expenses.');
  }

  const suggestedProfile: RiskLaneContext['suggestedProfile'] =
    lane === 'Cautious' ? 'Conservative' : lane === 'Balanced' ? 'Moderate' : 'Aggressive';

  return { lane, reasons, suggestedProfile };
}

export function deriveRiskLaneFromPerformance(
  stress: CashflowStressSignals | null | undefined
): { volatilityScore: number; downsidePressure: number } {
  const snaps = getPerformanceSnapshots();
  const metrics = snaps.length > 1 ? calculatePerformanceMetrics(snaps, snaps[snaps.length - 1].totalPortfolioValue) : null;

  if (!metrics) {
    return { volatilityScore: 0, downsidePressure: 0 };
  }

  const volatilityScore = Math.min(1, Math.max(0, metrics.volatility / 0.4)); // simple scaling

  // downsidePressure: share of days with negative return in the sample
  // (wealthUltraPerformance doesn't keep per-day returns, so approximate from snapshots)
  const totalReturnPct = metrics.totalReturnPct;
  const downsidePressure =
    totalReturnPct < -10 ? 1 : totalReturnPct < -5 ? 0.7 : totalReturnPct < 0 ? 0.4 : 0.1;

  // If household stress is already high, amplify perceived downside pressure
  const adjustedDownside =
    stress && stress.level === 'high'
      ? Math.min(1, downsidePressure + 0.2)
      : downsidePressure;

  return { volatilityScore, downsidePressure: adjustedDownside };
}

export function computeRiskLaneFromData(
  data: FinancialData | null | undefined,
  emergencyFundMonths: number
): RiskLaneContext {
  const stress = computeHouseholdStressFromData(data);
  const base = deriveRiskLaneFromHousehold(stress, emergencyFundMonths);
  const perf = deriveRiskLaneFromPerformance(stress);

  const reasons = [...base.reasons];
  if (perf.volatilityScore > 0.7) {
    reasons.push('Portfolio volatility has been elevated recently.');
  }
  if (perf.downsidePressure > 0.6) {
    reasons.push('Recent returns show sustained downside pressure.');
  }

  let lane = base.lane;
  if (perf.volatilityScore > 0.8 || perf.downsidePressure > 0.8) {
    lane = 'Cautious';
  } else if (perf.volatilityScore < 0.3 && perf.downsidePressure < 0.3 && base.lane !== 'Cautious') {
    lane = lane === 'Balanced' ? 'Opportunity' : lane;
  }

  const suggestedProfile: RiskLaneContext['suggestedProfile'] =
    lane === 'Cautious' ? 'Conservative' : lane === 'Balanced' ? 'Moderate' : 'Aggressive';

  return { lane, reasons, suggestedProfile };
}

