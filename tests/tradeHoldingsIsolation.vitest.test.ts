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

  it('persistHoldingsFromReplayMap collapses duplicate symbol rows (never leaves LCID ghosts)', async () => {
    const portfolio: InvestmentPortfolio = {
      id: 'pf1',
      name: 'T',
      accountId: 'acc1',
      currency: 'USD',
      holdings: [
        {
          id: 'h-lcid-a',
          symbol: 'LCID',
          quantity: 500,
          avgCost: 4,
          currentValue: 2000,
          zakahClass: 'Zakatable',
        },
        {
          id: 'h-lcid-b',
          symbol: 'LCID',
          quantity: 1390,
          avgCost: 4,
          currentValue: 5000,
          zakahClass: 'Zakatable',
        },
        {
          id: 'h-unh',
          symbol: 'UNH',
          quantity: 15,
          avgCost: 300,
          currentValue: 4500,
          zakahClass: 'Zakatable',
        },
      ],
    };
    const deleted: string[] = [];
    const updated: Holding[] = [];
    await persistHoldingsFromReplayMap({
      portfolio,
      replayed: new Map([['LCID', { quantity: 500, avgCost: 4 }]]),
      updateHolding: async (h) => {
        updated.push(h);
      },
      addHolding: async () => {
        throw new Error('must not add');
      },
      deleteHolding: async (id) => {
        deleted.push(id);
      },
      symbols: ['LCID'],
    });
    expect(deleted).toHaveLength(1);
    expect(deleted[0] === 'h-lcid-a' || deleted[0] === 'h-lcid-b').toBe(true);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.quantity).toBe(500);
    expect(updated[0]?.quantity).not.toBe(1890);
  });

  it('DataContext addHolding refuses duplicate portfolio+symbol inserts', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('refusing duplicate insert');
    expect(ctx).toContain('Never insert a second row for the same portfolio+symbol');
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

  it('rebuildHoldingsFromLedger does not preserve stored quantity for a sell-only repair', async () => {
    const holding: Holding = {
      id: 'h1',
      symbol: 'LCID',
      quantity: 60,
      avgCost: 5,
      currentValue: 420,
      zakahClass: 'Zakatable',
    };
    const portfolio: InvestmentPortfolio = {
      id: 'pf1',
      name: 'T',
      accountId: 'acc1',
      currency: 'USD',
      holdings: [holding],
    };
    const sell: InvestmentTransaction = {
      id: 's1',
      portfolioId: 'pf1',
      accountId: 'acc1',
      date: '2026-07-01',
      type: 'sell',
      symbol: 'LCID',
      quantity: 40,
      price: 7,
      total: 280,
    };
    const deleteHolding = vi.fn(async () => {});

    await rebuildHoldingsFromLedger({
      portfolio,
      investmentTransactions: [sell],
      corporateActionEvents: [],
      symbols: ['LCID'],
      updateHolding: async () => {},
      addHolding: async () => {},
      deleteHolding,
    });

    expect(deleteHolding).toHaveBeenCalledWith('h1');
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
    // Trade prep must never sum duplicates (LCID 500+1390→1890).
    expect(ctx).not.toContain('consolidateHoldingsBySymbol(symbolHoldingsForTrade)');
    expect(ctx).toContain('duplicateHoldingIdsForTrade');
    expect(ctx).toContain('resolveDuplicateHoldingsGroup');
    // syncLotsAfterTrade is nested inside the buy/sell block (not after dividend).
    const buySellBlock = ctx.slice(
      ctx.indexOf("if (tradeData.type === 'buy' || tradeData.type === 'sell')"),
      ctx.indexOf("if (tradeData.type === 'buy') {"),
    );
    expect(buySellBlock).toContain('applyPositionDeltaForTrade');
    expect(buySellBlock).toContain('syncLotsAfterTrade');
    expect(buySellBlock).not.toContain('persistHoldingsFromReplayMap');
  });

  it('sealHoldingsBookAfterTrade bumps generation and writes hydrate cache', () => {
    const ctx = read('context/DataContext.tsx');
    const sealStart = ctx.indexOf('const sealHoldingsBookAfterTrade = () =>');
    expect(sealStart).toBeGreaterThan(-1);
    const sealBody = ctx.slice(sealStart, sealStart + 350);
    expect(sealBody).toContain('bumpHoldingsBookGeneration');
    expect(sealBody).toContain('writeWorkspaceHydrateCache');
    expect(ctx).toContain('Skipping stale investments hydrate');
    expect(ctx).toContain('investmentsStale ? prev.investments');
  });

  it('trade prep with duplicate LCID keeps exact ledger match qty 500 (never 1890) then applies delta', async () => {
    const { resolveDuplicateHoldingsGroup } = await import('../services/holdingsDedupe');
    const holdings: Holding[] = [
      {
        id: 'h-new',
        symbol: 'LCID',
        quantity: 500,
        avgCost: 4,
        currentValue: 2000,
        zakahClass: 'Zakatable',
      },
      {
        id: 'h-ghost',
        symbol: 'LCID',
        quantity: 1390,
        avgCost: 4,
        currentValue: 5000,
        zakahClass: 'Zakatable',
      },
      {
        id: 'h-unh',
        symbol: 'UNH',
        quantity: 15,
        avgCost: 300,
        currentValue: 4500,
        zakahClass: 'Zakatable',
      },
    ];
    const lcidDupes = holdings.filter((h) => h.symbol === 'LCID');
    const resolved = resolveDuplicateHoldingsGroup({
      portfolioId: 'pf-awaed',
      symbol: 'LCID',
      holdings: lcidDupes,
      transactions: [{ portfolioId: 'pf-awaed', symbol: 'LCID', type: 'buy', quantity: 500 }],
    });
    expect(resolved.keep.quantity).toBe(500);
    expect(resolved.keep.quantity).not.toBe(1890);

    const updateHolding = vi.fn(async (h: Holding) => {
      const i = holdings.findIndex((x) => x.id === h.id);
      if (i >= 0) holdings[i] = h;
    });
    const deleteHolding = vi.fn(async (id: string) => {
      const i = holdings.findIndex((x) => x.id === id);
      if (i >= 0) holdings.splice(i, 1);
    });

    await applyPositionDeltaForTrade({
      portfolioId: 'pf-awaed',
      symbol: 'LCID',
      side: 'buy',
      quantity: 10,
      price: 5,
      existingHolding: resolved.keep,
      duplicateHoldingIds: resolved.deleteIds,
      updateHolding,
      addHolding: async () => {},
      deleteHolding,
    });

    expect(deleteHolding).toHaveBeenCalledWith('h-ghost');
    expect(holdings.filter((h) => h.symbol === 'LCID')).toHaveLength(1);
    expect(holdings.find((h) => h.symbol === 'LCID')?.quantity).toBe(510);
    expect(holdings.find((h) => h.symbol === 'UNH')?.quantity).toBe(15);
  });

  it('buy MSFT leaves other open holdings unchanged and does not resurrect closed NVDA', async () => {
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
    const addHolding = vi.fn(async () => {});
    await applyPositionDeltaForTrade({
      portfolioId: 'pf1',
      symbol: 'MSFT',
      side: 'buy',
      quantity: 2,
      price: 120,
      existingHolding: holdings.find((h) => h.symbol === 'MSFT')!,
      updateHolding,
      addHolding,
      deleteHolding: async () => {},
    });
    expect(holdings.find((h) => h.symbol === 'UNH')?.quantity).toBe(15);
    expect(holdings.find((h) => h.symbol === 'MSFT')?.quantity).toBe(7);
    expect(holdings.find((h) => h.symbol === 'NVDA')).toBeUndefined();
    expect(addHolding).not.toHaveBeenCalled();
  });

  it('non-DRIP dividend path never calls addHolding or qty updateHolding (wiring)', () => {
    const ctx = read('context/DataContext.tsx');
    const dripStart = ctx.indexOf('const dripHolding = existingHolding');
    expect(dripStart).toBeGreaterThan(-1);
    const afterDiv = ctx.indexOf("try {\n            if (!portfolio) throw new Error('Portfolio not found');", dripStart);
    const divBlock = ctx.slice(Math.max(0, dripStart - 500), afterDiv);
    expect(divBlock).toContain("if (tradeData.type === 'dividend')");
    expect(divBlock).toContain('sealHoldingsBookAfterTrade');
    expect(divBlock).not.toContain('addHolding');
    expect(divBlock).not.toContain('updateHolding');
    expect(divBlock).not.toContain('deleteHolding');
    expect(divBlock).not.toContain('applyPositionDeltaForTrade');
    expect(divBlock).not.toContain('persistHoldingsFromReplayMap');
  });

  it('DRIP nests recordTrade buy for same symbol only (wiring)', () => {
    const ctx = read('context/DataContext.tsx');
    const dripStart = ctx.indexOf('const dripHolding = existingHolding');
    const afterDiv = ctx.indexOf("try {\n            if (!portfolio) throw new Error('Portfolio not found');", dripStart);
    const divBlock = ctx.slice(Math.max(0, dripStart - 500), afterDiv);
    expect(divBlock).toContain("dividendDistribution === 'Reinvest'");
    expect(divBlock).toContain("type: 'buy'");
    expect(divBlock).toContain('symbol: normalizedSymbol');
    expect(divBlock).toContain('idempotencyKey: `drip|');
    expect(divBlock).toContain('await recordTrade(');
    // Nested buy goes through recordTrade → applyPositionDeltaForTrade for S only (buy/sell block).
    expect(ctx).toContain('applyPositionDeltaForTrade');
  });

  it('non-DRIP dividend skips position delta; DRIP nests a buy for the same symbol only', () => {
    const ctx = read('context/DataContext.tsx');
    const dripStart = ctx.indexOf('const dripHolding = existingHolding');
    expect(dripStart).toBeGreaterThan(-1);
    const afterDiv = ctx.indexOf("try {\n            if (!portfolio) throw new Error('Portfolio not found');", dripStart);
    expect(afterDiv).toBeGreaterThan(dripStart);
    const divBlock = ctx.slice(Math.max(0, dripStart - 500), afterDiv);
    expect(divBlock).toContain("if (tradeData.type === 'dividend')");
    expect(divBlock).toContain("dividendDistribution === 'Reinvest'");
    expect(divBlock).toContain("type: 'buy'");
    expect(divBlock).toContain('idempotencyKey: `drip|');
    expect(divBlock).toContain('sealHoldingsBookAfterTrade');
    expect(divBlock).toContain('return {');
    expect(divBlock).not.toContain('applyPositionDeltaForTrade');
    expect(divBlock).not.toContain('syncLotsAfterTrade');
    expect(divBlock).not.toContain('persistHoldingsFromReplayMap');
  });

  it('resolveDuplicateHoldingsGroup never sums LCID 500+1390 into 1890', async () => {
    const { resolveDuplicateHoldingsGroup } = await import('../services/holdingsDedupe');
    const resolved = resolveDuplicateHoldingsGroup({
      portfolioId: 'pf-awaed',
      symbol: 'LCID',
      holdings: [
        {
          id: 'h-new',
          symbol: 'LCID',
          quantity: 500,
          avgCost: 4,
          currentValue: 2000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
        },
        {
          id: 'h-ghost',
          symbol: 'LCID',
          quantity: 1390,
          avgCost: 4,
          currentValue: 5000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
        },
      ],
      transactions: [
        {
          portfolioId: 'pf-awaed',
          symbol: 'LCID',
          type: 'buy',
          quantity: 500,
        },
      ],
    });
    expect(resolved.keep.quantity).toBe(500);
    expect(resolved.keep.id).toBe('h-new');
    expect(resolved.deleteIds).toEqual(['h-ghost']);
    expect(resolved.disagreed).toBe(true);
    expect(resolved.keep.quantity).not.toBe(1890);
  });

  it('resolveDuplicateHoldingsGroup does not prefer nearest drift when ledger is inflated', async () => {
    const { resolveDuplicateHoldingsGroup } = await import('../services/holdingsDedupe');
    // Ledger still nets 1890 (incomplete sells) but stored rows are 500 + 1390 — must NOT pick 1390 via drift.
    const resolved = resolveDuplicateHoldingsGroup({
      portfolioId: 'pf-awaed',
      symbol: 'LCID',
      holdings: [
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000500',
          symbol: 'LCID',
          quantity: 500,
          avgCost: 4,
          currentValue: 2000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
        },
        {
          id: 'bbbbbbbb-0000-4000-8000-000000001390',
          symbol: 'LCID',
          quantity: 1390,
          avgCost: 4,
          currentValue: 5000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
        },
      ],
      transactions: [
        { portfolioId: 'pf-awaed', symbol: 'LCID', type: 'buy', quantity: 1890 },
      ],
    });
    expect(resolved.keep.quantity + resolved.discardedQuantities.reduce((a, b) => a + b, 0)).toBe(1890);
    expect(resolved.keep.quantity).not.toBe(1890);
    // No exact match → newest id wins (bbbb… > aaaa…)
    expect(resolved.keep.id).toBe('bbbbbbbb-0000-4000-8000-000000001390');
    expect(resolved.keep.quantity).toBe(1390);
  });

  it('DataContext auto-heal uses resolveDuplicateHoldingsGroup (not sum merge)', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('resolveDuplicateHoldingsGroup');
    expect(ctx).toContain('never sum');
    expect(ctx).toContain('holdingsBookGenerationRef');
    expect(ctx).toContain('sealHoldingsBookAfterTrade');
    expect(ctx).toContain('Skipping stale investments hydrate');
    // Disagreeing-qty auto-heal must not call consolidateHoldingsBySymbol for the merge.
    const healStart = ctx.indexOf('Auto-heal legacy duplicate holdings');
    expect(healStart).toBeGreaterThan(-1);
    const healBlock = ctx.slice(healStart, healStart + 2500);
    expect(healBlock).toContain('resolveDuplicateHoldingsGroup');
    expect(healBlock).not.toContain('consolidateHoldingsBySymbol(group)');
    expect(healBlock).not.toContain('await updateHolding(merged)');
  });

  it('Rebuild (re-open) confirm warns about sold positions', () => {
    const panel = read('components/investments/HoldingsQtyIntegrityPanel.tsx');
    expect(panel).toContain('RE-OPEN sold position');
    expect(panel).toContain('Keep closed');
    expect(panel).toContain('reopenSold');
  });

  it('migration enforces unique holdings per portfolio symbol', () => {
    const mig = read('supabase/migrations/20260722120000_holdings_unique_per_portfolio_symbol.sql');
    expect(mig).toContain('holdings_user_portfolio_symbol_uidx');
    expect(mig).toContain('DELETE FROM public.holdings');
    expect(read('supabase/README_DB_MIGRATIONS.md')).toContain('20260722120000_holdings_unique_per_portfolio_symbol.sql');
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
