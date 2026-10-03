import { describe, it, expect } from 'vitest';
import {
  buildAiPersonalWealthGrounding,
  buildCategorySuggestionGrounding,
  buildAiPageDelta,
} from '../services/aiPersonalWealthGrounding';
import type { FinancialData } from '../types';

const minimalData: FinancialData = {
  transactions: [
    { id: '1', date: '2026-05-10', description: 'STARBUCKS', amount: -45, type: 'expense', category: 'Food', budgetCategory: 'Food and Groceries', accountId: 'a1', status: 'Approved' },
    { id: '2', date: '2026-05-08', description: 'STARBUCKS', amount: -38, type: 'expense', category: 'Food', budgetCategory: 'Food and Groceries', accountId: 'a1', status: 'Approved' },
    { id: '3', date: '2026-05-01', description: 'Salary', amount: 15000, type: 'income', category: 'Salary', accountId: 'a1', status: 'Approved' },
  ],
  accounts: [{ id: 'a1', name: 'Checking', type: 'Checking', balance: 5000, currency: 'SAR' }],
  budgets: [{ id: 'b1', category: 'Food and Groceries', limit: 2000, month: 5, year: 2026, period: 'monthly' }],
  goals: [],
  investments: [],
  settings: { monthStartDay: 1 },
} as FinancialData;

describe('aiPersonalWealthGrounding', () => {
  it('buildAiPersonalWealthGrounding includes headline NW and P&L in prompt block', () => {
    const g = buildAiPersonalWealthGrounding({ data: minimalData, exchangeRate: 3.75 });
    expect(g.netWorthSar).toBeGreaterThan(0);
    expect(g.promptBlock).toContain('FINOVA GROUND TRUTH');
    expect(g.promptBlock).toContain('Headline net worth');
    expect(g.recentTxLines.length).toBeGreaterThan(0);
  });

  it('exposes investor-copilot fields (liquidity, concentration, dividends, debt)', () => {
    const g = buildAiPersonalWealthGrounding({ data: minimalData, exchangeRate: 3.75 });
    expect(typeof g.investableCashSar).toBe('number');
    expect(typeof g.emergencyFundMonths).toBe('number');
    expect(typeof g.topConcentrationPct).toBe('number');
    expect(typeof g.platformsDailyPnLSar).toBe('number');
    expect(typeof g.dividendRunRateSar).toBe('number');
    expect(typeof g.totalDebtSar).toBe('number');
    expect(typeof g.presentValueSar).toBe('number');
    expect(g.promptBlock).toContain('Investable / tradable platform cash');
    expect(g.promptBlock).toContain('Emergency fund months');
    expect(g.promptBlock).toContain('Top holding concentration');
  });

  it('buildAiPageDelta emits page-scoped block', () => {
    const delta = buildAiPageDelta('investments', minimalData, { concentrationWarnings: ['Top holding 30%'] });
    expect(delta).toContain('PAGE DELTA (investments)');
    expect(delta).toContain('concentrationWarnings');
  });

  it('buildCategorySuggestionGrounding surfaces prior labels for similar descriptions', () => {
    const ctx = buildCategorySuggestionGrounding(minimalData, 'STARBUCKS coffee', ['Food and Groceries', 'Transportation']);
    expect(ctx.priorCategoryHints.some((h) => h.includes('Food'))).toBe(true);
    expect(ctx.promptLines.some((l) => l.includes('Allowed categories'))).toBe(true);
  });
});
