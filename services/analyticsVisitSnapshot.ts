import type { ExpenseBudgetAnalysisModel } from './expenseBudgetAnalysisModel';
import type { BudgetDriftRow } from './budgetDrift';
import { buildBudgetDrillDownAction } from './spendingDrillDown';

export type AnalyticsVisitSnapshot = {
  at: string;
  netWorthSar: number;
  budgetVarianceSar: number;
  savingsRatePct: number | null;
  expenseSar: number;
  topDriftCategory?: string;
};

const STORAGE_KEY = 'finova_analytics_visit_snapshot_v1';

export function loadAnalyticsVisitSnapshot(): AnalyticsVisitSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AnalyticsVisitSnapshot;
  } catch {
    return null;
  }
}

export function saveAnalyticsVisitSnapshot(snapshot: AnalyticsVisitSnapshot): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* ignore quota */
  }
}

export function buildVisitSnapshotFromModel(
  netWorthSar: number,
  model: ExpenseBudgetAnalysisModel | null,
): AnalyticsVisitSnapshot {
  return {
    at: new Date().toISOString(),
    netWorthSar,
    budgetVarianceSar: model?.summary.budgetVarianceSar ?? 0,
    savingsRatePct: model?.summary.savingsRatePct ?? null,
    expenseSar: model?.summary.expenseSar ?? 0,
    topDriftCategory: model?.driftRows[0]?.category,
  };
}

export type VisitDelta = {
  daysSince: number;
  netWorthDeltaSar: number;
  expenseDeltaSar: number;
  budgetVarianceDeltaSar: number;
};

export function computeVisitDelta(
  prior: AnalyticsVisitSnapshot | null,
  current: AnalyticsVisitSnapshot,
): VisitDelta | null {
  if (!prior) return null;
  const daysSince = Math.max(
    0,
    Math.round((new Date(current.at).getTime() - new Date(prior.at).getTime()) / 86400000),
  );
  return {
    daysSince,
    netWorthDeltaSar: current.netWorthSar - prior.netWorthSar,
    expenseDeltaSar: current.expenseSar - prior.expenseSar,
    budgetVarianceDeltaSar: current.budgetVarianceSar - prior.budgetVarianceSar,
  };
}

export type AnalyticsInsight = {
  id: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  category?: string;
  drillAction?: string;
};

export function mergeInsightsFromModel(
  model: ExpenseBudgetAnalysisModel | null,
  driftRows: BudgetDriftRow[],
): AnalyticsInsight[] {
  const out: AnalyticsInsight[] = [];
  if (!model) return out;
  for (const ins of model.insights) {
    out.push({
      id: `model-${ins.title}`,
      priority: ins.priority,
      title: ins.title,
      detail: ins.detail,
      category: ins.category,
      drillAction: ins.category
        ? buildBudgetDrillDownAction({ budgetCategory: ins.category })
        : undefined,
    });
  }
  for (const d of driftRows.slice(0, 3)) {
    out.push({
      id: `drift-${d.category}`,
      priority: Math.abs(d.driftPct) > 25 ? 'high' : 'medium',
      title: `${d.category} drift`,
      detail: `${d.driftPct >= 0 ? '+' : ''}${d.driftPct.toFixed(0)}% vs 3-mo avg`,
      category: d.category,
      drillAction: buildBudgetDrillDownAction({ budgetCategory: d.category }),
    });
  }
  const seen = new Set<string>();
  return out.filter((x) => {
    if (seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  }).slice(0, 8);
}
