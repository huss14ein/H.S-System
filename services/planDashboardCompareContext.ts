/** Pass Plan cashflow snapshot to Dashboard when user clicks Compare (session bridge). */

export const PLAN_DASHBOARD_COMPARE_STORAGE_KEY = 'finova_plan_dashboard_compare_v1';

export type PlanDashboardCompareContext = {
  year: number;
  planYtdActualNetSar: number;
  planYtdProjectedNetSar?: number;
  savedAt: number;
};

export function savePlanDashboardCompareContext(ctx: Omit<PlanDashboardCompareContext, 'savedAt'>): void {
  if (typeof sessionStorage === 'undefined') return;
  const payload: PlanDashboardCompareContext = { ...ctx, savedAt: Date.now() };
  sessionStorage.setItem(PLAN_DASHBOARD_COMPARE_STORAGE_KEY, JSON.stringify(payload));
}

const MAX_AGE_MS = 30 * 60 * 1000;

export function loadPlanDashboardCompareContext(): PlanDashboardCompareContext | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PLAN_DASHBOARD_COMPARE_STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as PlanDashboardCompareContext;
    if (!Number.isFinite(j.planYtdActualNetSar) || !Number.isFinite(j.year)) return null;
    if (Date.now() - (j.savedAt ?? 0) > MAX_AGE_MS) {
      sessionStorage.removeItem(PLAN_DASHBOARD_COMPARE_STORAGE_KEY);
      return null;
    }
    return j;
  } catch {
    return null;
  }
}

export function clearPlanDashboardCompareContext(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(PLAN_DASHBOARD_COMPARE_STORAGE_KEY);
}
