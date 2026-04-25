import type { FinancialData } from '../types';
import { resolveSarPerUsd } from '../utils/currencyMath';
import {
  accumulateHouseholdYearCashflowSar,
  buildHouseholdBudgetPlan,
  buildHouseholdEngineInputFromData,
  type HouseholdEngineResult,
  type HouseholdEngineProfile,
  type HouseholdMonthlyOverride,
} from './householdBudgetEngine';

export interface CashflowStressSignals {
  level: 'low' | 'medium' | 'high';
  affordabilityPressureMonths: number;
  negativePlannedNetMonths: number;
  projectedYearEndDelta: number;
  emergencyGap: number;
  reserveGap: number;
  summary: string;
  flags: string[];
}

export function deriveCashflowStressSummary(result: HouseholdEngineResult): CashflowStressSignals {
  const months = result.months ?? [];
  const affordabilityPressureMonths = months.filter((m) =>
    m.warnings.some((w) => w.toLowerCase().includes('affordability pressure'))
  ).length;
  const negativePlannedNetMonths = months.filter((m) => (m.plannedNet ?? 0) < 0).length;
  const projectedYearEndDelta =
    (result.balanceProjection?.projectedYearEndLiquid ?? 0) -
    (result.balanceProjection?.openingLiquid ?? 0);
  const emergencyGap = Math.max(0, result.emergencyGap ?? 0);
  const reserveGap = Math.max(0, result.reserveGap ?? 0);

  let level: CashflowStressSignals['level'] = 'low';
  if (
    negativePlannedNetMonths >= 3 ||
    affordabilityPressureMonths >= 4 ||
    (emergencyGap > 0 && projectedYearEndDelta <= 0)
  ) {
    level = 'high';
  } else if (
    negativePlannedNetMonths > 0 ||
    affordabilityPressureMonths > 0 ||
    emergencyGap > 0
  ) {
    level = 'medium';
  }

  const flags: string[] = [];
  if (negativePlannedNetMonths > 0) {
    flags.push(`${negativePlannedNetMonths} month(s) with negative planned net cashflow`);
  }
  if (affordabilityPressureMonths > 0) {
    flags.push(`${affordabilityPressureMonths} month(s) with affordability warnings`);
  }
  if (emergencyGap > 0) {
    flags.push(`Emergency fund short by ~${Math.round(emergencyGap).toLocaleString()}`);
  }
  if (reserveGap > 0) {
    flags.push(`Reserve pool short by ~${Math.round(reserveGap).toLocaleString()}`);
  }

  let summary: string;
  if (level === 'high') {
    summary =
      'Household cashflow is under high stress: address negative months and emergency/reserve gaps before increasing investment risk.';
  } else if (level === 'medium') {
    summary =
      'Cashflow shows some stress signals; keep optional spending flexible and prefer Core and safety buffers when investing.';
  } else {
    summary =
      'Cashflow looks stable; maintain profile and keep emergency and reserve buckets funded as you invest.';
  }

  return {
    level,
    affordabilityPressureMonths,
    negativePlannedNetMonths,
    projectedYearEndDelta,
    emergencyGap,
    reserveGap,
    summary,
    flags,
  };
}

export function computeHouseholdStressFromData(
  data: FinancialData | null | undefined,
  options?: {
    year?: number;
    adults?: number;
    kids?: number;
    profile?: HouseholdEngineProfile;
    expectedMonthlySalary?: number;
    overrides?: HouseholdMonthlyOverride[];
  }
): CashflowStressSignals | null {
  if (!data) return null;

  const year = options?.year ?? new Date().getFullYear();
  const adults = options?.adults ?? 2;
  const kids = options?.kids ?? 0;
  const profile = options?.profile ?? 'Moderate';
  const overrides = options?.overrides ?? [];

  const transactions = (data as any).personalTransactions ?? data.transactions ?? [];
  const accounts = (data as any).personalAccounts ?? data.accounts ?? [];

  const sarPerUsd = resolveSarPerUsd(data, undefined);
  const { monthlyIncome } = accumulateHouseholdYearCashflowSar(data, transactions, accounts, year, sarPerUsd);
  const incomeWithData = monthlyIncome.filter((v: number) => v > 0);
  const inferredAvg =
    incomeWithData.length > 0 ? incomeWithData.reduce((a: number, b: number) => a + b, 0) / incomeWithData.length : 0;

  const input = buildHouseholdEngineInputFromData(
    transactions as Array<{ date: string; type?: string; amount?: number }>,
    accounts as Array<{ type?: string; balance?: number }>,
    (data.goals ?? []) as any[],
    {
      year,
      expectedMonthlySalary:
        options?.expectedMonthlySalary && options.expectedMonthlySalary > 0
          ? options.expectedMonthlySalary
          : inferredAvg > 0
          ? inferredAvg
          : undefined,
      adults,
      kids,
      profile,
      monthlyOverrides: overrides,
      financialData: data,
      sarPerUsd,
      uiExchangeRate: sarPerUsd,
    }
  );

  const result = buildHouseholdBudgetPlan(input);
  return deriveCashflowStressSummary(result);
}

