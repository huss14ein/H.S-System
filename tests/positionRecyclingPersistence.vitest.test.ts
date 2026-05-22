import { describe, expect, it, beforeEach } from 'vitest';
import {
  loadRecyclingPrefs,
  saveRecyclingPrefs,
  getRecyclingExecutionsBySymbol,
  saveRecyclingExecutionFromPlan,
  __resetRecyclingPersistenceForTests,
} from '../services/positionRecyclingPersistence';
import { generatePositionRecyclingPlan } from '../services/positionRecyclingPlan';

describe('positionRecyclingPersistence', () => {
  beforeEach(() => {
    __resetRecyclingPersistenceForTests();
    try {
      localStorage?.clear?.();
    } catch {
      /* node test env */
    }
  });

  it('saves and loads per-symbol prefs', () => {
    saveRecyclingPrefs('INSP', {
      convictionGrade: 'B',
      stockQualityStatus: 'Medium',
      minRebuyDiscountPercent: 12,
      avoidSellingBelowAverage: true,
      allowSellNearLoss: true,
    });
    const loaded = loadRecyclingPrefs('insp');
    expect(loaded?.convictionGrade).toBe('B');
    expect(loaded?.minRebuyDiscountPercent).toBe(12);
    expect(loaded?.avoidSellingBelowAverage).toBe(true);
  });

  it('records execution from plan', () => {
    const plan = generatePositionRecyclingPlan({
      ticker: 'INSP',
      companyName: 'Inspire',
      currentPrice: 44.74,
      averageCost: 51.61,
      sharesOwned: 80,
      convictionGrade: 'B',
      stockQualityStatus: 'Medium',
      allowOptions: false,
      hasMinimum100Shares: false,
    });
    saveRecyclingExecutionFromPlan(plan);
    const rows = getRecyclingExecutionsBySymbol('INSP');
    expect(rows.length).toBe(1);
    expect(rows[0].planAvailable).toBe(true);
    expect(rows[0].trancheCount).toBe(3);
  });
});
