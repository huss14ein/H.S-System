/**
 * Corporate action apply — prevent double-split and orphan-tx portfolio bleed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  filterTransactionsForPortfolio,
  replayPortfolioHoldingsFromEvents,
} from '../services/corporateActionApply';
import { recalculateCostBasisAfterAction } from '../services/corporateActions';
import { scaleQuotesForCorporateAction } from '../services/corporateActionQuoteAdjust';
import type { CorporateActionEvent, InvestmentPortfolio, InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('corporateActionApplyGuards', () => {
  const manualPortfolio = (holdings: InvestmentPortfolio['holdings']): InvestmentPortfolio => ({
    id: 'saham-pf',
    name: 'Saham Saudi Market',
    accountId: 'acc1',
    holdings,
  });

  it('does not absorb orphan investment txs missing portfolioId', () => {
    const orphan: InvestmentTransaction = {
      id: 'orphan-buy',
      accountId: 'acc1',
      date: '2026-01-01',
      type: 'buy',
      symbol: 'LCID',
      quantity: 1890,
      price: 4,
      total: 7560,
      // portfolioId intentionally missing
    };
    const scoped: InvestmentTransaction = {
      id: 'scoped-buy',
      portfolioId: 'saham-pf',
      accountId: 'acc1',
      date: '2026-01-01',
      type: 'buy',
      symbol: '1831.SR',
      quantity: 100,
      price: 50,
      total: 5000,
    };
    const filtered = filterTransactionsForPortfolio('saham-pf', [orphan, scoped]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.symbol).toBe('1831.SR');
  });

  it('as_stored + delta-only event does not double-apply a prior split on another symbol', async () => {
    /** After CA1 already applied to 1831.SR (10 → 100 via 10:1). */
    const portfolio = manualPortfolio([
      {
        id: 'h-1831',
        symbol: '1831.SR',
        name: 'Maharah',
        quantity: 100,
        avgCost: 5,
        currentValue: 550,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: 'Stock',
      },
      {
        id: 'h-other',
        symbol: '1120.SR',
        name: 'Al Rajhi',
        quantity: 10,
        avgCost: 80,
        currentValue: 900,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: 'Stock',
      },
    ]);

    const priorSplit: CorporateActionEvent = {
      id: 'ca-prior',
      portfolioId: 'saham-pf',
      actionType: 'stock_split',
      symbol: '1831.SR',
      executionDate: '2026-05-01',
      ratioNumerator: 10,
      ratioDenominator: 1,
      idempotencyKey: 'prior-split',
      status: 'applied',
    };
    const newSplit: CorporateActionEvent = {
      id: 'ca-new',
      portfolioId: 'saham-pf',
      actionType: 'stock_split',
      symbol: '1120.SR',
      executionDate: '2026-06-01',
      ratioNumerator: 2,
      ratioDenominator: 1,
      idempotencyKey: 'new-split',
      status: 'applied',
    };

    /** Bug path: as_stored + replay ALL events → 1831 doubles again (1000). */
    const buggy = await replayPortfolioHoldingsFromEvents({
      portfolio,
      transactions: [],
      corporateActionEvents: [priorSplit, newSplit],
      holdingsBaselineMode: 'as_stored',
    });
    expect(buggy.get('1831.SR')?.quantity).toBeCloseTo(1000, 4);

    /** Fixed path: as_stored + only the new event. */
    const fixed = await replayPortfolioHoldingsFromEvents({
      portfolio,
      transactions: [],
      corporateActionEvents: [priorSplit, newSplit],
      holdingsBaselineMode: 'as_stored',
      holdingsReplayEvents: [newSplit],
    });
    expect(fixed.get('1831.SR')?.quantity).toBeCloseTo(100, 4);
    expect(fixed.get('1120.SR')?.quantity).toBeCloseTo(20, 4);
    expect(fixed.get('1120.SR')?.avgCost).toBeCloseTo(40, 4);
  });

  it('orphan buys do not invent holdings on an unrelated manual portfolio', async () => {
    const portfolio = manualPortfolio([
      {
        id: 'h1',
        symbol: '1831.SR',
        name: 'Maharah',
        quantity: 50,
        avgCost: 10,
        currentValue: 500,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: 'Stock',
      },
    ]);
    const orphanBuy: InvestmentTransaction = {
      id: 'orphan-lcid',
      accountId: 'acc1',
      date: '2026-01-01',
      type: 'buy',
      symbol: 'LCID',
      quantity: 1890,
      price: 4.2,
      total: 7938,
    };
    const split: CorporateActionEvent = {
      id: 'ca1',
      portfolioId: 'saham-pf',
      actionType: 'stock_split',
      symbol: '1831.SR',
      executionDate: '2026-06-01',
      ratioNumerator: 2,
      ratioDenominator: 1,
      idempotencyKey: 'split-1831',
      status: 'applied',
    };
    const replayed = await replayPortfolioHoldingsFromEvents({
      portfolio,
      transactions: [orphanBuy],
      corporateActionEvents: [split],
      holdingsBaselineMode: 'as_stored',
      holdingsReplayEvents: [split],
    });
    expect(replayed.has('LCID')).toBe(false);
    expect(replayed.get('1831.SR')?.quantity).toBeCloseTo(100, 4);
  });

  it('legacy orphan buys for held symbols still participate in replay with a scoped sell', async () => {
    const { filterTransactionsForPortfolioReplay } = await import('../services/portfolioTransactionScope');
    const orphanBuy: InvestmentTransaction = {
      id: 'orphan-insp-buy',
      accountId: 'acc1',
      date: '2026-01-01',
      type: 'buy',
      symbol: 'INSP',
      quantity: 40,
      price: 50,
      total: 2000,
    };
    const scopedSell: InvestmentTransaction = {
      id: 'sell-insp',
      portfolioId: 'saham-pf',
      accountId: 'acc1',
      date: '2026-07-09',
      type: 'sell',
      symbol: 'INSP',
      quantity: 32,
      price: 49.5,
      total: 1584,
    };
    const otherAccountOrphan: InvestmentTransaction = {
      id: 'orphan-other-acc',
      accountId: 'acc-other',
      date: '2026-01-01',
      type: 'buy',
      symbol: 'INSP',
      quantity: 1000,
      price: 1,
      total: 1000,
    };
    const txs = filterTransactionsForPortfolioReplay({
      portfolioId: 'saham-pf',
      transactions: [orphanBuy, scopedSell, otherAccountOrphan],
      holdingSymbols: ['INSP'],
      accountId: 'acc1',
    });
    expect(txs.map((t) => t.id).sort()).toEqual(['orphan-insp-buy', 'sell-insp']);
  });

  it('rounds awkward split quantities instead of leaving float residue', () => {
    const result = recalculateCostBasisAfterAction({
      action: { type: 'stock_split', ratioNumerator: 19, ratioDenominator: 1 },
      holding: { quantity: 653.443713, avgCost: 92.1386 },
    });
    /** 8 dp max — not raw IEEE residue like …42105263158 */
    expect(String(result.quantity)).not.toMatch(/42105263158/);
    expect(result.quantity).toBe(roundExpect(653.443713 * 19));
  });

  it('scales quote aliases after a Tadawul split (1831 vs 1831.SR)', () => {
    const { prices, changed } = scaleQuotesForCorporateAction(
      {
        '1831': { price: 110, change: 2, changePercent: 1.8 },
        '1831.SR': { price: 110, change: 2, changePercent: 1.8 },
      },
      '1831.SR',
      { type: 'stock_split', ratioNumerator: 10, ratioDenominator: 1 },
    );
    expect(changed).toBe(true);
    expect(prices['1831']?.price).toBeCloseTo(11, 4);
    expect(prices['1831.SR']?.price).toBeCloseTo(11, 4);
  });

  it('DataContext apply/undo gate holdingsReplayEvents to manual portfolios', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('const manualOnly = !hasPositionAffectingTransactions(replayTxs)');
    expect(ctx).toContain('...(manualOnly ? { holdingsReplayEvents: [ev] } : {})');
    expect(ctx).toContain("holdingsBaselineMode: manualOnly ? 'as_stored' : 'replay_derived'");
  });

  it('Investments alloc uses displayed portfolioValue not KPI holdingsValue', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('const positionsTotalForAlloc = portfolioValue');
    expect(page).not.toMatch(/positionsTotalForAlloc = pk != null \? pk\.holdingsValue/);
  });
});

function roundExpect(n: number): number {
  const f = 1e8;
  return Math.round((n + Number.EPSILON) * f) / f;
}
