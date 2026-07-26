/**
 * Transfer clearance: detect unpaired transfer legs.
 *
 * A well-formed transfer has both a `principal_out` and a `principal_in` leg sharing
 * one `transferGroupId` (fees are optional extra rows). A group missing one side is an
 * "unpaired" transfer — usually an import that only captured one bank's statement, or a
 * mis-tagged row — and would distort cashflow if treated as income/expense.
 */
import type { Transaction } from '../types';

export interface TransferGroupClearance {
  transferGroupId: string;
  hasOut: boolean;
  hasIn: boolean;
  legCount: number;
  outAmount: number;
  inAmount: number;
  /** |out| − |in|; non-zero means the legs don't net to zero. */
  imbalance: number;
  transactionIds: string[];
}

export interface TransferClearanceReport {
  groups: TransferGroupClearance[];
  /** Groups missing one principal leg. */
  unpaired: TransferGroupClearance[];
  /** Paired groups whose out/in magnitudes differ beyond `epsilon`. */
  imbalanced: TransferGroupClearance[];
}

const DEFAULT_EPS = 0.01;

function absAmount(t: Transaction): number {
  return Math.abs(Number(t.amount) || 0);
}

export function buildTransferClearanceReport(
  transactions: Transaction[] | null | undefined,
  epsilon: number = DEFAULT_EPS,
): TransferClearanceReport {
  const byGroup = new Map<string, Transaction[]>();
  for (const t of transactions ?? []) {
    const gid = (t.transferGroupId ?? '').trim();
    if (!gid) continue;
    const list = byGroup.get(gid) ?? [];
    list.push(t);
    byGroup.set(gid, list);
  }

  const groups: TransferGroupClearance[] = [];
  for (const [transferGroupId, legs] of byGroup) {
    const outLegs = legs.filter((t) => t.transferRole === 'principal_out');
    const inLegs = legs.filter((t) => t.transferRole === 'principal_in');
    // Fall back to income/expense sign when transferRole was not tagged on import.
    const hasOut = outLegs.length > 0 || legs.some((t) => t.type === 'expense');
    const hasIn = inLegs.length > 0 || legs.some((t) => t.type === 'income');
    const outAmount = (outLegs.length ? outLegs : legs.filter((t) => t.type === 'expense')).reduce(
      (s, t) => s + absAmount(t),
      0,
    );
    const inAmount = (inLegs.length ? inLegs : legs.filter((t) => t.type === 'income')).reduce(
      (s, t) => s + absAmount(t),
      0,
    );
    groups.push({
      transferGroupId,
      hasOut,
      hasIn,
      legCount: legs.length,
      outAmount,
      inAmount,
      imbalance: Math.round((outAmount - inAmount) * 100) / 100,
      transactionIds: legs.map((t) => t.id),
    });
  }

  const unpaired = groups.filter((g) => !(g.hasOut && g.hasIn));
  const imbalanced = groups.filter((g) => g.hasOut && g.hasIn && Math.abs(g.imbalance) > epsilon);

  return { groups, unpaired, imbalanced };
}

/** Convenience: list transaction ids that belong to an unpaired transfer group. */
export function findUnpairedTransferLegIds(
  transactions: Transaction[] | null | undefined,
): string[] {
  return buildTransferClearanceReport(transactions).unpaired.flatMap((g) => g.transactionIds);
}
