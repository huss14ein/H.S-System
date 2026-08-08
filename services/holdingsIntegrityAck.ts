/**
 * Persist "Keep stored" / "Keep closed" / post-reconcile acknowledgments for holdings qty integrity.
 * Stored holdings remain the calculation source of truth; these acks only dismiss repair UI noise.
 * Ack fingerprints include stored qty and (when present) ledger qty so a later trade that changes
 * either side resurfaces the prompt — but the same handled drift stays dismissed across refresh.
 */
const STORAGE_PREFIX = 'finova_holdings_qty_ack_v1:';

export type HoldingsIntegrityAckKind = 'keep_stored' | 'keep_closed' | 'reconciled' | 'rebuilt';

export type HoldingsIntegrityAckEntry = {
  portfolioId: string;
  symbol: string;
  kind: HoldingsIntegrityAckKind;
  /** Round stored qty (keep_stored / reconciled / rebuilt) or ledger net (keep_closed) at ack time. */
  storedQtyFingerprint: number;
  /** Ledger qty fingerprint at ack time — required for durable drift dismissals. */
  ledgerQtyFingerprint?: number;
  at: string;
};

export type HoldingsIntegrityAckMap = Record<string, HoldingsIntegrityAckEntry>;

export function holdingsIntegrityAckKey(portfolioId: string, symbol: string): string {
  return `${String(portfolioId)}:${String(symbol).trim().toUpperCase()}`;
}

export function holdingsIntegrityAckFingerprint(storedQty: number): number {
  const q = Math.max(0, Number(storedQty) || 0);
  return Math.round(q * 1e6) / 1e6;
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function loadHoldingsIntegrityAcks(userId: string | null | undefined): HoldingsIntegrityAckMap {
  if (!userId || typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as HoldingsIntegrityAckMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveHoldingsIntegrityAcks(
  userId: string | null | undefined,
  map: HoldingsIntegrityAckMap,
): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(map));
  } catch {
    // quota / private mode — ignore
  }
}

/** Per-key merge: newer `at` wins. Never drops local-only entries when remote is sparse/empty. */
export function mergeHoldingsIntegrityAckMapsByAt(
  local: HoldingsIntegrityAckMap,
  remote: HoldingsIntegrityAckMap,
): HoldingsIntegrityAckMap {
  const out: HoldingsIntegrityAckMap = { ...local };
  for (const [key, remoteEntry] of Object.entries(remote)) {
    const localEntry = out[key];
    if (!localEntry) {
      out[key] = remoteEntry;
      continue;
    }
    const localAt = String(localEntry.at ?? '');
    const remoteAt = String(remoteEntry.at ?? '');
    if (remoteAt >= localAt) out[key] = remoteEntry;
  }
  return out;
}

export function acknowledgeHoldingsIntegrity(args: {
  userId: string | null | undefined;
  portfolioId: string;
  symbol: string;
  kind: HoldingsIntegrityAckKind;
  storedQty: number;
  /** When set, dismissal is bound to this ledger qty as well (final for this drift pair). */
  ledgerQty?: number;
}): HoldingsIntegrityAckMap {
  const map = loadHoldingsIntegrityAcks(args.userId);
  const key = holdingsIntegrityAckKey(args.portfolioId, args.symbol);
  const entry: HoldingsIntegrityAckEntry = {
    portfolioId: args.portfolioId,
    symbol: String(args.symbol).trim().toUpperCase(),
    kind: args.kind,
    storedQtyFingerprint: holdingsIntegrityAckFingerprint(args.storedQty),
    at: new Date().toISOString(),
  };
  if (args.ledgerQty != null && Number.isFinite(Number(args.ledgerQty))) {
    entry.ledgerQtyFingerprint = holdingsIntegrityAckFingerprint(args.ledgerQty);
  }
  map[key] = entry;
  saveHoldingsIntegrityAcks(args.userId, map);
  return map;
}

export function clearHoldingsIntegrityAck(args: {
  userId: string | null | undefined;
  portfolioId: string;
  symbol: string;
}): HoldingsIntegrityAckMap {
  const map = loadHoldingsIntegrityAcks(args.userId);
  const key = holdingsIntegrityAckKey(args.portfolioId, args.symbol);
  delete map[key];
  saveHoldingsIntegrityAcks(args.userId, map);
  return map;
}

/**
 * True when user previously chose Keep stored/closed/reconcile/rebuild for this fingerprint.
 * Drift kinds (`keep_stored` | `reconciled` | `rebuilt`) are interchangeable for dismissal —
 * any handled action on the same stored(+ledger) pair stays final.
 */
export function isHoldingsIntegrityAcked(args: {
  acks: HoldingsIntegrityAckMap;
  portfolioId: string;
  symbol: string;
  kind: HoldingsIntegrityAckKind;
  storedQty: number;
  ledgerQty?: number;
}): boolean {
  const entry = args.acks[holdingsIntegrityAckKey(args.portfolioId, args.symbol)];
  if (!entry) return false;

  const driftKinds: HoldingsIntegrityAckKind[] = ['keep_stored', 'reconciled', 'rebuilt'];
  if (args.kind === 'keep_closed') {
    if (entry.kind !== 'keep_closed') return false;
  } else if (!driftKinds.includes(entry.kind)) {
    return false;
  }

  if (
    Math.abs(entry.storedQtyFingerprint - holdingsIntegrityAckFingerprint(args.storedQty)) >= 1e-6
  ) {
    return false;
  }

  if (entry.ledgerQtyFingerprint != null && args.ledgerQty != null && Number.isFinite(args.ledgerQty)) {
    return (
      Math.abs(entry.ledgerQtyFingerprint - holdingsIntegrityAckFingerprint(args.ledgerQty)) < 1e-6
    );
  }

  // Legacy acks without ledger fingerprint still dismiss on stored qty alone.
  return true;
}

export function filterUnackedDriftRows<
  T extends { portfolioId: string; symbol: string; storedQuantity: number; ledgerQuantity?: number },
>(rows: T[], acks: HoldingsIntegrityAckMap): T[] {
  return rows.filter(
    (r) =>
      !isHoldingsIntegrityAcked({
        acks,
        portfolioId: r.portfolioId,
        symbol: r.symbol,
        kind: 'keep_stored',
        storedQty: r.storedQuantity,
        ledgerQty: r.ledgerQuantity,
      }),
  );
}

export function filterUnackedMissingRows<
  T extends { portfolioId: string; symbol: string; ledgerNet: number },
>(rows: T[], acks: HoldingsIntegrityAckMap): T[] {
  return rows.filter((r) => {
    if (
      isHoldingsIntegrityAcked({
        acks,
        portfolioId: r.portfolioId,
        symbol: r.symbol,
        kind: 'keep_closed',
        storedQty: r.ledgerNet,
        ledgerQty: r.ledgerNet,
      })
    ) {
      return false;
    }
    /**
     * Qty reconcile to 0 writes `reconciled` with storedQty 0. That must also clear Critical
     * missing when the fingerprint still matches this ledger residual.
     */
    if (
      isHoldingsIntegrityAcked({
        acks,
        portfolioId: r.portfolioId,
        symbol: r.symbol,
        kind: 'reconciled',
        storedQty: 0,
        ledgerQty: r.ledgerNet,
      })
    ) {
      return false;
    }
    return true;
  });
}
