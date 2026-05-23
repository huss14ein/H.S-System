import { describe, expect, it } from 'vitest';
import {
  buildDividendDedupeKey,
  dividendAlreadyRecorded,
  flagBatchDuplicateDividendRows,
  isInvestmentLedgerDuplicate,
  resolveDividendBookCurrency,
  validateDividendPlanOverride,
  validateDividendRecordInput,
} from '../services/dividendLedgerGuards';

describe('dividendLedgerGuards', () => {
  const accounts = [{ id: 'acc1', name: 'Broker', type: 'Investment' as const, balance: 0 }];

  it('validateDividendRecordInput rejects missing fields', () => {
    const r = validateDividendRecordInput({ symbol: '', total: 0 });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('dividendAlreadyRecorded respects portfolioId', () => {
    const txs = [
      {
        id: '1',
        accountId: 'acc1',
        portfolioId: 'p1',
        date: '2024-06-01',
        type: 'dividend' as const,
        symbol: 'AAPL',
        quantity: 0,
        price: 0,
        total: 10,
        currency: 'USD' as const,
      },
    ];
    expect(
      dividendAlreadyRecorded({
        transactions: txs,
        accounts,
        accountId: 'acc1',
        symbol: 'AAPL',
        payDate: '2024-06-01',
        totalBook: 10,
        bookCurrency: 'USD',
        portfolioId: 'p1',
      }),
    ).toBe(true);
    expect(
      dividendAlreadyRecorded({
        transactions: txs,
        accounts,
        accountId: 'acc1',
        symbol: 'AAPL',
        payDate: '2024-06-01',
        totalBook: 10,
        bookCurrency: 'USD',
        portfolioId: 'p2',
      }),
    ).toBe(false);
  });

  it('resolveDividendBookCurrency infers SAR from Tadawul symbol when currency omitted', () => {
    expect(
      resolveDividendBookCurrency({ symbol: '2222.SR' }),
    ).toBe('SAR');
    expect(
      resolveDividendBookCurrency({ symbol: 'AAPL' }),
    ).toBe('USD');
  });

  it('dividendAlreadyRecorded matches across USD/SAR when amounts are FX-equivalent', () => {
    const portfolios = [{ id: 'p1', currency: 'SAR' as const, holdings: [] }];
    const txs = [
      {
        id: '1',
        accountId: 'acc1',
        portfolioId: 'p1',
        date: '2024-06-01',
        type: 'dividend' as const,
        symbol: 'AAPL',
        quantity: 0,
        price: 0,
        total: 375,
        currency: 'SAR' as const,
      },
    ];
    expect(
      dividendAlreadyRecorded({
        transactions: txs,
        accounts,
        accountId: 'acc1',
        symbol: 'AAPL',
        payDate: '2024-06-01',
        totalBook: 100,
        bookCurrency: 'USD',
        portfolioId: 'p1',
        portfolios,
        sarPerUsd: 3.75,
      }),
    ).toBe(true);
  });

  it('isInvestmentLedgerDuplicate matches SAR ledger when candidate omits currency and uses USD book inference', () => {
    const portfolios = [{ id: 'p1', currency: 'SAR' as const, holdings: [{ id: 'h', symbol: '2222.SR', name: 'S', quantity: 1, averageCost: 1 }] }];
    const txs = [
      {
        id: '1',
        accountId: 'acc1',
        portfolioId: 'p1',
        date: '2024-06-01',
        type: 'dividend' as const,
        symbol: '2222.SR',
        quantity: 0,
        price: 0,
        total: 500,
        currency: 'SAR' as const,
      },
    ];
    expect(
      isInvestmentLedgerDuplicate({
        tx: {
          type: 'dividend',
          accountId: 'acc1',
          date: '2024-06-01',
          symbol: '2222.SR',
          total: 500,
        },
        existingTransactions: txs,
        accounts,
        portfolios,
        sarPerUsd: 3.75,
      }),
    ).toBe(true);
  });

  it('isInvestmentLedgerDuplicate matches SAR ledger row when import row omits currency', () => {
    const portfolios = [{ id: 'p1', currency: 'SAR' as const, holdings: [] }];
    const txs = [
      {
        id: '1',
        accountId: 'acc1',
        portfolioId: 'p1',
        date: '2024-06-01',
        type: 'dividend' as const,
        symbol: '2222.SR',
        quantity: 0,
        price: 0,
        total: 500,
        currency: 'SAR' as const,
      },
    ];
    expect(
      isInvestmentLedgerDuplicate({
        tx: {
          type: 'dividend',
          accountId: 'acc1',
          portfolioId: 'p1',
          date: '2024-06-01',
          symbol: '2222.SR',
          total: 500,
        },
        existingTransactions: txs,
        accounts,
        portfolios,
      }),
    ).toBe(true);
  });

  it('buildDividendDedupeKey canonicalizes account aliases', () => {
    const accounts = [
      { id: 'acc-canonical', name: 'Broker', type: 'Investment' as const, balance: 0, account_id: 'legacy-ext' },
    ];
    const withAlias = buildDividendDedupeKey(
      {
        portfolioId: 'p1',
        accountId: 'legacy-ext',
        symbol: 'XOM',
        payDate: '2024-01-01',
        totalBook: 50,
        bookCurrency: 'USD',
      },
      accounts,
    );
    const withCanonical = buildDividendDedupeKey(
      {
        portfolioId: 'p1',
        accountId: 'acc-canonical',
        symbol: 'XOM',
        payDate: '2024-01-01',
        totalBook: 50,
        bookCurrency: 'USD',
      },
      accounts,
    );
    expect(withAlias).toBe(withCanonical);
  });

  it('pendingKeys blocks same-batch duplicates', () => {
    const pending = new Set<string>();
    const key = buildDividendDedupeKey({
      portfolioId: 'p1',
      accountId: 'acc1',
      symbol: 'XOM',
      payDate: '2024-01-01',
      totalBook: 50,
      bookCurrency: 'USD',
    });
    pending.add(key);
    expect(
      dividendAlreadyRecorded({
        transactions: [],
        accounts,
        accountId: 'acc1',
        symbol: 'XOM',
        payDate: '2024-01-01',
        totalBook: 50,
        bookCurrency: 'USD',
        portfolioId: 'p1',
        pendingKeys: pending,
      }),
    ).toBe(true);
  });

  it('flagBatchDuplicateDividendRows marks second row', () => {
    const rows = flagBatchDuplicateDividendRows([
      {
        symbol: 'MSFT',
        date: '2024-02-01',
        total: 20,
        currency: 'USD' as const,
        portfolioId: 'p1',
        accountId: 'acc1',
        description: '',
        confidence: 'high' as const,
      },
      {
        symbol: 'MSFT',
        date: '2024-02-01',
        total: 20,
        currency: 'USD' as const,
        portfolioId: 'p1',
        accountId: 'acc1',
        description: '',
        confidence: 'high' as const,
      },
    ]);
    expect(rows[1].batchDuplicate).toBe(true);
    expect(rows[1].duplicate).toBe(true);
  });

  it('validateDividendPlanOverride clamps invalid yield', () => {
    const r = validateDividendPlanOverride({ yieldPct: 150 });
    expect(r.valid).toBe(false);
    const ok = validateDividendPlanOverride({ annualSar: 12000, yieldPct: 4.5 });
    expect(ok.valid).toBe(true);
    expect(ok.annualSar).toBe(12000);
    expect(ok.yieldPct).toBe(4.5);
  });
});
