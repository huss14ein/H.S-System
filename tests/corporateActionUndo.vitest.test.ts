/**
 * Corporate action undo — replay restores pre-action holdings (B6).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rebuildPortfolioFromEvents } from '../services/portfolioReplayEngine';
import {
  replayPortfolioHoldingsFromEvents,
  persistHoldingsFromReplayMap,
  computeCashInLieuDepositSar,
  corporateActionCashDepositIdempotencyKeysForEvent,
} from '../services/corporateActionApply';
import type { CorporateActionEvent, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('corporateActionUndo', () => {
  const portfolio: InvestmentPortfolio = {
    id: 'pf1',
    name: 'Test',
    accountId: 'a1',
    holdings: [
      {
        id: 'h1',
        symbol: 'AAPL',
        name: 'Apple',
        quantity: 20,
        avgCost: 50,
        currentValue: 1000,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: 'Stock',
      },
    ],
  };

  const buyTx: InvestmentTransaction = {
    id: 't1',
    portfolioId: 'pf1',
    accountId: 'a1',
    date: '2026-01-01',
    type: 'buy',
    symbol: 'AAPL',
    quantity: 10,
    price: 100,
    total: 1000,
  };

  const splitEvent: CorporateActionEvent = {
    id: 'ca1',
    portfolioId: 'pf1',
    actionType: 'stock_split',
    symbol: 'AAPL',
    executionDate: '2026-06-01',
    ratioNumerator: 2,
    ratioDenominator: 1,
    idempotencyKey: 'split-1',
    status: 'applied',
  };

  it('replay with split yields doubled quantity', async () => {
    const result = await rebuildPortfolioFromEvents({
      transactions: [buyTx],
      corporateActions: [
        {
          id: 'ca1',
          executionDate: '2026-06-01',
          symbol: 'AAPL',
          action: { type: 'stock_split', ratioNumerator: 2, ratioDenominator: 1 },
        },
      ],
    });
    const h = result.holdings.get('AAPL');
    expect(h?.quantity).toBeCloseTo(20, 4);
    expect(h?.avgCost).toBeCloseTo(50, 4);
  });

  it('undo (exclude reversed event) restores original holdings', async () => {
    const withSplit = await replayPortfolioHoldingsFromEvents({
      portfolio,
      transactions: [buyTx],
      corporateActionEvents: [splitEvent],
    });
    expect(withSplit.get('AAPL')?.quantity).toBeCloseTo(20, 4);

    const reversed: CorporateActionEvent = { ...splitEvent, status: 'reversed' };
    const afterUndo = await replayPortfolioHoldingsFromEvents({
      portfolio: { ...portfolio, holdings: [] },
      transactions: [buyTx],
      corporateActionEvents: [reversed],
    });
    const h = afterUndo.get('AAPL');
    expect(h?.quantity).toBeCloseTo(10, 4);
    expect(h?.avgCost).toBeCloseTo(100, 4);
  });

  it('persistHoldingsFromReplayMap updates and removes holdings', async () => {
    const updates: Holding[] = [];
    const added: Holding[] = [];
    const deleted: string[] = [];

    await persistHoldingsFromReplayMap({
      portfolio,
      replayed: new Map([['AAPL', { quantity: 10, avgCost: 100 }]]),
      updateHolding: async (h) => {
        updates.push(h);
      },
      addHolding: async (h) => {
        added.push(h as Holding);
      },
      deleteHolding: async (id) => {
        deleted.push(id);
      },
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]?.quantity).toBeCloseTo(10, 4);
    expect(added).toHaveLength(0);
    expect(deleted).toHaveLength(0);
  });

  it('undo on manual-only portfolio restores quantity via reversal replay', async () => {
    const postSplit: InvestmentPortfolio = {
      id: 'pf1',
      name: 'Test',
      accountId: 'a1',
      holdings: [
        {
          id: 'h1',
          symbol: 'AAPL',
          name: 'Apple',
          quantity: 20,
          avgCost: 50,
          currentValue: 1000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          assetClass: 'Stock',
        },
      ],
    };
    const splitEvent: CorporateActionEvent = {
      id: 'ca1',
      portfolioId: 'pf1',
      actionType: 'stock_split',
      symbol: 'AAPL',
      executionDate: '2026-06-01',
      ratioNumerator: 2,
      ratioDenominator: 1,
      idempotencyKey: 'split-1',
      status: 'reversed',
    };
    const reversalEvent: CorporateActionEvent = {
      id: 'ca2',
      portfolioId: 'pf1',
      actionType: 'reverse_stock_split',
      symbol: 'AAPL',
      executionDate: '2026-06-02',
      ratioNumerator: 1,
      ratioDenominator: 2,
      idempotencyKey: 'split-1|reverse|ca1',
      status: 'applied',
    };
    const afterUndo = await replayPortfolioHoldingsFromEvents({
      portfolio: postSplit,
      transactions: [],
      corporateActionEvents: [splitEvent, reversalEvent],
      holdingsBaselineMode: 'as_stored',
    });
    expect(afterUndo.get('AAPL')?.quantity).toBeCloseTo(10, 4);
    expect(afterUndo.get('AAPL')?.avgCost).toBeCloseTo(100, 4);
  });

  it('reverse-split fractional deposit amount and idempotency keys', () => {
    const depositSar = computeCashInLieuDepositSar({
      action: {
        type: 'reverse_stock_split',
        ratioNumerator: 1,
        ratioDenominator: 10,
        cashInLieuPrice: 50,
      },
      holding: { quantity: 15, avgCost: 10 },
    });
    expect(depositSar).toBeCloseTo(25, 4);
    const keys = corporateActionCashDepositIdempotencyKeysForEvent('ca-key-1');
    expect(keys).toEqual(['cash-in-lieu|ca-key-1', 'reverse-split-fraction|ca-key-1']);
  });

  it('DataContext undo uses replay sync path and deposit reversal helpers', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('reverseCorporateActionEvent');
    expect(ctx).toContain('syncPortfolioAfterLedgerMutation');
    expect(ctx).toContain("status: 'reversed'");
    expect(ctx).toContain('removeCorporateActionCashDeposits');
  });
});
