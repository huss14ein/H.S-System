/**
 * Cash allocation and liquidity ranking (logic layer).
 * Determines operating vs reserve vs goal vs investable cash; suggests sweeps; ranks liquidity sources.
 */

import type { Account } from '../types';

export interface CashBucket {
  id: string;
  label: string;
  type: 'operating' | 'reserve' | 'provision' | 'goal' | 'investable';
  currentBalance: number;
  targetMin?: number;
  targetMax?: number;
  currency?: string;
}

export interface LiquiditySource {
  id: string;
  name: string;
  balance: number;
  liquidityLevel: number; // 1 = highest (cash), 5 = lowest (illiquid)
  accountType?: string;
  currency?: string;
}

/** Allocate amounts across buckets from a total cash amount (e.g. monthly surplus). Policy: reserve first, then goals, then investable. */
export function allocateCashAcrossBuckets(
  totalCash: number,
  buckets: { id: string; targetMin: number; targetMax?: number; priority: number }[]
): { bucketId: string; amount: number }[] {
  const sorted = [...buckets].sort((a, b) => a.priority - b.priority);
  let remaining = Math.max(0, totalCash);
  const result: { bucketId: string; amount: number }[] = [];

  for (const b of sorted) {
    const need = Math.max(0, b.targetMin - (result.find((r) => r.bucketId === b.id)?.amount ?? 0));
    const cap = b.targetMax != null ? Math.max(0, b.targetMax - (result.find((r) => r.bucketId === b.id)?.amount ?? 0)) : remaining;
    const amount = Math.min(remaining, Math.max(need, 0), cap);
    if (amount > 0) {
      result.push({ bucketId: b.id, amount });
      remaining -= amount;
    }
    if (remaining <= 0) break;
  }
  return result;
}

/** Detect accounts with balance above a threshold and no recent outflows (simple heuristic). */
export function detectIdleCash(
  accounts: Pick<Account, 'id' | 'name' | 'balance' | 'type'>[],
  opts?: { minBalance?: number; excludeTypes?: string[] }
): LiquiditySource[] {
  const min = opts?.minBalance ?? 0;
  const exclude = new Set(opts?.excludeTypes ?? []);
  return accounts
    .filter((a) => a.type && !exclude.has(a.type) && Number(a.balance) >= min)
    .map((a) => ({
      id: a.id,
      name: a.name,
      balance: Number(a.balance),
      liquidityLevel: 1,
      accountType: a.type,
    }));
}

/** Suggest moves: top up bills, refill emergency, move surplus to goal or investments. */
export function suggestCashSweep(
  buckets: CashBucket[],
  surplusAmount: number
): { fromBucketId: string; toBucketId: string; amount: number; reason: string }[] {
  const suggestions: { fromBucketId: string; toBucketId: string; amount: number; reason: string }[] = [];
  const operating = buckets.find((b) => b.type === 'operating');
  const reserve = buckets.find((b) => b.type === 'reserve');
  const investable = buckets.find((b) => b.type === 'investable');
  if (surplusAmount <= 0) return suggestions;
  if (reserve && reserve.targetMin != null && reserve.currentBalance < reserve.targetMin) {
    const need = reserve.targetMin - reserve.currentBalance;
    const amount = Math.min(surplusAmount, need);
    if (amount > 0 && operating)
      suggestions.push({ fromBucketId: operating.id, toBucketId: reserve.id, amount, reason: 'Refill emergency reserve' });
  }
  if (investable && surplusAmount > 0)
    suggestions.push({
      fromBucketId: operating?.id ?? buckets[0]?.id ?? 'cash',
      toBucketId: investable.id,
      amount: surplusAmount,
      reason: 'Move surplus to investable',
    });
  return suggestions;
}

/** Rank accounts + cash-like assets from most liquid (1) to least (5). */
export function rankLiquiditySources(
  accounts: Pick<Account, 'id' | 'name' | 'balance' | 'type'>[],
  opts?: { includeZeroBalance?: boolean }
): LiquiditySource[] {
  const includeZero = opts?.includeZeroBalance ?? false;
  const mapTypeToLevel = (t: string): number => {
    if (t === 'Checking') return 1;
    if (t === 'Savings') return 2;
    if (t === 'Investment') return 4;
    if (t === 'Credit') return 5;
    return 3;
  };
  return accounts
    .filter((a) => includeZero || Number(a.balance) > 0)
    .map((a) => ({
      id: a.id,
      name: a.name,
      balance: Number(a.balance),
      liquidityLevel: mapTypeToLevel(a.type ?? ''),
      accountType: a.type,
    }))
    .sort((a, b) => a.liquidityLevel - b.liquidityLevel);
}
