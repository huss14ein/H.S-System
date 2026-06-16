import type { FinancialData } from '../types';
import type { PersonalHeadlineNetWorthResult } from './personalNetWorth';
import { captureExtendedNetWorthSnapshot, captureNetWorthSnapshotFromHeadline } from './netWorthSnapshotExtended';
import { canAutoCaptureNetWorthSnapshot } from './netWorthSnapshotReadiness';
import type { SupabaseClient } from '@supabase/supabase-js';

const AUTO_SNAP_KEY = 'finova_auto_nw_snapshot_v1';
const LAST_RUN_KEY = 'finova_auto_nw_snapshot_last_v1';

export function isAutoNetWorthSnapshotEnabled(userId: string | undefined): boolean {
  if (!userId || typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(`${AUTO_SNAP_KEY}_${userId}`) === '1';
  } catch {
    return false;
  }
}

export function setAutoNetWorthSnapshotEnabled(userId: string, enabled: boolean): void {
  try {
    localStorage.setItem(`${AUTO_SNAP_KEY}_${userId}`, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** At most once per calendar month per user (client-side schedule). */
export function shouldRunAutoSnapshot(userId: string): boolean {
  if (!isAutoNetWorthSnapshotEnabled(userId)) return false;
  try {
    const last = localStorage.getItem(`${LAST_RUN_KEY}_${userId}`);
    const nowKey = new Date().toISOString().slice(0, 7);
    return last !== nowKey;
  } catch {
    return false;
  }
}

export function markAutoSnapshotRan(userId: string): void {
  try {
    localStorage.setItem(`${LAST_RUN_KEY}_${userId}`, new Date().toISOString().slice(0, 7));
  } catch {
    /* ignore */
  }
}

export async function runAutoNetWorthSnapshotIfDue(input: {
  userId: string;
  data: FinancialData;
  headline?: PersonalHeadlineNetWorthResult;
  exchangeRate: number;
  getAvailableCashForAccount: (id: string) => { SAR: number; USD: number };
  simulatedPrices?: Record<string, { price: number }>;
  supabase: SupabaseClient | null;
  metricsExtendedReady?: boolean;
  snapshotReadiness?: {
    showHydrateBanner: boolean;
    isRefreshing: boolean;
    hasQueuedPriceRefresh: () => boolean;
    symbolQuoteUpdatedAt: Record<string, string | undefined>;
    isLive: boolean;
    metricsExtendedReady?: boolean;
    getAvailableCashForAccount?: (id: string) => { SAR: number; USD: number };
  };
}): Promise<boolean> {
  if (!shouldRunAutoSnapshot(input.userId) || !input.supabase) return false;
  if (input.snapshotReadiness) {
    const ready = canAutoCaptureNetWorthSnapshot({
      ...input.snapshotReadiness,
      data: input.data,
    });
    if (!ready) return false;
  }
  try {
    const sync = { supabase: input.supabase, userId: input.userId };
    const snap =
      input.headline && input.metricsExtendedReady
        ? captureNetWorthSnapshotFromHeadline(input.headline, input.data, sync)
        : captureExtendedNetWorthSnapshot(
            input.data,
            input.exchangeRate,
            input.getAvailableCashForAccount,
            sync,
            input.simulatedPrices,
          );
    if (!snap) return false;
    markAutoSnapshotRan(input.userId);
    return true;
  } catch {
    return false;
  }
}
