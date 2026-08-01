import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('salary investment allocation completion wiring', () => {
  it('canonical metrics own the salary-invest model', () => {
    expect(read('services/canonicalFinancialMetrics.ts')).toContain('salaryInvestment');
    expect(read('services/canonicalFinancialMetrics.ts')).toContain('computeSalaryInvestmentKpis');
    expect(read('services/canonicalFinancialMetricsAsync.ts')).toContain('computeSalaryInvestmentKpis');
    expect(read('hooks/canonicalFinancialMetricsBundle.ts')).toContain('...metrics');
  });

  it('primary surfaces render the shared salary-invest summary card', () => {
    expect(read('pages/Dashboard.tsx')).toContain('SalaryInvestmentSummaryCard');
    expect(read('pages/Investments.tsx')).toContain('SalaryInvestmentSummaryCard');
    expect(read('pages/Analysis.tsx')).toContain('SalaryInvestmentSummaryCard');
    expect(read('pages/Forecast.tsx')).toContain('SalaryInvestmentSummaryCard');
    expect(read('pages/Plan.tsx')).toContain('SalaryInvestmentSummaryCard');
    expect(read('pages/Summary.tsx')).toContain('SalaryInvestmentSummaryCard');
    expect(read('pages/WealthAnalytics.tsx')).toContain('SalaryInvestmentSummaryCard');
  });

  it('secondary surfaces use the same model for settings, alerts, commands, and exports', () => {
    expect(read('pages/Settings.tsx')).toContain('salaryInvestmentTargets');
    expect(read('pages/Settings.tsx')).toContain('normalizeSalaryInvestmentTargets');
    expect(read('pages/Settings.tsx')).toContain('id="salary-investing-targets"');
    expect(read('pages/Settings.tsx')).toContain('focus-salary-investing');
    expect(read('pages/SystemHealth.tsx')).toContain('salaryInvestment');
    expect(read('pages/Accounts.tsx')).toContain('Salary receiving');
    expect(read('pages/Transactions.tsx')).toMatch(/[Ss]alary/);
    expect(read('pages/Budgets.tsx')).toContain('salary-to-investment KPIs');
    expect(read('context/NotificationsContext.tsx')).toContain('computeSalaryInvestmentKpis(data, sarPerUsd)');
    expect(read('context/NotificationsContext.tsx')).toContain("safePageAction('Settings', 'focus-salary-investing')");
    expect(read('components/CommandPalette.tsx')).toContain("triggerPageAction('Settings', 'focus-salary-investing')");
    expect(read('components/CommandPalette.tsx')).toContain("triggerPageAction('Dashboard', 'focus-salary-invest')");
    expect(read('pages/Analysis.tsx')).toContain("triggerPageAction('Settings', 'focus-salary-investing')");
    expect(read('pages/Forecast.tsx')).toContain("triggerPageAction('Settings', 'focus-salary-investing')");
    expect(read('pages/Plan.tsx')).toContain("triggerPageAction('Settings', 'focus-salary-investing')");
    expect(read('pages/Summary.tsx')).toContain("triggerPageAction('Settings', 'focus-salary-investing')");
    expect(read('components/SalaryInvestmentSummaryCard.tsx')).toContain('loading');
    expect(read('services/reviewPack.ts')).toContain('Salary to investment');
    expect(read('services/wealthSummaryReportModel.ts')).toContain('salaryInvestRatePct');
    expect(read('services/reportingEngine.ts')).toContain('Salary invest rate');
    expect(read('services/aiPersonalWealthGrounding.ts')).toContain('salaryInvestRatePct');
    expect(read('supabase/functions/send-weekly-digest/index.ts')).toContain('Salary to investment');
    expect(read('supabase/functions/send-weekly-digest/index.ts')).toContain('hasSalaryInvestSignal');
    expect(read('services/digestFinancialData.ts')).toContain('transactionsRaw');
    expect(read('services/digestFinancialData.ts')).toContain('salaryInvestmentTargets');
    expect(read('utils/pageActions.ts')).toContain('focus-salary-investing');
  });

  it('defers salary KPIs off the fast canonical path', () => {
    const src = read('services/canonicalFinancialMetrics.ts');
    const fast = src.slice(
      src.indexOf('export function buildFastCanonicalFinancialMetrics'),
      src.indexOf('export function extendCanonicalFinancialMetrics'),
    );
    expect(fast).toContain('salaryInvestment: null');
    expect(fast).not.toContain('computeSalaryInvestmentKpis');
  });

  it('persists salary-invest settings through DataContext and migrations', () => {
    expect(read('context/DataContext.tsx')).toContain('salary_investing_targets');
    expect(read('services/salaryInvestmentSettings.ts')).toContain('normalizeSalaryInvestmentTargets');
    expect(read('supabase/migrations/20260728170500_settings_salary_investing_targets.sql')).toContain('salary_investing_targets');
  });
});
