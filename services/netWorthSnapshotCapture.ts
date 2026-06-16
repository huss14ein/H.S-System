import type { FinancialData } from '../types';
import type { PersonalHeadlineNetWorthResult } from './personalNetWorth';
import { captureNetWorthSnapshotFromHeadline } from './netWorthSnapshotExtended';
import {
  canAutoCaptureNetWorthSnapshot,
  getTrackedQuoteSymbolsFromData,
  quoteRefreshFingerprint,
} from './netWorthSnapshotReadiness';
import { listNetWorthSnapshots, type NetWorthSyncContext } from './netWorthSnapshot';
import { markAutoNetWorthSnapshotCaptured, shouldThrottleAutoNetWorthSnapshot } from './netWorthSnapshotThrottle';

const RECAPTURE_DRIFT_SAR = 2;

export type AutoNetWorthSnapshotInput = {
  userId: string;
  data: FinancialData;
  headline: PersonalHeadlineNetWorthResult;
  metricsExtendedReady: boolean;
  showHydrateBanner: boolean;
  getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number };
  isRefreshing: boolean;
  hasQueuedPriceRefresh: () => boolean;
  symbolQuoteUpdatedAt: Record<string, string | undefined>;
  isLive: boolean;
  sync?: NetWorthSyncContext | null;
};

/** Auto-capture using the displayed canonical headline (no independent recompute). */
export function tryAutoCaptureNetWorthSnapshot(input: AutoNetWorthSnapshotInput): boolean {
  const nw = input.headline.netWorth;
  if (!Number.isFinite(nw) || nw <= 0.5) return false;

  const snapshotReady = canAutoCaptureNetWorthSnapshot({
    showHydrateBanner: input.showHydrateBanner,
    isRefreshing: input.isRefreshing,
    hasQueuedPriceRefresh: input.hasQueuedPriceRefresh,
    symbolQuoteUpdatedAt: input.symbolQuoteUpdatedAt,
    isLive: input.isLive,
    data: input.data,
    metricsExtendedReady: input.metricsExtendedReady,
    getAvailableCashForAccount: input.getAvailableCashForAccount,
  });
  if (!snapshotReady) return false;

  const quoteFp = quoteRefreshFingerprint(
    getTrackedQuoteSymbolsFromData(input.data),
    input.symbolQuoteUpdatedAt,
  );

  const today = new Date().toISOString().slice(0, 10);
  const latest = listNetWorthSnapshots()[0];
  const todaySnap = latest?.at.slice(0, 10) === today ? latest : null;
  const needsRecapture =
    todaySnap != null && Math.abs(todaySnap.netWorth - nw) > RECAPTURE_DRIFT_SAR;

  if (!needsRecapture && shouldThrottleAutoNetWorthSnapshot(input.userId, nw, undefined, quoteFp)) {
    return false;
  }

  const snap = captureNetWorthSnapshotFromHeadline(input.headline, input.data, input.sync ?? null);
  if (!snap) return false;

  markAutoNetWorthSnapshotCaptured(input.userId, snap.netWorth, quoteFp);
  return true;
}
