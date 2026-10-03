import { describe, it, expect } from 'vitest';
import {
  validateAiActionCards,
  splitInsightAndActionCards,
  buildRuleBasedActionCards,
  normalizeAiActionCard,
  mergeAiActionCards,
  actionCardsPromptFooter,
  feedItemToActionCard,
} from '../services/aiActionCards';
import { buildAiPersonalWealthGrounding } from '../services/aiPersonalWealthGrounding';
import type { FinancialData } from '../types';

const minimalData: FinancialData = {
  transactions: [
    { id: '1', date: '2026-05-10', description: 'STARBUCKS', amount: -45, type: 'expense', category: 'Food', budgetCategory: 'Food and Groceries', accountId: 'a1', status: 'Approved' },
    { id: '2', date: '2026-05-01', description: 'Salary', amount: 15000, type: 'income', category: 'Salary', accountId: 'a1', status: 'Approved' },
  ],
  accounts: [
    { id: 'a1', name: 'Checking', type: 'Checking', balance: 2000, currency: 'SAR' },
    { id: 'inv1', name: 'Broker', type: 'Investment', balance: 8000, currency: 'SAR' },
  ],
  budgets: [{ id: 'b1', category: 'Food and Groceries', limit: 50, month: 5, year: 2026, period: 'monthly' }],
  goals: [],
  investments: [],
  settings: { monthStartDay: 1 },
} as FinancialData;

describe('aiActionCards', () => {
  it('normalizeAiActionCard maps CTA and severity', () => {
    const card = normalizeAiActionCard({
      title: 'Deploy cash',
      rationale: 'Idle investable cash',
      kind: 'wealth',
      severity: 'watch',
      cta: { page: 'Investments', action: 'open-trade-modal', label: 'Record Trade' },
    });
    expect(card?.title).toBe('Deploy cash');
    expect(card?.cta.page).toBe('Investments');
    expect(card?.cta.action).toBe('open-trade-modal');
  });

  it('validateAiActionCards caps and dedupes', () => {
    const cards = validateAiActionCards({
      actionCards: [
        { id: 'a', title: 'A', rationale: 'r', kind: 'trade', severity: 'urgent', cta: { page: 'Investments', action: 'open-trade-modal' } },
        { id: 'b', title: 'A', rationale: 'r2', kind: 'trade', severity: 'info', cta: { page: 'Investments', action: 'open-trade-modal' } },
      ],
    });
    expect(cards.length).toBe(1);
    expect(cards[0].severity).toBe('urgent');
  });

  it('splitInsightAndActionCards peels trailing JSON fence', () => {
    const raw = `### Advice\n- Cut dining.\n\n\`\`\`json\n{"actionCards":[{"id":"c1","kind":"budget","severity":"urgent","title":"Cut Food","rationale":"Overspent","cta":{"page":"Budgets"}}]}\n\`\`\``;
    const split = splitInsightAndActionCards(raw);
    expect(split.markdown).toContain('Cut dining');
    expect(split.markdown).not.toContain('actionCards');
    expect(split.actionCards).toHaveLength(1);
    expect(split.actionCards[0].kind).toBe('budget');
  });

  it('buildRuleBasedActionCards seeds from wealth grounding', () => {
    const g = buildAiPersonalWealthGrounding({ data: minimalData, exchangeRate: 3.75 });
    const cards = buildRuleBasedActionCards(g, minimalData, 'dashboard');
    expect(Array.isArray(cards)).toBe(true);
    expect(actionCardsPromptFooter(cards)).toContain('actionCards');
  });

  it('does not treat 10/50/100% goal progress as behind, and ignores unknown emergency coverage', () => {
    const g = buildAiPersonalWealthGrounding({ data: minimalData, exchangeRate: 3.75 });
    const healthy = buildRuleBasedActionCards(
      {
        ...g,
        goalsProgress: 'Retirement (100%), House (50%), Vacation (10%)',
        emergencyFundMonths: null,
        monthlyExpensesSar: 0,
        overspentBudgetLines: [],
        unpaidInstallmentsHint: null,
        dividendRunRateSar: 0,
        topConcentrationPct: 0,
        fundedNotDeployedSar: 0,
        investableCashSar: 0,
        totalDebtSar: 0,
        monthlyPnLSar: 0,
        platformsDailyPnLSar: 0,
      },
      minimalData,
      'dashboard',
    );
    expect(healthy.some((c) => c.id === 'rules-goals-fund')).toBe(false);
    expect(healthy.some((c) => c.id === 'rules-ef-low')).toBe(false);

    const behind = buildRuleBasedActionCards(
      { ...g, goalsProgress: 'Emergency (0%), House (40%)', emergencyFundMonths: 6, monthlyExpensesSar: 2000 },
      minimalData,
      'goals',
    );
    expect(behind.some((c) => c.id === 'rules-goals-fund')).toBe(true);
  });

  it('mergeAiActionCards prefers higher severity', () => {
    const merged = mergeAiActionCards(
      [{ id: '1', kind: 'ops', severity: 'info', title: 'X', rationale: 'r', cta: { page: 'Dashboard' } }],
      [{ id: '2', kind: 'ops', severity: 'urgent', title: 'Y', rationale: 'r', cta: { page: 'Goals' } }],
    );
    expect(merged[0].severity).toBe('urgent');
  });

  it('feedItemToActionCard maps INVESTMENT to trade', () => {
    const card = feedItemToActionCard(
      { type: 'INVESTMENT', title: 'Trim risk', description: 'Concentration high' },
      0,
    );
    expect(card.kind).toBe('trade');
    expect(card.cta.page).toBe('Investments');
  });
});
