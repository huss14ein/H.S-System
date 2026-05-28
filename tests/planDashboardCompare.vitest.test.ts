/**
 * Plan ↔ Dashboard comparison UX (stability plan p2-plan-dashboard-align).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSupportedPageAction } from '../utils/pageActions';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('Plan Dashboard compare wiring', () => {
  it('whitelists plan-compare-dashboard for Dashboard', () => {
    expect(isSupportedPageAction('Dashboard', 'plan-compare-dashboard')).toBe(true);
  });

  it('Plan triggers compare and shows metric families', () => {
    const plan = read('pages/Plan.tsx');
    expect(plan).toContain('goToDashboardCompare');
    expect(plan).toContain("triggerPageAction('Dashboard', 'plan-compare-dashboard')");
    expect(plan).toContain('Plan vs Dashboard (different metrics)');
    expect(plan).toContain('How planned columns work in the grid');
    expect(plan).toContain('savePlanDashboardCompareContext');
    expect(plan).toContain('What we still do not merge');
    expect(plan).toContain('Compare on Dashboard');
    expect(plan).toContain('do not merge those into Plan YTD');
  });

  it('Dashboard scrolls to KPI row on plan-compare-dashboard', () => {
    const dash = read('pages/Dashboard.tsx');
    expect(dash).toContain("pageAction !== 'plan-compare-dashboard'");
    expect(dash).toContain('dashboard-kpi-row');
    expect(dash).toContain('clearPageAction');
    expect(dash).toContain('PlanCompareContextBanner');
  });

  it('proxies use server-side quote edge cache', () => {
    expect(read('netlify/functions/sahmk-proxy.ts')).toContain('quoteEdgeCache');
    expect(read('netlify/functions/stooq-proxy.ts')).toContain('getQuoteEdgeCached');
  });

  it('Budgets uses extracted panels and shared RPC service', () => {
    const budgets = read('pages/Budgets.tsx');
    expect(budgets).toContain('BudgetSharedRpcStatusLine');
    expect(budgets).toContain('BudgetRecurringBillsPanel');
    expect(budgets).toContain('sharedBudgetConsumedRpc');
  });

  it('shell passes pageAction to Dashboard and nav to Plan', () => {
    const shell = read('components/AuthenticatedAppShell.tsx');
    expect(shell).toMatch(/case 'Dashboard':[\s\S]{0,120}\{\.\.\.actionProps\}/);
    expect(shell).toMatch(/case 'Plan':[\s\S]{0,80}\{\.\.\.nav\}/);
  });
});
