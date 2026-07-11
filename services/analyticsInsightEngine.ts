import type { ExpenseBudgetAnalysisModel } from './expenseBudgetAnalysisModel';
import type { BudgetDriftRow } from './budgetDrift';

export type AnalyticsInsight = {
  id: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  body: string;
  category?: string;
  amountSar?: number;
  source: string;
};

/** Ranked insight feed for Wealth Analytics + Analysis (deduped, max 8). */
export function buildAnalyticsInsightFeed(args: {
  model: ExpenseBudgetAnalysisModel | null;
  driftRows?: BudgetDriftRow[];
}): AnalyticsInsight[] {
  const out: AnalyticsInsight[] = [];
  const { model, driftRows = [] } = args;
  if (!model) return out;

  for (const i of model.insights.slice(0, 4)) {
    out.push({
      id: `model-${i.title}`,
      priority: i.priority,
      title: i.title,
      body: i.detail,
      category: i.category,
      amountSar: i.amountSar,
      source: 'expenseBudgetAnalysisModel',
    });
  }

  for (const d of driftRows.slice(0, 2)) {
    out.push({
      id: `drift-${d.category}`,
      priority: Math.abs(d.driftPct) >= 30 ? 'high' : 'medium',
      title: `${d.category} drift`,
      body: `Spend is ${d.driftPct > 0 ? '+' : ''}${d.driftPct.toFixed(0)}% vs your 3-month baseline.`,
      category: d.category,
      source: 'budgetDrift',
    });
  }

  for (const c of model.overBudgetCategories.slice(0, 2)) {
    out.push({
      id: `over-${c.category}`,
      priority: 'high',
      title: `${c.category} over envelope`,
      body: `${c.utilizationPct.toFixed(0)}% of budget used (${Math.round(c.spentSar).toLocaleString()} SAR).`,
      category: c.category,
      amountSar: c.spentSar,
      source: 'envelope',
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  const seen = new Set<string>();
  return out
    .filter((x) => {
      const k = `${x.title}:${x.category ?? ''}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => rank[a.priority] - rank[b.priority])
    .slice(0, 8);
}
