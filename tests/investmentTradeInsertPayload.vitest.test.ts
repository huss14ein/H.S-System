import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildInvestmentTradeInsertVariants } from '../services/investmentTradeInsertPayload';
import { stampInvestmentTradeIdentity } from '../services/investmentTradeIdentity';
import {
  filterTransactionsForPortfolioReplay,
} from '../services/portfolioTransactionScope';
import type { InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('investmentTradeInsertPayload', () => {
  it('includes a no-portfolio_id fallback when portfolio is set', () => {
    const variants = buildInvestmentTradeInsertVariants({
      accountId: 'acc-1',
      portfolioId: 'pf-1',
      date: '2026-07-15',
      type: 'buy',
      symbol: 'AAPL',
      quantity: 1,
      price: 100,
      total: 100,
      currency: 'USD',
      idempotencyKey: 'idem-1',
      linkedCashAccountId: 'cash-1',
    });
    expect(variants.some((v) => v.portfolio_id === 'pf-1')).toBe(true);
    expect(variants.some((v) => !('portfolio_id' in v))).toBe(true);
    expect(variants.some((v) => v.linked_cash_account_id === 'cash-1')).toBe(true);
    expect(variants.some((v) => !('linked_cash_account_id' in v))).toBe(true);
    expect(variants.some((v) => !('currency' in v) && !('portfolio_id' in v) && !('idempotency_key' in v))).toBe(true);
    expect(variants[0]).toMatchObject({
      account_id: 'acc-1',
      portfolio_id: 'pf-1',
      currency: 'USD',
      idempotency_key: 'idem-1',
      linked_cash_account_id: 'cash-1',
      symbol: 'AAPL',
    });
  });

  it('does not invent portfolio_id when unset', () => {
    const variants = buildInvestmentTradeInsertVariants({
      accountId: 'acc-1',
      date: '2026-07-15',
      type: 'deposit',
      symbol: 'CASH',
      quantity: 0,
      price: 0,
      total: 500,
    });
    expect(variants.every((v) => !('portfolio_id' in v))).toBe(true);
  });
});

describe('stampInvestmentTradeIdentity', () => {
  it('stamps missing portfolioId and currency for holdings replay', () => {
    const orphan: InvestmentTransaction = {
      id: 'tx-new',
      accountId: 'acc1',
      date: '2026-07-15',
      type: 'buy',
      symbol: 'LCID',
      quantity: 100,
      price: 1,
      total: 100,
    };
    const stamped = stampInvestmentTradeIdentity(orphan, { portfolioId: 'pf1', currency: 'USD' });
    expect(stamped.portfolioId).toBe('pf1');
    expect(stamped.currency).toBe('USD');

    const replayed = filterTransactionsForPortfolioReplay({
      portfolioId: 'pf1',
      transactions: [stamped],
      holdingSymbols: [],
      accountId: 'acc1',
    });
    expect(replayed.map((t) => t.id)).toEqual(['tx-new']);
  });

  it('orphan without stamp still blocked for new symbols (regression guard)', () => {
    const orphan: InvestmentTransaction = {
      id: 'tx-new',
      accountId: 'acc1',
      date: '2026-07-15',
      type: 'buy',
      symbol: 'LCID',
      quantity: 100,
      price: 1,
      total: 100,
    };
    const replayed = filterTransactionsForPortfolioReplay({
      portfolioId: 'pf1',
      transactions: [orphan],
      holdingSymbols: [],
      accountId: 'acc1',
    });
    expect(replayed).toHaveLength(0);
  });
});

describe('recordTrade identity wiring', () => {
  it('DataContext stamps portfolio/currency after insert and syncs from dataRef', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('stampInvestmentTradeIdentity');
    expect(ctx).toContain('applyFinancialDataPatch');
    expect(ctx).toContain('brokerCashBucketsFromInvestmentAccount');
    expect(ctx).toContain('cashBalanceAccumulatorRef.current[accountId]');
    expect(ctx).toContain("ilike('symbol', normalizedSymbol)");
  });

  it('migrations add portfolio_id and fee/vat types', () => {
    const portfolioMig = read('supabase/migrations/20260715120000_investment_transactions_portfolio_id.sql');
    expect(portfolioMig).toContain('portfolio_id');
    const feeMig = read('supabase/migrations/20260715121000_investment_transactions_fee_vat_types.sql');
    expect(feeMig).toMatch(/'fee'/);
    expect(feeMig).toMatch(/'vat'/);
  });
});
