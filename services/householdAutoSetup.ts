/**
 * Household Autopilot “Auto-setup” — single resolver for profile + salary source.
 * Budgets button must call this (not a missing `suggestedProfile` on the plan result).
 */
import type { HouseholdEngineProfile } from './householdBudgetEngine';
import {
  deriveEngineProfileFromRiskProfile,
  suggestProfileFromIncomeVariance,
} from './householdBudgetEngine';
import type { HouseholdMonthlyOverride } from './householdBudgetEngine';

export type HouseholdAutoSetupResult = {
  profile: HouseholdEngineProfile;
  /** Empty string clears manual override so UI uses income-history average. */
  expectedMonthlySalary: number | '';
  adults: number;
  kids: number;
  /** Clear monthly scenario overrides so projections match live txs. */
  clearOverrides: boolean;
  /** Pre-fill bulk-add salary when income history exists. */
  bulkAddSalary: number | '';
  messages: string[];
};

export type HouseholdProfileSnapshot = {
  adults: number;
  kids: number;
  overrides: HouseholdMonthlyOverride[];
  profile: HouseholdEngineProfile;
  expectedMonthlySalary?: number;
};

/** JSON shape persisted locally and in `household_budget_profiles.profile`. */
export function buildHouseholdProfileSnapshot(
  setup: Pick<HouseholdAutoSetupResult, 'adults' | 'kids' | 'profile' | 'expectedMonthlySalary' | 'clearOverrides'>,
  prevOverrides: HouseholdMonthlyOverride[] = [],
): HouseholdProfileSnapshot {
  return {
    adults: setup.adults,
    kids: setup.kids,
    profile: setup.profile,
    overrides: setup.clearOverrides ? [] : prevOverrides,
    expectedMonthlySalary:
      typeof setup.expectedMonthlySalary === 'number' && setup.expectedMonthlySalary > 0
        ? setup.expectedMonthlySalary
        : undefined,
  };
}

/** Immediate local + optional cloud persist (Auto-setup on Budgets / Plan). */
export async function persistHouseholdProfileSnapshot(args: {
  storageKey: string;
  snapshot: HouseholdProfileSnapshot;
  supabase?: { from: (t: string) => { upsert: (row: object, opts: object) => PromiseLike<unknown> } } | null;
  userId?: string | null;
}): Promise<void> {
  try {
    localStorage.setItem(args.storageKey, JSON.stringify(args.snapshot));
  } catch {
    /* local only */
  }
  if (args.supabase && args.userId) {
    try {
      await args.supabase
        .from('household_budget_profiles')
        .upsert({ user_id: args.userId, profile: args.snapshot }, { onConflict: 'user_id' });
    } catch {
      /* optional cloud */
    }
  }
}

export function resolveHouseholdAutoSetup(args: {
  currentProfile: HouseholdEngineProfile;
  riskProfileRaw?: string | null;
  monthlyActualIncome: number[];
  suggestedMonthlySalary: number;
  adults: number;
  kids: number;
}): HouseholdAutoSetupResult {
  const messages: string[] = [];
  const adults = Math.max(1, Math.round(Number(args.adults) || 1));
  const kids = Math.max(0, Math.round(Number(args.kids) || 0));

  const fromVariance = suggestProfileFromIncomeVariance(args.monthlyActualIncome);
  const fromRisk = deriveEngineProfileFromRiskProfile(
    'Moderate',
    String(args.riskProfileRaw || ''),
  );
  let profile: HouseholdEngineProfile = args.currentProfile;
  if (fromVariance) {
    profile = fromVariance;
    messages.push(`Profile → ${fromVariance} (income variance)`);
  } else if (fromRisk && fromRisk !== 'Moderate') {
    profile = fromRisk;
    messages.push(`Profile → ${fromRisk} (risk settings)`);
  } else if (args.currentProfile) {
    profile = args.currentProfile;
    messages.push(`Profile kept: ${args.currentProfile}`);
  }

  const suggested = Math.max(0, Math.round(Number(args.suggestedMonthlySalary) || 0));
  if (suggested > 0) {
    messages.push(`Salary → auto from income history (${suggested.toLocaleString()} SAR/mo)`);
  } else {
    messages.push('Salary: no income history yet — add salary transactions or set an override');
  }

  return {
    profile,
    expectedMonthlySalary: '',
    adults,
    kids,
    clearOverrides: true,
    bulkAddSalary: suggested > 0 ? suggested : '',
    messages,
  };
}
