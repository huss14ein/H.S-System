/**
 * Shared validation + duplicate prevention for dividend ledger rows.
 * Used by Record Trade, SMS import, Finnhub sync, and plan overrides.
 */

import type { Account, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { fromSAR, toSAR } from '../utils/currencyMath';
import { resolveCanonicalAccountId } from '../utils/investmentLedgerCurrency';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { roundMoney } from '../utils/money';

/** Cash amount match tolerance (book currency). */
export const DIVIDEND_LEDGER_AMOUNT_TOLERANCE = 0.05;

export const DIVIDEND_MAX_ANNUAL_SAR = 1_000_000_000;
export const DIVIDEND_MAX_YIELD_PCT = 100;

export type DividendDedupeKeyInput = {
  portfolioId?: string;
  accountId: string;
  symbol: string;
  payDate: string;
  totalBook: number;
  bookCurrency: 'USD' | 'SAR';
};

function payDateKey(iso: string): string {
  return String(iso || '').slice(0, 10);
}

function txPortfolioId(t: InvestmentTransaction): string {
  const ext = t as InvestmentTransaction & { portfolio_id?: string };
  return String(t.portfolioId ?? ext.portfolio_id ?? '').trim();
}

type PortfolioBookCurrencyHint = Pick<InvestmentPortfolio, 'id' | 'currency' | 'holdings'>;

/** Book currency for dividend dedupe when `currency` is missing on a parsed/import row. */
export function resolveDividendBookCurrency(args: {
  currency?: string;
  symbol?: string;
  portfolioId?: string;
  portfolios?: PortfolioBookCurrencyHint[];
}): 'USD' | 'SAR' {
  const explicit = args.currency;
  if (explicit === 'SAR' || explicit === 'USD') return explicit;

  const pid = String(args.portfolioId ?? '').trim();
  if (pid && args.portfolios?.length) {
    const portfolio = args.portfolios.find((p) => p.id === pid);
    if (portfolio) return resolveInvestmentPortfolioCurrency(portfolio);
  }

  const sym = String(args.symbol ?? '').trim().toUpperCase();
  if (/\.(SR|SA)$/.test(sym)) return 'SAR';

  return 'USD';
}

/** Convert a dividend cash amount into portfolio/book currency for dedupe. */
export function dividendAmountInBookCurrency(
  amount: number,
  from: 'USD' | 'SAR',
  book: 'USD' | 'SAR',
  sarPerUsd: number,
): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const rate = Number.isFinite(sarPerUsd) && sarPerUsd > 0 ? sarPerUsd : 3.75;
  if (from === book) return roundMoney(n);
  if (from === 'USD' && book === 'SAR') return roundMoney(toSAR(n, 'USD', rate));
  return roundMoney(fromSAR(n, 'USD', rate));
}

export type DividendDedupeTxLike = {
  type?: string;
  total?: number;
  currency?: string;
  symbol?: string;
  portfolioId?: string;
};

/**
 * Normalize a dividend row to book-currency amount for duplicate checks and import.
 * When `currency` is omitted, the numeric total is treated as already in book currency
 * (same inference path as `resolveDividendBookCurrency`, not a hardcoded SAR/USD split).
 */
export function normalizeDividendForDedupe(
  tx: DividendDedupeTxLike,
  portfolios?: PortfolioBookCurrencyHint[],
  sarPerUsd = 3.75,
): { totalBook: number; bookCurrency: 'USD' | 'SAR' } | null {
  if (String(tx.type ?? '').toLowerCase() !== 'dividend') return null;
  const total = Number(tx.total) || 0;
  if (!(total > 0)) return null;

  const book = resolveDividendBookCurrency({
    currency: tx.currency,
    symbol: tx.symbol,
    portfolioId: tx.portfolioId,
    portfolios,
  });
  const explicit = tx.currency === 'USD' || tx.currency === 'SAR' ? tx.currency : null;
  const parsedCurrency = explicit ?? book;
  const totalBook =
    explicit && explicit !== book
      ? dividendAmountInBookCurrency(total, parsedCurrency, book, sarPerUsd)
      : roundMoney(total);

  return { totalBook, bookCurrency: book };
}

function dividendCashAmountsMatch(
  amountA: number,
  curA: 'USD' | 'SAR',
  amountB: number,
  curB: 'USD' | 'SAR',
  sarPerUsd: number,
): boolean {
  if (curA === curB) {
    return Math.abs(amountA - amountB) < DIVIDEND_LEDGER_AMOUNT_TOLERANCE;
  }
  const rate = Number.isFinite(sarPerUsd) && sarPerUsd > 0 ? sarPerUsd : 3.75;
  const aSar = curA === 'SAR' ? amountA : toSAR(amountA, 'USD', rate);
  const bSar = curB === 'SAR' ? amountB : toSAR(amountB, 'USD', rate);
  return Math.abs(aSar - bSar) < DIVIDEND_LEDGER_AMOUNT_TOLERANCE;
}

/** When `accounts` is passed, `accountId` in the key is canonical (matches ledger dedupe comparisons). */
export function buildDividendDedupeKey(
  input: DividendDedupeKeyInput,
  accounts?: Account[],
): string {
  const sym = input.symbol.trim().toUpperCase();
  const day = payDateKey(input.payDate);
  const pid = String(input.portfolioId ?? '').trim();
  const acc = accounts?.length
    ? resolveCanonicalAccountId(input.accountId, accounts)
    : String(input.accountId ?? '').trim();
  const amt = roundMoney(Math.max(0, input.totalBook));
  return `${pid}|${acc}|${sym}|${day}|${input.bookCurrency}|${amt.toFixed(4)}`;
}

export function dividendAlreadyRecorded(args: {
  transactions: InvestmentTransaction[];
  accounts: Account[];
  accountId: string;
  symbol: string;
  payDate: string;
  totalBook: number;
  bookCurrency: 'USD' | 'SAR';
  portfolioId?: string;
  portfolios?: PortfolioBookCurrencyHint[];
  /** Rows inserted earlier in the same batch/sync run. */
  pendingKeys?: Set<string>;
  /** Used when comparing ledger rows stored in a different currency than the candidate row. */
  sarPerUsd?: number;
}): boolean {
  const key = buildDividendDedupeKey(
    {
      portfolioId: args.portfolioId,
      accountId: args.accountId,
      symbol: args.symbol,
      payDate: args.payDate,
      totalBook: args.totalBook,
      bookCurrency: args.bookCurrency,
    },
    args.accounts,
  );
  if (args.pendingKeys?.has(key)) return true;

  const canon = resolveCanonicalAccountId(args.accountId, args.accounts);
  const day = payDateKey(args.payDate);
  const sym = args.symbol.trim().toUpperCase();
  const wantPid = String(args.portfolioId ?? '').trim();
  const fxRate = args.sarPerUsd;

  for (const t of args.transactions) {
    if (t.type !== 'dividend') continue;
    if ((t.symbol || '').trim().toUpperCase() !== sym) continue;
    if (payDateKey(t.date) !== day) continue;

    const tac = resolveCanonicalAccountId(t.accountId, args.accounts);
    if (tac !== canon) continue;

    if (wantPid) {
      const txPid = txPortfolioId(t);
      if (txPid && txPid !== wantPid) continue;
    }

    const cur = resolveDividendBookCurrency({
      currency: t.currency,
      symbol: t.symbol,
      portfolioId: txPortfolioId(t),
      portfolios: args.portfolios,
    });
    const a = getInvestmentTransactionCashAmount(t as Parameters<typeof getInvestmentTransactionCashAmount>[0]);
    const b = args.totalBook;
    if (dividendCashAmountsMatch(a, cur, b, args.bookCurrency, fxRate ?? 3.75)) return true;
  }
  return false;
}

/** Statement review + import: detect investment row already in ledger. */
export function isInvestmentLedgerDuplicate(args: {
  tx: {
    type: string;
    date?: string;
    symbol?: string;
    quantity?: number;
    price?: number;
    total?: number;
    currency?: string;
    accountId?: string;
    portfolioId?: string;
  };
  existingTransactions: InvestmentTransaction[];
  accounts: Account[];
  portfolios?: PortfolioBookCurrencyHint[];
  pendingKeys?: Set<string>;
  sarPerUsd?: number;
}): boolean {
  const tx = args.tx;
  const type = String(tx.type ?? '').toLowerCase();
  if (type === 'dividend') {
    const normalized = normalizeDividendForDedupe(tx, args.portfolios, args.sarPerUsd);
    if (!normalized) return false;
    return dividendAlreadyRecorded({
      transactions: args.existingTransactions,
      accounts: args.accounts,
      accountId: String(tx.accountId ?? ''),
      symbol: String(tx.symbol ?? ''),
      payDate: String(tx.date ?? ''),
      totalBook: normalized.totalBook,
      bookCurrency: normalized.bookCurrency,
      portfolioId: tx.portfolioId,
      portfolios: args.portfolios,
      pendingKeys: args.pendingKeys,
      sarPerUsd: args.sarPerUsd,
    });
  }

  const txDate = new Date(String(tx.date ?? ''));
  if (isNaN(txDate.getTime())) return false;
  const txSymbol = String(tx.symbol ?? '').trim().toUpperCase();
  const txQuantity = Math.abs(Number(tx.quantity) || 0);
  const txPrice = Number(tx.price) || 0;

  return args.existingTransactions.some((existing) => {
    if (String(existing.type ?? '').toLowerCase() !== type) return false;
    const existingDate = new Date(existing.date);
    if (isNaN(existingDate.getTime())) return false;
    const existingSymbol = String(existing.symbol ?? '').trim().toUpperCase();
    const existingQuantity = Math.abs(Number(existing.quantity) || 0);
    const existingPrice = Number(existing.price) || 0;
    const dateDiff = Math.abs(txDate.getTime() - existingDate.getTime());
    const daysDiff = dateDiff / (1000 * 60 * 60 * 24);
    return (
      daysDiff <= 3 &&
      txSymbol === existingSymbol &&
      Math.abs(txQuantity - existingQuantity) <= 0.01 &&
      Math.abs(txPrice - existingPrice) <= 0.01
    );
  });
}

export function formatDividendDuplicateMessage(args: {
  symbol: string;
  payDate: string;
  totalBook: number;
  bookCurrency: 'USD' | 'SAR';
}): string {
  const sym = args.symbol.trim().toUpperCase();
  const day = payDateKey(args.payDate);
  return `A dividend for ${sym} on ${day} for ${roundMoney(args.totalBook).toLocaleString()} ${args.bookCurrency} is already recorded. Edit the existing row or use a different date/amount.`;
}

export function assertDividendNotDuplicate(args: Parameters<typeof dividendAlreadyRecorded>[0]): void {
  if (dividendAlreadyRecorded(args)) {
    throw new Error(
      formatDividendDuplicateMessage({
        symbol: args.symbol,
        payDate: args.payDate,
        totalBook: args.totalBook,
        bookCurrency: args.bookCurrency,
      }),
    );
  }
}

export function validateDividendRecordInput(input: {
  symbol?: string;
  date?: string;
  total?: unknown;
  portfolioId?: string;
  accountId?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const sym = String(input.symbol ?? '').trim().toUpperCase();
  if (!sym || sym === 'CASH') errors.push('Symbol is required for dividend entries.');

  const day = payDateKey(String(input.date ?? ''));
  if (!day || day.length < 10) errors.push('Payment date is required (YYYY-MM-DD).');
  else {
    const y = Number(day.slice(0, 4));
    if (!Number.isFinite(y) || y < 1990 || y > 2100) errors.push('Payment date year must be between 1990 and 2100.');
  }

  const total = Number(input.total);
  if (!Number.isFinite(total) || total <= 0) errors.push('Dividend cash amount must be a positive number.');

  if (!String(input.portfolioId ?? '').trim()) errors.push('Portfolio is required.');
  if (!String(input.accountId ?? '').trim()) errors.push('Investment platform account is required.');

  return { valid: errors.length === 0, errors };
}

export function validateDividendPlanOverride(input: {
  annualSar?: unknown;
  yieldPct?: unknown;
}): { valid: boolean; errors: string[]; annualSar: number | null; yieldPct: number | null } {
  const errors: string[] = [];
  let annualSar: number | null = null;
  let yieldPct: number | null = null;

  const annualRaw = input.annualSar;
  if (annualRaw !== '' && annualRaw != null && String(annualRaw).trim() !== '') {
    const a = Number(annualRaw);
    if (!Number.isFinite(a) || a < 0) errors.push('Expected annual amount must be zero or a positive number.');
    else if (a > DIVIDEND_MAX_ANNUAL_SAR) errors.push('Expected annual amount is too large.');
    else annualSar = roundMoney(a);
  }

  const yieldRaw = input.yieldPct;
  if (yieldRaw !== '' && yieldRaw != null && String(yieldRaw).trim() !== '') {
    const y = Number(yieldRaw);
    if (!Number.isFinite(y) || y <= 0 || y > DIVIDEND_MAX_YIELD_PCT) {
      errors.push(`Yield must be between 0 and ${DIVIDEND_MAX_YIELD_PCT}%.`);
    } else yieldPct = Math.round(y * 100) / 100;
  }

  return { valid: errors.length === 0, errors, annualSar, yieldPct };
}

/** Mark rows that duplicate each other within the same paste/import batch. */
export function flagBatchDuplicateDividendRows<T extends {
  portfolioId?: string;
  accountId?: string;
  symbol: string;
  date: string;
  total: number;
  currency: 'USD' | 'SAR';
  duplicate?: boolean;
  batchDuplicate?: boolean;
  resolveError?: string;
}>(rows: T[], accounts?: Account[]): T[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    if (row.resolveError || row.duplicate || !row.portfolioId || !row.accountId) return row;
    const key = buildDividendDedupeKey(
      {
        portfolioId: row.portfolioId,
        accountId: row.accountId,
        symbol: row.symbol,
        payDate: row.date,
        totalBook: row.total,
        bookCurrency: row.currency,
      },
      accounts,
    );
    if (seen.has(key)) {
      return { ...row, batchDuplicate: true, duplicate: true };
    }
    seen.add(key);
    return row;
  });
}
