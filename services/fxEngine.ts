/**
 * Multi-currency and FX logic (logic layer).
 * Base currency normalization, realized/unrealized FX, exposure by account/asset.
 */

export interface FXRateAtDate {
  date: string; // YYYY-MM-DD
  rate: number; // units of foreign per 1 base
  base: string;
  quote: string;
}

/** Convert amount from source currency to base using rate (source per base). */
export function convertToBaseCurrency(
  amount: number,
  sourceCurrency: string,
  baseCurrency: string,
  rateSourcePerBase: number
): number {
  if (sourceCurrency === baseCurrency) return amount;
  return amount / rateSourcePerBase;
}

/** Realized FX gain/loss from a closed position or converted balance (simplified: in-out difference). */
export function realizedFXGain(
  amountInOriginalCurrency: number,
  originalRateToBase: number,
  amountInBaseAtSettlement: number
): number {
  const valueAtEntry = amountInOriginalCurrency / originalRateToBase;
  return amountInBaseAtSettlement - valueAtEntry;
}

/** Unrealized FX exposure: value of holdings in non-base currency at current rate vs at entry rate. */
export function unrealizedFXExposure(
  amountInForeignCurrency: number,
  rateToBaseNow: number,
  rateToBaseAtEntry: number
): { valueInBase: number; costInBase: number; unrealizedGainLoss: number } {
  const valueInBase = amountInForeignCurrency / rateToBaseNow;
  const costInBase = amountInForeignCurrency / rateToBaseAtEntry;
  return { valueInBase, costInBase, unrealizedGainLoss: valueInBase - costInBase };
}

/**
 * Cash FX P&L layers (SAR base) — documentation stub.
 *
 * The app resolves SAR/USD at three distinct layers; conflating them is the most
 * common source of KPI drift, so the intended separation is documented here and
 * returned as a small breakdown a caller can wire into a full realized/unrealized
 * cash-FX engine later:
 *
 *  1. **Balance-sheet (spot)** — current SAR/USD applied to today's USD cash for
 *     headline net worth (`resolveSarPerUsd` / canonical metrics). No P&L on its own.
 *  2. **Transaction-dated** — each USD cashflow converted at its calendar-day rate
 *     (`getSarPerUsdForCalendarDay`) so historical income/expense KPIs are stable.
 *  3. **Realized FX** — when USD cash is actually converted to SAR (or vice-versa),
 *     the difference between the entry rate and the settlement rate is a realized gain/loss.
 *
 * Unrealized cash FX = USD cash × (spot − weighted entry rate). Realized cash FX is
 * booked only on conversion. This stub computes the unrealized layer and leaves the
 * realized layer to the ledger (which knows actual conversion events).
 */
export interface CashFxPnlStub {
  usdCash: number;
  spotSarPerUsd: number;
  weightedEntrySarPerUsd: number;
  valueSar: number;
  costSar: number;
  unrealizedFxPnlSar: number;
  /** Realized FX is booked on conversion events; not derivable from balances alone. */
  realizedFxPnlSar: number;
  notes: string[];
}

export function computeCashFxPnlStub(args: {
  usdCash: number;
  spotSarPerUsd: number;
  weightedEntrySarPerUsd?: number;
}): CashFxPnlStub {
  const usdCash = Number(args.usdCash) || 0;
  const spot = Number(args.spotSarPerUsd) || 0;
  const entry = Number(args.weightedEntrySarPerUsd) || spot;
  const valueSar = usdCash * spot;
  const costSar = usdCash * entry;
  return {
    usdCash,
    spotSarPerUsd: spot,
    weightedEntrySarPerUsd: entry,
    valueSar,
    costSar,
    unrealizedFxPnlSar: valueSar - costSar,
    realizedFxPnlSar: 0,
    notes: [
      'Layer 1 (spot) feeds headline net worth; not P&L by itself.',
      'Layer 2 (transaction-dated FX) keeps historical cashflow KPIs stable.',
      'Layer 3 (realized FX) is booked on actual SAR<->USD conversion events in the ledger.',
    ],
  };
}

/** Portfolio FX allocation: share of portfolio value in each currency (by value in base). */
export function portfolioFXAllocation(
  positions: { currency: string; valueInBase: number }[]
): { currency: string; valueInBase: number; allocationPct: number }[] {
  const total = positions.reduce((s, p) => s + p.valueInBase, 0);
  if (total <= 0) return [];
  const byCurrency = new Map<string, number>();
  for (const p of positions) {
    const c = p.currency || 'USD';
    byCurrency.set(c, (byCurrency.get(c) ?? 0) + p.valueInBase);
  }
  return Array.from(byCurrency.entries()).map(([currency, valueInBase]) => ({
    currency,
    valueInBase,
    allocationPct: (valueInBase / total) * 100,
  }));
}
