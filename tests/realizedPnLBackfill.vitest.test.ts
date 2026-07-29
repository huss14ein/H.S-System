import { describe, expect, it, vi } from 'vitest';
import { applyPositionDeltaForTrade } from '../services/applyPositionDeltaForTrade';
import { backfillRealizedPnLForPortfolio, syncLotsAfterTrade } from '../services/portfolioLedgerSync';
import type { Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';

describe('realized P/L persistence', () => {
  it('full sell keeps holding row at qty 0 so syncLotsAfterTrade can patch realizedPnL', async () => {
    const holding: Holding = {
      id: 'h1',
      symbol: 'AAPL',
      name: 'Apple',
      quantity: 10,
      avgCost: 100,
      currentValue: 1200,
      realizedPnL: 0,
      zakahClass: 'Zakatable',
    };
    const updateHolding = vi.fn(async (h: Holding) => {
      Object.assign(holding, h);
    });
    const deleteHolding = vi.fn(async () => {});

    await applyPositionDeltaForTrade({
      portfolioId: 'pf1',
      symbol: 'AAPL',
      side: 'sell',
      quantity: 10,
      price: 120,
      existingHolding: holding,
      updateHolding,
      addHolding: vi.fn(),
      deleteHolding,
    });

    expect(holding.quantity).toBe(0);
    expect(deleteHolding).not.toHaveBeenCalled();

    const portfolio: InvestmentPortfolio = {
      id: 'pf1',
      name: 'Test',
      accountId: 'acc1',
      currency: 'USD',
      holdings: [holding],
    };
    const txs: InvestmentTransaction[] = [
      {
        id: 'b1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-01-01',
        type: 'buy',
        symbol: 'AAPL',
        quantity: 10,
        price: 100,
        total: 1000,
      },
      {
        id: 's1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-07-01',
        type: 'sell',
        symbol: 'AAPL',
        quantity: 10,
        price: 120,
        total: 1200,
      },
    ];

    await syncLotsAfterTrade({
      portfolio,
      investmentTransactions: txs,
      corporateActionEvents: [],
      touchedSymbols: ['AAPL'],
      resolveHolding: () => holding,
      updateHolding,
    });

    expect(holding.realizedPnL).toBeCloseTo(200, 1);
  });

  it('backfillRealizedPnLForPortfolio patches holdings from ledger sells', async () => {
    const holding: Holding = {
      id: 'h-msft',
      symbol: 'MSFT',
      name: 'MSFT',
      quantity: 5,
      avgCost: 100,
      currentValue: 550,
      realizedPnL: 0,
      zakahClass: 'Zakatable',
    };
    const portfolio: InvestmentPortfolio = {
      id: 'pf1',
      name: 'Test',
      accountId: 'acc1',
      currency: 'USD',
      holdings: [holding],
    };
    const txs: InvestmentTransaction[] = [
      {
        id: 'b1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-01-01',
        type: 'buy',
        symbol: 'MSFT',
        quantity: 10,
        price: 100,
        total: 1000,
      },
      {
        id: 's1',
        portfolioId: 'pf1',
        accountId: 'acc1',
        date: '2026-06-01',
        type: 'sell',
        symbol: 'MSFT',
        quantity: 5,
        price: 110,
        total: 550,
      },
    ];
    const updateHolding = vi.fn(async (h: Holding) => {
      Object.assign(holding, h);
    });

    const { patchedSymbols } = await backfillRealizedPnLForPortfolio({
      portfolio,
      investmentTransactions: txs,
      corporateActionEvents: [],
      updateHolding,
      resolveHolding: () => holding,
    });

    expect(patchedSymbols).toBeGreaterThan(0);
    expect(holding.realizedPnL).toBeCloseTo(50, 1);
  });
});
