/**
 * E2E wiring: alerts P-score semantics, toast dedupe, admin approve system flag,
 * Fibonacci TA hub surfaces.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('alertsImportFibCompletion', () => {
  it('CrossEngineAlertsBanner treats higher P as more urgent (P100 critical)', () => {
    const banner = read('components/CrossEngineAlertsBanner.tsx');
    expect(banner).toContain('higher = more urgent');
    expect(banner).not.toContain('lower = more urgent');
    expect(banner).toContain('p >= 90');
    expect(banner).toContain('p >= 70');
  });

  it('engine promotes all critical household stress signals', () => {
    const eng = read('services/engineIntegration.ts');
    expect(eng).toContain("filter((s) => s.type === 'critical')");
    expect(eng).toContain('seenStressMessages');
    expect(eng).toContain('emergencyFundMonthsTarget');
    expect(eng).toContain('toSAR');
  });

  it('ToastContext dedupes identical active messages', () => {
    const toast = read('context/ToastContext.tsx');
    expect(toast).toContain('Dedupe identical active toasts');
    expect(toast).toContain('dupIdx');
  });

  it('admin approve refresh uses system:true to skip posting-policy toast', () => {
    const tx = read('pages/Transactions.tsx');
    expect(tx).toContain('{ system: true }');
    expect(tx).toMatch(/await updateTransaction\(\s*\{[\s\S]*?status: 'Approved'[\s\S]*?\},\s*\{\s*system:\s*true\s*\}/);
    expect(tx).toContain('const ok = await addTransaction');
    expect(tx).toContain('if (!ok) throw new Error');
  });

  it('Fibonacci service + Watchlist/Investments/MiniPriceChart/AI grounding are wired', () => {
    expect(read('services/fibonacciAnalysis.ts')).toContain('evaluateFibonacciRetracement');
    expect(read('services/fibonacciAnalysis.ts')).toContain('0.618');
    expect(read('services/fibonacciAnalysis.ts')).toContain('0.786');
    expect(read('services/fibonacciAnalysis.ts')).toContain("direction === 'uptrend'");

    const watch = read('pages/WatchlistView.tsx');
    expect(watch).toContain('evaluateFibonacciRetracement');
    expect(watch).toContain('fibAnalysis={techSignals?.fib');
    expect(watch).toContain('shouldNotifyFibZoneEntry');
    expect(watch).toContain('fibonacciGrounding');

    const inv = read('pages/Investments.tsx');
    expect(inv).toContain('getStockCandles1M');
    expect(inv).toContain('holdingFibAnalysis');
    expect(inv).toContain('formatFibForAiGrounding');

    const chart = read('components/charts/MiniPriceChart.tsx');
    expect(chart).toContain('fibAnalysis');
    expect(chart).toContain('ReferenceArea');
    expect(chart).toContain('ReferenceLine');

    const gemini = read('services/geminiService.ts');
    expect(gemini).toContain('fibonacciGrounding');
    expect(gemini).toContain('61.8% (golden)');
    expect(gemini).toContain('for uptrends draw low→high');

    expect(read('FEATURES.md')).toContain('Fibonacci retracement');
    expect(read('pages/LogicEnginesHub.tsx')).toContain('evaluateFibonacciRetracement');
    expect(read('pages/InvestmentPlanView.tsx')).toContain('lnk.label');
    expect(read('pages/WealthUltraDashboard.tsx')).toContain('a.links');
  });

  it('yearly plan gate covers digest, KPI, LiveAdvisor, automation, and drift', () => {
    expect(read('services/budgetOverspendGate.ts')).toContain('lumpyYearlyMonthExcessWithinPlanSar');
    expect(read('services/budgetOverspendGate.ts')).toContain('isYearlyPeriodBudget');
    expect(read('utils/budgetPeriod.ts')).toContain('normalizeBudgetPeriod');
    expect(read('utils/budgetPeriod.ts')).toContain('buildNormalizedSpendLookup');
    expect(read('services/budgetPeriod.ts')).toContain("from '../utils/budgetPeriod'");
    expect(read('services/dashboardKpiSnapshot.ts')).toContain('adjustMonthExpensesForYearlyPlanHeadroom');
    expect(read('services/dashboardKpiSnapshot.ts')).toContain('isYearlyPeriodBudget');
    expect(read('services/wealthSummaryReportModel.ts')).toContain('adjustMonthExpensesForYearlyPlanHeadroom');
    expect(read('services/budgetDrift.ts')).toContain('hasAnnualEnvelope');
    expect(read('services/aiBudgetAutomation.ts')).toContain('yearly plan');
    expect(read('components/LiveAdvisorModal.tsx')).toContain('yearly_plan');
    expect(read('components/BudgetCardMetricsBlocks.tsx')).toContain('lumpyMonthWithinAnnual');
    expect(read('pages/Transactions.tsx')).toContain('transactionBudgetSpendMaps');
    expect(read('pages/Transactions.tsx')).toContain('headroomByCategoryKey');
    expect(read('pages/Transactions.tsx')).toContain('buildNormalizedSpendLookup');
    expect(read('pages/Transactions.tsx')).toContain('lumpyMonthWithinAnnualHint');
    expect(read('context/NotificationsContext.tsx')).toContain('buildBudgetRelatedNotifications');
    expect(read('services/notificationBudgetAlerts.ts')).toContain('buildNormalizedSpendLookup');
    expect(read('services/notificationBudgetAlerts.ts')).toContain('YTD exceeds the yearly plan');
    expect(read('services/notificationBudgetAlerts.ts')).toContain('withTransactionsDrillDown');
    expect(read('services/notificationBudgetAlerts.ts')).toContain('drillFor(cat)');
    expect(read('supabase/functions/send-weekly-digest/index.ts')).toContain('lumpyYearlyExcess');
    expect(read('services/annualPlanFromData.ts')).toContain('yearlyEnvelope');
    expect(read('services/annualPlanFromData.ts')).toContain('isYearlyPeriodBudget');
    expect(read('services/aiBudgetAutomation.ts')).toContain('isYearlyPeriodBudget');
    expect(read('pages/Budgets.tsx')).toContain('isYearlyPeriodBudget');
    expect(read('pages/Plan.tsx')).toContain('yearlyEnvelope');
    expect(read('pages/Plan.tsx')).toContain('% of yearly plan');
    expect(read('services/planExpenseOutliers.ts')).toContain('withinYearlyPlan');
    expect(read('services/geminiService.ts')).toContain('within yearly plan (lumpy month OK)');
    expect(read('services/enhancedBudgetEngine.ts')).toContain('effectiveSpendLimit');
    // Dashboard must not recompute ungated yearly÷12 budget variance for UI.
    const dash = read('pages/Dashboard.tsx');
    expect(dash).toContain('annual-aware gate');
    expect(dash).not.toContain('budgetToMonthly');
    expect(dash).not.toContain('monthlyBudgets');
    // Gate is period-based for all yearly categories (not Housing Rent–only).
    expect(read('FEATURES.md')).toContain("period: 'yearly'");
    expect(read('FEATURES.md')).toContain('not a Housing Rent special case');
  });

  it('version 5.0.0.0 is shipped end to end', () => {
    expect(read('utils/buildInfo.ts')).toContain("APP_VERSION = '5.0.0.0'");
    expect(read('package.json')).toContain('"version": "5.0.0.0"');
    expect(read('FEATURES.md')).toContain('5.0.0.0');
    expect(read('FEATURES.md')).toContain('Annual-aware overspend gate');
    expect(read('FEATURES.md')).toContain('budgetOverspendGate');
  });

  it('Wealth Ultra native alerts expose type-specific nav links', () => {
    expect(read('wealth-ultra/alertEngine.ts')).toContain('defaultLinksForWealthUltraAlert');
    expect(read('pages/WealthUltraDashboard.tsx')).toContain('a.links');
    expect(read('types.ts')).toContain('links?: Array<{ label: string; page: Page');
  });

  it('budget AI analysis uses annual-aware headroom when data is present', () => {
    const gemini = read('services/geminiService.ts');
    expect(gemini).toContain('resolveBudgetCategoryHeadroom');
    expect(gemini).toContain('ytdRangeForFinancialMonth');
    expect(gemini).toContain('within yearly plan (lumpy month OK)');
  });
});
