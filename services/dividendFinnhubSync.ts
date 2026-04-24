import type { Account, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { fetchStockDividendHistory, type StockDividendPayment, getExchangeAndCurrencyForSymbol } from './finnhubService';
import { resolveCanonicalAccountId } from '../utils/investmentLedgerCurrency';
import { getInvestmentTransactionCashAmount } from '../utils/investmentTransactionCash';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { fromSAR, toSAR } from '../utils/currencyMath';
import { roundMoney } from '../utils/money';

const SKIP_SYMBOL = /^(BTC|ETH|BINANCE:|XAU_|XAG_|CASH)$/i;

function paymentCurrencyForSymbol(symbol: string, payment: StockDividendPayment): 'USD' | 'SAR' {
  const ex = getExchangeAndCurrencyForSymbol(symbol);
  if (ex?.currency === 'SAR') return 'SAR';
  return payment.currency;
}

function toPortfolioBookAmount(
  amount: number,
  from: 'USD' | 'SAR',
  book: 'USD' | 'SAR',
  sarPerUsd: number,
  sarPerUsdForDay?: (dayKey: string) => number,
  dayKey?: string,
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (from === book) return roundMoney(amount);
  const r = typeof sarPerUsdForDay === 'function' && dayKey ? sarPerUsdForDay(dayKey) : sarPerUsd;
  if (from === 'USD' && book === 'SAR') return roundMoney(toSAR(amount, 'USD', r));
  return roundMoney(fromSAR(amount, 'USD', r));
}

export function dividendAlreadyRecorded(args: {
  transactions: InvestmentTransaction[];
  accounts: Account[];
  accountId: string;
  symbol: string;
  payDate: string;
  totalBook: number;
  bookCurrency: 'USD' | 'SAR';
}): boolean {
  const canon = resolveCanonicalAccountId(args.accountId, args.accounts);
  const day = payDateKey(args.payDate);
  const sym = args.symbol.trim().toUpperCase();
  for (const t of args.transactions) {
    if (t.type !== 'dividend') continue;
    if ((t.symbol || '').trim().toUpperCase() !== sym) continue;
    if (payDateKey(t.date) !== day) continue;
    const tac = resolveCanonicalAccountId(t.accountId, args.accounts);
    if (tac !== canon) continue;
    const cur = t.currency === 'SAR' || t.currency === 'USD' ? t.currency : args.bookCurrency;
    const a = getInvestmentTransactionCashAmount(t as any);
    const b = args.totalBook;
    if (cur === args.bookCurrency && Math.abs(a - b) < 0.05) return true;
  }
  return false;
}

function payDateKey(iso: string): string {
  return String(iso || '').slice(0, 10);
}

export interface DividendSyncHoldingRow {
  symbol: string;
  quantity: number;
  portfolioId: string;
  accountId: string;
}

/** One row per portfolio + symbol with consolidated quantity (avoids double-counting duplicate lot lines). */
export function listDividendEligibleHoldings(portfolios: InvestmentPortfolio[]): DividendSyncHoldingRow[] {
  const map = new Map<string, DividendSyncHoldingRow>();
  for (const p of portfolios) {
    const accountRaw = (p.accountId ?? (p as { account_id?: string }).account_id ?? '').trim();
    if (!accountRaw) continue;
    for (const h of p.holdings ?? []) {
      const sym = String(h.symbol ?? '').trim().toUpperCase();
      if (!sym || SKIP_SYMBOL.test(sym)) continue;
      if ((h.holdingType ?? '') === 'manual_fund') continue;
      const qty = Number(h.quantity) || 0;
      if (!(qty > 0)) continue;
      const key = `${p.id}\0${sym}`;
      const prev = map.get(key);
      if (prev) prev.quantity += qty;
      else map.set(key, { symbol: sym, quantity: qty, portfolioId: p.id, accountId: accountRaw });
    }
  }
  return [...map.values()];
}

export interface SyncFinnhubDividendsParams {
  portfolios: InvestmentPortfolio[];
  investmentTransactions: InvestmentTransaction[];
  accounts: Account[];
  /** Finnhub `from` date YYYY-MM-DD */
  fromIso: string;
  /** Finnhub `to` date YYYY-MM-DD */
  toIso: string;
  sarPerUsd: number;
  /** Optional: use a dated SAR/USD rate per pay date when converting USD payments into SAR-book portfolios. */
  sarPerUsdForDay?: (dayKey: string) => number;
  recordDividend: (args: {
    portfolioId: string;
    accountId: string;
    symbol: string;
    date: string;
    total: number;
    currency: 'USD' | 'SAR';
  }) => Promise<void>;
}

/**
 * Fetches historical dividends from Finnhub and records `dividend` investment transactions
 * (one per payment × portfolio position). Dedupes against existing ledger rows.
 */
export async function syncFinnhubDividendsForHoldings(
  params: SyncFinnhubDividendsParams,
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const rows = listDividendEligibleHoldings(params.portfolios);
  const bySymbol = new Map<string, DividendSyncHoldingRow[]>();
  for (const r of rows) {
    const list = bySymbol.get(r.symbol) ?? [];
    list.push(r);
    bySymbol.set(r.symbol, list);
  }

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  const insertedThisRun = new Set<string>();

  for (const [symbol, positions] of bySymbol.entries()) {
    let payments: StockDividendPayment[] = [];
    try {
      payments = await fetchStockDividendHistory(symbol, params.fromIso, params.toIso);
    } catch (e) {
      errors.push(`${symbol}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (payments.length === 0) continue;

    for (const pos of positions) {
      const portfolio = params.portfolios.find((p) => p.id === pos.portfolioId);
      if (!portfolio) continue;
      const book: 'USD' | 'SAR' = resolveInvestmentPortfolioCurrency(portfolio);

      for (const pay of payments) {
        const payCur = paymentCurrencyForSymbol(symbol, pay);
        const gross = pay.amountPerShare * pos.quantity;
        const dayKey = payDateKey(pay.payDate);
        const totalBook = toPortfolioBookAmount(gross, payCur, book, params.sarPerUsd, params.sarPerUsdForDay, dayKey);
        if (!(totalBook > 0)) continue;

        const canonAcc = resolveCanonicalAccountId(pos.accountId, params.accounts);
        const runKey = `${canonAcc}|${symbol}|${payDateKey(pay.payDate)}|${book}|${totalBook.toFixed(4)}`;
        if (insertedThisRun.has(runKey)) {
          skipped += 1;
          continue;
        }
        if (
          dividendAlreadyRecorded({
            transactions: params.investmentTransactions,
            accounts: params.accounts,
            accountId: canonAcc,
            symbol,
            payDate: pay.payDate,
            totalBook,
            bookCurrency: book,
          })
        ) {
          skipped += 1;
          continue;
        }

        try {
          await params.recordDividend({
            portfolioId: pos.portfolioId,
            accountId: pos.accountId,
            symbol,
            date: pay.payDate,
            total: totalBook,
            currency: book,
          });
          created += 1;
          insertedThisRun.add(runKey);
        } catch (e) {
          errors.push(`${symbol} ${pay.payDate}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  return { created, skipped, errors };
}

export function defaultDividendSyncWindow(): { fromIso: string; toIso: string } {
  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - 5);
  return {
    fromIso: from.toISOString().slice(0, 10),
    toIso: to.toISOString().slice(0, 10),
  };
}
