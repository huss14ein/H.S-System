/**
 * Persist "Keep stored" / "Keep closed" acknowledgments for holdings qty integrity.
 * Stored holdings remain the calculation source of truth; these acks only dismiss repair UI noise.
 * Ack fingerprint includes stored qty (keep_stored) or ledger net (keep_closed) so a later trade
 * that changes qty / ledger resurfaces the prompt.
 */
const STORAGE_PREFIX = 'finova_holdings_qty_ack_v1:';

export type HoldingsIntegrityAckKind = 'keep_stored' | 'keep_closed';

export type HoldingsIntegrityAckEntry = {
  portfolioId: string;
  symbol: string;
  kind: HoldingsIntegrityAckKind;
  /** Round stored qty (keep_stored) or ledger net (keep_closed) at ack time. */
  storedQtyFingerprint: number;
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

export function acknowledgeHoldingsIntegrity(args: {
  userId: string | null | undefined;
  portfolioId: string;
  symbol: string;
  kind: HoldingsIntegrityAckKind;
  storedQty: number;
}): HoldingsIntegrityAckMap {
  const map = loadHoldingsIntegrityAcks(args.userId);
  const key = holdingsIntegrityAckKey(args.portfolioId, args.symbol);
  map[key] = {
    portfolioId: args.portfolioId,
    symbol: String(args.symbol).trim().toUpperCase(),
    kind: args.kind,
    storedQtyFingerprint: holdingsIntegrityAckFingerprint(args.storedQty),
    at: new Date().toISOString(),
  };
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

/** True when user previously chose Keep stored/closed for this fingerprint. */
export function isHoldingsIntegrityAcked(args: {
  acks: HoldingsIntegrityAckMap;
  portfolioId: string;
  symbol: string;
  kind: HoldingsIntegrityAckKind;
  storedQty: number;
}): boolean {
  const entry = args.acks[holdingsIntegrityAckKey(args.portfolioId, args.symbol)];
  if (!entry || entry.kind !== args.kind) return false;
  return (
    Math.abs(entry.storedQtyFingerprint - holdingsIntegrityAckFingerprint(args.storedQty)) < 1e-6
  );
}

export function filterUnackedDriftRows<
  T extends { portfolioId: string; symbol: string; storedQuantity: number },
>(rows: T[], acks: HoldingsIntegrityAckMap): T[] {
  return rows.filter(
    (r) =>
      !isHoldingsIntegrityAcked({
        acks,
        portfolioId: r.portfolioId,
        symbol: r.symbol,
        kind: 'keep_stored',
        storedQty: r.storedQuantity,
      }),
  );
}

export function filterUnackedMissingRows<
  T extends { portfolioId: string; symbol: string; ledgerNet: number },
>(rows: T[], acks: HoldingsIntegrityAckMap): T[] {
  return rows.filter(
    (r) =>
      !isHoldingsIntegrityAcked({
        acks,
        portfolioId: r.portfolioId,
        symbol: r.symbol,
        kind: 'keep_closed',
        storedQty: r.ledgerNet,
      }),
  );
}
