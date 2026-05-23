/**
 * Update / delete investment ledger rows with balance reversal and dividend guards.
 */

import type { Account, FinancialData, InvestmentTransaction } from '../types';
import { deltaForInvestmentTrade } from './investmentBalanceDelta';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';
import { roundMoney } from '../utils/money';
import {
  assertDividendNotDuplicate,
  dividendAlreadyRecorded,
  validateDividendRecordInput,
} from './dividendLedgerGuards';
import { resolveCanonicalAccountId } from '../utils/investmentLedgerCurrency';

export function validateDividendTransactionUpdate(input: {
  symbol: string;
  date: string;
  total: number;
  portfolioId?: string;
  accountId: string;
}): { valid: boolean; errors: string[] } {
  return validateDividendRecordInput({
    symbol: input.symbol,
    date: input.date,
    total: input.total,
    portfolioId: input.portfolioId,
    accountId: input.accountId,
  });
}

export function computeInvestmentTxCashDelta(tx: InvestmentTransaction): number {
  const total = getInvestmentTransactionCashAmount(tx as Parameters<typeof getInvestmentTransactionCashAmount>[0]);
  return deltaForInvestmentTrade(String(tx.type ?? ''), total);
}

export function assertDividendUpdateNotDuplicate(args: {
  existingId: string;
  transactions: InvestmentTransaction[];
  accounts: Account[];
  accountId: string;
  portfolioId?: string;
  symbol: string;
  payDate: string;
  totalBook: number;
  bookCurrency: 'USD' | 'SAR';
}): void {
  const sym = args.symbol.trim().toUpperCase();
  const day = String(args.payDate).slice(0, 10);
  const canon = resolveCanonicalAccountId(args.accountId, args.accounts);
  const filtered = args.transactions.filter((t) => t.id !== args.existingId);
  if (
    dividendAlreadyRecorded({
      transactions: filtered,
      accounts: args.accounts,
      accountId: canon,
      symbol: sym,
      payDate: day,
      totalBook: args.totalBook,
      bookCurrency: args.bookCurrency,
      portfolioId: args.portfolioId,
    })
  ) {
    assertDividendNotDuplicate({
      transactions: filtered,
      accounts: args.accounts,
      accountId: canon,
      symbol: sym,
      payDate: day,
      totalBook: args.totalBook,
      bookCurrency: args.bookCurrency,
      portfolioId: args.portfolioId,
    });
  }
}

export function investmentTransactionToRow(
  tx: InvestmentTransaction,
  _data: FinancialData | null,
): Record<string, unknown> {
  const total = roundMoney(Math.max(0, Number(tx.total) || getInvestmentTransactionCashAmount(tx as any) || 0));
  const row: Record<string, unknown> = {
    date: String(tx.date).slice(0, 10),
    type: tx.type,
    symbol: (tx.symbol || '').trim().toUpperCase(),
    quantity: tx.type === 'dividend' ? 0 : Number(tx.quantity) || 0,
    price: tx.type === 'dividend' ? 0 : Number(tx.price) || 0,
    total,
    account_id: tx.accountId,
  };
  if (tx.portfolioId) {
    row.portfolio_id = tx.portfolioId;
  }
  if (tx.currency === 'USD' || tx.currency === 'SAR') {
    row.currency = tx.currency;
  }
  return row;
}

export function netBalanceDeltaForInvestmentTxUpdate(
  before: InvestmentTransaction,
  after: InvestmentTransaction,
): number {
  return computeInvestmentTxCashDelta(after) - computeInvestmentTxCashDelta(before);
}
