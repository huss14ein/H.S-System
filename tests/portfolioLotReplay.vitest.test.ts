/**
 * FIFO lot replay + ledger sync E2E tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rebuildCostLotsFromEvents } from '../services/portfolioLotReplayEngine';
import { allocateFifoSell } from '../services/investmentCostLots';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const buyTx = {
  id: 't1',
  accountId: 'a1',
  portfolioId: 'pf1',
  date: '2026-01-01',
  type: 'buy' as const,
  symbol: 'AAPL',
  quantity: 10,
  price: 100,
  total: 1000,
};

describe('portfolioLotReplay', () => {
  it('opens lot on buy and allocates FIFO on sell', async () => {
    const result = await rebuildCostLotsFromEvents({
      portfolioId: 'pf1',
      transactions: [
        buyTx,
        {
          id: 't2',
          accountId: 'a1',
          portfolioId: 'pf1',
          date: '2026-03-01',
          type: 'buy',
          symbol: 'AAPL',
          quantity: 5,
          price: 120,
          total: 600,
        },
        {
          id: 't3',
          accountId: 'a1',
          portfolioId: 'pf1',
          date: '2026-06-01',
          type: 'sell',
          symbol: 'AAPL',
          quantity: 8,
          price: 110,
          total: 880,
        },
      ],
      corporateActions: [],
    });
    expect(result.lots.length).toBe(2);
    expect(result.lots.reduce((sum, l) => sum + l.quantityRemaining, 0)).toBeCloseTo(7, 4);
    expect(result.realizedPnLByTransactionId.get('t3')).toBeCloseTo(80, 0);
  });

  it('propagates stock split across lots', async () => {
    const result = await rebuildCostLotsFromEvents({
      portfolioId: 'pf1',
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
    expect(result.lots[0]?.quantityRemaining).toBeCloseTo(20, 4);
    expect(result.lots[0]?.costPerShare).toBeCloseTo(50, 4);
  });

  it('allocates spinoff child lots with cost basis split', async () => {
    const result = await rebuildCostLotsFromEvents({
      portfolioId: 'pf1',
      transactions: [buyTx],
      corporateActions: [
        {
          id: 'ca2',
          executionDate: '2026-06-01',
          symbol: 'AAPL',
          action: {
            type: 'spinoff',
            ratioNumerator: 1,
            ratioDenominator: 4,
            costBasisAllocationPct: 0.2,
            linkedSymbol: 'WBD',
          },
        },
      ],
    });
    const parent = result.lots.find((l) => l.symbol === 'AAPL');
    const child = result.lots.find((l) => l.symbol === 'WBD');
    expect(parent?.costPerShare).toBeCloseTo(80, 4);
    expect(child?.quantityRemaining).toBeCloseTo(2.5, 4);
    expect(child?.costPerShare).toBeCloseTo(80, 4);
  });

  it('converts merger parent lots into acquirer symbol lots', async () => {
    const result = await rebuildCostLotsFromEvents({
      portfolioId: 'pf1',
      transactions: [buyTx],
      corporateActions: [
        {
          id: 'ca3',
          executionDate: '2026-07-01',
          symbol: 'AAPL',
          action: {
            type: 'merger',
            conversionRatio: 0.5,
            linkedSymbol: 'MSFT',
          },
        },
      ],
    });
    expect(result.lots.some((l) => l.symbol === 'AAPL')).toBe(false);
    const acquirer = result.lots.find((l) => l.symbol === 'MSFT');
    expect(acquirer?.quantityRemaining).toBeCloseTo(5, 4);
    expect(acquirer?.costPerShare).toBeCloseTo(200, 4);
  });

  it('reverse split with cash-in-lieu drops fractional lot quantity', async () => {
    const result = await rebuildCostLotsFromEvents({
      portfolioId: 'pf1',
      transactions: [
        {
          ...buyTx,
          quantity: 11,
          total: 1100,
        },
      ],
      corporateActions: [
        {
          id: 'ca4',
          executionDate: '2026-06-01',
          symbol: 'AAPL',
          action: { type: 'cash_in_lieu', ratioNumerator: 1, ratioDenominator: 10 },
        },
      ],
    });
    expect(result.lots[0]?.quantityRemaining).toBe(1);
    expect(result.lots[0]?.costPerShare).toBeCloseTo(1000, 4);
  });
});

describe('portfolioLedgerSync wiring', () => {
  it('DataContext routes recordTrade through applyPositionDeltaForTrade + syncLotsAfterTrade', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('applyPositionDeltaForTrade');
    expect(ctx).toContain('syncLotsAfterTrade');
    expect(ctx).toContain('syncPortfolioAfterLedgerMutation');
    expect(ctx).toContain('syncPortfolioLedgerAfterChange');
    expect(ctx).toContain('investment_cost_lots');
    expect(ctx).toContain('Promise.all([cashWrite, positionWrite])');
    expect(read('services/portfolioLedgerSync.ts')).toContain('persistInvestmentCostLotsForSymbols');
    expect(read('services/portfolioLedgerSync.ts')).toContain('persistInvestmentCostLotsForPortfolio');
    expect(ctx).toContain('applyPositionDeltaForTrade');
  });

  it('corporate action apply/undo use unified ledger sync', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('await syncPortfolioAfterLedgerMutation(args.portfolioId');
    expect(ctx).toContain('await syncPortfolioAfterLedgerMutation(ev.portfolioId');
  });

  it('FIFO sell uses oldest lot first', () => {
    const { allocations } = allocateFifoSell(
      [
        { id: 'l1', symbol: 'X', acquisitionDate: '2026-01-01', quantityRemaining: 5, costPerShare: 10, bookCurrency: 'SAR' },
        { id: 'l2', symbol: 'X', acquisitionDate: '2026-02-01', quantityRemaining: 5, costPerShare: 12, bookCurrency: 'SAR' },
      ],
      'X',
      6,
      15,
    );
    expect(allocations[0]?.lotId).toBe('l1');
    expect(allocations[0]?.quantity).toBe(5);
  });

  it('cost lot rows never send lot-prefixed ids to Postgres uuid columns', async () => {
    const { investmentCostLotToRow, isCostLotUuid } = await import('../services/investmentCostLotDb');
    const { newCostLotId } = await import('../services/investmentCostLots');
    expect(isCostLotUuid('lot-3845ec05-3d90-47ec-ba40-c979b3518aab')).toBe(false);
    expect(isCostLotUuid('3845ec05-3d90-47ec-ba40-c979b3518aab')).toBe(true);
    const bad = investmentCostLotToRow({
      id: 'lot-3845ec05-3d90-47ec-ba40-c979b3518aab',
      portfolioId: '3845ec05-3d90-47ec-ba40-c979b3518aab',
      symbol: 'LCID',
      market: 'US',
      acquisitionDate: '2026-01-01',
      quantityRemaining: 10,
      costPerShare: 5,
      bookCurrency: 'USD',
      sourceTransactionId: 'lot-3845ec05-3d90-47ec-ba40-c979b3518aab',
    });
    expect(bad).not.toHaveProperty('id');
    expect(bad.source_transaction_id).toBeNull();
    const goodId = newCostLotId();
    const good = investmentCostLotToRow({
      id: goodId,
      portfolioId: '3845ec05-3d90-47ec-ba40-c979b3518aab',
      symbol: 'LCID',
      market: 'US',
      acquisitionDate: '2026-01-01',
      quantityRemaining: 10,
      costPerShare: 5,
      bookCurrency: 'USD',
      sourceTransactionId: '3845ec05-3d90-47ec-ba40-c979b3518aab',
    });
    expect(good.id).toBe(goodId);
    expect(good.source_transaction_id).toBe('3845ec05-3d90-47ec-ba40-c979b3518aab');
    expect(read('services/portfolioLotReplayEngine.ts')).toContain('newCostLotId()');
    expect(read('services/portfolioLotReplayEngine.ts')).not.toContain('lot-${tx.id}');
  });
});
