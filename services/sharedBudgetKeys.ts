import type { Budget } from '../types';

export function normalizeSharedOwnerKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeSharedCategoryKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function makeSharedOwnerCategoryKey(owner: unknown, category: unknown): string {
  return `${normalizeSharedOwnerKey(owner)}::${normalizeSharedCategoryKey(category)}`;
}

type SharedBudgetLike = Budget & {
  owner_user_id?: string;
  ownerEmail?: string;
  owner_email?: string;
  shared_at?: string;
};

/**
 * Prevent duplicate shared budget rows when overlapping share scopes exist
 * (e.g. repeated ALL shares or ALL + specific rows returning the same budget).
 */
export function dedupeSharedBudgetRows<T extends SharedBudgetLike>(rows: T[]): T[] {
  const bestByKey = new Map<string, T>();
  rows.forEach((row) => {
    const owner = row.owner_user_id ?? row.user_id ?? row.ownerEmail ?? row.owner_email ?? '';
    const key = `${makeSharedOwnerCategoryKey(owner, row.category)}::${Number(row.year) || 0}::${Number(row.month) || 0}::${String(row.period || 'monthly').trim().toLowerCase()}`;
    const prev = bestByKey.get(key);
    if (!prev) {
      bestByKey.set(key, row);
      return;
    }
    const prevTs = new Date((prev as SharedBudgetLike).shared_at ?? 0).getTime();
    const nextTs = new Date((row as SharedBudgetLike).shared_at ?? 0).getTime();
    if (nextTs >= prevTs) bestByKey.set(key, row);
  });
  return Array.from(bestByKey.values());
}
