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
  opts?: { includeId?: boolean },
): Record<string, unknown> {
  const total = roundMoney(Math.max(0, Number(tx.total) || getInvestmentTransactionCashAmount(tx as any) || 0));
  const row: Record<string, unknown> = {
    date: String(tx.date).slice(0, 10),
    type: tx.type,
    symbol: (tx.symbol || '').trim().toUpperCase(),
    quantity: tx.type === 'dividend' ? 0 : Number(tx.quantity) || 0,
    price: tx.type === 'dividend' ? 0 : Number(tx.price) || 0,
    total,
    account_id: tx.accountId ?? (tx as { account_id?: string }).account_id,
  };
  if (opts?.includeId && tx.id) {
    row.id = tx.id;
  }
  const portfolioId = tx.portfolioId ?? (tx as { portfolio_id?: string }).portfolio_id;
  if (portfolioId) {
    row.portfolio_id = portfolioId;
  }
  if (tx.currency === 'USD' || tx.currency === 'SAR') {
    row.currency = tx.currency;
  }
  const linked =
    tx.linkedCashAccountId ?? (tx as { linked_cash_account_id?: string }).linked_cash_account_id;
  if (linked) {
    row.linked_cash_account_id = linked;
  }
  const idem = tx.idempotencyKey ?? (tx as { idempotency_key?: string }).idempotency_key;
  if (idem) {
    row.idempotency_key = idem;
  }
  const note = tx.note != null && String(tx.note).trim() !== '' ? String(tx.note).trim().slice(0, 200) : '';
  if (note) {
    row.note = note;
  }
  return row;
}

export function netBalanceDeltaForInvestmentTxUpdate(
  before: InvestmentTransaction,
  after: InvestmentTransaction,
): number {
  return computeInvestmentTxCashDelta(after) - computeInvestmentTxCashDelta(before);
}
