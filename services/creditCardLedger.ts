import type { Transaction } from '../types';
import { isInternalTransferTransaction } from './transactionFilters';

export type CreditCardStatementAggregate = {
  /** Sum of purchase-like expenses (signed: negative = more debt in typical app sign). */
  purchaseFlow: number;
  /** Sum of refund-like income (signed). */
  refundFlow: number;
  /** Transfer legs that pay down the card (principal_in on this account). */
  paymentPrincipalIn: number;
  /** Interest + bank fees posted as expenses on the card (absolute magnitude). */
  interestAndFees: number;
};

function txAmount(t: Transaction): number {
  return Number(t.amount) || 0;
}

function isInterestOrFeeCategory(t: Transaction): boolean {
  const c = String(t.category ?? '').trim().toLowerCase();
  return c === 'interest' || c === 'fee' || c === 'fees';
}

/**
 * Aggregate activity on a credit account within [start, end] inclusive (by `transaction.date` YYYY-MM-DD).
 * Convention: expenses are typically negative; payments show as positive income with Transfer category.
 */
export function aggregateCreditCardStatementActivity(
  transactions: Transaction[],
  creditAccountId: string,
  startYmd: string,
  endYmd: string,
): CreditCardStatementAggregate {
  let purchaseFlow = 0;
  let refundFlow = 0;
  let paymentPrincipalIn = 0;
  let interestAndFees = 0;

  for (const t of transactions) {
    if (t.accountId !== creditAccountId) continue;
    const d = String(t.date ?? '').slice(0, 10);
    if (d < startYmd || d > endYmd) continue;

    const amt = txAmount(t);
    const ty = String(t.type ?? '').toLowerCase();
    const transferIn =
      ty === 'income' &&
      (isInternalTransferTransaction(t) || String(t.transferRole ?? '').toLowerCase() === 'principal_in');

    if (transferIn) {
      paymentPrincipalIn += Math.abs(amt);
      continue;
    }

    if (ty === 'expense' && !isInternalTransferTransaction(t)) {
      if (isInterestOrFeeCategory(t)) {
        interestAndFees += Math.abs(amt);
      } else {
        purchaseFlow += amt;
      }
      continue;
    }

    if (ty === 'income' && !isInternalTransferTransaction(t)) {
      refundFlow += amt;
    }
  }

  return { purchaseFlow, refundFlow, paymentPrincipalIn, interestAndFees };
}

export type CardBillingCurrency = 'SAR' | 'USD';

/**
 * Rule-of-thumb minimum payment: 1% of statement purchase magnitude with a **currency-appropriate** floor
 * (SAR: 25 — rough local issuer style; USD: 1 so small balances follow the 1% rule instead of a 25-unit floor).
 */
export function estimateMinimumCardPaymentDue(
  statementPurchasesMagnitudeInAccountCurrency: number,
  accountCurrency: CardBillingCurrency,
): number {
  const mag = Math.max(0, Number(statementPurchasesMagnitudeInAccountCurrency) || 0);
  const pct = Math.round(mag * 0.01);
  if (accountCurrency === 'USD') return Math.max(1, pct);
  return Math.max(25, pct);
}

/** @deprecated Prefer {@link estimateMinimumCardPaymentDue} with explicit card currency. */
export function estimateMinimumDueSar(statementPurchasesMagnitudeSar: number): number {
  return estimateMinimumCardPaymentDue(statementPurchasesMagnitudeSar, 'SAR');
}
