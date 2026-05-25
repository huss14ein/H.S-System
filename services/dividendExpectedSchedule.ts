/**
 * Expected dividend schedule helpers (plan layer — not ledger cash).
 */

import type { Account, FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { investmentTransactionCashAmountSarDated } from '../utils/investmentTransactionSar';

export type DividendCadence = 'none' | 'monthly' | 'quarterly' | 'annual' | 'reinvest';

export interface UpcomingDividendPayout {
  portfolioId: string;
  portfolioName: string;
  symbol: string;
  name: string;
  payDate: string;
  amountSar: number;
  cadence: DividendCadence;
}

export function inferDividendCadence(
  holding: Pick<Holding, 'dividendDistribution' | 'dividendPayoutCadence'>,
): DividendCadence {
  const explicit = holding.dividendPayoutCadence;
  if (
    explicit === 'none' ||
    explicit === 'monthly' ||
    explicit === 'quarterly' ||
    explicit === 'annual' ||
    explicit === 'reinvest'
  ) {
    return explicit;
  }
  if (holding.dividendDistribution === 'Reinvest') return 'reinvest';
  if (holding.dividendDistribution === 'Payout') return 'quarterly';
  return 'quarterly';
}

/** Infer usual payout months (1–12) from dividend ledger history for a holding. */
export function inferTypicalPayoutMonthsFromLedger(args: {
  dividendTransactions: InvestmentTransaction[];
  portfolioId: string;
  symbol: string;
  maxMonths?: number;
}): number[] {
  const sym = args.symbol.trim().toUpperCase();
  const pid = args.portfolioId.trim();
  const counts = new Map<number, number>();
  for (const t of args.dividendTransactions) {
    if (t.type !== 'dividend') continue;
    if ((t.symbol || '').trim().toUpperCase() !== sym) continue;
    const txPid = String(t.portfolioId ?? (t as { portfolio_id?: string }).portfolio_id ?? '').trim();
    if (txPid && txPid !== pid) continue;
    const d = new Date(t.date);
    if (isNaN(d.getTime())) continue;
    const m = d.getMonth() + 1;
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const max = args.maxMonths ?? 4;
  return ranked.slice(0, max).map(([m]) => m);
}

export function effectivePayoutMonths(holding: Pick<Holding, 'typicalPayoutMonths'>): number[] {
  const user = holding.typicalPayoutMonths?.filter((m) => m >= 1 && m <= 12) ?? [];
  if (user.length > 0) return [...user].sort((a, b) => a - b);
  return [];
}

export function cadenceLabel(cadence: DividendCadence): string {
  switch (cadence) {
    case 'reinvest':
      return 'Reinvest (no cash schedule)';
    case 'annual':
      return 'Annual';
    case 'quarterly':
      return 'Quarterly (est.)';
    default:
      return 'Not set';
  }
}

/** Calendar-quarter index 0–3 for a date. */
export function calendarQuarterIndex(d: Date): number {
  return Math.floor(d.getMonth() / 3);
}

export function receivedQuartersYtdSar(args: {
  dividendTransactions: InvestmentTransaction[];
  portfolioId: string;
  symbol: string;
  accounts: Account[];
  portfolios: InvestmentPortfolio[];
  data: FinancialData | null;
  uiExchangeRate: number;
  year: number;
}): [number, number, number, number] {
  const sym = args.symbol.trim().toUpperCase();
  const pid = args.portfolioId.trim();
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (const t of args.dividendTransactions) {
    if (t.type !== 'dividend') continue;
    if ((t.symbol || '').trim().toUpperCase() !== sym) continue;
    const txPid = String(t.portfolioId ?? (t as { portfolio_id?: string }).portfolio_id ?? '').trim();
    if (txPid && txPid !== pid) continue;
    const d = new Date(t.date);
    if (isNaN(d.getTime()) || d.getFullYear() !== args.year) continue;
    const q = calendarQuarterIndex(d);
    out[q] += investmentTransactionCashAmountSarDated({
      tx: t,
      accounts: args.accounts,
      portfolios: args.portfolios,
      data: args.data,
      uiExchangeRate: args.uiExchangeRate,
    });
  }
  return out;
}

/** Typical ex-div months (US-style); Tadawul may differ — label as estimate. */
const QUARTER_END_MONTHS = [2, 5, 8, 11]; // Mar, Jun, Sep, Dec (0-indexed month)

export function nextEstimatedPayoutDates(args: {
  cadence: DividendCadence;
  typicalMonths?: number[];
  now?: Date;
  count?: number;
}): string[] {
  const now = args.now ?? new Date();
  const count = args.count ?? 4;
  if (args.cadence === 'none' || args.cadence === 'reinvest') return [];

  const dates: string[] = [];
  const y = now.getFullYear();
  const userMonths = (args.typicalMonths ?? []).filter((m) => m >= 1 && m <= 12);

  const pushFromMonths = (months: number[], yearsAhead: number) => {
    for (let addYear = 0; addYear <= yearsAhead && dates.length < count; addYear++) {
      for (const m of months) {
        const d = new Date(y + addYear, m - 1, 28);
        if (d >= now) dates.push(d.toISOString().slice(0, 10));
        if (dates.length >= count) break;
      }
    }
  };

  if (userMonths.length > 0) {
    pushFromMonths(userMonths, 1);
    return dates.slice(0, count);
  }

  if (args.cadence === 'annual') {
    const d = new Date(y, 11, 28);
    if (d >= now) dates.push(d.toISOString().slice(0, 10));
    else dates.push(new Date(y + 1, 11, 28).toISOString().slice(0, 10));
    return dates.slice(0, count);
  }

  if (args.cadence === 'monthly') {
    for (let i = 0; i < count; i++) {
      const d = new Date(y, now.getMonth() + i, 28);
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }

  for (let addYear = 0; addYear <= 1 && dates.length < count; addYear++) {
    for (const m of QUARTER_END_MONTHS) {
      const d = new Date(y + addYear, m, 28);
      if (d >= now) dates.push(d.toISOString().slice(0, 10));
      if (dates.length >= count) break;
    }
  }
  return dates.slice(0, count);
}

export function buildUpcomingDividendPayouts(args: {
  holdingRows: Array<{
    portfolioId: string;
    portfolioName: string;
    symbol: string;
    name: string;
    expectedAnnualSar: number;
    dividendDistribution?: 'Reinvest' | 'Payout';
    dividendPayoutCadence?: Holding['dividendPayoutCadence'];
    typicalPayoutMonths?: number[];
  }>;
  now?: Date;
  horizonDays?: number;
  maxItems?: number;
}): UpcomingDividendPayout[] {
  const now = args.now ?? new Date();
  const horizon = args.horizonDays ?? 120;
  const maxItems = args.maxItems ?? 12;
  const horizonEnd = new Date(now.getTime() + horizon * 86400000);
  const items: UpcomingDividendPayout[] = [];

  for (const row of args.holdingRows) {
    if (!(row.expectedAnnualSar > 0.01)) continue;
    const cadence = inferDividendCadence({
      dividendDistribution: row.dividendDistribution,
      dividendPayoutCadence: row.dividendPayoutCadence,
    });
    if (cadence === 'reinvest' || cadence === 'none') continue;

    const perPayment =
      cadence === 'annual'
        ? row.expectedAnnualSar
        : cadence === 'monthly'
          ? row.expectedAnnualSar / 12
          : row.expectedAnnualSar / 4;
    const dates = nextEstimatedPayoutDates({
      cadence,
      typicalMonths: row.typicalPayoutMonths,
      now,
      count: 4,
    });
    for (const payDate of dates) {
      const d = new Date(payDate);
      if (d > horizonEnd) continue;
      items.push({
        portfolioId: row.portfolioId,
        portfolioName: row.portfolioName,
        symbol: row.symbol,
        name: row.name,
        payDate,
        amountSar: perPayment,
        cadence,
      });
    }
  }

  items.sort((a, b) => a.payDate.localeCompare(b.payDate) || b.amountSar - a.amountSar);
  return items.slice(0, maxItems);
}

export function aggregateQuarterlyYtd(args: {
  holdingRows: Array<{ expectedAnnualSar: number; receivedQuartersYtd: [number, number, number, number] }>;
}): {
  expectedPerQuarter: number;
  receivedByQuarter: [number, number, number, number];
} {
  const receivedByQuarter: [number, number, number, number] = [0, 0, 0, 0];
  let expectedAnnual = 0;
  for (const r of args.holdingRows) {
    expectedAnnual += r.expectedAnnualSar;
    for (let q = 0; q < 4; q++) receivedByQuarter[q] += r.receivedQuartersYtd[q];
  }
  const expectedPerQuarter = expectedAnnual > 0 ? expectedAnnual / 4 : 0;
  return { expectedPerQuarter, receivedByQuarter };
}
