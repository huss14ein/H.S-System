import { describe, it, expect } from 'vitest';
import {
  inferEngineSleeveKeyFromHolding,
  engineSleeveKeyToTickerStatus,
} from '../services/inferHoldingUniverseClassification';
import type { Holding } from '../types';

function h(partial: Partial<Holding> & Pick<Holding, 'symbol'>): Holding {
  return {
    id: partial.id ?? 'x',
    symbol: partial.symbol,
    name: partial.name,
    quantity: partial.quantity ?? 1,
    avgCost: partial.avgCost ?? 10,
    currentValue: partial.currentValue ?? 10,
    zakahClass: partial.zakahClass ?? 'Zakatable',
    realizedPnL: partial.realizedPnL ?? 0,
    assetClass: partial.assetClass,
  };
}

describe('inferEngineSleeveKeyFromHolding', () => {
  it('classifies broad indices / funds as core', () => {
    expect(inferEngineSleeveKeyFromHolding(h({ symbol: 'VOO', assetClass: 'ETF' }))).toBe('core');
    expect(inferEngineSleeveKeyFromHolding(h({ symbol: 'X', assetClass: 'Mutual Fund' }))).toBe('core');
    expect(inferEngineSleeveKeyFromHolding(h({ symbol: 'REIT', assetClass: 'REIT' }))).toBe('core');
  });

  it('classifies volatile sleeves as speculative', () => {
    expect(inferEngineSleeveKeyFromHolding(h({ symbol: 'BTC', assetClass: 'Cryptocurrency' }))).toBe('speculative');
    expect(inferEngineSleeveKeyFromHolding(h({ symbol: 'PE', assetClass: 'Private Equity' }))).toBe('speculative');
  });

  it('defaults stocks to high-upside', () => {
    expect(inferEngineSleeveKeyFromHolding(h({ symbol: 'AAPL', assetClass: 'Stock' }))).toBe('high-upside');
    expect(engineSleeveKeyToTickerStatus('high-upside')).toBe('High-Upside');
  });

  it('uses name heuristics when asset class missing', () => {
    expect(inferEngineSleeveKeyFromHolding(h({ symbol: 'XYZ', name: 'Global ETF Trust' }))).toBe('core');
    expect(inferEngineSleeveKeyFromHolding(h({ symbol: 'ZZ', name: 'Some Stock Inc' }))).toBe('high-upside');
  });
});
