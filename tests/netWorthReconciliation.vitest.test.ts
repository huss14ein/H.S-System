import { describe, expect, it } from 'vitest';
import { bucketSumMatchesNetWorth } from '../services/netWorthReconciliation';

describe('netWorthReconciliation', () => {
  it('accepts balanced buckets within tolerance', () => {
    const r = bucketSumMatchesNetWorth({
      netWorth: 100000,
      buckets: {
        cash: 10000,
        investments: 50000,
        physicalAndCommodities: 40000,
        receivables: 0,
        liabilities: 0,
      },
    });
    expect(r.matches).toBe(true);
    expect(r.driftSar).toBeLessThan(1.5);
  });

  it('detects drift when buckets do not sum to net worth', () => {
    const r = bucketSumMatchesNetWorth({
      netWorth: 100000,
      buckets: {
        cash: 10000,
        investments: 40000,
        physicalAndCommodities: 40000,
        receivables: 0,
        liabilities: 0,
      },
    });
    expect(r.matches).toBe(false);
    expect(r.driftSar).toBeGreaterThan(1.5);
  });
});
