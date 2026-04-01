import type { FinancialData } from '../types';
import { toSAR, resolveSarPerUsd } from '../utils/currencyMath';
import { isInvestmentTransactionType } from '../utils/investmentTransactionType';
import { getSarPerUsdForCalendarDay } from './fxDailySeries';

/**
 * Simple money-weighted return (IRR) via bisection on periodic cashflows.
 * cashflows: negative = invest, positive = withdraw/terminal value.
 * Not a substitute for audited performance; document limitations.
 */
export function approximatePortfolioMWRR(
  flows: { date: string; amount: number }[],
  terminalValue: number,
  terminalDate: string
): number | null {
  if (flows.length === 0 && terminalValue <= 0) return null;
  const all = [...flows, { date: terminalDate, amount: terminalValue }];
  const t0 = new Date(all.reduce((m, f) => Math.min(m, new Date(f.date).getTime()), Infinity)).getTime();
  const days = (d: string) => (new Date(d).getTime() - t0) / 86400000;
  const npv = (r: number) => {
    const daily = Math.pow(1 + r, 1 / 365) - 1;
    return all.reduce((s, f) => s + f.amount / Math.pow(1 + daily, days(f.date)), 0);
  };
  let lo = -0.99,
    hi = 10;
  let vlo = npv(lo),
    vhi = npv(hi);
  if (!Number.isFinite(vlo) || !Number.isFinite(vhi)) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const vm = npv(mid);
    if (Math.abs(vm) < 1e-6) return mid * 100;
    if (vm > 0) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 100;
}

export function flowsFromInvestmentTransactions(
  txs: { date: string; type: string; total?: number }[]
): { date: string; amount: number }[] {
  const out: { date: string; amount: number }[] = [];
  txs.forEach((t) => {
    const x = Math.abs(Number(t.total) || 0);
    if (isInvestmentTransactionType(t.type, 'buy') || isInvestmentTransactionType(t.type, 'deposit')) out.push({ date: t.date, amount: -x });
    if (isInvestmentTransactionType(t.type, 'sell') || isInvestmentTransactionType(t.type, 'withdrawal')) out.push({ date: t.date, amount: x });
  });
  return out;
}

/** Same as `flowsFromInvestmentTransactions` but converts each flow to SAR using `currency` (defaults USD), matching `getAllInvestmentsValueInSAR` for MWRR. */
export function flowsFromInvestmentTransactionsInSAR(
  txs: { date: string; type: string; total?: number; currency?: string }[],
  exchangeRate: number
): { date: string; amount: number }[] {
  const out: { date: string; amount: number }[] = [];
  txs.forEach((t) => {
    const x = Math.abs(Number(t.total) || 0);
    const sar = toSAR(x, (t.currency ?? 'USD') as 'USD' | 'SAR', exchangeRate);
    if (isInvestmentTransactionType(t.type, 'buy') || isInvestmentTransactionType(t.type, 'deposit')) out.push({ date: t.date, amount: -sar });
    if (isInvestmentTransactionType(t.type, 'sell') || isInvestmentTransactionType(t.type, 'withdrawal')) out.push({ date: t.date, amount: sar });
    /** Cash dividends are investor inflows (same sign as sell for MWRR math). */
    if (isInvestmentTransactionType(t.type, 'dividend')) out.push({ date: t.date, amount: sar });
  });
  return out;
}

/**
 * Converts each flow to SAR using `getSarPerUsdForCalendarDay` for that transaction’s calendar day
 * (after `hydrateSarPerUsdDailySeries`, so Wealth Ultra / snapshot series align with KPIs).
 */
export function flowsFromInvestmentTransactionsInSARWithDatedFx(
  txs: { date: string; type: string; total?: number; currency?: string }[],
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
): { date: string; amount: number }[] {
  const spot = resolveSarPerUsd(data, uiExchangeRate);
  const out: { date: string; amount: number }[] = [];
  txs.forEach((t) => {
    const x = Math.abs(Number(t.total) || 0);
    const day = (t.date ?? '').slice(0, 10);
    const r = day.length === 10 ? getSarPerUsdForCalendarDay(day, data, uiExchangeRate) : spot;
    const sar = toSAR(x, (t.currency ?? 'USD') as 'USD' | 'SAR', r);
    if (isInvestmentTransactionType(t.type, 'buy') || isInvestmentTransactionType(t.type, 'deposit')) out.push({ date: t.date, amount: -sar });
    if (isInvestmentTransactionType(t.type, 'sell') || isInvestmentTransactionType(t.type, 'withdrawal')) out.push({ date: t.date, amount: sar });
    if (isInvestmentTransactionType(t.type, 'dividend')) out.push({ date: t.date, amount: sar });
  });
  return out;
}
