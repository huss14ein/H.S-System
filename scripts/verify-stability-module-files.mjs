#!/usr/bin/env node
/**
 * CI guard: stability rollout modules must exist on disk (prevents committed imports to untracked files).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const required = [
  'services/quoteRefreshCooldown.ts',
  'services/monthlyInvestmentPlanProgress.ts',
  'services/budgetSpendFingerprint.ts',
  'services/sharedBudgetRpcLog.ts',
  'services/sharedBudgetConsumedRpc.ts',
  'services/planDashboardCompareContext.ts',
  'services/planExpenseOutliers.ts',
  'hooks/useDebouncedMarketPrices.ts',
  'hooks/usePageDataReady.ts',
  'utils/runWhenIdle.ts',
  'netlify/functions/quoteEdgeCache.ts',
  'components/PlanCompareContextBanner.tsx',
  'components/budgets/BudgetSharedRpcBanner.tsx',
  'components/budgets/BudgetSharedRpcStatusLine.tsx',
  'components/budgets/BudgetRecurringBillsPanel.tsx',
  'components/plan/PlanExpenseSpikePanel.tsx',
  'components/goals/GoalsFundingEnvelopeBanner.tsx',
  'components/investments/InvestmentsQuoteStatusBanner.tsx',
  'components/investments/PlatformHoldingsOutlierBanner.tsx',
];

const missing = required.filter((rel) => !existsSync(join(root, rel)));

if (missing.length > 0) {
  console.error('Missing stability module files (add and commit before push):\n');
  missing.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}

console.log(`Stability module files OK (${required.length} paths).`);
