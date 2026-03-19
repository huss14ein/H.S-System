/**
 * Review cadence workflows (logic layer).
 *
 * These are checklists and "what should be reviewed" outputs.
 * Scheduling/automation is intentionally handled by the automation layer.
 */

export type ReviewCadence = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';

export interface ReviewItem {
  id: string;
  title: string;
  description?: string;
  severity: 'info' | 'warning' | 'critical';
}

export function dailyReviewChecklist(args: {
  hasStaleMarketData?: boolean;
  debtStressScore?: number;
}): ReviewItem[] {
  const items: ReviewItem[] = [];
  if (args.hasStaleMarketData) {
    items.push({
      id: 'stale-market',
      title: 'Refresh stale market data',
      description: 'Prices/FX may be out of date; avoid decisions on stale quotes.',
      severity: 'warning',
    });
  }
  if (args.debtStressScore != null && args.debtStressScore >= 50) {
    items.push({
      id: 'debt-stress',
      title: 'Check debt stress indicators',
      severity: 'warning',
      description: 'Reassess coverage and repayment plan.',
    });
  }
  items.push({ id: 'cash-check', title: 'Cash check', severity: 'info', description: 'Verify no negative balances for operations.' });
  return items;
}

export function weeklyReviewChecklist(args: {
  budgetVariancePct?: number;
  isUncategorizedSpend?: boolean;
}): ReviewItem[] {
  const items: ReviewItem[] = [];
  if (args.isUncategorizedSpend) {
    items.push({ id: 'uncategorized', title: 'Review uncategorized spend', severity: 'critical' });
  }
  if (args.budgetVariancePct != null && Math.abs(args.budgetVariancePct) >= 15) {
    items.push({
      id: 'budget-variance',
      title: 'Investigate budget variance',
      severity: 'warning',
      description: 'Large drift indicates structural changes or mis-categorization.',
    });
  }
  items.push({ id: 'portfolio-move', title: 'Check portfolio movement', severity: 'info', description: 'Confirm no unintended reallocation or large trims.' });
  return items;
}

export function monthlyCloseProcess(args: {
  shouldSnapshot?: boolean;
  missingBudgetCategories?: boolean;
}): ReviewItem[] {
  const items: ReviewItem[] = [];
  if (args.missingBudgetCategories) {
    items.push({ id: 'budget-cats', title: 'Audit missing categories', severity: 'critical' });
  }
  items.push({
    id: 'snapshot',
    title: args.shouldSnapshot ? 'Create month-end snapshot' : 'Snapshot not requested',
    severity: 'info',
  });
  items.push({ id: 'goal-progress', title: 'Review goal progress', severity: 'info' });
  items.push({ id: 'allocation-review', title: 'Allocation review', severity: 'info' });
  return items;
}

export function quarterlyStrategyReview(): ReviewItem[] {
  return [
    { id: 'rebalance', title: 'Rebalance policy review', severity: 'info', description: 'Check drift vs targets and update rebalance tolerance.' },
    { id: 'thesis', title: 'Thesis review for key holdings', severity: 'warning', description: 'Confirm catalysts still valid and invalidate if needed.' },
    { id: 'attribution', title: 'Performance attribution', severity: 'info', description: 'Review residual vs cashflow effects and concentration impacts.' },
  ];
}

export function annualResetWorkflow(): ReviewItem[] {
  return [
    { id: 'targets', title: 'Reset annual targets', severity: 'warning', description: 'Update inflation/assumption baselines and yearly goals.' },
    { id: 'rule-revision', title: 'Review rule thresholds', severity: 'info', description: 'Update trading and budget thresholds if reality changed.' },
    { id: 'benchmark', title: 'Update benchmark choices', severity: 'info' },
    { id: 'allocation-reset', title: 'Reset allocation baselines', severity: 'warning' },
  ];
}

