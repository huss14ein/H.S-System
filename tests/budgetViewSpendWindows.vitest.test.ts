import { describe, expect, it } from 'vitest';
import {
  clampDateToFinancialMonthBounds,
  computeBudgetSpendWindows,
  formatBudgetSpendWindowLabel,
} from '../services/budgetViewSpendWindows';
import { financialMonthRangeFromKey } from '../utils/financialMonth';

describe('clampDateToFinancialMonthBounds', () => {
  it('clamps before start to month start and leaves in-range dates unchanged', () => {
    const { start, end } = financialMonthRangeFromKey({ year: 2026, month: 4 }, 1);
    const early = new Date(2026, 2, 1);
    expect(clampDateToFinancialMonthBounds(early, { year: 2026, month: 4 }, 1).getTime()).toBe(start.getTime());
    const mid = new Date(2026, 3, 15);
    expect(clampDateToFinancialMonthBounds(mid, { year: 2026, month: 4 }, 1).getTime()).toBe(mid.getTime());
    expect(clampDateToFinancialMonthBounds(end, { year: 2026, month: 4 }, 1).getTime()).toBe(end.getTime());
  });
});

describe('computeBudgetSpendWindows', () => {
  it('Monthly: range matches financial month; YTD from Jan 1 through month end', () => {
    const w = computeBudgetSpendWindows({
      budgetView: 'Monthly',
      currentYear: 2026,
      currentMonth: 4,
      monthStartDay: 1,
      anchorDate: new Date(2026, 3, 15),
    });
    expect(w.rangeStart.getMonth()).toBe(3);
    expect(w.rangeEnd.getMonth()).toBe(3);
    expect(w.ytdStart?.getMonth()).toBe(0);
    expect(w.ytdStart?.getDate()).toBe(1);
    expect(w.ytdEnd?.getTime()).toBe(w.rangeEnd.getTime());
  });

  it('Weekly: week contains anchor and lies inside April when anchor is mid-April', () => {
    const anchor = new Date(2026, 3, 10);
    const w = computeBudgetSpendWindows({
      budgetView: 'Weekly',
      currentYear: 2026,
      currentMonth: 4,
      monthStartDay: 1,
      anchorDate: anchor,
    });
    expect(w.rangeStart.getTime()).toBeLessThanOrEqual(anchor.getTime());
    expect(w.rangeEnd.getTime()).toBeGreaterThanOrEqual(anchor.getTime());
    const spanDays = Math.round((w.rangeEnd.getTime() - w.rangeStart.getTime()) / (86400 * 1000));
    expect(spanDays).toBeGreaterThanOrEqual(6);
    expect(w.rangeStart.getDay()).toBe(1);
  });

  it('Daily: range is single calendar day of clamped anchor', () => {
    const w = computeBudgetSpendWindows({
      budgetView: 'Daily',
      currentYear: 2026,
      currentMonth: 4,
      monthStartDay: 1,
      anchorDate: new Date(2026, 3, 22, 15, 30, 0),
    });
    expect(w.rangeStart.getFullYear()).toBe(2026);
    expect(w.rangeStart.getMonth()).toBe(3);
    expect(w.rangeStart.getDate()).toBe(22);
    expect(w.rangeEnd.getDate()).toBe(22);
    expect(w.ytdStart).toBeNull();
  });
});

describe('formatBudgetSpendWindowLabel', () => {
    it('formats a date range for monthly view', () => {
        const w = computeBudgetSpendWindows({
            budgetView: 'Monthly',
            currentYear: 2026,
            currentMonth: 4,
            monthStartDay: 1,
            anchorDate: new Date(2026, 3, 15),
        });
        const label = formatBudgetSpendWindowLabel('Monthly', w.rangeStart, w.rangeEnd);
        expect(label).toContain('–');
    });

    it('formats a single day for daily view', () => {
        const w = computeBudgetSpendWindows({
            budgetView: 'Daily',
            currentYear: 2026,
            currentMonth: 4,
            monthStartDay: 1,
            anchorDate: new Date(2026, 3, 22),
        });
        const label = formatBudgetSpendWindowLabel('Daily', w.rangeStart, w.rangeEnd);
        expect(label.length).toBeGreaterThan(0);
        expect(label).not.toContain('–');
    });

    it('formats full calendar year span for yearly view', () => {
        const w = computeBudgetSpendWindows({
            budgetView: 'Yearly',
            currentYear: 2026,
            currentMonth: 6,
            monthStartDay: 1,
            anchorDate: new Date(2026, 5, 1),
        });
        const label = formatBudgetSpendWindowLabel('Yearly', w.rangeStart, w.rangeEnd);
        expect(label).toContain('–');
        expect(label).toMatch(/2026/);
    });
});
