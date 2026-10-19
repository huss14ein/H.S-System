import { describe, expect, it } from 'vitest';
import {
  calculateBudgetHealthMetrics,
  generateSmartBudgetRecommendations,
  type DynamicBaseline,
  type SpendingPattern,
} from '../services/enhancedBudgetEngine';

describe('enhancedBudgetEngine yearly plan gate', () => {
  it('does not treat lumpy yearly rent as overrun while YTD within annual plan', () => {
    const metrics = calculateBudgetHealthMetrics(
      [
        {
          category: 'Housing Rent',
          limit: 10_000,
          spent: 60_000,
          period: 'yearly',
          annualLimit: 120_000,
          ytdSpent: 60_000,
        },
      ],
      [],
    );
    expect(metrics.adherenceScore).toBe(100);
    expect(metrics.stressResilience).toBe(100);
  });

  it('skips smart increase recommendations for yearly plan still within annual cap', () => {
    const baselines: DynamicBaseline[] = [
      {
        category: 'Housing Rent',
        baselineAmount: 10_000,
        confidenceInterval: { lower: 8_000, upper: 12_000 },
        trendDirection: 'increasing',
        trendStrength: 0.5,
        seasonalityFactor: 1,
        lastUpdated: new Date(),
      },
    ];
    const patterns: SpendingPattern[] = [
      {
        category: 'Housing Rent',
        avgMonthlySpend: 10_000,
        volatility: 2_000,
        weekendSpendRatio: 0.2,
        impulseSpendRatio: 0.1,
        recurringVsDiscretionary: 0.9,
        merchantConcentration: 0.3,
        priceElasticity: 0.5,
      },
    ];
    const recs = generateSmartBudgetRecommendations(
      [
        {
          category: 'Housing Rent',
          limit: 120_000,
          spent: 60_000,
          period: 'yearly',
          annualLimit: 120_000,
          ytdSpent: 60_000,
        },
      ],
      baselines,
      patterns,
      20_000,
    );
    expect(recs).toHaveLength(0);
  });
});
