import { describe, it, expect } from 'vitest';
import {
  financialMonthKey,
  financialMonthRange,
  financialMonthRangeFromKey,
  addMonthsToKey,
  effectiveMonthStartDay,
  currentFinancialMonthColumnEndIndex,
  financialMonthColumnIndexForDate,
  financialMonthColumnHeadersForPlanYear,
  financialMonthKeysEndingAt,
  financialMonthIsoKey,
  dateInRange,
  parseCalendarDateLocal,
  resolveMonthStartDayFromData,
  DEFAULT_FINANCIAL_MONTH_START_DAY,
  budgetAppliesToFinancialView,
  budgetRowViewMatchScore,
  dedupeBudgetRowsForFinancialView,
} from '../utils/financialMonth';

describe('financialMonthRangeFromKey vs calendar reference', () => {
  it('does not mis-assign prev period when monthStartDay > 15 (day-15 calendar trick)', () => {
    const monthStartDay = 20;
    const prevKey = { year: 2025, month: 12 };

    const fromKey = financialMonthRangeFromKey(prevKey, monthStartDay);
    const buggyRef = financialMonthRange(new Date(prevKey.year, prevKey.month - 1, 15), monthStartDay);

    expect(fromKey.start.getMonth()).toBe(11); // December (0-indexed)
    expect(fromKey.start.getDate()).toBe(20);

    // Bug: Dec 15 is before Dec 20 → financialMonthKey maps to November, not December
    expect(buggyRef.key.month).toBe(11);

    expect(fromKey.start.getTime()).not.toBe(buggyRef.start.getTime());
  });

  it('matches addMonthsToKey pipeline for “previous” month KPI window', () => {
    const monthStartDay = 28;
    const ref = new Date('2026-03-05T12:00:00');
    const currentRange = financialMonthRange(ref, monthStartDay);
    const prevKey = addMonthsToKey(currentRange.key, -1);
    const prevRange = financialMonthRangeFromKey(prevKey, monthStartDay);

    expect(prevRange.start <= prevRange.end).toBe(true);
    expect(prevRange.start.getFullYear()).toBe(prevKey.year);
    expect(prevRange.start.getMonth()).toBe(prevKey.month - 1);
    expect(prevRange.start.getDate()).toBe(monthStartDay);
  });

  it('caps preferred day 31 to the last day of shorter months', () => {
    expect(effectiveMonthStartDay(2026, 2, 31)).toBe(28);
    expect(effectiveMonthStartDay(2024, 2, 31)).toBe(29);
    expect(effectiveMonthStartDay(2026, 4, 31)).toBe(30);
  });

  it('maps late-February dates correctly when preference is 31', () => {
    const beforeStart = financialMonthKey(new Date(2026, 1, 27), 31);
    expect(beforeStart).toEqual({ year: 2026, month: 1 });
    const onStart = financialMonthKey(new Date(2026, 1, 28), 31);
    expect(onStart).toEqual({ year: 2026, month: 2 });
  });

  it('currentFinancialMonthColumnEndIndex uses financial month, not calendar', () => {
    const monthStartDay = 15;
    const ref = new Date('2026-05-10T12:00:00');
    expect(financialMonthKey(ref, monthStartDay)).toEqual({ year: 2026, month: 4 });
    expect(currentFinancialMonthColumnEndIndex(2026, ref, monthStartDay)).toBe(3);
    expect(financialMonthColumnIndexForDate('2026-05-10', 2026, monthStartDay)).toBe(3);
  });

  it('financialMonthColumnHeadersForPlanYear uses range labels when day > 1', () => {
    const headers = financialMonthColumnHeadersForPlanYear(2026, 15);
    expect(headers[0]).not.toBe('Jan');
    expect(headers[0]).toContain('–');
    expect(financialMonthKeysEndingAt(new Date('2026-05-10'), 3, 15)).toHaveLength(3);
    expect(financialMonthIsoKey({ year: 2026, month: 5 })).toBe('2026-05');
  });
});

describe('budgetAppliesToFinancialView', () => {
  const monthStartDay = 28;
  const viewKey = { year: 2026, month: 4 };

  it('includes legacy calendar-month rows that overlap the financial window', () => {
    expect(
      budgetAppliesToFinancialView({ year: 2026, month: 5, period: 'monthly' }, viewKey, monthStartDay, 'Monthly'),
    ).toBe(true);
  });

  it('excludes non-overlapping calendar months', () => {
    expect(
      budgetAppliesToFinancialView({ year: 2026, month: 3, period: 'monthly' }, viewKey, monthStartDay, 'Monthly'),
    ).toBe(false);
  });

  it('matches exact financial month index', () => {
    expect(
      budgetAppliesToFinancialView({ year: 2026, month: 4, period: 'monthly' }, viewKey, monthStartDay, 'Monthly'),
    ).toBe(true);
  });

  it('yearly rows apply to the whole plan year in yearly view', () => {
    expect(
      budgetAppliesToFinancialView({ year: 2026, month: 1, period: 'yearly' }, viewKey, monthStartDay, 'Yearly'),
    ).toBe(true);
    expect(
      budgetAppliesToFinancialView({ year: 2025, month: 1, period: 'yearly' }, viewKey, monthStartDay, 'Yearly'),
    ).toBe(false);
  });
});

describe('dedupeBudgetRowsForFinancialView', () => {
  const monthStartDay = 28;
  const viewKey = { year: 2026, month: 4 };

  it('keeps one row per category, preferring financial-month index over overlap-only calendar row', () => {
    const rows = [
      { id: 'a', category: 'Transportation', year: 2026, month: 4, period: 'monthly' as const, limit: 600 },
      { id: 'b', category: 'Transportation', year: 2026, month: 5, period: 'monthly' as const, limit: 800 },
    ];
    const deduped = dedupeBudgetRowsForFinancialView(rows, viewKey, monthStartDay, 'Monthly');
    expect(deduped).toHaveLength(1);
    expect(deduped[0].limit).toBe(600);
    expect(budgetRowViewMatchScore(rows[0], viewKey, monthStartDay)).toBeGreaterThan(
      budgetRowViewMatchScore(rows[1], viewKey, monthStartDay),
    );
  });
});

describe('parseCalendarDateLocal and dateInRange', () => {
  it('parses ISO date-only strings as local calendar midnight', () => {
    const d = parseCalendarDateLocal('2026-05-15');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });

  it('dateInRange matches financial month for boundary ISO dates (not UTC shift)', () => {
    const monthStartDay = 15;
    const { start, end } = financialMonthRangeFromKey({ year: 2026, month: 5 }, monthStartDay);
    expect(dateInRange('2026-05-15', start, end)).toBe(true);
    expect(dateInRange('2026-05-14', start, end)).toBe(false);
    expect(dateInRange('2026-06-14', start, end)).toBe(true);
    expect(dateInRange('2026-06-15', start, end)).toBe(false);
  });

  it('financialMonthColumnIndexForDate agrees with dateInRange for ISO strings', () => {
    const monthStartDay = 15;
    const { start, end } = financialMonthRangeFromKey({ year: 2026, month: 5 }, monthStartDay);
    expect(financialMonthColumnIndexForDate('2026-05-15', 2026, monthStartDay)).toBe(4);
    expect(dateInRange('2026-05-15', start, end)).toBe(true);
  });
});

describe('resolveMonthStartDayFromData', () => {
  it('defaults to day 28 when settings omit month start day', () => {
    expect(resolveMonthStartDayFromData(null)).toBe(DEFAULT_FINANCIAL_MONTH_START_DAY);
    expect(resolveMonthStartDayFromData({ settings: {} })).toBe(DEFAULT_FINANCIAL_MONTH_START_DAY);
  });

  it('reads camelCase and snake_case stored values', () => {
    expect(resolveMonthStartDayFromData({ settings: { monthStartDay: 1 } })).toBe(1);
    expect(resolveMonthStartDayFromData({ settings: { month_start_day: 25 } })).toBe(25);
  });
});
