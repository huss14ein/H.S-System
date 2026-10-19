/**
 * Best-in-class edge matrix for yearly-period budgets (any category).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isYearlyPeriodBudget,
  normalizeBudgetPeriod,
  normalizeBudgetCategoryKey,
  resolveBudgetCategoryHeadroom,
  shouldWarnBudgetOverspend,
  ytdRangeForFinancialMonth,
  lumpyYearlyMonthExcessWithinPlanSar,
  spendFromCategoryMap,
  buildNormalizedSpendLookup,
  spendFromNormalizedLookup,
} from '../services/budgetOverspendGate';
import { buildBudgetCardVisualMetrics } from '../services/budgetCardMetrics';
import { generateBudgetRecommendations } from '../services/aiBudgetAutomation';
import {
  budgetRowViewMatchScore,
  dedupeBudgetRowsForFinancialView,
} from '../utils/financialMonth';
import { financialPlanYearYtdWindow as ytdFromWindows } from '../services/budgetViewSpendWindows';
import type { Budget, Transaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('yearly budget gate — edge scenarios', () => {
  const finKey = { year: 2026, month: 6 };

  it('normalizes period casing and aliases (Yearly / annual / annually)', () => {
    expect(normalizeBudgetPeriod('Yearly')).toBe('yearly');
    expect(normalizeBudgetPeriod(' ANNUAL ')).toBe('yearly');
    expect(normalizeBudgetPeriod('annually')).toBe('yearly');
    expect(isYearlyPeriodBudget({ period: 'Yearly' })).toBe(true);
    expect(isYearlyPeriodBudget({ period: 'annual' })).toBe(true);
    expect(isYearlyPeriodBudget({ period: 'Monthly' })).toBe(false);
  });

  it('matches categories case-insensitively and with whitespace', () => {
    expect(normalizeBudgetCategoryKey('  Housing   Rent ')).toBe('housing rent');
    const budgets = [
      {
        id: '1',
        category: 'Housing Rent',
        limit: 24_000,
        period: 'yearly',
        year: 2026,
        month: 1,
      } as Budget,
    ];
    const headroom = resolveBudgetCategoryHeadroom({
      category: 'housing rent',
      finKey,
      monthStartDay: 1,
      budgets,
      monthSpentSar: 10_000,
      ytdSpentSar: 10_000,
    });
    expect(headroom.hasAnnualEnvelope).toBe(true);
    expect(shouldWarnBudgetOverspend(headroom)).toBe(false);

    const map = new Map([['Housing Rent', 500]]);
    expect(spendFromCategoryMap(map, 'housing  rent')).toBe(500);
    const lookup = buildNormalizedSpendLookup(map);
    expect(spendFromNormalizedLookup(lookup, 'HOUSING RENT')).toBe(500);
  });

  it('aligns YTD with monthStartDay 28 (not calendar Jan 1)', () => {
    const { start, end } = ytdRangeForFinancialMonth({ year: 2026, month: 4 }, 28);
    const windows = ytdFromWindows(2026, 4, 28);
    expect(start.getTime()).toBe(windows.ytdStart.getTime());
    expect(end.getTime()).toBe(windows.ytdEnd.getTime());
    // Plan-year financial month 1 with start day 28 → Jan 28 (not Jan 1).
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(28);
    // Day-1 YTD would start Jan 1 — gate must not use that when MSD=28.
    const day1 = ytdFromWindows(2026, 4, 1);
    expect(start.getTime()).not.toBe(day1.ytdStart.getTime());
    expect(day1.ytdStart.getDate()).toBe(1);
  });

  it('dual monthly+yearly same category prefers yearly for view score / dial', () => {
    const monthly = {
      id: 'm',
      category: 'Iqama Renewal',
      limit: 2000,
      period: 'monthly' as const,
      year: 2026,
      month: 6,
    };
    const yearly = {
      id: 'y',
      category: 'Iqama Renewal',
      limit: 24_000,
      period: 'Yearly' as const,
      year: 2026,
      month: 1,
    };
    const viewKey = { year: 2026, month: 6 };
    expect(budgetRowViewMatchScore(yearly, viewKey, 1)).toBe(210);
    expect(budgetRowViewMatchScore(monthly, viewKey, 1)).toBe(200);
    const [winner] = dedupeBudgetRowsForFinancialView(
      [monthly, yearly] as Budget[],
      viewKey,
      1,
      'Monthly',
    );
    expect(isYearlyPeriodBudget(winner)).toBe(true);
    expect(Number(winner.limit)).toBe(24_000);

    const headroom = resolveBudgetCategoryHeadroom({
      category: 'Iqama Renewal',
      finKey: viewKey,
      monthStartDay: 1,
      budgets: [monthly, yearly] as Budget[],
      monthSpentSar: 12_000,
      ytdSpentSar: 12_000,
    });
    expect(headroom.mode).toBe('annual');
    expect(headroom.lumpyMonthWithinAnnual).toBe(true);
    expect(shouldWarnBudgetOverspend(headroom)).toBe(false);
  });

  it('zero yearly limit does not soft-warn and has no annual envelope', () => {
    const budgets = [
      {
        id: 'z',
        category: 'Zakat',
        limit: 0,
        period: 'yearly',
        year: 2026,
        month: 1,
      } as Budget,
    ];
    const headroom = resolveBudgetCategoryHeadroom({
      category: 'Zakat',
      finKey,
      monthStartDay: 1,
      budgets,
      monthSpentSar: 500,
      ytdSpentSar: 500,
    });
    expect(headroom.hasAnnualEnvelope).toBe(false);
    expect(shouldWarnBudgetOverspend(headroom)).toBe(false);
    expect(headroom.lumpyMonthWithinAnnual).toBe(false);
  });

  it('warns only after YTD (+ upcoming) exceeds yearly cap', () => {
    const budgets = [
      {
        id: 't',
        category: 'School Tuition (Semester)',
        limit: 40_000,
        period: 'yearly',
        year: 2026,
        month: 1,
      } as Budget,
    ];
    const within = resolveBudgetCategoryHeadroom({
      category: 'School Tuition (Semester)',
      finKey,
      monthStartDay: 1,
      budgets,
      monthSpentSar: 20_000,
      ytdSpentSar: 39_000,
      upcomingSar: 500,
    });
    expect(shouldWarnBudgetOverspend(within)).toBe(false);

    const over = resolveBudgetCategoryHeadroom({
      category: 'School Tuition (Semester)',
      finKey,
      monthStartDay: 1,
      budgets,
      monthSpentSar: 20_000,
      ytdSpentSar: 39_000,
      upcomingSar: 2_000,
    });
    expect(shouldWarnBudgetOverspend(over)).toBe(true);
  });

  it('card metrics flag lumpyMonthWithinAnnual for yearly rows', () => {
    const visual = buildBudgetCardVisualMetrics({
      budgetView: 'Monthly',
      period: 'yearly',
      limit: 24_000,
      spentPeriod: 12_000,
      spentYtd: 12_000,
      annualEnvelopeLimit: 0,
    });
    expect(visual.percentage).toBeCloseTo(50, 5);
    expect(visual.utilizationLabel).toBe('Healthy');
    expect(visual.lumpyMonthWithinAnnual).toBe(true);
  });

  it('does not strip lumpy excess once yearly plan is breached', () => {
    const budgets = [
      {
        id: '1',
        category: 'Vehicle Insurance',
        limit: 12_000,
        period: 'yearly',
        year: 2026,
        month: 1,
      } as Budget,
    ];
    const excess = lumpyYearlyMonthExcessWithinPlanSar({
      budgets,
      finKey,
      monthStartDay: 1,
      monthSpentByCat: new Map([['Vehicle Insurance', 8_000]]),
      ytdSpentByCat: new Map([['Vehicle Insurance', 13_000]]),
    });
    expect(excess).toBe(0);
  });

  it('AI recommendations treat annual aliases as yearly plans (lumpy month within cap stays quiet)', async () => {
    const recs = await generateBudgetRecommendations(
      [
        {
          id: 't1',
          date: '2026-06-05',
          type: 'expense',
          amount: -4_000,
          budgetCategory: 'Housing Rent',
          category: 'Housing Rent',
        } as Transaction,
      ],
      [
        {
          id: 'b1',
          category: 'Housing Rent',
          limit: 24_000,
          period: 'annual' as Budget['period'],
          year: 2026,
          month: 6,
        } as Budget,
      ],
      6,
      2026,
      1,
    );
    expect(recs).toEqual([]);
  });

  it('soft lumpy UX is text-only (no HTML injection surface)', () => {
    const cards = read('components/BudgetCardMetricsBlocks.tsx');
    const tx = read('pages/Transactions.tsx');
    expect(cards).toContain('lumpyMonthWithinAnnual');
    expect(tx).toContain('lumpyMonthWithinAnnualHint');
    expect(cards).not.toContain('dangerouslySetInnerHTML');
    // Transactions page may use other safe patterns elsewhere; soft hint block must stay JSX text.
    const hintIdx = tx.indexOf('lumpyMonthWithinAnnualHint');
    expect(hintIdx).toBeGreaterThan(0);
    const snippet = tx.slice(hintIdx, hintIdx + 800);
    expect(snippet).not.toContain('dangerouslySetInnerHTML');
    expect(snippet).not.toContain('innerHTML');
  });
});
