/**
 * Accounts transfer History month filter — calendar month + dateInRange (not fiscal 28→27).
 * Bug: History (N) with empty list when Month=July used financialMonthRangeFromIsoKey + new Date(iso).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  calendarMonthRangeFromIsoKey,
  dateInRange,
  financialMonthRangeFromIsoKey,
} from '../utils/financialMonth';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('transferHistoryMonthFilter', () => {
  it('Accounts History uses calendar month range + dateInRange (not fiscal range / UTC Date parse)', () => {
    const src = read('pages/Accounts.tsx');
    expect(src).toContain('calendarMonthRangeFromIsoKey');
    expect(src).toContain('dateInRange');
    expect(src).toContain("transferHistoryMonth === 'all'");
    expect(src).toContain("useState<string>('all')");
    expect(src).toContain('Show all');
    expect(src).not.toContain('financialMonthRangeFromIsoKey');
    expect(src).not.toMatch(/filteredTransferHistory[\s\S]*new Date\(p\.date\)/);
  });

  it('Accounts History uses calendar month; Budgets shared tx month picker matches calendar too', () => {
    expect(read('pages/Accounts.tsx')).toContain('calendarMonthRangeFromIsoKey');
    expect(read('pages/Budgets.tsx')).toContain('calendarMonthRangeFromIsoKey(sharedTxMonthFilter)');
    expect(read('pages/Budgets.tsx')).toContain('calendarMonthRangeFromIsoKey(requestMonthFilter)');
  });

  it('calendar July includes mid-month transfer dates that fiscal July (start day 28) excludes', () => {
    const cal = calendarMonthRangeFromIsoKey('2026-07');
    expect(cal).not.toBeNull();
    expect(dateInRange('2026-07-15', cal!.start, cal!.end)).toBe(true);
    expect(dateInRange('2026-07-01', cal!.start, cal!.end)).toBe(true);
    expect(dateInRange('2026-07-31', cal!.start, cal!.end)).toBe(true);
    expect(dateInRange('2026-06-30', cal!.start, cal!.end)).toBe(false);

    const fiscal = financialMonthRangeFromIsoKey('2026-07', 28);
    // Salary-cycle July starts on the 28th — mid-month rows fall outside that window.
    expect(dateInRange('2026-07-15', fiscal.start, fiscal.end)).toBe(false);
    expect(dateInRange('2026-07-28', fiscal.start, fiscal.end)).toBe(true);
  });
});
