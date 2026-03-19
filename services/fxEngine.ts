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
