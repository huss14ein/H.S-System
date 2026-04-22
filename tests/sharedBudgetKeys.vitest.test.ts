import { describe, expect, it } from 'vitest';
import { dedupeSharedBudgetRows, makeSharedOwnerCategoryKey } from '../services/sharedBudgetKeys';
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
});
