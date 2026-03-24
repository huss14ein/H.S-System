/**
 * Zakat investment totals: same book-currency rules as Investments (Tadawul → SAR, legacy rows),
 * zakah classification from camelCase or snake_case DB fields, and value fallback when currentValue is stale.
 */

import type { Holding, InvestmentPortfolio, TradeCurrency } from '../types';
import { toSAR } from '../utils/currencyMath';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';

export type ZakatInvestmentLine = {
  portfolioId: string;
  portfolioName: string;
  symbol: string;
  name?: string;
  bookCurrency: TradeCurrency;
  bookValue: number;
  valueSar: number;
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
 */
export function summarizeZakatableInvestmentsForZakat(
  portfolios: InvestmentPortfolio[],
  sarPerUsd: number,
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
      const valueSar = toSAR(bookValue, bookCurrency, sarPerUsd);
      totalSar += valueSar;
      lines.push({
        portfolioId: p.id,
        portfolioName: p.name,
        symbol: String(h.symbol ?? '—').trim() || '—',
        name: h.name,
        bookCurrency,
        bookValue,
        valueSar,
      });
    }
  }

  return { totalSar, lines };
}
