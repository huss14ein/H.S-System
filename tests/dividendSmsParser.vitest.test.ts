import { describe, expect, it } from 'vitest';
import {
  parseDividendSmsText,
  resolveDividendSmsRows,
  resolvePortfolioForDividendSymbol,
  dividendAmountInBookCurrency,
} from '../services/dividendSmsParser';
import type { Account, FinancialData, InvestmentPortfolio, InvestmentTransaction } from '../types';

describe('parseDividendSmsText', () => {
  it('parses English broker dividend SMS with Tadawul code', () => {
    const sms = `SNBC: Cash dividend SAR 1,250.50 credited for symbol 2222 on 15/03/2026`;
    const res = parseDividendSmsText(sms, ['2222']);
    expect(res.errors).toHaveLength(0);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].symbol).toBe('2222');
    expect(res.rows[0].total).toBeCloseTo(1250.5, 2);
    expect(res.rows[0].currency).toBe('SAR');
    expect(res.rows[0].date).toBe('2026-03-15');
  });

  it('parses Arabic dividend SMS', () => {
    const sms = `تم إيداع توزيع نقدي بمبلغ 500.00 ريال للسهم 1120 بتاريخ 18/04/26`;
    const res = parseDividendSmsText(sms, ['1120']);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].symbol).toBe('1120');
    expect(res.rows[0].total).toBeCloseTo(500, 2);
    expect(res.rows[0].date).toBe('2026-04-18');
  });

  it('parses multiple dividend blocks', () => {
    const sms = `Cash dividend SAR 100 for 2222 on 01/01/26\n\nDividend USD 25.50 AAPL 02/01/26`;
    const res = parseDividendSmsText(sms, ['2222', 'AAPL']);
    expect(res.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('ignores non-dividend purchase SMS', () => {
    const sms = `شراء عبر نقاط البيع SAR مبلغ:5.75 8/4/26`;
    const res = parseDividendSmsText(sms, ['2222']);
    expect(res.rows).toHaveLength(0);
  });

  it('parses dividend SMS without symbol for manual holding pick', () => {
    const sms = `Cash dividend SAR 750.00 credited on 10/05/2026`;
    const res = parseDividendSmsText(sms, ['2222']);
    expect(res.errors).toHaveLength(0);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].symbol).toBe('');
    expect(res.rows[0].symbolMissing).toBe(true);
    expect(res.rows[0].total).toBeCloseTo(750, 2);
  });
});

describe('resolveDividendSmsRows', () => {
  const portfolios: InvestmentPortfolio[] = [
    {
      id: 'pf1',
      name: 'Main',
      accountId: 'inv1',
      currency: 'SAR',
      holdings: [{ id: 'h1', symbol: '2222', quantity: 10, avgCost: 30, currentValue: 300 }],
    },
  ];
  const accounts: Account[] = [{ id: 'inv1', name: 'Derayah', type: 'Investment', balance: 1000, currency: 'SAR' }];

  it('resolves portfolio and flags duplicates', () => {
    const rows = parseDividendSmsText('Dividend SAR 50 for 2222 on 2026-05-01', ['2222']).rows;
    const existing: InvestmentTransaction[] = [
      {
        id: 't1',
        accountId: 'inv1',
        date: '2026-05-01',
        type: 'dividend',
        symbol: '2222',
        quantity: 0,
        price: 0,
        total: 50,
        currency: 'SAR',
      },
    ];
    const resolved = resolveDividendSmsRows({
      rows,
      portfolios,
      accounts,
      investmentTransactions: existing,
    });
    expect(resolved[0].portfolioId).toBe('pf1');
    expect(resolved[0].duplicate).toBe(true);
  });

  it('errors when symbol not in holdings', () => {
    const rows = parseDividendSmsText('Dividend SAR 10 for 9999 on 2026-05-01', []).rows;
    const resolved = resolveDividendSmsRows({
      rows,
      portfolios,
      accounts,
      investmentTransactions: [],
    });
    expect(resolved[0].resolveError).toMatch(/not found|Select a holding/i);
  });

  it('resolves row when user picks holding manually (no symbol in SMS)', () => {
    const rows = parseDividendSmsText('Dividend SAR 80 credited on 2026-06-01', ['2222']).rows;
    expect(rows[0].symbolMissing).toBe(true);
    const holdingOptions = [
      {
        optionKey: 'pf1:h1',
        symbol: '2222',
        name: 'SABIC',
        holdingId: 'h1',
        portfolioId: 'pf1',
        portfolioName: 'Main',
        accountId: 'inv1',
        quantity: 10,
        avgCost: 30,
        bookCurrency: 'SAR' as const,
      },
    ];
    const resolved = resolveDividendSmsRows({
      rows,
      portfolios,
      accounts,
      investmentTransactions: [],
      holdingOverrideByIndex: new Map([[0, 'pf1:h1']]),
      holdingOptions,
    });
    expect(resolved[0].symbol).toBe('2222');
    expect(resolved[0].portfolioId).toBe('pf1');
    expect(resolved[0].resolveError).toBeUndefined();
  });
});

describe('dividendAmountInBookCurrency', () => {
  it('converts USD SMS amount into SAR book currency', () => {
    expect(dividendAmountInBookCurrency(100, 'USD', 'SAR', 3.8)).toBeCloseTo(380, 2);
  });

  it('leaves amount unchanged when SMS currency matches book', () => {
    expect(dividendAmountInBookCurrency(500, 'SAR', 'SAR', 3.75)).toBe(500);
  });
});

describe('resolvePortfolioForDividendSymbol', () => {
  it('prefers portfolio on preferred account', () => {
    const portfolios: InvestmentPortfolio[] = [
      {
        id: 'a',
        name: 'A',
        accountId: 'acc1',
        currency: 'SAR',
        holdings: [{ id: 'h', symbol: '2222', quantity: 1, avgCost: 1, currentValue: 1 }],
      },
      {
        id: 'b',
        name: 'B',
        accountId: 'acc2',
        currency: 'SAR',
        holdings: [{ id: 'h2', symbol: '2222', quantity: 1, avgCost: 1, currentValue: 1 }],
      },
    ];
    const accounts: Account[] = [
      { id: 'acc1', name: 'One', type: 'Investment', balance: 0, currency: 'SAR' },
      { id: 'acc2', name: 'Two', type: 'Investment', balance: 0, currency: 'SAR' },
    ];
    const r = resolvePortfolioForDividendSymbol('2222', portfolios, accounts, 'acc2');
    expect(r?.portfolioId).toBe('b');
  });
});
