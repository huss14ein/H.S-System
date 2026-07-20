/**
 * Trade holdings isolation — position book mutated only for the traded symbol.
 * Trace: recordTrade → applyPositionDeltaForTrade → syncLotsAfterTrade (no full-book persist).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyBuyToHolding,
  applySellToHolding,
  computePositionFieldsAfterTrade,
} from '../services/holdingMath';
import { applyPositionDeltaForTrade } from '../services/applyPositionDeltaForTrade';
import { syncLotsAfterTrade, rebuildHoldingsFromLedger } from '../services/portfolioLedgerSync';
import { persistHoldingsFromReplayMap } from '../services/corporateActionApply';
import { buildHoldingsQtyDriftReport } from '../services/holdingsIntegrityRepair';
import type { Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('tradeHoldingsIsolation', () => {
  it('applySellToHolding scales CV and closes at zero', () => {
    const partial = applySellToHolding({ quantity: 100, avgCost: 5, currentValue: 800 }, 40);
    expect(partial.quantity).toBe(60);
    expect(partial.avgCost).toBe(5);
    expect(partial.currentValue).toBe(480);
    expect(partial.closed).toBe(false);

    const full = applySellToHolding({ quantity: 50, avgCost: 5, currentValue: 400 }, 50);
    expect(full.closed).toBe(true);
    expect(full.quantity).toBe(0);
  });

  it('computePositionFieldsAfterTrade buy/sell actions', () => {
    const created = computePositionFieldsAfterTrade({
      existing: null,
      side: 'buy',
      quantity: 10,
      price: 20,
    });
    expect(created.action).toBe('create');
    expect(created.quantity).toBe(10);

    const updated = computePositionFieldsAfterTrade({
      existing: { quantity: 10, avgCost: 20, currentValue: 200 },
      side: 'buy',
      quantity: 10,
      price: 40,
    });
    expect(updated.action).toBe('update');
    expect(updated).toMatchObject(applyBuyToHolding({ quantity: 10, avgCost: 20, currentValue: 200 }, 10, 40));

    const closed = computePositionFieldsAfterTrade({
      existing: { quantity: 10, avgCost: 20, currentValue: 200 },
      side: 'sell',
      quantity: 10,
      price: 25,
    });
    expect(closed.action).toBe('delete');
  });

  it('applyPositionDeltaForTrade mutates only the traded symbol', async () => {
    const holdings: Holding[] = [
      {
        id: 'h-unh',
        symbol: 'UNH',
        name: 'UNH',
        quantity: 15,
        avgCost: 300,
        currentValue: 4500,
        zakahClass: 'Zakatable',
      },
      {
        id: 'h-lcid',
        symbol: 'LCID',
        name: 'LCID',
        quantity: 1890,
        avgCost: 4.2,
        currentValue: 14000,
        zakahClass: 'Zakatable',
      },
    ];
    const updateHolding = vi.fn(async (h: Holding) => {
      const i = holdings.findIndex((x) => x.id === h.id);
      if (i >= 0) holdings[i] = h;
    });
    const addHolding = vi.fn(async () => {});
    const deleteHolding = vi.fn(async (id: string) => {
      const i = holdings.findIndex((x) => x.id === id);
      if (i >= 0) holdings.splice(i, 1);
    });

    await applyPositionDeltaForTrade({
      portfolioId: 'pf1',
      symbol: 'LCID',
      side: 'sell',
      quantity: 400,
      price: 7.36,
      existingHolding: holdings.find((h) => h.id === 'h-lcid')!,
      updateHolding,
      addHolding,
      deleteHolding,
    });

    expect(holdings.find((h) => h.symbol === 'UNH')?.quantity).toBe(15);
    expect(holdings.find((h) => h.symbol === 'LCID')?.quantity).toBe(1490);
    expect(addHolding).not.toHaveBeenCalled();
    expect(deleteHolding).not.toHaveBeenCalled();
  });

  it('syncLotsAfterTrade never calls addHolding/deleteHolding and patches realizedPnL only', async () => {
    const holding: Holding = {
      id: 'h1',
      symbol: 'LCID',
      quantity: 60,
      avgCost: 5,
      currentValue: 420,
      realizedPnL: 0,
      zakahClass: 'Zakatable',
    };
    const portfolio: InvestmentPortfolio = {
      id: 'pf1',
      name: 'T',
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
    const updateHolding = vi.fn(async (h: Holding) => {
      Object.assign(holding, h);
    });

    await syncLotsAfterTrade({
      portfolio,
      investmentTransactions: txs,
      corporateActionEvents: [],
      touchedSymbols: ['LCID'],
      resolveHolding: () => holding,
      updateHolding,
    });

    expect(holding.quantity).toBe(60);
    for (const call of updateHolding.mock.calls) {
      const h = call[0] as Holding;
      expect(h.quantity).toBe(60);
    }
  });

  it('persistHoldingsFromReplayMap with symbols gate does not resurrect untouched closed names', async () => {
    const portfolio: InvestmentPortfolio = {
      id: 'pf1',
      name: 'T',
      accountId: 'acc1',
      currency: 'USD',
      holdings: [
        {
          id: 'h-msft',
          symbol: 'MSFT',
          quantity: 5,
          avgCost: 100,
          currentValue: 500,
          zakahClass: 'Zakatable',
        },
      ],
    };
    const replayed = new Map([
      ['MSFT', { quantity: 8, avgCost: 110 }],
      ['NVDA', { quantity: 20, avgCost: 50 }],
    ]);
    const updateHolding = vi.fn(async () => {});
    const addHolding = vi.fn(async () => {});
    const deleteHolding = vi.fn(async () => {});

    await persistHoldingsFromReplayMap({
      portfolio,
      replayed,
      updateHolding,
      addHolding,
      deleteHolding,
      symbols: ['MSFT'],
    });

    expect(addHolding).not.toHaveBeenCalled();
    expect(updateHolding).toHaveBeenCalled();
    expect(deleteHolding).not.toHaveBeenCalled();
  });

  it('rebuildHoldingsFromLedger requires explicit symbols', async () => {
    await expect(
      rebuildHoldingsFromLedger({
        portfolio: { id: 'pf1', name: 'T', holdings: [], currency: 'USD' },
        investmentTransactions: [],
        corporateActionEvents: [],
        symbols: [],
        updateHolding: async () => {},
        addHolding: async () => {},
        deleteHolding: async () => {},
      }),
    ).rejects.toThrow(/at least one symbol/i);
  });

  it('DataContext trade path uses applyPositionDeltaForTrade + syncLotsAfterTrade (not full-book persist)', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('applyPositionDeltaForTrade');
    expect(ctx).toContain('syncLotsAfterTrade');
    expect(ctx).toContain('rebuildHoldingsFromLedgerForSymbols');
    expect(ctx).not.toContain(
      'syncPortfolioAfterLedgerMutation(portfolio.id, { investmentTransactions: mergedTxs })',
    );
    expect(ctx).not.toContain('portfolioHasBuyHistoryForSymbol');
    expect(ctx).toContain("tradeData.type === 'buy' || tradeData.type === 'sell'");
    // syncLotsAfterTrade is nested inside the buy/sell block (not after dividend).
    const buySellBlock = ctx.slice(
      ctx.indexOf("if (tradeData.type === 'buy' || tradeData.type === 'sell')"),
      ctx.indexOf("if (tradeData.type === 'buy') {"),
    );
    expect(buySellBlock).toContain('applyPositionDeltaForTrade');
    expect(buySellBlock).toContain('syncLotsAfterTrade');
  });

  it('non-DRIP dividend skips position delta; DRIP nests a buy for the same symbol only', () => {
    const ctx = read('context/DataContext.tsx');
    const divStart = ctx.indexOf("if (tradeData.type === 'dividend') {\n            const dripHolding = existingHolding;");
    expect(divStart).toBeGreaterThan(-1);
    const divBlock = ctx.slice(divStart, divStart + 2500);
    expect(divBlock).toContain("dividendDistribution === 'Reinvest'");
    expect(divBlock).toContain("type: 'buy'");
    expect(divBlock).toContain('idempotencyKey: `drip|');
    expect(divBlock).toContain('return {');
    expect(divBlock).not.toContain('applyPositionDeltaForTrade');
    expect(divBlock).not.toContain('syncLotsAfterTrade');
    expect(divBlock).not.toContain('persistHoldingsFromReplayMap');
  });

  it('full sell deletes holding; later trade on another symbol cannot resurrect via lots sync', async () => {
    const holdings: Holding[] = [
      {
        id: 'h-nvda',
        symbol: 'NVDA',
        name: 'NVDA',
        quantity: 10,
        avgCost: 50,
        currentValue: 500,
        zakahClass: 'Zakatable',
      },
      {
        id: 'h-msft',
        symbol: 'MSFT',
        name: 'MSFT',
        quantity: 5,
        avgCost: 100,
        currentValue: 500,
        zakahClass: 'Zakatable',
      },
    ];
    const updateHolding = vi.fn(async (h: Holding) => {
      const i = holdings.findIndex((x) => x.id === h.id);
      if (i >= 0) holdings[i] = h;
    });
    const addHolding = vi.fn(async (h: Holding & { portfolio_id?: string }) => {
      holdings.push({ ...h, id: `new-${h.symbol}` } as Holding);
    });
    const deleteHolding = vi.fn(async (id: string) => {
      const i = holdings.findIndex((x) => x.id === id);
      if (i >= 0) holdings.splice(i, 1);
    });

    await applyPositionDeltaForTrade({
      portfolioId: 'pf1',
      symbol: 'NVDA',
      side: 'sell',
      quantity: 10,
      price: 60,
      existingHolding: holdings.find((h) => h.symbol === 'NVDA')!,
      updateHolding,
      addHolding,
      deleteHolding,
    });
    expect(holdings.find((h) => h.symbol === 'NVDA')).toBeUndefined();
    expect(deleteHolding).toHaveBeenCalledWith('h-nvda');

    await applyPositionDeltaForTrade({
      portfolioId: 'pf1',
      symbol: 'MSFT',
      side: 'buy',
      quantity: 1,
      price: 110,
      existingHolding: holdings.find((h) => h.symbol === 'MSFT')!,
      updateHolding,
      addHolding,
      deleteHolding,
    });
    expect(holdings.find((h) => h.symbol === 'NVDA')).toBeUndefined();
    expect(holdings.find((h) => h.symbol === 'MSFT')?.quantity).toBe(6);
    expect(addHolding).not.toHaveBeenCalled();
  });

  it('all recordTrade entry points still go through DataContext recordTrade', () => {
    for (const file of [
      'pages/Investments.tsx',
      'pages/StatementUpload.tsx',
      'pages/DividendTrackerView.tsx',
      'components/DividendSmsImportPanel.tsx',
    ]) {
      expect(read(file)).toContain('recordTrade');
    }
    expect(read('services/dividendSmsParser.ts')).toContain('recordTrade');
  });

  it('exposure KPIs still value stored holdings quantity (canonical / headline path)', () => {
    expect(read('utils/holdingValuation.ts')).toContain('Number(h.quantity');
    expect(read('services/investmentKpiCore.ts')).toContain('computeHeadlinePersonalInvestmentRoiDecimal');
    expect(read('services/canonicalFinancialMetrics.ts')).toContain('computeHeadlinePersonalInvestmentRoiDecimal');
    expect(read('pages/Investments.tsx')).toContain('HoldingsQtyIntegrityPanel');
    expect(read('components/investments/HoldingsQtyIntegrityPanel.tsx')).toContain('holdings-qty-integrity');
  });

  it('persistHoldingsFromReplayMap requires symbols (ungated full-book rewrite forbidden)', async () => {
    await expect(
      persistHoldingsFromReplayMap({
        portfolio: {
          id: 'pf1',
          name: 'T',
          holdings: [],
          currency: 'USD',
        },
        replayed: new Map([['AAPL', { quantity: 1, avgCost: 1 }]]),
        updateHolding: async () => {},
        addHolding: async () => {},
        deleteHolding: async () => {},
        symbols: [],
      }),
    ).rejects.toThrow(/at least one symbol/i);
  });

  it('syncPortfolioLedgerAfterChange requires symbols', async () => {
    const { syncPortfolioLedgerAfterChange } = await import('../services/portfolioLedgerSync');
    await expect(
      syncPortfolioLedgerAfterChange({
        portfolio: { id: 'pf1', name: 'T', holdings: [], currency: 'USD' },
        investmentTransactions: [],
        corporateActionEvents: [],
        updateHolding: async () => {},
        addHolding: async () => {},
        deleteHolding: async () => {},
        symbols: [],
      }),
    ).rejects.toThrow(/at least one symbol/i);
  });

  it('buy MSFT leaves other open holdings unchanged', async () => {
    const holdings: Holding[] = [
      {
        id: 'h-unh',
        symbol: 'UNH',
        quantity: 15,
        avgCost: 300,
        currentValue: 4500,
        zakahClass: 'Zakatable',
      },
      {
        id: 'h-msft',
        symbol: 'MSFT',
        quantity: 5,
        avgCost: 100,
        currentValue: 500,
        zakahClass: 'Zakatable',
      },
    ];
    const updateHolding = vi.fn(async (h: Holding) => {
      const i = holdings.findIndex((x) => x.id === h.id);
      if (i >= 0) holdings[i] = h;
    });
    await applyPositionDeltaForTrade({
      portfolioId: 'pf1',
      symbol: 'MSFT',
      side: 'buy',
      quantity: 2,
      price: 120,
      existingHolding: holdings.find((h) => h.symbol === 'MSFT')!,
      updateHolding,
      addHolding: async () => {},
      deleteHolding: async () => {},
    });
    expect(holdings.find((h) => h.symbol === 'UNH')?.quantity).toBe(15);
    expect(holdings.find((h) => h.symbol === 'MSFT')?.quantity).toBe(7);
  });

  it('SystemHealth and Investments expose Keep stored / Rebuild this symbol', () => {
    const panel = read('components/investments/HoldingsQtyIntegrityPanel.tsx');
    expect(panel).toContain('Rebuild this symbol');
    expect(panel).toContain('Keep stored');
    expect(panel).toContain('listLedgerSymbolsMissingFromHoldings');
    expect(panel).toContain('rebuildHoldingsFromLedgerForSymbols');
    expect(read('pages/SystemHealth.tsx')).toContain('HoldingsQtyIntegrityPanel');
    expect(read('pages/Investments.tsx')).toContain('HoldingsQtyIntegrityPanel');
  });

  it('buildHoldingsQtyDriftReport uses portfolio_id–scoped ledger only', () => {
    const rows = buildHoldingsQtyDriftReport({
      investments: [
        {
          id: 'pf1',
          name: 'Awaed',
          accountId: 'acc1',
          currency: 'USD',
          holdings: [
            {
              id: 'h1',
              symbol: 'AAPL',
              quantity: 10,
              avgCost: 100,
              currentValue: 1000,
              zakahClass: 'Zakatable',
            },
          ],
        },
      ],
      investmentTransactions: [
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
          id: 'orphan-buy',
          accountId: 'acc1',
          date: '2026-02-01',
          type: 'buy',
          symbol: 'AAPL',
          quantity: 50,
          price: 100,
          total: 5000,
        },
      ],
      accounts: [],
    });
    const aapl = rows.find((r) => r.symbol === 'AAPL');
    expect(aapl?.ledgerQuantity).toBe(10);
    expect(aapl?.ok).toBe(true);
  });
});
