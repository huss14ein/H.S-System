/**
 * Stable monetary amounts: avoid float drift (e.g. 59997.999999 → 59998.00) across the app.
 * Use for SAR/USD and any stored currency field; use {@link roundQuantity} for share counts.
 */

export const MONEY_DECIMALS = 2;

/**
 * Per-share / per-unit **average cost** (not a currency line total).
 * Use 4 dp so weighted averages and DB round-trips stay aligned with the holdings UI;
 * {@link roundMoney} (2 dp) was too coarse and made cost basis drift after buys.
 */
export const AVG_COST_DECIMALS = 4;

export function roundAvgCostPerUnit(amount: number, decimals: number = AVG_COST_DECIMALS): number {
  if (amount == null || !Number.isFinite(Number(amount))) return 0;
  const n = Number(amount);
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function roundMoney(amount: number, decimals: number = MONEY_DECIMALS): number {
  if (amount == null || !Number.isFinite(Number(amount))) return 0;
  const n = Number(amount);
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Fractional shares / units — higher precision, still bounded. */
export function roundQuantity(q: number, decimals = 8): number {
  if (q == null || !Number.isFinite(Number(q))) return 0;
  const n = Number(q);
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/**
 * Parse form / string input into a currency-safe number (2 dp).
 * Prefer this over raw `parseFloat` for money fields.
 */
export function parseMoneyInput(raw: string | number | null | undefined): number {
  if (raw == null || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  return roundMoney(n);
}
