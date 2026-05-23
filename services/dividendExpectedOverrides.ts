/**
 * User overrides for expected annual dividend (SAR) per holding instance.
 * Key: `${portfolioId}:${symbol}` — ledger remains source of truth for received cash.
 */

import { DIVIDEND_MAX_ANNUAL_SAR, validateDividendPlanOverride } from './dividendLedgerGuards';
import { roundMoney } from '../utils/money';

const STORAGE_KEY = 'dividend-expected-annual-sar:v1';
const mem = new Map<string, number>();

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage?.getItem === 'function';
  } catch {
    return false;
  }
}

export function expectedOverrideKey(portfolioId: string, symbol: string): string {
  return `${String(portfolioId).trim()}:${String(symbol).trim().toUpperCase()}`;
}

export function loadExpectedAnnualOverride(portfolioId: string, symbol: string): number | null {
  const key = expectedOverrideKey(portfolioId, symbol);
  if (hasLocalStorage()) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const map = JSON.parse(raw) as Record<string, number>;
        const v = map[key];
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
      }
    } catch {
      /* ignore */
    }
  }
  const m = mem.get(key);
  return m != null && Number.isFinite(m) ? m : null;
}

export function saveExpectedAnnualOverride(portfolioId: string, symbol: string, annualSar: number | null): { ok: boolean; error?: string } {
  const key = expectedOverrideKey(portfolioId, symbol);
  if (annualSar == null || !Number.isFinite(annualSar) || annualSar < 0) {
    mem.delete(key);
    if (!hasLocalStorage()) return { ok: true };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const map: Record<string, number> = raw ? JSON.parse(raw) : {};
      delete map[key];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
    return { ok: true };
  }

  const check = validateDividendPlanOverride({ annualSar });
  if (!check.valid || check.annualSar == null) {
    return { ok: false, error: check.errors[0] ?? 'Invalid expected annual amount.' };
  }
  const safe = roundMoney(Math.min(check.annualSar, DIVIDEND_MAX_ANNUAL_SAR));
  mem.set(key, safe);
  if (!hasLocalStorage()) return { ok: true };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    map[key] = safe;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
  return { ok: true };
}

export function loadAllExpectedOverrides(): Record<string, number> {
  if (hasLocalStorage()) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Record<string, number>;
    } catch {
      /* ignore */
    }
  }
  return Object.fromEntries(mem);
}
