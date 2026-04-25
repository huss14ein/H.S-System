import type { NetWorthSnapshot } from './netWorthSnapshot';

/**
 * Verifies stored bucket rows sum to the same net worth as the headline number (balance-sheet identity).
 * Uses a small SAR tolerance for rounding.
 */
export function bucketSumMatchesNetWorth(snap: Pick<NetWorthSnapshot, 'netWorth' | 'buckets'>): {
  matches: boolean;
  driftSar: number;
  componentsSum: number;
} {
  if (!snap.buckets) {
    return { matches: true, driftSar: 0, componentsSum: Number(snap.netWorth) || 0 };
  }
  const b = snap.buckets;
  const componentsSum =
    (Number(b.cash) || 0) +
    (Number(b.investments) || 0) +
    (Number(b.physicalAndCommodities) || 0) +
    (Number(b.receivables) || 0) +
    (Number(b.liabilities) || 0);
  const nw = Number(snap.netWorth) || 0;
  const driftSar = Math.abs(componentsSum - nw);
  return { matches: driftSar < 1.5, driftSar, componentsSum };
}

/** Dev-only: log first mismatched recent snapshots. */
export function logNetWorthSnapshotDriftInDev(snaps: NetWorthSnapshot[], max = 12): void {
  if (!import.meta.env.DEV) return;
  let warned = 0;
  for (const s of snaps.slice(0, max)) {
    const { matches, driftSar } = bucketSumMatchesNetWorth(s);
    if (!matches && s.buckets) {
      console.warn(
        `[Finova NW reconcile] Snapshot ${s.at.slice(0, 10)} drift ${driftSar.toFixed(2)} SAR (buckets vs netWorth).`,
      );
      warned += 1;
      if (warned >= 3) break;
    }
  }
}
