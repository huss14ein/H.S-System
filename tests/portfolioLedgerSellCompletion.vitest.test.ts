/**
 * Sell sync must not restore pre-trade qty, and mixed books must keep manual holdings.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { syncPortfolioLedgerAfterChange } from '../services/portfolioLedgerSync';
import { replayPortfolioHoldingsFromEvents } from '../services/corporateActionApply';
import type { Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('portfolioLedgerSellCompletion', () => {
  it('realized PnL patch on CA sync uses post-replay qty (never spreads stale pre-sell holding)', () => {
    const sync = read('services/portfolioLedgerSync.ts');
    expect(sync).toContain('const pos = replayed.get(upper)');
    expect(sync).toContain('quantity: roundQuantity(pos.quantity)');
    expect(sync).toContain('syncLotsAfterTrade');
    expect(sync).toContain('rebuildHoldingsFromLedger');
    expect(sync).toContain('Cost lot persist failed after holdings sync');
  });

  it('hybrid replay: sell-only trusts as_stored (no double-apply); qty reduced before sync', async () => {
    const portfolio: InvestmentPortfolio = {
      id: 'pf-awaed',
      name: "Hussein's Awaed",
      accountId: 'acc1',
      currency: 'USD',
      holdings: [
        {
          id: 'h-lcid',
          symbol: 'LCID',
          name: 'Lucid',
          // Already reduced by recordTrade sell-only pre-patch (1890 − 400).
          quantity: 1490,
          avgCost: 4.2,
          currentValue: 10966.4,
        },
        {
          id: 'h-unh',
          symbol: 'UNH',
          name: 'UnitedHealth',
          quantity: 15,
          avgCost: 298.62,
          currentValue: 6391,
        },
      ],
    };
    const transactions: InvestmentTransaction[] = [
      {
        id: 'sell-lcid-partial',
        portfolioId: 'pf-awaed',
        accountId: 'acc1',
        date: '2026-07-19',
        type: 'sell',
        symbol: 'LCID',
        quantity: 400,
        price: 7.36,
        total: 400 * 7.36,
      },
    ];

    const replayed = await replayPortfolioHoldingsFromEvents({
      portfolio,
      transactions,
      corporateActionEvents: [],
    });

    // Sell-only must NOT subtract 400 again on re-sync.
    expect(replayed.get('LCID')?.quantity).toBe(1490);
    expect(replayed.get('UNH')?.quantity).toBe(15);
  });

  it('hybrid replay: second sync with same sell-only txs stays idempotent', async () => {
    const portfolio: InvestmentPortfolio = {
      id: 'pf-awaed',
      name: "Hussein's Awaed",
      accountId: 'acc1',
      currency: 'USD',
      holdings: [
        {
          id: 'h-lcid',
          symbol: 'LCID',
          name: 'Lucid',
          quantity: 1490,
          avgCost: 4.2,
          currentValue: 10966.4,
        },
      ],
    };
    const transactions: InvestmentTransaction[] = [
      {
        id: 'sell-1',
        portfolioId: 'pf-awaed',
        accountId: 'acc1',
        date: '2026-07-19',
        type: 'sell',
        symbol: 'LCID',
        quantity: 400,
        price: 7.36,
        total: 2944,
      },
    ];
    const first = await replayPortfolioHoldingsFromEvents({
      portfolio,
      transactions,
      corporateActionEvents: [],
    });
    const second = await replayPortfolioHoldingsFromEvents({
      portfolio: {
        ...portfolio,
        holdings: [
          {
            ...portfolio.holdings[0]!,
            quantity: first.get('LCID')!.quantity,
          },
        ],
      },
      transactions,
      corporateActionEvents: [],
    });
    expect(second.get('LCID')?.quantity).toBe(1490);
  });

  it('hybrid replay: sell LCID to zero keeps manual UNH', async () => {
    const portfolio: InvestmentPortfolio = {
      id: 'pf-awaed',
      name: "Hussein's Awaed",
      accountId: 'acc1',
      currency: 'USD',
      holdings: [
        {
          id: 'h-lcid',
          symbol: 'LCID',
          name: 'Lucid',
          quantity: 1890,
          avgCost: 4.2,
          currentValue: 13910,
        },
        {
          id: 'h-unh',
          symbol: 'UNH',
          name: 'UnitedHealth',
          quantity: 15,
          avgCost: 298.62,
          currentValue: 6391,
        },
      ],
    };
    const transactions: InvestmentTransaction[] = [
      {
        id: 'buy-lcid',
        portfolioId: 'pf-awaed',
        accountId: 'acc1',
        date: '2025-01-01',
        type: 'buy',
        symbol: 'LCID',
        quantity: 1890,
        price: 4.2,
        total: 1890 * 4.2,
      },
      {
        id: 'sell-lcid',
        portfolioId: 'pf-awaed',
        accountId: 'acc1',
        date: '2026-07-19',
        type: 'sell',
        symbol: 'LCID',
        quantity: 1890,
        price: 7.36,
        total: 1890 * 7.36,
      },
    ];

    const replayed = await replayPortfolioHoldingsFromEvents({
      portfolio,
      transactions,
      corporateActionEvents: [],
    });

    expect(replayed.has('LCID')).toBe(false);
    expect(replayed.get('UNH')?.quantity).toBe(15);
  });

  it('syncPortfolioLedgerAfterChange PnL update keeps post-sell quantity', async () => {
    const portfolio: InvestmentPortfolio = {
      id: 'pf1',
      name: 'Test',
      accountId: 'acc1',
      currency: 'USD',
      holdings: [
        {
          id: 'h1',
          symbol: 'LCID',
          name: 'Lucid',
          quantity: 100,
          avgCost: 5,
          currentValue: 700,
          realizedPnL: 0,
        },
      ],
    };
    const transactions: InvestmentTransaction[] = [
      {
        id: 'b1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-01-01',
        type: 'buy',
        symbol: 'LCID',
        quantity: 100,
        price: 5,
        total: 500,
      },
      {
        id: 's1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-07-01',
        type: 'sell',
        symbol: 'LCID',
        quantity: 40,
        price: 7,
        total: 280,
      },
    ];

    const updateHolding = vi.fn(async (_h: Holding) => {});
    const addHolding = vi.fn(async () => {});
    const deleteHolding = vi.fn(async () => {});

    await syncPortfolioLedgerAfterChange({
      portfolio,
      investmentTransactions: transactions,
      corporateActionEvents: [],
      updateHolding,
      addHolding,
      deleteHolding,
      symbols: ['LCID'],
    });

    // First updateHolding from persist (qty 60); any later PnL patch must also use qty 60.
    expect(updateHolding.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const call of updateHolding.mock.calls) {
      const h = call[0] as Holding;
      if (String(h.symbol).toUpperCase() === 'LCID') {
        expect(h.quantity).toBe(60);
      }
    }
    expect(deleteHolding).not.toHaveBeenCalled();
  });

  it('DataContext buy/sell uses applyPositionDeltaForTrade (not sell-only pre-sync special case)', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('applyPositionDeltaForTrade');
    expect(ctx).toContain('syncLotsAfterTrade');
    expect(ctx).toContain("tradeData.type === 'buy' || tradeData.type === 'sell'");
    expect(ctx).not.toContain('portfolioHasBuyHistoryForSymbol');
    expect(ctx).not.toContain('Sell-only (manual book, no buy ledger)');
    const apply = read('services/corporateActionApply.ts');
    expect(apply).toContain('sellOnlySymbols');
    expect(apply).toContain('txsForHoldingsReplay');
  });

  it('full sell deletes holding and never re-writes stale qty via PnL patch', async () => {
    const portfolio: InvestmentPortfolio = {
      id: 'pf1',
      name: 'Test',
      accountId: 'acc1',
      currency: 'USD',
      holdings: [
        {
          id: 'h1',
          symbol: 'LCID',
          name: 'Lucid',
          quantity: 50,
          avgCost: 5,
          currentValue: 350,
          realizedPnL: 0,
        },
      ],
    };
    const transactions: InvestmentTransaction[] = [
      {
        id: 'b1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-01-01',
        type: 'buy',
        symbol: 'LCID',
        quantity: 50,
        price: 5,
        total: 250,
      },
      {
        id: 's1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-07-01',
        type: 'sell',
        symbol: 'LCID',
        quantity: 50,
        price: 7,
        total: 350,
      },
    ];

    const updateHolding = vi.fn(async () => {});
    const addHolding = vi.fn(async () => {});
    const deleteHolding = vi.fn(async () => {});

    await syncPortfolioLedgerAfterChange({
      portfolio,
      investmentTransactions: transactions,
      corporateActionEvents: [],
      updateHolding,
      addHolding,
      deleteHolding,
      symbols: ['LCID'],
    });

    expect(deleteHolding).toHaveBeenCalledWith('h1');
    // No updateHolding should restore qty 50 after delete.
    for (const call of updateHolding.mock.calls) {
      const h = call[0] as Holding;
      if (String(h.symbol).toUpperCase() === 'LCID') {
        expect(h.quantity).toBeLessThan(1e-9);
      }
    }
    expect(addHolding).not.toHaveBeenCalled();
  });
});
