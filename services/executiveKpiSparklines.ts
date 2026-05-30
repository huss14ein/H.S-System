import { listNetWorthSnapshots } from './netWorthSnapshot';

/** Oldest → newest sparkline values from stored net worth snapshots. */
export function netWorthSparklineFromSnapshots(maxPoints = 14): number[] {
  const snaps = listNetWorthSnapshots();
  if (!snaps.length) return [];
  return snaps
    .slice(0, maxPoints)
    .reverse()
    .map((s) => s.netWorth)
    .filter((v) => Number.isFinite(v));
}

export function liquidCashSparklineFromSnapshots(maxPoints = 14): number[] {
  const snaps = listNetWorthSnapshots();
  if (!snaps.length) return [];
  return snaps
    .slice(0, maxPoints)
    .reverse()
    .map((s) => s.buckets?.cash ?? Number.NaN)
    .filter((v) => Number.isFinite(v));
}

/** Two-point trend when snapshot history is thin. */
export function twoPointTrend(current: number, prior: number): number[] {
  if (!Number.isFinite(current)) return [];
  if (!Number.isFinite(prior) || prior === current) return [current];
  return [prior, current];
}
