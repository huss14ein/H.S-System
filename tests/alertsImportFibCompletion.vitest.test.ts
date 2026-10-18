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
    expect(read('services/dashboardKpiSnapshot.ts')).toContain('adjustMonthExpensesForYearlyPlanHeadroom');
    expect(read('services/wealthSummaryReportModel.ts')).toContain('adjustMonthExpensesForYearlyPlanHeadroom');
    expect(read('services/budgetDrift.ts')).toContain('hasAnnualEnvelope');
    expect(read('services/aiBudgetAutomation.ts')).toContain('yearly plan');
    expect(read('components/LiveAdvisorModal.tsx')).toContain('yearly_plan');
    expect(read('supabase/functions/send-weekly-digest/index.ts')).toContain('lumpyYearlyExcess');
    expect(read('services/annualPlanFromData.ts')).toContain('yearlyEnvelope');
    expect(read('pages/Plan.tsx')).toContain('yearlyEnvelope');
  });
});
