/**
 * Open-lot alignment to sold qty + WAC book, and holding cost reconcile wiring.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  alignOpenLotsToTargetQuantity,
  rescaleOpenLotsToTargetBookCost,
  sumOpenLotBookCost,
  sumOpenLotQuantity,
  summarizeSymbolTradeQuantities,
} from '../services/alignOpenLotsToHolding';
import { previewHoldingQuantityReconcile, resolveHoldingReconcileBook } from '../services/reconciliation';
import type { InvestmentCostLot, InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function lot(partial: Partial<InvestmentCostLot> & Pick<InvestmentCostLot, 'id' | 'quantityRemaining' | 'costPerShare'>): InvestmentCostLot {
  return {
    portfolioId: 'pf-1',
    symbol: 'SNAP',
    market: 'US',
    acquisitionDate: '2026-01-01',
    bookCurrency: 'USD',
    ...partial,
  };
}

describe('alignOpenLotsToHolding — sold quantity', () => {
  it('FIFO-consumes excess open lots when holding qty is lower (sold / reconciled down)', () => {
    const lots = [
      lot({ id: 'a', acquisitionDate: '2026-01-01', quantityRemaining: 100, costPerShare: 5 }),
      lot({ id: 'b', acquisitionDate: '2026-02-01', quantityRemaining: 50, costPerShare: 4 }),
    ];
    const { lots: next, consumedQty } = alignOpenLotsToTargetQuantity(lots, 'SNAP', 120);
    expect(consumedQty).toBe(30);
    expect(sumOpenLotQuantity(next)).toBe(120);
    // Oldest lot reduced first: 100 → 70, second untouched at 50.
    const open = next.filter((l) => l.symbol === 'SNAP');
    expect(open.find((l) => l.id === 'a')?.quantityRemaining).toBe(70);
    expect(open.find((l) => l.id === 'b')?.quantityRemaining).toBe(50);
  });

  it('rescales lot costs so FIFO book matches WAC purchased cost (SNAP-style gap)', () => {
    const lots = [
      lot({ id: '1', quantityRemaining: 60, costPerShare: 5.55 }),
      lot({ id: '2', quantityRemaining: 40, costPerShare: 4.5 }),
    ];
    // Open book ≈ 333 + 180 = 513; WAC book e.g. 550
    const scaled = rescaleOpenLotsToTargetBookCost(lots, 'SNAP', 550);
    expect(sumOpenLotBookCost(scaled)).toBeCloseTo(550, 1);
    expect(sumOpenLotQuantity(scaled)).toBe(100);
  });

  it('summarizeSymbolTradeQuantities counts buys and sells', () => {
    const txs: InvestmentTransaction[] = [
      { id: '1', accountId: 'a', date: '2026-01-01', type: 'buy', symbol: 'SNAP', quantity: 200, price: 5, total: 1000, portfolioId: 'pf-1' },
      { id: '2', accountId: 'a', date: '2026-03-01', type: 'sell', symbol: 'SNAP', quantity: 50, price: 6, total: 300, portfolioId: 'pf-1' },
      { id: 'orphan', accountId: 'a', date: '2026-02-01', type: 'buy', symbol: 'SNAP', quantity: 999, price: 5, total: 4995 },
    ];
    const s = summarizeSymbolTradeQuantities(txs, 'SNAP', { portfolioId: 'pf-1' });
    expect(s.boughtQty).toBe(200);
    expect(s.soldQty).toBe(50);
    expect(s.netQty).toBe(150);
  });
});

describe('holding cost reconcile preview', () => {
  it('allows cost-only restatement when qty unchanged', () => {
    const preview = previewHoldingQuantityReconcile({
      holdingId: 'h1',
      beforeQty: 250,
      actualQty: 250,
      beforeAvgCost: 5.3448,
      targetAvgCost: 5.0,
      reason: 'Match broker avg',
    });
    expect(preview.noop).toBe(false);
    expect(preview.blockedReason).toBeUndefined();
    expect(preview.impacts.some((i) => /Cost basis/i.test(i))).toBe(true);
  });

  it('alignLotCostsToBook=true is not a holding noop when qty and cost are unchanged', () => {
    const preview = previewHoldingQuantityReconcile({
      holdingId: 'h1',
      beforeQty: 250,
      actualQty: 250,
      beforeAvgCost: 5.3448,
      targetBookCost: 250 * 5.3448,
      alignLotCostsToBook: true,
      reason: 'Align open lots to holding book',
    });
    expect(preview.noop).toBe(false);
    expect(preview.impacts.some((i) => /open lots will be trimmed/i.test(i))).toBe(true);
  });

  it('still requires add-cost or full book when increasing qty', () => {
    const blocked = previewHoldingQuantityReconcile({
      holdingId: 'h1',
      beforeQty: 250,
      actualQty: 260,
      beforeAvgCost: 5,
      reason: 'Bought more',
    });
    expect(blocked.blockedReason).toMatch(/cost/i);
  });

  it('qty-down without cost restatement keeps WAC (does not force proportional book)', () => {
    const preview = previewHoldingQuantityReconcile({
      holdingId: 'h1',
      beforeQty: 150,
      actualQty: 50,
      beforeAvgCost: 10,
      reason: 'Match broker qty after sell',
    });
    expect(preview.blockedReason).toBeUndefined();
    expect(preview.delta).toBe(-100);
    // Book shrinks with qty but avg stays 10 — impacts should still mention cost basis change.
    expect(preview.impacts.some((i) => /avg 10\.0000 → 10\.0000/i.test(i) || /Cost basis 1500\.00 → 500\.00/i.test(i))).toBe(
      true,
    );
  });

  it('qty-up prefers add-share cost over a proportional target book', () => {
    const resolved = resolveHoldingReconcileBook({
      beforeQty: 100,
      actualQty: 120,
      beforeAvgCost: 10,
      // Proportional auto book would be 1200 — wrong when adds cost 300.
      targetBookCost: 1200,
      costBasisTotal: 300,
    });
    expect(resolved.mode).toBe('add_cost');
    expect(resolved.bookCost).toBe(1300);
    expect(resolved.avgCost).toBeCloseTo(1300 / 120, 4);
  });

  it('qty-down preview is explicit non-cash (not a withdrawal / sell)', () => {
    const preview = previewHoldingQuantityReconcile({
      holdingId: 'h1',
      beforeQty: 250,
      actualQty: 200,
      beforeAvgCost: 5,
      reason: 'Match broker statement qty',
    });
    expect(preview.delta).toBe(-50);
    expect(preview.blockedReason).toBeUndefined();
    expect(preview.impacts.some((i) => /non-cash/i.test(i))).toBe(true);
    expect(preview.impacts.some((i) => /not a cash withdrawal/i.test(i))).toBe(true);
    expect(preview.impacts.every((i) => !/\bwithdrawn action\b/i.test(i))).toBe(true);
    expect(preview.impacts.every((i) => !/treated as sold/i.test(i))).toBe(true);
  });
});

describe('holding reconcile UI wiring', () => {
  it('ReconcileQuantityModal only sends cost restatement when avg/book are user-dirty', () => {
    const modal = read('components/reconciliation/ReconcileQuantityModal.tsx');
    expect(modal).toContain('avgDirty');
    expect(modal).toContain('bookDirty');
    expect(modal).toContain('does not mark book dirty');
    expect(modal).toContain('not applied unless you edit it');
    expect(modal).toContain('roundQuantity');
    expect(modal).toContain('Average cost');
    expect(modal).toContain('Total cost basis');
    expect(modal).toContain('targetAvgCost');
    expect(modal).toContain('targetBookCost');
    expect(modal).toContain('alignLotCostsToBook');
    expect(modal).toContain('alignLotCostsToBook: alignLotCosts');
    expect(modal).toContain('Reconcile holding');
    // Must not treat any bookStr ≠ beforeBook as intentional (old bug).
    expect(modal).not.toContain('Math.abs(targetBookCost - beforeBook) > 0.004');
  });

  it('HoldingLotsPanel shows sold ledger summary and align action', () => {
    const panel = read('components/investments/HoldingLotsPanel.tsx');
    expect(panel).toContain('summarizeSymbolTradeQuantities');
    expect(panel).toContain('sold');
    expect(panel).toContain('Align open lots to book');
    expect(panel).toContain('WAC purchased cost');
  });

  it('Investments page passes cost fields into applyReconciliationAdjustment', () => {
    const inv = read('pages/Investments.tsx');
    expect(inv).toContain('targetAvgCost');
    expect(inv).toContain('targetBookCost');
    expect(inv).toContain('alignLotCostsToBook');
    expect(inv).toContain('onAlignLotsToBook');
    expect(inv).toContain('Reconcile quantity / avg cost');
    expect(inv).toContain('liveReconcileQtyHolding');
  });

  it('holding qty apply path never posts broker cash withdrawal/deposit', () => {
    const orch = read('services/reconciliation/orchestrator.ts');
    const start = orch.indexOf('async function applyHoldingQty');
    const end = orch.indexOf('\nexport async function orchestrateReverseReconciliation', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = orch.slice(start, end);
    expect(body).toContain('non-cash book correction');
    expect(body).toContain('resolveHoldingReconcileBook');
    expect(body).toContain('markUnit');
    expect(body).toContain("portfolio.currency === 'SAR' ? 'SAR' : 'USD'");
    // Invocation sites only — comments may mention cash helpers as negatives.
    expect(body).not.toMatch(/deps\.recordBrokerCashAdjust\s*\(/);
    expect(body).not.toMatch(/deps\.addTransaction\s*\(/);
    expect(body).not.toMatch(/buildBrokerCashReconcileInvestmentRow\s*\(/);
    expect(body).not.toMatch(/type:\s*'withdrawal'/);
    expect(body).not.toMatch(/type:\s*'deposit'/);
  });

  it('syncLotsAfterTrade aligns open lots to holding qty after rebuild', () => {
    const sync = read('services/portfolioLedgerSync.ts');
    expect(sync).toContain('alignPortfolioOpenLotsToHoldings');
    expect(sync).toContain('persistInvestmentCostLotsForSymbols');
    expect(sync).toContain('yieldDuringReplay: false');
    expect(sync).toContain('narrowLotReplayToTouchedSymbols');
  });

  it('orchestrator cost-aligns open lots whenever align is requested (not only when cost restated)', () => {
    const orch = read('services/reconciliation/orchestrator.ts');
    expect(orch).toContain('persistAlignedLotsForPortfolio');
    expect(orch).toContain('input.alignLotCostsToBook !== false && newQty > 0');
    expect(orch).not.toContain('costRestated && newQty > 0');
  });

  it('integrity panel wires holding qty/avg and Align action', () => {
    const panel = read('components/investments/HoldingsQtyIntegrityPanel.tsx');
    expect(panel).toContain('holdingQty={holding?.quantity}');
    expect(panel).toContain('holdingAvgCost={holding?.avgCost}');
    expect(panel).toContain('onAlignLotsToBook');
    const inv = read('pages/Investments.tsx');
    expect(inv).toContain('HoldingsQtyIntegrityPanel');
    expect(inv).toMatch(/onAlignLotsToBook=\{/);
  });

  it('DataContext exposes persistAlignedLotsForPortfolio for reconcile apply', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('persistAlignedLotsForPortfolio');
  });

  it('ReconcileBalanceModal submits parseReconcileActualBalanceInput so statement amount is exact', () => {
    const modal = read('components/reconciliation/ReconcileBalanceModal.tsx');
    expect(modal).toContain('parseReconcileActualBalanceInput');
    expect(modal).toContain('actualValue: actual');
  });
});
