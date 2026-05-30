const SESSION_KEY_PREFIX = 'finova_nw_snapshot_last_';
const SESSION_NW_PREFIX = 'finova_nw_snapshot_nw_';
const SESSION_QUOTE_FP_PREFIX = 'finova_nw_snapshot_qfp_';
const DEFAULT_THROTTLE_MS = 6 * 60 * 60 * 1000;
const MATERIAL_NW_CHANGE_PCT = 0.005;

export function shouldThrottleAutoNetWorthSnapshot(
  userId: string | undefined,
  netWorthSar?: number,
  throttleMs = DEFAULT_THROTTLE_MS,
  quoteFingerprint?: string,
): boolean {
  if (!userId || typeof sessionStorage === 'undefined') return false;
  try {
    const raw = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${userId}`);
    if (!raw) return false;
    const last = Number(raw);
    if (!Number.isFinite(last) || Date.now() - last >= throttleMs) return false;

    if (quoteFingerprint && typeof sessionStorage !== 'undefined') {
      const prevFp = sessionStorage.getItem(`${SESSION_QUOTE_FP_PREFIX}${userId}`) ?? '';
      if (prevFp && prevFp !== quoteFingerprint) return false;
    }

    if (typeof netWorthSar === 'number' && Number.isFinite(netWorthSar)) {
      const prevNwRaw = sessionStorage.getItem(`${SESSION_NW_PREFIX}${userId}`);
      const prevNw = prevNwRaw != null ? Number(prevNwRaw) : NaN;
      if (Number.isFinite(prevNw) && prevNw > 0) {
        const change = Math.abs(netWorthSar - prevNw) / prevNw;
        if (change >= MATERIAL_NW_CHANGE_PCT) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function markAutoNetWorthSnapshotCaptured(
  userId: string,
  netWorthSar?: number,
  quoteFingerprint?: string,
): void {
  try {
    sessionStorage.setItem(`${SESSION_KEY_PREFIX}${userId}`, String(Date.now()));
    if (typeof netWorthSar === 'number' && Number.isFinite(netWorthSar)) {
      sessionStorage.setItem(`${SESSION_NW_PREFIX}${userId}`, String(netWorthSar));
    }
    if (quoteFingerprint) {
      sessionStorage.setItem(`${SESSION_QUOTE_FP_PREFIX}${userId}`, quoteFingerprint);
    }
  } catch {
    /* ignore */
  }
}
