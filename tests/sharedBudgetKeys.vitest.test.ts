import { describe, expect, it } from 'vitest';
import {
  dedupeSharedBudgetRows,
  dedupeSharedBudgetRowsForFinancialView,
  makeSharedOwnerCategoryKey,
  normalizeSharedBudgetRowFromRpc,
  parseStoredBudgetMonth,
  parseStoredBudgetYear,
} from '../services/sharedBudgetKeys';
import type { Budget } from '../types';

type SharedBudgetRow = Budget & {
  owner_user_id?: string;
  ownerEmail?: string;
  owner_email?: string;
  shared_at?: string;
};

describe('sharedBudgetKeys', () => {
  it('normalizes owner/category key case and whitespace', () => {
    const k1 = makeSharedOwnerCategoryKey(' OWNER-1 ', 'Groceries');
    const k2 = makeSharedOwnerCategoryKey('owner-1', ' groceries ');
    expect(k1).toBe(k2);
  });

  it('dedupes overlapping shared rows for same owner/category/period', () => {
    const base: SharedBudgetRow = {
      id: 'b1',
      user_id: 'owner-1',
      owner_user_id: 'owner-1',
      category: 'Groceries',
      month: 4,
      year: 2026,
      period: 'monthly',
      limit: 1000,
      tier: 'Core',
      ownerEmail: 'owner@example.com',
    };
    const rows: SharedBudgetRow[] = [
      { ...base, id: 'old', shared_at: '2026-04-01T10:00:00Z' },
      { ...base, id: 'new', shared_at: '2026-04-10T10:00:00Z' },
      { ...base, id: 'other-month', month: 5, shared_at: '2026-04-11T10:00:00Z' },
    ];

    const deduped = dedupeSharedBudgetRows(rows);
    expect(deduped).toHaveLength(2);
    expect(deduped.some((r) => r.id === 'new')).toBe(true);
    expect(deduped.some((r) => r.id === 'old')).toBe(false);
    expect(deduped.some((r) => r.id === 'other-month')).toBe(true);
  });

  it('normalizeSharedBudgetRowFromRpc marks missing year/month explicitly (not conflated with 0)', () => {
    const row = normalizeSharedBudgetRowFromRpc({
      id: 'x',
      user_id: 'o1',
      category: 'Fuel',
      limit: 500,
    });
    expect(row.year).toBe(0);
    expect(row.month).toBe(0);
    expect(row.budgetYearUnspecified).toBe(true);
    expect(row.budgetMonthUnspecified).toBe(true);
    expect(parseStoredBudgetYear(0)).toBeNull();
    expect(parseStoredBudgetMonth(0)).toBeNull();
  });

  it('dedupes unspecified-period rows separately from explicit year/month', () => {
    const base = {
      id: 'b1',
      user_id: 'owner-1',
      owner_user_id: 'owner-1',
      category: 'Groceries',
      period: 'monthly' as const,
      limit: 1000,
      tier: 'Core' as const,
      shared_at: '2026-04-01T10:00:00Z',
    };
    const unspecified = normalizeSharedBudgetRowFromRpc({ ...base, id: 'unspec' });
    const explicitZero = normalizeSharedBudgetRowFromRpc({
      ...base,
      id: 'zero',
      year: 0,
      month: 0,
    });
    const explicitApr = normalizeSharedBudgetRowFromRpc({
      ...base,
      id: 'apr',
      year: 2026,
      month: 4,
      shared_at: '2026-04-11T10:00:00Z',
    });
    const deduped = dedupeSharedBudgetRows([unspecified, explicitZero, explicitApr]);
    expect(deduped).toHaveLength(2);
    // DB 0 and missing both mean unspecified — same dedupe bucket; newer shared_at wins.
    expect(deduped.some((r) => r.id === 'zero')).toBe(true);
    expect(deduped.some((r) => r.id === 'apr')).toBe(true);
    expect(deduped.find((r) => r.budgetYearUnspecified)?.id).toBe('zero');
  });

  it('dedupeSharedBudgetRowsForFinancialView resolves unspecified month against view key', () => {
    const row = normalizeSharedBudgetRowFromRpc({
      id: 'wild',
      user_id: 'owner-1',
      owner_user_id: 'owner-1',
      category: 'Transport',
      limit: 800,
      year: 2026,
      shared_at: '2026-01-01T00:00:00Z',
    });
    const viewKey = { year: 2026, month: 5 };
    const out = dedupeSharedBudgetRowsForFinancialView([row], viewKey, 1, 'Monthly');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('wild');
  });
});
