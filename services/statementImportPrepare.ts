/**
 * Shared validation, portfolio resolution, dividend FX, and duplicate detection
 * for Statement Upload review + import (aligned with dividend SMS import).
 */

import type { Account, InvestmentPortfolio, InvestmentTransaction, Transaction } from '../types';
import { findDuplicateTransactions } from './dataQuality';
import {
  buildDividendDedupeKey,
  dividendAmountInBookCurrency,
  isInvestmentLedgerDuplicate,
  normalizeDividendForDedupe,
  resolveDividendBookCurrency,
} from './dividendLedgerGuards';
import { resolvePortfolioForDividendSymbol } from './dividendSmsParser';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';

export type StatementImportContext = {
  accounts: Account[];
  portfolios: InvestmentPortfolio[];
  existingBankTransactions: Transaction[];
  existingInvestmentTransactions: InvestmentTransaction[];
  sarPerUsd: number;
  /** Selected investment platform when parsing trading statements. */
  preferredAccountId?: string;
};

export type StatementImportPlan = {
  importableBankRows: Array<{ tx: Transaction; idx: number; displayIdx: number }>;
  importableInvestmentRows: Array<{
    tx: InvestmentTransaction;
    absoluteIdx: number;
    displayIdx: number;
  }>;
  importableCount: number;
  skippedDuplicates: number;
  skippedValidation: number;
  validationMessages: string[];
};

/** Normalize symbol, resolve portfolio, convert dividend totals to book currency. */
export function prepareStatementInvestmentRow(
  raw: InvestmentTransaction,
  ctx: Pick<StatementImportContext, 'portfolios' | 'accounts' | 'sarPerUsd' | 'preferredAccountId'>,
): InvestmentTransaction {
  const symbol = String(raw.symbol || '').trim().toUpperCase();
  const date = String(raw.date || '').slice(0, 10);
  let accountId = String(raw.accountId || ctx.preferredAccountId || '').trim();
  let portfolioId = raw.portfolioId;

  if (!portfolioId && symbol && accountId) {
    const resolved = resolvePortfolioForDividendSymbol(symbol, ctx.portfolios, ctx.accounts, accountId);
    if (resolved) {
      portfolioId = resolved.portfolioId;
      accountId = resolved.accountId;
    }
  }

  const type = String(raw.type || '').toLowerCase();
  const parsedTotal = Number(raw.total) || 0;
  const book = resolveDividendBookCurrency({
    currency: raw.currency,
    symbol,
    portfolioId,
    portfolios: ctx.portfolios,
  });
  const portfolio = portfolioId ? ctx.portfolios.find((p) => p.id === portfolioId) : undefined;
  const bookForDividend: 'USD' | 'SAR' =
    type === 'dividend' && portfolio
      ? resolveInvestmentPortfolioCurrency(portfolio)
      : book;
  const parsedCurrency: 'USD' | 'SAR' =
    raw.currency === 'USD' || raw.currency === 'SAR' ? raw.currency : bookForDividend;
  const total =
    type === 'dividend'
      ? dividendAmountInBookCurrency(parsedTotal, parsedCurrency, bookForDividend, ctx.sarPerUsd)
      : parsedTotal;

  return {
    ...raw,
    date,
    symbol,
    accountId,
    portfolioId,
    quantity: Number(raw.quantity) || 0,
    price: Number(raw.price) || 0,
    total,
    currency: type === 'dividend' ? bookForDividend : parsedCurrency,
  };
}

export function validatePreparedStatementInvestmentRow(tx: InvestmentTransaction): string[] {
  const reasons: string[] = [];
  const type = String(tx.type || '').toLowerCase();
  if (!tx.date) reasons.push('missing date');
  if (!tx.symbol) reasons.push('missing symbol');
  if (!(Number(tx.total) > 0)) reasons.push('total must be > 0');
  if ((type === 'buy' || type === 'sell') && !(Number(tx.quantity) > 0)) {
    reasons.push('quantity must be > 0 for buy/sell');
  }
  if ((type === 'buy' || type === 'sell') && !(Number(tx.price) > 0)) {
    reasons.push('price must be > 0 for buy/sell');
  }
  if (!['buy', 'sell', 'deposit', 'withdrawal', 'dividend', 'fee', 'vat'].includes(type)) {
    reasons.push('unsupported type');
  }
  if ((type === 'buy' || type === 'sell' || type === 'dividend') && !String(tx.portfolioId || '').trim()) {
    reasons.push('no matching portfolio for symbol');
  }
  if (!String(tx.accountId || '').trim()) reasons.push('missing platform account');
  return reasons;
}

function validatePreparedBankRow(tx: Transaction): string[] {
  const reasons: string[] = [];
  if (!tx.date) reasons.push('missing date');
  if (!tx.description) reasons.push('missing description');
  if (!Number.isFinite(Number(tx.amount)) || Number(tx.amount) === 0) {
    reasons.push('amount must be non-zero');
  }
  if (tx.type === 'expense' && !String(tx.budgetCategory || '').trim()) {
    reasons.push('missing budget mapping');
  }
  return reasons;
}

/** Combined row indices (bank first, then investment) flagged as ledger or batch duplicates. */
export function computeStatementReviewDuplicates(
  bankTransactions: Transaction[],
  investmentTransactions: InvestmentTransaction[],
  ctx: StatementImportContext,
): Set<number> {
  const duplicates = new Set<number>();
  const bankLen = bankTransactions.length;

  bankTransactions.forEach((tx, index) => {
    const matches = findDuplicateTransactions(
      {
        date: tx.date,
        amount: tx.amount,
        description: tx.description,
        accountId: tx.accountId || '',
        type: tx.type,
      },
      ctx.existingBankTransactions,
      { dateToleranceDays: 3, requireSameAccount: false },
    );
    if (matches.length > 0) duplicates.add(index);
  });

  const prepared = investmentTransactions.map((tx) =>
    prepareStatementInvestmentRow(tx, ctx),
  );
  const batchDividendKeys = new Set<string>();

  prepared.forEach((tx, invIndex) => {
    const absoluteIdx = bankLen + invIndex;
    const validationErrors = validatePreparedStatementInvestmentRow(tx);
    if (validationErrors.length > 0) return;

    const ledgerDup = isInvestmentLedgerDuplicate({
      tx,
      existingTransactions: ctx.existingInvestmentTransactions,
      accounts: ctx.accounts,
      portfolios: ctx.portfolios,
      sarPerUsd: ctx.sarPerUsd,
    });
    if (ledgerDup) {
      duplicates.add(absoluteIdx);
      return;
    }

    if (String(tx.type).toLowerCase() === 'dividend') {
      const norm = normalizeDividendForDedupe(tx, ctx.portfolios, ctx.sarPerUsd);
      if (!norm) return;
      const key = buildDividendDedupeKey(
        {
          portfolioId: tx.portfolioId,
          accountId: tx.accountId,
          symbol: tx.symbol,
          payDate: tx.date,
          totalBook: norm.totalBook,
          bookCurrency: norm.bookCurrency,
        },
        ctx.accounts,
      );
      if (batchDividendKeys.has(key)) duplicates.add(absoluteIdx);
      else batchDividendKeys.add(key);
    }
  });

  return duplicates;
}

/** Rows that will actually be written after validation + duplicate checks (for confirm dialog). */
export function planStatementImport(args: {
  bankTransactions: Transaction[];
  investmentTransactions: InvestmentTransaction[];
  selectedIndices: Set<number>;
  duplicateIndices: Set<number>;
  ctx: StatementImportContext;
}): StatementImportPlan {
  const bankLen = args.bankTransactions.length;
  const importableBankRows: StatementImportPlan['importableBankRows'] = [];
  const importableInvestmentRows: StatementImportPlan['importableInvestmentRows'] = [];
  const validationMessages: string[] = [];
  let skippedDuplicates = 0;
  let skippedValidation = 0;
  const importPendingKeys = new Set<string>();

  args.bankTransactions.forEach((raw, idx) => {
    if (!args.selectedIndices.has(idx)) return;
    if (args.duplicateIndices.has(idx)) {
      skippedDuplicates += 1;
      return;
    }
    const tx = {
      ...raw,
      date: String(raw.date || '').slice(0, 10),
      description: String(raw.description || '').trim(),
      category: String(raw.category || '').trim(),
      budgetCategory: String(raw.budgetCategory || '').trim() || undefined,
      amount: Number(raw.amount) || 0,
      type: raw.type === 'income' ? 'income' : 'expense',
    } as Transaction;
    const reasons = validatePreparedBankRow(tx);
    if (reasons.length > 0) {
      skippedValidation += 1;
      validationMessages.push(`Bank row #${idx + 1}: ${reasons.join(', ')}`);
      return;
    }
    importableBankRows.push({ tx, idx, displayIdx: idx + 1 });
  });

  args.investmentTransactions.forEach((raw, invIdx) => {
    const absoluteIdx = bankLen + invIdx;
    if (!args.selectedIndices.has(absoluteIdx)) return;
    if (args.duplicateIndices.has(absoluteIdx)) {
      skippedDuplicates += 1;
      return;
    }
    const tx = prepareStatementInvestmentRow(raw, args.ctx);
    const reasons = validatePreparedStatementInvestmentRow(tx);
    if (reasons.length > 0) {
      skippedValidation += 1;
      validationMessages.push(`Investment row #${invIdx + 1}: ${reasons.join(', ')}`);
      return;
    }
    if (
      isInvestmentLedgerDuplicate({
        tx,
        existingTransactions: args.ctx.existingInvestmentTransactions,
        accounts: args.ctx.accounts,
        portfolios: args.ctx.portfolios,
        pendingKeys: importPendingKeys,
        sarPerUsd: args.ctx.sarPerUsd,
      })
    ) {
      skippedDuplicates += 1;
      return;
    }
    importableInvestmentRows.push({ tx, absoluteIdx, displayIdx: invIdx + 1 });
    if (String(tx.type).toLowerCase() === 'dividend') {
      const norm = normalizeDividendForDedupe(tx, args.ctx.portfolios, args.ctx.sarPerUsd);
      if (norm) {
        importPendingKeys.add(
          buildDividendDedupeKey(
            {
              portfolioId: tx.portfolioId,
              accountId: tx.accountId,
              symbol: tx.symbol,
              payDate: tx.date,
              totalBook: norm.totalBook,
              bookCurrency: norm.bookCurrency,
            },
            args.ctx.accounts,
          ),
        );
      }
    }
  });

  return {
    importableBankRows,
    importableInvestmentRows,
    importableCount: importableBankRows.length + importableInvestmentRows.length,
    skippedDuplicates,
    skippedValidation,
    validationMessages,
  };
}
