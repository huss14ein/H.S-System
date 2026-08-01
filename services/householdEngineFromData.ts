/**
 * Canonical non-React path: FinancialData → household budget plan.
 * Use from Wealth Summary, shock drill, stress signals, digest, etc.
 */
import type { FinancialData } from '../types';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { resolveMonthStartDayFromData } from '../utils/financialMonth';
import { getPersonalAccounts, getPersonalTransactions } from '../utils/wealthScope';
import {
  buildHouseholdBudgetPlan,
  buildHouseholdEngineInputFromData,
  deriveEngineProfileFromRiskProfile,
  resolveHouseholdPlanMonthIndex,
  type HouseholdBudgetPlanInput,
  type HouseholdBudgetPlanResult,
  type HouseholdEngineProfile,
  type HouseholdMonthlyOverride,
} from './householdBudgetEngine';

export type HouseholdEngineFromDataOptions = {
  year?: number;
  ref?: Date;
  uiExchangeRate?: number;
  expectedMonthlySalary?: number;
  adults?: number;
  kids?: number;
  profile?: HouseholdEngineProfile;
  monthlyOverrides?: HouseholdMonthlyOverride[];
};

export function resolveHouseholdEngineRuntimeContext(
  data: FinancialData | null | undefined,
  options?: Pick<HouseholdEngineFromDataOptions, 'year' | 'ref' | 'uiExchangeRate'>,
) {
  const ref = options?.ref ?? new Date();
  const year = options?.year ?? ref.getFullYear();
  const monthStartDay = resolveMonthStartDayFromData(data);
  const sarPerUsd = resolveSarPerUsd(data, options?.uiExchangeRate);
  const uiEx = Number(options?.uiExchangeRate);
  return {
    year,
    ref,
    monthStartDay,
    sarPerUsd,
    uiExchangeRate: Number.isFinite(uiEx) && uiEx > 0 ? uiEx : sarPerUsd,
    currentMonthIndex: resolveHouseholdPlanMonthIndex(year, ref, monthStartDay),
  };
}

export function buildHouseholdEngineInputFromFinancialData(
  data: FinancialData | null | undefined,
  options: HouseholdEngineFromDataOptions = {},
): HouseholdBudgetPlanInput | null {
  if (!data) return null;
  const ctx = resolveHouseholdEngineRuntimeContext(data, options);
  const transactions = getPersonalTransactions(data);
  const accounts = getPersonalAccounts(data);
  const goals = data.goals ?? [];
  const profile =
    options.profile ??
    deriveEngineProfileFromRiskProfile('Moderate', String(data.settings?.riskProfile || ''));

  return buildHouseholdEngineInputFromData(
    transactions as Array<{ date: string; type?: string; amount?: number; accountId?: string }>,
    accounts as Array<{ type?: string; balance?: number; id?: string; currency?: string }>,
    goals as Array<{ id?: string; name?: string; targetAmount?: number; currentAmount?: number; deadline?: string }>,
    {
      year: ctx.year,
      expectedMonthlySalary: options.expectedMonthlySalary,
      adults: options.adults ?? 2,
      kids: options.kids ?? 0,
      profile,
      monthlyOverrides: options.monthlyOverrides ?? [],
      financialData: data,
      sarPerUsd: ctx.sarPerUsd,
      uiExchangeRate: ctx.uiExchangeRate,
      monthStartDay: ctx.monthStartDay,
      currentMonthIndex: ctx.currentMonthIndex,
    },
  );
}

export function buildHouseholdPlanFromFinancialData(
  data: FinancialData | null | undefined,
  options: HouseholdEngineFromDataOptions = {},
): HouseholdBudgetPlanResult | null {
  const input = buildHouseholdEngineInputFromFinancialData(data, options);
  if (!input) return null;
  return buildHouseholdBudgetPlan(input);
}
