import { describe, expect, it } from 'vitest';
import { normalizeAssetClassBucket } from '../services/investmentAssetClassBuckets';

describe('InvestmentOverview asset-class bucket normalization', () => {

  it('keeps Sukuk in dedicated Sukuk bucket', () => {
    expect(normalizeAssetClassBucket('Sukuk')).toBe('Sukuk');
    expect(normalizeAssetClassBucket('sukuks')).not.toBe('Commodities');
  });

  it('normalizes Commodity naming to Commodities bucket', () => {
    expect(normalizeAssetClassBucket('Commodity')).toBe('Commodities');
    expect(normalizeAssetClassBucket('commodities')).toBe('Commodities');
  });

  it('falls back to Other for empty classes', () => {
    expect(normalizeAssetClassBucket('')).toBe('Other');
    expect(normalizeAssetClassBucket(undefined)).toBe('Other');
  });

  it('maps Equity / Equities aliases to Stock', () => {
    expect(normalizeAssetClassBucket('Equity')).toBe('Stock');
    expect(normalizeAssetClassBucket('equities')).toBe('Stock');
    expect(normalizeAssetClassBucket('Stock')).toBe('Stock');
  });
});
