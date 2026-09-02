/**
 * Goal progress includes platform/portfolio tradable cash end-to-end:
 * computeGoalResolvedAmountsSar → Goals / Plan / Forecast / funding / AI surfaces.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeGoalResolvedAmountsSar, computeGoalPlatformCashByGoalSar } from '../services/goalResolvedTotals';
import { goalsWithResolvedCurrentAmount } from '../services/goalResolvedTotals';
import type { FinancialData, Goal } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('goalProgressPlatformCashCompletion', () => {
  it('canonical helper attributes Investment account cash into resolved totals', () => {
    const goal: Goal = {
      id: 'g1',
      name: 'Car',
      targetAmount: 50_000,
      deadline: '2028-01-01',
      priority: 'Medium',
    };
    const data = {
      goals: [goal],
      assets: [],
      accounts: [{ id: 'inv', name: 'Derayah', type: 'Investment', balance: 2500, currency: 'SAR' }],
      investments: [
        {
          id: 'pf',
          name: 'Goal sleeve',
          accountId: 'inv',
          goalId: 'g1',
          currency: 'SAR',
          holdings: [{ id: 'h1', symbol: '1111.SR', quantity: 1, avgCost: 1, currentValue: 7500 }],
        },
      ],
      liabilities: [],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;

    const cash = computeGoalPlatformCashByGoalSar(data, 3.75).get('g1') ?? [];
    expect(cash.reduce((s, r) => s + r.amountSar, 0)).toBeCloseTo(2500, 5);
    expect(computeGoalResolvedAmountsSar(data, 3.75).get('g1')).toBeCloseTo(10_000, 5);
    expect(goalsWithResolvedCurrentAmount(data, 3.75)[0]?.currentAmount).toBeCloseTo(10_000, 5);
  });

  it('Goals page lists platform cash and uses computeGoalResolvedAmountsSar', () => {
    const src = read('pages/Goals.tsx');
    expect(src).toContain('computeGoalResolvedAmountsSar');
    expect(src).toContain('computeGoalPlatformCashByGoalSar');
    expect(src).toContain('Platform cash:');
  });

  it('downstream surfaces keep the canonical resolved helper (no ad-hoc currentAmount sums)', () => {
    const surfaces = [
      'pages/Plan.tsx',
      'pages/Forecast.tsx',
      'pages/Investments.tsx',
      'services/goalFundingRouter.ts',
      'services/householdBudgetEngine.ts',
      'services/geminiService.ts',
    ];
    for (const path of surfaces) {
      const src = read(path);
      const wired =
        src.includes('computeGoalResolvedAmountsSar') ||
        src.includes('goalsWithResolvedCurrentAmount') ||
        src.includes('mergeGoalRowsWithResolvedCurrentSar');
      expect(wired, `${path} missing resolved goal totals`).toBe(true);
    }
  });
});
