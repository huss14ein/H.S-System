export interface StressInput {
  jobLossMonths?: number;
  marketDropPct?: number;
  medicalCost?: number;
  monthlyExpense?: number;
  liquidCash?: number;
  goalMonthlyNeed?: number;
}

export interface StressOutput {
  runwayMonthsAfter: number;
  goalsDelayedMonths: number;
  headline: string;
}

export function stressTestScenario(i: StressInput): StressOutput {
  const exp = Math.max(1, i.monthlyExpense ?? 4000);
  const cash = Math.max(0, i.liquidCash ?? 20000);
  const jobM = i.jobLossMonths ?? 0;
  const medical = i.medicalCost ?? 0;
  const marketDrop = (i.marketDropPct ?? 0) / 100;
  const investHit = cash * 0.3 * marketDrop;
  const afterCash = Math.max(0, cash - medical - investHit - jobM * exp);
  const runway = afterCash / exp;
  const goalNeed = i.goalMonthlyNeed ?? 500;
  const goalsDelayed = goalNeed > 0 ? Math.ceil((medical + investHit) / goalNeed) : 0;
  return {
    runwayMonthsAfter: Math.round(runway * 10) / 10,
    goalsDelayedMonths: goalsDelayed,
    headline: `Stress: ~${runway.toFixed(1)}mo runway; goals ~+${goalsDelayed}mo if contributions pause.`,
  };
}

export function compareStrategies(): { aggressive: string; balanced: string } {
  return {
    aggressive: 'Higher equity → higher long-term expected return, deeper drawdowns.',
    balanced: 'Moderate mix → smoother path; typical default for multi-year goals.',
  };
}

export function compareLumpSumVsDCA(lump: number, months = 12): { lumpNote: string; dcaNote: string } {
  return {
    lumpNote: `Full ${lump} now: full market exposure immediately.`,
    dcaNote: `Spread over ${months} mo: ~${(lump / months).toFixed(0)}/mo; reduces timing risk.`,
  };
}
