import { toSAR } from '../utils/currencyMath';
import type { Account, Liability } from '../types';

export interface DeductibleLiabilityTotals {
  shortTermDebts: number;
  trackedLiabilities: number;
  otherDebts: number;
  total: number;
}

/**
 * Computes deductible liabilities for Zakat.
 * Credit-card debt is sourced from credit accounts only, so manual liabilities of type
 * "Credit Card" are excluded to prevent double counting the same obligation.
 */
export function computeDeductibleLiabilities(args: {
  accounts: Account[];
  liabilities: Liability[];
  otherDebts: number;
  sarPerUsd: number;
}): DeductibleLiabilityTotals {
  const shortTermDebts = (args.accounts ?? [])
    .filter((a) => a.type === 'Credit' && (a.balance ?? 0) < 0)
    .reduce((sum, acc) => sum + toSAR(Math.abs(acc.balance ?? 0), acc.currency, args.sarPerUsd), 0);

  const trackedLiabilities = (args.liabilities ?? [])
    .filter((l) => l.status === 'Active' && (l.amount ?? 0) < 0)
    .filter((l) => l.type !== 'Receivable')
    .filter((l) => l.type !== 'Credit Card')
    .reduce((sum, liability) => sum + Math.abs(liability.amount ?? 0), 0);

  const otherDebts = Math.max(0, Number(args.otherDebts) || 0);
  const total = shortTermDebts + trackedLiabilities + otherDebts;
  return { shortTermDebts, trackedLiabilities, otherDebts, total };
}
