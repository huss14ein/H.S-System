import { toSAR } from '../utils/currencyMath';
import type { Account, Liability } from '../types';
import { getCreditCardLinkedAccountIds } from './creditCardLinking';

export interface DeductibleLiabilityTotals {
  shortTermDebts: number;
  trackedLiabilities: number;
  otherDebts: number;
  total: number;
}

/**
 * Computes deductible liabilities for Zakat.
 * Credit-card debt: **`Liability` rows of type Credit Card** are the canonical amount when linked;
 * credit **accounts** with a linked Credit Card liability are skipped so debt is not double-counted.
 * Unlinked negative Credit accounts still count in `shortTermDebts`.
 */
export function computeDeductibleLiabilities(args: {
  accounts: Account[];
  liabilities: Liability[];
  otherDebts: number;
  sarPerUsd: number;
}): DeductibleLiabilityTotals {
  const linkedCcAccountIds = getCreditCardLinkedAccountIds(args.liabilities);
  const shortTermDebts = (args.accounts ?? [])
    .filter(
      (a) =>
        a.type === 'Credit' &&
        (a.balance ?? 0) < 0 &&
        !linkedCcAccountIds.has(String(a.id ?? '')),
    )
    .reduce((sum, acc) => sum + toSAR(Math.abs(acc.balance ?? 0), acc.currency, args.sarPerUsd), 0);

  const trackedLiabilities = (args.liabilities ?? [])
    .filter((l) => l.status === 'Active' && (l.amount ?? 0) < 0)
    .filter((l) => l.type !== 'Receivable')
    .reduce((sum, liability) => sum + Math.abs(liability.amount ?? 0), 0);

  const otherDebts = Math.max(0, Number(args.otherDebts) || 0);
  const total = shortTermDebts + trackedLiabilities + otherDebts;
  return { shortTermDebts, trackedLiabilities, otherDebts, total };
}
