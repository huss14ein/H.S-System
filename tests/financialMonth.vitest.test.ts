import { describe, it, expect } from 'vitest';
import { financialMonthRange, financialMonthRangeFromKey, addMonthsToKey } from '../utils/financialMonth';

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
});
