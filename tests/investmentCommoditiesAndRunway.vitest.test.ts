import { describe, expect, it } from 'vitest';
import type { FinancialData } from '../types';
import { computePersonalCommoditiesContributionSAR } from '../services/investmentPlatformCardMetrics';
import { getPersonalCommodityHoldings } from '../utils/wealthScope';
import { toSAR } from '../utils/currencyMath';
import { evaluateBuyAgainstPolicy, type TradingPolicy } from '../services/tradingPolicy';
import { totalLiquidCashSARFromAccounts } from '../utils/currencyMath';

const DEFAULT_POLICY: TradingPolicy = {
  minRunwayMonthsToAllowBuys: 1,
  maxPositionWeightPct: 35,
  blockBuysIfMonthlyNetNegative: false,
  requireAckLargeSellNotional: 25_000,
};

describe('investment commodities + runway policy regressions', () => {
  it('treats commodity currentValue/live price as SAR (no second FX conversion)', () => {
    const data = {
      commodityHoldings: [
        {
          id: 'c1',
          name: 'Gold',
          quantity: 2,
          unit: 'gram',
          purchaseValue: 700,
          currentValue: 750,
          symbol: 'XAU_GRAM_24K',
          zakahClass: 'Zakatable',
        },
      ],
    } as unknown as FinancialData;

    // live quote already SAR/unit
    const fromLive = computePersonalCommoditiesContributionSAR(data, 3.75, {
      XAU_GRAM_24K: { price: 400, change: 5 },
    });
    expect(fromLive.valueSAR).toBeCloseTo(800, 8);
    expect(fromLive.dailyDeltaSAR).toBeCloseTo(10, 8);

    // fallback to stored currentValue (also SAR)
    const fromStored = computePersonalCommoditiesContributionSAR(data, 3.75, {});
    expect(fromStored.valueSAR).toBeCloseTo(750, 8);
    expect(fromStored.dailyDeltaSAR).toBeCloseTo(0, 8);
  });

  it('sums commodity purchase cost in SAR without USD→SAR scaling (ROI net capital)', () => {
    const purchaseSar = 9400;
    const data = {
      commodityHoldings: [
        {
          id: 'c1',
          name: 'Gold',
          quantity: 20,
          unit: 'gram',
          purchaseValue: purchaseSar,
          currentValue: 9500,
          symbol: 'XAU_GRAM_24K',
          zakahClass: 'Zakatable',
        },
      ],
    } as unknown as FinancialData;

    const rate = 3.75;
    const allCommodities = getPersonalCommodityHoldings(data);
    const buggyUsdAsCurrency = allCommodities.reduce((sum, ch) => sum + toSAR(ch.purchaseValue ?? 0, 'USD', rate), 0);
    const fixedSarAsCurrency = allCommodities.reduce((sum, ch) => sum + toSAR(ch.purchaseValue ?? 0, 'SAR', rate), 0);
    expect(buggyUsdAsCurrency).toBeCloseTo(purchaseSar * rate, 8);
    expect(fixedSarAsCurrency).toBeCloseTo(purchaseSar, 8);
  });

  it('buy policy runway uses total liquid cash (cash + tradable platform cash)', () => {
    const accounts = [
      { id: 'chk', type: 'Checking', currency: 'SAR', balance: 6000 },
      { id: 'inv', type: 'Investment', currency: 'USD', balance: 0 },
    ];
    const totalLiquidSar = totalLiquidCashSARFromAccounts(
      accounts as Array<{ id: string; type?: string; balance?: number; currency?: 'USD' | 'SAR' }>,
      () => ({ SAR: 0, USD: 200 }), // tradable platform cash = 750 SAR
      3.75,
    );
    expect(totalLiquidSar).toBeCloseTo(6750, 8);

    const monthlyCoreExpenses = 3000;
    const runwayMonths = totalLiquidSar / monthlyCoreExpenses;
    const policyResult = evaluateBuyAgainstPolicy({
      policy: DEFAULT_POLICY,
      runwayMonths,
      monthlyNetLast30d: 0,
      positionWeightAfterBuyPct: 10,
    });
    expect(runwayMonths).toBeGreaterThan(2);
    expect(policyResult.allowed).toBe(true);
  });
});
