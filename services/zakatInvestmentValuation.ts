/**
 * Zakat investment totals: same book-currency rules as Investments (Tadawul → SAR, legacy rows),
 * zakah classification from camelCase or snake_case DB fields, and value fallback when currentValue is stale.
 * Lunar hawl (~354d) reduces zakatable amount unless acquisition date or earliest buy resolves the start.
 */

import type { CommodityHolding, Holding, InvestmentPortfolio, InvestmentTransaction, TradeCurrency } from '../types';
import { toSAR } from '../utils/currencyMath';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import {
  evaluateHawlEligibility,
  resolveCommodityHawlStart,
  resolveInvestmentHawlStart,
} from './zakatHawl';

export type ZakatInvestmentLine = {
  portfolioId: string;
  portfolioName: string;
  symbol: string;
  name?: string;
  bookCurrency: TradeCurrency;
  bookValue: number;
  /** Full position value in SAR (before hawl). */
  grossValueSar: number;
  /** Amount counted toward Zakat after hawl (≤ grossValueSar). */
  zakatableValueSar: number;
  hawlEligible: boolean;
  hawlLabel: string;
  hawlSource: 'manual' | 'buy' | 'none';
  effectiveAcquisitionDate: string | null;
};

function holdingZakahClassification(h: Holding & { zakah_class?: string }): 'Zakatable' | 'Non-Zakatable' {
  const z = h.zakahClass ?? h.zakah_class;
  return z === 'Non-Zakatable' ? 'Non-Zakatable' : 'Zakatable';
}

/** Prefer current market value; else cost basis (quantity × avg cost) in portfolio book currency. */
export function holdingBookValueForZakat(h: Holding): number {
  const cv = Number(h.currentValue);
  if (Number.isFinite(cv) && cv > 0) return cv;
  const q = Number(h.quantity) || 0;
  const ac = Number(h.avgCost) || 0;
  const implied = q * ac;
  return Number.isFinite(implied) && implied > 0 ? implied : 0;
}

/**
 * Sum zakatable holdings across portfolios, converting each line to SAR with the resolved portfolio currency.
 * Applies lunar hawl when acquisition date or earliest buy is known; otherwise keeps legacy “count full value” behavior.
 */
export function summarizeZakatableInvestmentsForZakat(
  portfolios: InvestmentPortfolio[],
  sarPerUsd: number,
  investmentTransactions?: InvestmentTransaction[],
  asOf: Date = new Date(),
): { totalSar: number; lines: ZakatInvestmentLine[] } {
  const lines: ZakatInvestmentLine[] = [];
  let totalSar = 0;

  for (const p of portfolios) {
    const bookCurrency = resolveInvestmentPortfolioCurrency(p);
    for (const raw of p.holdings ?? []) {
      const h = raw as Holding & { zakah_class?: string };
      if (holdingZakahClassification(h) === 'Non-Zakatable') continue;
      const bookValue = holdingBookValueForZakat(h);
      if (bookValue <= 0) continue;
      const grossValueSar = toSAR(bookValue, bookCurrency, sarPerUsd);
      const hawl = resolveInvestmentHawlStart(h, p.id, investmentTransactions);
      // Strict hawl: if we cannot infer a start date, do not count the position yet.
      const elig = evaluateHawlEligibility(hawl.startDate, asOf, false);
      const zakatableValueSar = elig.eligible ? grossValueSar : 0;
      totalSar += zakatableValueSar;
      lines.push({
        portfolioId: p.id,
        portfolioName: p.name,
        symbol: String(h.symbol ?? '—').trim() || '—',
        name: h.name,
        bookCurrency,
        bookValue,
        grossValueSar,
        zakatableValueSar,
        hawlEligible: elig.eligible,
        hawlLabel: elig.label,
        hawlSource: hawl.source,
        effectiveAcquisitionDate: hawl.startDate,
      });
    }
  }

  return { totalSar, lines };
}

export type ZakatCommodityLine = {
  id: string;
  name: string;
  symbol: string;
  grossValueSar: number;
  zakatableValueSar: number;
  hawlEligible: boolean;
  hawlLabel: string;
  hawlSource: 'manual' | 'created' | 'none';
  effectiveAcquisitionDate: string | null;
};

/** Commodity values are already in SAR in the app model. */
export function summarizeZakatableCommoditiesForZakat(
  holdings: CommodityHolding[],
  asOf: Date = new Date(),
): { totalSar: number; lines: ZakatCommodityLine[] } {
  const lines: ZakatCommodityLine[] = [];
  let totalSar = 0;
  for (const raw of holdings) {
    const c = raw as CommodityHolding & { zakah_class?: string };
    const z = c.zakahClass ?? c.zakah_class;
    if (z === 'Non-Zakatable') continue;
    const gross = Number(c.currentValue);
    if (!Number.isFinite(gross) || gross <= 0) continue;
    const hawl = resolveCommodityHawlStart(c);
    // Strict hawl: if we cannot infer a start date, do not count the lot yet.
    const elig = evaluateHawlEligibility(hawl.startDate, asOf, false);
    const zakatableValueSar = elig.eligible ? gross : 0;
    totalSar += zakatableValueSar;
    lines.push({
      id: c.id,
      name: c.name,
      symbol: c.symbol,
      grossValueSar: gross,
      zakatableValueSar,
      hawlEligible: elig.eligible,
      hawlLabel: elig.label,
      hawlSource: hawl.source,
      effectiveAcquisitionDate: hawl.startDate,
    });
  }
  return { totalSar, lines };
}
