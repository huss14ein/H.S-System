import { describe, expect, it } from 'vitest';
import type { Account, InvestmentPortfolio, InvestmentTransaction, Transaction } from '../types';
import {
  computeStatementReviewDuplicates,
  planStatementImport,
  prepareStatementInvestmentRow,
} from '../services/statementImportPrepare';
import { countWillImportDividendSmsRows } from '../services/dividendSmsParser';

const accounts: Account[] = [
  { id: 'acc1', name: 'Platform', type: 'Investment', balance: 0, currency: 'SAR' },
];

const portfolios: InvestmentPortfolio[] = [
  {
    id: 'pf1',
    name: 'Saudi',
    accountId: 'acc1',
    currency: 'SAR',
    holdings: [{ id: 'h1', symbol: '2222.SR', name: 'SABIC', quantity: 10, averageCost: 50 }],
  },
];

describe('statementImportPrepare', () => {
  it('resolves portfolio and converts dividend to SAR book currency', () => {
    const raw: InvestmentTransaction = {
      id: 'x',
      accountId: 'acc1',
      date: '2026-01-15',
      type: 'dividend',
      symbol: '2222.SR',
      quantity: 0,
      price: 0,
      total: 100,
      currency: 'USD',
    };
    const prepared = prepareStatementInvestmentRow(raw, {
      portfolios,
      accounts,
      sarPerUsd: 4,
      preferredAccountId: 'acc1',
    });
    expect(prepared.portfolioId).toBe('pf1');
    expect(prepared.currency).toBe('SAR');
    expect(prepared.total).toBe(400);
  });

  it('flags batch duplicate dividends in review', () => {
    const rows: InvestmentTransaction[] = [
      {
        id: '1',
        accountId: 'acc1',
        portfolioId: 'pf1',
        date: '2026-02-01',
        type: 'dividend',
        symbol: '2222.SR',
        quantity: 0,
        price: 0,
        total: 50,
        currency: 'SAR',
      },
      {
        id: '2',
        accountId: 'acc1',
        portfolioId: 'pf1',
        date: '2026-02-01',
        type: 'dividend',
        symbol: '2222.SR',
        quantity: 0,
        price: 0,
        total: 50,
        currency: 'SAR',
      },
    ];
    const dupes = computeStatementReviewDuplicates([], rows, {
      accounts,
      portfolios,
      existingBankTransactions: [],
      existingInvestmentTransactions: [],
      sarPerUsd: 3.75,
    });
    expect(dupes.has(1)).toBe(true);
    expect(dupes.has(0)).toBe(false);
  });

  it('detects ledger duplicate when parsed row omits currency but matches SAR holding', () => {
    const existing: InvestmentTransaction[] = [
      {
        id: 'led',
        accountId: 'acc1',
        portfolioId: 'pf1',
        date: '2026-03-10',
        type: 'dividend',
        symbol: '2222.SR',
        quantity: 0,
        price: 0,
        total: 200,
        currency: 'SAR',
      },
    ];
    const parsed: InvestmentTransaction[] = [
      {
        id: 'new',
        accountId: 'acc1',
        date: '2026-03-10',
        type: 'dividend',
        symbol: '2222.SR',
        quantity: 0,
        price: 0,
        total: 200,
      },
    ];
    const dupes = computeStatementReviewDuplicates([], parsed, {
      accounts,
      portfolios,
      existingBankTransactions: [],
      existingInvestmentTransactions: existing,
      sarPerUsd: 3.75,
      preferredAccountId: 'acc1',
    });
    expect(dupes.has(0)).toBe(true);
  });

  it('plan skips validation failures and duplicates for confirm count', () => {
    const bank: Transaction[] = [];
    const inv: InvestmentTransaction[] = [
      {
        id: '1',
        accountId: 'acc1',
        portfolioId: 'pf1',
        date: '2026-03-01',
        type: 'dividend',
        symbol: '2222.SR',
        quantity: 0,
        price: 0,
        total: 10,
        currency: 'SAR',
      },
      {
        id: '2',
        accountId: 'acc1',
        date: '',
        type: 'buy',
        symbol: 'UNKNOWN',
        quantity: 1,
        price: 1,
        total: 1,
        currency: 'SAR',
      },
    ];
    const plan = planStatementImport({
      bankTransactions: bank,
      investmentTransactions: inv,
      selectedIndices: new Set([0, 1]),
      duplicateIndices: new Set(),
      ctx: {
        accounts,
        portfolios,
        existingBankTransactions: [],
        existingInvestmentTransactions: [],
        sarPerUsd: 3.75,
        preferredAccountId: 'acc1',
      },
    });
    expect(plan.importableCount).toBe(1);
    expect(plan.skippedValidation).toBe(1);
  });
});

describe('countWillImportDividendSmsRows', () => {
  it('excludes ledger duplicate in same selection batch', () => {
    const rows = [
      {
        date: '2026-04-01',
        symbol: '2222.SR',
        total: 25,
        currency: 'SAR' as const,
        description: 'd1',
        confidence: 'high' as const,
        portfolioId: 'pf1',
        accountId: 'acc1',
        duplicate: false,
      },
      {
        date: '2026-04-01',
        symbol: '2222.SR',
        total: 25,
        currency: 'SAR' as const,
        description: 'd2',
        confidence: 'high' as const,
        portfolioId: 'pf1',
        accountId: 'acc1',
        batchDuplicate: true,
        duplicate: true,
      },
    ];
    const count = countWillImportDividendSmsRows({
      rows: rows as any,
      selectedIndices: new Set([0, 1]),
      investmentTransactions: [],
      accounts,
    });
    expect(count).toBe(1);
  });
});
