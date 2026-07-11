/**
 * Pie / portfolio allocation rows that reconcile to {@link computeHeadlinePersonalInvestmentRoiDecimal} total.
 */
import type { FinancialData, InvestmentPortfolio } from '../types';
import { toSAR } from '../utils/currencyMath';
import { effectiveHoldingValueInBookCurrency } from '../utils/holdingValuation';
import { getPersonalInvestments } from '../utils/wealthScope';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { normalizeInvestmentAssetClassBucket } from './investmentAssetClassBuckets';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';
import type { HeadlinePersonalInvestmentRoi } from './investmentKpiCore';
import { sumPersonalSukukPositionsSar } from './sukuk/sukukExposure';

export type HeadlineAllocationRow = { name: string; value: number };

export type HeadlineInvestmentAllocationSlices = {
  totalSar: number;
  platformHoldingsSar: number;
  platformCashSar: number;
  commoditiesSar: number;
  sukukSar: number;
  assetClassAllocation: HeadlineAllocationRow[];
  portfolioAllocation: HeadlineAllocationRow[];
};

function scaleRows(rows: HeadlineAllocationRow[], targetTotal: number): HeadlineAllocationRow[] {
  const sum = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  if (!(targetTotal > 0) || !(sum > 0)) return rows;
  if (Math.abs(sum - targetTotal) < 1) return rows;
  const factor = targetTotal / sum;
  return rows.map((r) => ({ ...r, value: r.value * factor }));
}

/**
 * Build allocation chart rows from headline exposure parts; scales slices so they sum to `totalSar`.
 */
export function buildHeadlineInvestmentAllocationSlices(
  data: FinancialData | null | undefined,
  exposure: Pick<
    HeadlinePersonalInvestmentRoi,
    'totalExposureSar' | 'platformsRollupSar' | 'commoditiesValueSar' | 'sukukPositionsValueSar'
  >,
  sarPerUsd: number,
  investableCashTotalSar: number,
  simulatedPrices: SimulatedPriceMap = {},
): HeadlineInvestmentAllocationSlices {
  const totalSar = Math.max(0, exposure.totalExposureSar);
  const platformCashSar = Math.max(0, Math.min(investableCashTotalSar, exposure.platformsRollupSar));
  const platformHoldingsSar = Math.max(0, exposure.platformsRollupSar - platformCashSar);
  const commoditiesSar = Math.max(0, exposure.commoditiesValueSar);
  const sukukSar = Math.max(0, exposure.sukukPositionsValueSar);

  if (!data) {
    const portfolioAllocation: HeadlineAllocationRow[] = [];
    if (platformHoldingsSar > 0) portfolioAllocation.push({ name: 'Holdings (platforms)', value: platformHoldingsSar });
    if (platformCashSar > 0) portfolioAllocation.push({ name: 'Uninvested cash (platforms)', value: platformCashSar });
    if (commoditiesSar > 0) portfolioAllocation.push({ name: 'Commodities', value: commoditiesSar });
    if (sukukSar > 0) portfolioAllocation.push({ name: 'Sukuk (direct)', value: sukukSar });
    return {
      totalSar,
      platformHoldingsSar,
      platformCashSar,
      commoditiesSar,
      sukukSar,
      assetClassAllocation: portfolioAllocation,
      portfolioAllocation,
    };
  }

  const investments = getPersonalInvestments(data);
  const assetAllocationMap = new Map<string, number>();

  for (const p of investments) {
    const book = resolveInvestmentPortfolioCurrency(p);
    for (const h of p.holdings ?? []) {
      const qty = Number(h.quantity || 0);
      if (!(qty > 0)) continue;
      const valueSar = toSAR(
        effectiveHoldingValueInBookCurrency(h, book, simulatedPrices, sarPerUsd),
        book,
        sarPerUsd,
      );
      if (!(valueSar > 0)) continue;
      const bucket = normalizeInvestmentAssetClassBucket(h.assetClass);
      assetAllocationMap.set(bucket, (assetAllocationMap.get(bucket) || 0) + valueSar);
    }
  }

  const portfolioRows: HeadlineAllocationRow[] = investments
    .map((p: InvestmentPortfolio) => {
      const cur = resolveInvestmentPortfolioCurrency(p);
      let sumNative = 0;
      for (const h of p.holdings || []) {
        sumNative += effectiveHoldingValueInBookCurrency(h, cur, simulatedPrices, sarPerUsd);
      }
      return { name: p.name ?? 'Portfolio', value: toSAR(sumNative, cur, sarPerUsd) };
    })
    .filter((x) => x.value > 0);

  const rawPortfolio: HeadlineAllocationRow[] = [
    ...portfolioRows,
    ...(platformCashSar > 0 ? [{ name: 'Uninvested cash (platforms)', value: platformCashSar }] : []),
    ...(commoditiesSar > 0 ? [{ name: 'Commodities', value: commoditiesSar }] : []),
    ...(sukukSar > 0 ? [{ name: 'Sukuk (direct)', value: sukukSar }] : []),
  ];

  const rawAsset: HeadlineAllocationRow[] = [
    ...Array.from(assetAllocationMap, ([name, value]) => ({ name, value })).filter((x) => x.value > 0),
    ...(platformCashSar > 0 ? [{ name: 'Cash', value: platformCashSar }] : []),
    ...(commoditiesSar > 0 ? [{ name: 'Commodities', value: commoditiesSar }] : []),
    ...(sukukSar > 0 ? [{ name: 'Sukuk', value: sukukSar }] : []),
  ];

  const portfolioAllocation = scaleRows(
    rawPortfolio.sort((a, b) => b.value - a.value),
    totalSar,
  );
  const assetClassAllocation = scaleRows(
    rawAsset.sort((a, b) => b.value - a.value),
    totalSar,
  );

  return {
    totalSar,
    platformHoldingsSar,
    platformCashSar,
    commoditiesSar,
    sukukSar,
    assetClassAllocation,
    portfolioAllocation,
  };
}

/**
 * Rescale extended allocation slices to live headline exposure without rebuilding chart rows.
 */
export function rescaleHeadlineInvestmentAllocation(
  alloc: HeadlineInvestmentAllocationSlices,
  exposure: Pick<
    HeadlinePersonalInvestmentRoi,
    'totalExposureSar' | 'platformsRollupSar' | 'commoditiesValueSar' | 'sukukPositionsValueSar'
  >,
): HeadlineInvestmentAllocationSlices {
  if (alloc.portfolioAllocation.length === 0 && alloc.assetClassAllocation.length === 0) {
    return alloc;
  }
  const totalSar = Math.max(0, exposure.totalExposureSar);
  const platformCashSar = Math.max(0, Math.min(alloc.platformCashSar, exposure.platformsRollupSar));
  const platformHoldingsSar = Math.max(0, exposure.platformsRollupSar - platformCashSar);
  const commoditiesSar = Math.max(0, exposure.commoditiesValueSar);
  const sukukSar = Math.max(0, exposure.sukukPositionsValueSar);
  return {
    totalSar,
    platformHoldingsSar,
    platformCashSar,
    commoditiesSar,
    sukukSar,
    portfolioAllocation: scaleRows(alloc.portfolioAllocation, totalSar),
    assetClassAllocation: scaleRows(alloc.assetClassAllocation, totalSar),
  };
}

/** @deprecated Use sumPersonalSukukPositionsSar */
export function sumPersonalSukukFromAssets(data: FinancialData | null | undefined): number {
  return sumPersonalSukukPositionsSar(data);
}
