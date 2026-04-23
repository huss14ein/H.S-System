export function normalizeInvestmentAssetClassBucket(assetClassRaw: string | undefined): string {
  const normalized = String(assetClassRaw || '').trim().toLowerCase();
  if (!normalized) return 'Other';
  // Sukuk is a fixed-income bucket, not commodity exposure.
  if (normalized === 'sukuk' || normalized === 'sukuks' || normalized.includes('islamic bond')) return 'Sukuk';
  if (normalized === 'commodity' || normalized === 'commodities') return 'Commodities';
  return assetClassRaw || 'Other';
}

/** Backward-compatible alias used in tests/util consumers. */
export const normalizeAssetClassBucket = normalizeInvestmentAssetClassBucket;
