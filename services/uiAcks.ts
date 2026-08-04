/**
 * Durable UI acknowledgments for reconcile / integrity prompts.
 * Source of truth: settings.ui_acks (Supabase). localStorage is write-through cache
 * only on acknowledge / explicit sync — never during notification/KPI hot paths.
 */
import type { Settings } from '../types';
import {
  acknowledgeHoldingsIntegrity,
  clearHoldingsIntegrityAck,
  loadHoldingsIntegrityAcks,
  mergeHoldingsIntegrityAckMapsByAt,
  saveHoldingsIntegrityAcks,
  type HoldingsIntegrityAckMap,
  type HoldingsIntegrityAckEntry,
  type HoldingsIntegrityAckKind,
} from './holdingsIntegrityAck';
import { roundMoney } from '../utils/money';

export type CashBalanceDriftAckEntry = {
  accountId: string;
  /** Rounded stored balance at ack time. */
  balanceFp: number;
  /** Rounded transaction-net at ack time. */
  netFp: number;
  at: string;
};

export type CashBalanceDriftAckMap = Record<string, CashBalanceDriftAckEntry>;

export type InvestmentCashLedgerAck = {
  /** Absolute SAR drift fingerprint at dismiss time. */
  driftSarFp: number;
  at: string;
};

export type UiAcks = {
  holdingsQtyIntegrity?: HoldingsIntegrityAckMap;
  cashBalanceDrift?: CashBalanceDriftAckMap;
  /** Broker cash vs ledger-flows KPI warning on System Health. */
  investmentCashLedgerDrift?: InvestmentCashLedgerAck;
};

/** Prevent unbounded settings.ui_acks growth from long-lived workspaces. */
export const UI_ACKS_MAX_ENTRIES = 120;

const CASH_ACK_STORAGE_PREFIX = 'finova_cash_balance_drift_ack_v1:';
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function cashAckStorageKey(userId: string): string {
  return `${CASH_ACK_STORAGE_PREFIX}${userId}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function safeKey(k: string): boolean {
  return k.length > 0 && k.length < 200 && !DANGEROUS_KEYS.has(k);
}

function pruneByAt<T extends { at?: string }>(map: Record<string, T>, max: number): Record<string, T> {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const sorted = keys.sort((a, b) => String(map[a]?.at ?? '').localeCompare(String(map[b]?.at ?? '')));
  const drop = sorted.slice(0, keys.length - max);
  const next = { ...map };
  for (const k of drop) delete next[k];
  return next;
}

function sanitizeHoldingsMap(raw: unknown): HoldingsIntegrityAckMap {
  if (!isPlainObject(raw)) return {};
  const out: HoldingsIntegrityAckMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!safeKey(k) || !isPlainObject(v)) continue;
    const kindRaw = String(v.kind ?? '');
    const kind: HoldingsIntegrityAckKind | null =
      kindRaw === 'keep_closed'
        ? 'keep_closed'
        : kindRaw === 'keep_stored' || kindRaw === 'reconciled' || kindRaw === 'rebuilt'
          ? (kindRaw as HoldingsIntegrityAckKind)
          : null;
    if (!kind) continue;
    const portfolioId = String(v.portfolioId ?? '').slice(0, 128);
    const symbol = String(v.symbol ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 64);
    const storedQtyFingerprint = Number(v.storedQtyFingerprint);
    const ledgerQtyFingerprint =
      v.ledgerQtyFingerprint != null && Number.isFinite(Number(v.ledgerQtyFingerprint))
        ? Number(v.ledgerQtyFingerprint)
        : undefined;
    const at = String(v.at ?? '').slice(0, 40);
    if (!portfolioId || !symbol || !Number.isFinite(storedQtyFingerprint)) continue;
    out[k.slice(0, 200)] = {
      portfolioId,
      symbol,
      kind,
      storedQtyFingerprint,
      ...(ledgerQtyFingerprint != null ? { ledgerQtyFingerprint } : {}),
      at: at || new Date(0).toISOString(),
    } satisfies HoldingsIntegrityAckEntry;
  }
  return pruneByAt(out, UI_ACKS_MAX_ENTRIES);
}

function sanitizeCashMap(raw: unknown): CashBalanceDriftAckMap {
  if (!isPlainObject(raw)) return {};
  const out: CashBalanceDriftAckMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!safeKey(k) || !isPlainObject(v)) continue;
    const accountId = String(v.accountId ?? k).slice(0, 128);
    const balanceFp = Number(v.balanceFp);
    const netFp = Number(v.netFp);
    const at = String(v.at ?? '').slice(0, 40);
    if (!accountId || !Number.isFinite(balanceFp) || !Number.isFinite(netFp)) continue;
    out[accountId] = {
      accountId,
      balanceFp: roundMoney(balanceFp),
      netFp: roundMoney(netFp),
      at: at || new Date(0).toISOString(),
    };
  }
  return pruneByAt(out, UI_ACKS_MAX_ENTRIES);
}

export function loadCashBalanceDriftAcks(userId: string | null | undefined): CashBalanceDriftAckMap {
  if (!userId || typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(cashAckStorageKey(userId));
    if (!raw) return {};
    return sanitizeCashMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveCashBalanceDriftAcks(
  userId: string | null | undefined,
  map: CashBalanceDriftAckMap,
): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(cashAckStorageKey(userId), JSON.stringify(sanitizeCashMap(map)));
  } catch {
    // quota / private mode
  }
}

export function normalizeUiAcks(raw: unknown): UiAcks {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const holdings = sanitizeHoldingsMap(o.holdingsQtyIntegrity);
  const cash = sanitizeCashMap(o.cashBalanceDrift);
  let inv: InvestmentCashLedgerAck | undefined;
  if (isPlainObject(o.investmentCashLedgerDrift)) {
    const driftSarFp = Number(o.investmentCashLedgerDrift.driftSarFp);
    if (Number.isFinite(driftSarFp)) {
      inv = {
        driftSarFp: roundMoney(Math.abs(driftSarFp)),
        at: String(o.investmentCashLedgerDrift.at ?? '').slice(0, 40) || new Date(0).toISOString(),
      };
    }
  }
  return {
    ...(Object.keys(holdings).length ? { holdingsQtyIntegrity: holdings } : {}),
    ...(Object.keys(cash).length ? { cashBalanceDrift: cash } : {}),
    ...(inv ? { investmentCashLedgerDrift: inv } : {}),
  };
}

/**
 * Merge a partial uiAcks update onto the latest known state without dropping sibling maps.
 * Provided maps replace wholesale (so clears work); omitted keys keep previous.
 */
export function mergeUiAcks(previous: UiAcks | null | undefined, incoming: UiAcks | null | undefined): UiAcks {
  const prev = normalizeUiAcks(previous ?? {});
  const next = normalizeUiAcks(incoming ?? {});
  const merged: UiAcks = {
    holdingsQtyIntegrity:
      incoming && 'holdingsQtyIntegrity' in incoming
        ? next.holdingsQtyIntegrity
        : prev.holdingsQtyIntegrity,
    cashBalanceDrift:
      incoming && 'cashBalanceDrift' in incoming ? next.cashBalanceDrift : prev.cashBalanceDrift,
    investmentCashLedgerDrift:
      incoming && 'investmentCashLedgerDrift' in incoming
        ? next.investmentCashLedgerDrift
        : prev.investmentCashLedgerDrift,
  };
  return normalizeUiAcks(merged);
}

export type ResolveAcksOptions = {
  /**
   * Write settings → localStorage. Default false — hot paths (notifications, KPI memos)
   * must not sync I/O on every recompute.
   */
  writeThrough?: boolean;
};

/** Settings + localStorage merge by newest `at` per key — never wipe local dismissals with an empty remote map. */
export function resolveHoldingsIntegrityAcks(
  userId: string | null | undefined,
  settings?: Pick<Settings, 'uiAcks'> | null,
  opts?: ResolveAcksOptions,
): HoldingsIntegrityAckMap {
  const local = sanitizeHoldingsMap(loadHoldingsIntegrityAcks(userId));
  const fromSettings = settings?.uiAcks?.holdingsQtyIntegrity;
  if (fromSettings && typeof fromSettings === 'object') {
    const remote = sanitizeHoldingsMap(fromSettings);
    const merged = mergeHoldingsIntegrityAckMapsByAt(local, remote);
    if (opts?.writeThrough) saveHoldingsIntegrityAcks(userId, merged);
    return merged;
  }
  return local;
}

export function resolveCashBalanceDriftAcks(
  userId: string | null | undefined,
  settings?: Pick<Settings, 'uiAcks'> | null,
  opts?: ResolveAcksOptions,
): CashBalanceDriftAckMap {
  const fromSettings = settings?.uiAcks?.cashBalanceDrift;
  if (fromSettings && typeof fromSettings === 'object') {
    const map = sanitizeCashMap(fromSettings);
    if (opts?.writeThrough) saveCashBalanceDriftAcks(userId, map);
    return map;
  }
  return loadCashBalanceDriftAcks(userId);
}

export function cashBalanceDriftFingerprint(balance: number, net: number): { balanceFp: number; netFp: number } {
  return {
    balanceFp: roundMoney(Number(balance) || 0),
    netFp: roundMoney(Number(net) || 0),
  };
}

export function isCashBalanceDriftAcked(args: {
  acks: CashBalanceDriftAckMap;
  accountId: string;
  storedBalance: number;
  transactionNet: number;
}): boolean {
  const entry = args.acks[String(args.accountId)];
  if (!entry) return false;
  const fp = cashBalanceDriftFingerprint(args.storedBalance, args.transactionNet);
  return Math.abs(entry.balanceFp - fp.balanceFp) < 0.02 && Math.abs(entry.netFp - fp.netFp) < 0.02;
}

export function filterUnackedCashDriftWarnings<
  T extends { accountId: string; storedBalance: number; transactionNet: number; showWarning: boolean },
>(rows: T[], acks: CashBalanceDriftAckMap): T[] {
  return rows.filter((r) => {
    if (!r.showWarning) return false;
    return !isCashBalanceDriftAcked({
      acks,
      accountId: r.accountId,
      storedBalance: r.storedBalance,
      transactionNet: r.transactionNet,
    });
  });
}

export function isInvestmentCashLedgerDriftAcked(
  ack: InvestmentCashLedgerAck | null | undefined,
  driftSar: number,
): boolean {
  if (!ack) return false;
  return Math.abs(Number(ack.driftSarFp) - roundMoney(Math.abs(Number(driftSar) || 0))) < 1;
}

export type PersistUiAcksFn = (uiAcks: UiAcks) => Promise<void>;

/** Keep stored / Keep closed / reconciled / rebuilt — local cache + settings.ui_acks. */
export async function acknowledgeHoldingsIntegrityDurable(args: {
  userId: string | null | undefined;
  portfolioId: string;
  symbol: string;
  kind: HoldingsIntegrityAckKind;
  storedQty: number;
  ledgerQty?: number;
  currentUiAcks?: UiAcks | null;
  persistUiAcks?: PersistUiAcksFn;
}): Promise<HoldingsIntegrityAckMap> {
  const base = resolveHoldingsIntegrityAcks(
    args.userId,
    { uiAcks: args.currentUiAcks ?? undefined },
    { writeThrough: true },
  );
  saveHoldingsIntegrityAcks(args.userId, base);
  const map = pruneByAt(
    acknowledgeHoldingsIntegrity({
      userId: args.userId,
      portfolioId: args.portfolioId,
      symbol: args.symbol,
      kind: args.kind,
      storedQty: args.storedQty,
      ledgerQty: args.ledgerQty,
    }),
    UI_ACKS_MAX_ENTRIES,
  );
  saveHoldingsIntegrityAcks(args.userId, map);
  if (args.persistUiAcks) {
    await args.persistUiAcks({
      holdingsQtyIntegrity: map,
    });
  }
  return map;
}

export async function clearHoldingsIntegrityAckDurable(args: {
  userId: string | null | undefined;
  portfolioId: string;
  symbol: string;
  currentUiAcks?: UiAcks | null;
  persistUiAcks?: PersistUiAcksFn;
}): Promise<HoldingsIntegrityAckMap> {
  const base = resolveHoldingsIntegrityAcks(
    args.userId,
    { uiAcks: args.currentUiAcks ?? undefined },
    { writeThrough: true },
  );
  saveHoldingsIntegrityAcks(args.userId, base);
  const map = clearHoldingsIntegrityAck({
    userId: args.userId,
    portfolioId: args.portfolioId,
    symbol: args.symbol,
  });
  if (args.persistUiAcks) {
    await args.persistUiAcks({
      holdingsQtyIntegrity: map,
    });
  }
  return map;
}

/**
 * After Reconcile Balance Apply, both stored balance and Σ(txs) move by the same delta,
 * so raw drift often stays large. Fingerprint the post-apply (balance, net) pair instead.
 */
export function expectedPostReconcileCashState(args: {
  beforeBalance: number;
  actualValue: number;
  beforeTransactionNet: number;
}): { storedBalance: number; transactionNet: number } {
  const beforeBalance = Number(args.beforeBalance) || 0;
  const actualValue = Number(args.actualValue) || 0;
  const beforeNet = Number(args.beforeTransactionNet) || 0;
  const delta = actualValue - beforeBalance;
  return {
    storedBalance: actualValue,
    transactionNet: beforeNet + delta,
  };
}

/** Hide cash/credit drift until balance/net fingerprint changes (Apply or Keep stored). */
export async function acknowledgeCashBalanceDriftDurable(args: {
  userId?: string | null;
  accountId: string;
  storedBalance: number;
  transactionNet: number;
  currentUiAcks?: UiAcks | null;
  persistUiAcks?: PersistUiAcksFn;
}): Promise<CashBalanceDriftAckMap> {
  const fp = cashBalanceDriftFingerprint(args.storedBalance, args.transactionNet);
  const map: CashBalanceDriftAckMap = pruneByAt(
    {
      ...resolveCashBalanceDriftAcks(args.userId, { uiAcks: args.currentUiAcks ?? undefined }),
      [String(args.accountId).slice(0, 128)]: {
        accountId: String(args.accountId).slice(0, 128),
        balanceFp: fp.balanceFp,
        netFp: fp.netFp,
        at: new Date().toISOString(),
      },
    },
    UI_ACKS_MAX_ENTRIES,
  );
  saveCashBalanceDriftAcks(args.userId, map);
  if (args.persistUiAcks) {
    await args.persistUiAcks({
      cashBalanceDrift: map,
    });
  }
  return map;
}

/** Convenience: ack the post-apply fingerprint for a cash/credit reconcile. */
export async function acknowledgeCashBalanceDriftAfterReconcile(args: {
  userId?: string | null;
  accountId: string;
  beforeBalance: number;
  actualValue: number;
  beforeTransactionNet: number;
  currentUiAcks?: UiAcks | null;
  persistUiAcks?: PersistUiAcksFn;
}): Promise<CashBalanceDriftAckMap> {
  const post = expectedPostReconcileCashState({
    beforeBalance: args.beforeBalance,
    actualValue: args.actualValue,
    beforeTransactionNet: args.beforeTransactionNet,
  });
  return acknowledgeCashBalanceDriftDurable({
    userId: args.userId,
    accountId: args.accountId,
    storedBalance: post.storedBalance,
    transactionNet: post.transactionNet,
    currentUiAcks: args.currentUiAcks,
    persistUiAcks: args.persistUiAcks,
  });
}

export async function acknowledgeInvestmentCashLedgerDriftDurable(args: {
  driftSar: number;
  currentUiAcks?: UiAcks | null;
  persistUiAcks?: PersistUiAcksFn;
}): Promise<InvestmentCashLedgerAck> {
  const entry: InvestmentCashLedgerAck = {
    driftSarFp: roundMoney(Math.abs(Number(args.driftSar) || 0)),
    at: new Date().toISOString(),
  };
  if (args.persistUiAcks) {
    await args.persistUiAcks({
      investmentCashLedgerDrift: entry,
    });
  }
  return entry;
}
