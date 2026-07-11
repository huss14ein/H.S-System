/**
 * Corporate actions replay + apply helpers.
 */
import { describe, it, expect } from 'vitest';
import { applyCorporateAction } from '../services/corporateActions';
import { applyCorporateActionToHoldings } from '../services/corporateActionApply';
import { allocateFifoSell } from '../services/investmentCostLots';

describe('corporateActionsReplay', () => {
  it('applies spinoff cost allocation', () => {
    const result = applyCorporateAction({
      action: {
        type: 'spinoff',
        linkedSymbol: 'CHILD',
        costBasisAllocationPct: 0.2,
        ratioNumerator: 1,
        ratioDenominator: 10,
      },
      holding: { quantity: 100, avgCost: 50 },
    });
    expect(result.spinoffGrant?.symbol).toBe('CHILD');
    expect(result.avgCost).toBeCloseTo(40, 4);
  });

  it('updates holdings map for merger', () => {
    const next = applyCorporateActionToHoldings(
      [
        {
          id: 'h1',
          symbol: 'OLD',
          name: 'Old Co',
          quantity: 10,
          avgCost: 100,
          currentValue: 1000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          assetClass: 'Stock',
        },
      ],
      'OLD',
      { type: 'merger', linkedSymbol: 'NEW', conversionRatio: 0.5 },
    );
    expect(next.some((h) => h.symbol === 'OLD')).toBe(false);
    expect(next.some((h) => h.symbol === 'NEW')).toBe(true);
  });

  it('FIFO sell allocates oldest lot first', () => {
    const { allocations } = allocateFifoSell(
      [
        {
          id: 'l1',
          symbol: '2222.SR',
          acquisitionDate: '2026-01-01',
          quantityRemaining: 5,
          costPerShare: 30,
          bookCurrency: 'SAR',
        },
        {
          id: 'l2',
          symbol: '2222.SR',
          acquisitionDate: '2026-03-01',
          quantityRemaining: 5,
          costPerShare: 35,
          bookCurrency: 'SAR',
        },
      ],
      '2222.SR',
      6,
      40,
    );
    expect(allocations[0]?.lotId).toBe('l1');
    expect(allocations[0]?.quantity).toBe(5);
    expect(allocations[1]?.lotId).toBe('l2');
    expect(allocations[1]?.quantity).toBe(1);
  });
});
