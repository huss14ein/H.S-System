import { describe, it, expect } from 'vitest';
import { holdingBookValueForZakat, summarizeZakatableInvestmentsForZakat } from '../services/zakatInvestmentValuation';
import { getPortfolioHoldingsValueInSAR } from '../utils/currencyMath';
import type { Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';

describe('zakatInvestmentValuation', () => {
  it('infers SAR book currency for Tadawul symbols when portfolio.currency missing', () => {
    const p: InvestmentPortfolio = {
      id: 'p1',
      name: 'Local',
      accountId: 'a1',
      holdings: [
        {
          id: 'h1',
          symbol: '2222.SR',
          quantity: 10,
          avgCost: 30,
          currentValue: 350,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
        } as Holding,
      ],
    };
    const { totalSar, lines } = summarizeZakatableInvestmentsForZakat([p], 3.75);
    expect(lines[0]?.bookCurrency).toBe('SAR');
    expect(totalSar).toBe(350);
    expect(lines[0]?.grossValueSar).toBe(350);
    expect(lines[0]?.zakatableValueSar).toBe(350);
  });

  it('uses cost basis when currentValue is zero', () => {
    const p: InvestmentPortfolio = {
      id: 'p1',
      name: 'Book',
      accountId: 'a1',
      currency: 'USD',
      holdings: [
        {
          id: 'h1',
          symbol: 'VOO',
          quantity: 2,
          avgCost: 400,
          currentValue: 0,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
        } as Holding,
      ],
    };
    expect(holdingBookValueForZakat(p.holdings[0]!)).toBe(800);
    const { totalSar } = summarizeZakatableInvestmentsForZakat([p], 4);
    expect(totalSar).toBe(3200);
  });

  it('includes holdings with missing zakahClass (defaults zakatable)', () => {
    const p: InvestmentPortfolio = {
      id: 'p1',
      name: 'X',
      accountId: 'a1',
      currency: 'SAR',
      holdings: [
        {
          id: 'h1',
          symbol: 'XYZ',
          quantity: 1,
          avgCost: 100,
          currentValue: 100,
          realizedPnL: 0,
        } as Holding,
      ],
    };
    const { totalSar, lines } = summarizeZakatableInvestmentsForZakat([p], 3.75);
    expect(lines).toHaveLength(1);
    expect(totalSar).toBe(100);
  });

  it('getPortfolioHoldingsValueInSAR uses inferred SAR when portfolio.currency is unset (Tadawul symbols)', () => {
    const p: InvestmentPortfolio = {
      id: 'p1',
      name: 'Tadawul',
      accountId: 'a1',
      holdings: [
        {
          id: 'h1',
          symbol: '2222.SR',
          quantity: 10,
          avgCost: 30,
          currentValue: 350,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
        } as Holding,
      ],
    };
    expect(getPortfolioHoldingsValueInSAR(p, 3.75)).toBe(350);
  });

  it('excludes Non-Zakatable and respects zakah_class from API shape', () => {
    const p: InvestmentPortfolio = {
      id: 'p1',
      name: 'X',
      accountId: 'a1',
      currency: 'SAR',
      holdings: [
        { id: 'a', symbol: 'A', quantity: 1, avgCost: 10, currentValue: 10, realizedPnL: 0, zakah_class: 'Non-Zakatable' } as any,
        { id: 'b', symbol: 'B', quantity: 1, avgCost: 20, currentValue: 20, realizedPnL: 0, zakahClass: 'Zakatable' } as Holding,
      ],
    };
    const { totalSar, lines } = summarizeZakatableInvestmentsForZakat([p], 3.75);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.symbol).toBe('B');
    expect(totalSar).toBe(20);
  });

  it('defers zakatable amount until hawl when earliest buy is recent', () => {
    const asOf = new Date('2030-06-15T12:00:00.000Z');
    const p: InvestmentPortfolio = {
      id: 'p1',
      name: 'X',
      accountId: 'a1',
      currency: 'SAR',
      holdings: [
        {
          id: 'h1',
          symbol: 'AAA',
          quantity: 1,
          avgCost: 100,
          currentValue: 100,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
        } as Holding,
      ],
    };
    const txs: InvestmentTransaction[] = [
      {
        id: 't1',
        accountId: 'a1',
        portfolioId: 'p1',
        date: '2030-04-01',
        type: 'buy',
        symbol: 'AAA',
        quantity: 1,
        price: 100,
        total: 100,
        currency: 'SAR',
      },
    ];
    const { totalSar, lines } = summarizeZakatableInvestmentsForZakat([p], 3.75, txs, asOf);
    expect(lines[0]?.hawlSource).toBe('buy');
    expect(lines[0]?.zakatableValueSar).toBe(0);
    expect(totalSar).toBe(0);
  });

  it('counts zakatable amount after hawl when earliest buy is old enough', () => {
    const asOf = new Date('2030-06-15T12:00:00.000Z');
    const p: InvestmentPortfolio = {
      id: 'p1',
      name: 'X',
      accountId: 'a1',
      currency: 'SAR',
      holdings: [
        {
          id: 'h1',
          symbol: 'BBB',
          quantity: 1,
          avgCost: 100,
          currentValue: 100,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
        } as Holding,
      ],
    };
    const txs: InvestmentTransaction[] = [
      {
        id: 't1',
        accountId: 'a1',
        portfolioId: 'p1',
        date: '2028-01-01',
        type: 'buy',
        symbol: 'BBB',
        quantity: 1,
        price: 100,
        total: 100,
        currency: 'SAR',
      },
    ];
    const { totalSar, lines } = summarizeZakatableInvestmentsForZakat([p], 3.75, txs, asOf);
    expect(lines[0]?.zakatableValueSar).toBe(100);
    expect(totalSar).toBe(100);
  });
});
