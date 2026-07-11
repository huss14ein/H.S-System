/**
 * Spending command center E2E wiring — shared UI on primary surfaces + alert hooks.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const SPENDING_SURFACES = ['pages/Dashboard.tsx', 'pages/Analysis.tsx', 'pages/Budgets.tsx'] as const;

describe('spendingCommandCenterCoverage', () => {
  it('mounts SpendingCommandCenter on Dashboard, Analysis, and Budgets', () => {
    for (const page of SPENDING_SURFACES) {
      const src = read(page);
      expect(src, page).toContain('SpendingCommandCenter');
      expect(src, page).toContain('useSpendingCommandCenterModel');
    }
  });

  it('Dashboard mounts deferred operations cockpit', () => {
    expect(read('pages/Dashboard.tsx')).toContain('DashboardOperationsCockpitSection');
  });

  it('Analysis studio wires explorer tabs, content, period bar, and SAR export', () => {
    const analysis = read('pages/Analysis.tsx');
    expect(analysis).toContain('AnalyticsPeriodScopeBar');
    expect(analysis).toContain('AnalysisExplorerTabs');
    expect(analysis).toContain('AnalysisExplorerContent');
    expect(analysis).toContain('downloadSpendingBriefCsv');
    expect(analysis).toMatch(/analysisStudioTab === 'command'[\s\S]*AnalyticsInsightRail/);
    expect(read('components/analysis/AnalysisExplorerTabs.tsx')).not.toContain("'position'");
  });

  it('NotificationsContext surfaces budget drift, envelope, and anomaly alerts with drill-down', () => {
    const ctx = read('context/NotificationsContext.tsx');
    expect(ctx).toContain('enhancementSignals.budgetDrift');
    expect(ctx).toContain('computeExpenseBudgetAnalysisModel');
    expect(ctx).toContain('overBudgetCategories');
    expect(ctx).toContain('detectSpendingAnomaliesFromTransactions');
    expect(ctx).toContain('buildBudgetDrillDownAction');
  });

  it('shared spending services exist and export drill-down + brief', () => {
    expect(read('services/spendingDrillDown.ts')).toContain('buildBudgetDrillDownAction');
    expect(read('services/spendingReportExport.ts')).toContain('downloadSpendingBriefCsv');
    expect(read('components/spending/SpendingCommandCenter.tsx')).toContain('ExpenseBudgetAnalysisPanel');
  });
});
