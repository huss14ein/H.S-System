/** Quote-provider routing guards. Keeps restricted feeds from receiving symbols they should not handle. */

export function isTadawulQuoteSymbol(symbol: string | null | undefined): boolean {
  const upper = String(symbol ?? '').trim().toUpperCase();
  if (!upper) return false;
  if (/^TADAWUL:[A-Z0-9]{1,8}$/.test(upper)) return true;
  if (/^[0-9]{4,6}$/.test(upper)) return true;
  return /^[A-Z0-9]{1,8}\.(SR|SA|SE)$/i.test(upper);
}

export function isCommodityOrProviderSymbol(symbol: string | null | undefined): boolean {
  const upper = String(symbol ?? '').trim().toUpperCase();
  if (!upper) return false;
  if (upper.includes(':')) return true;
  if (/^(XAU|XAG|BTC|ETH)([_-]USD)?($|_)/.test(upper)) return true;
  return /^(OANDA|BINANCE):/.test(upper);
}

/**
 * Conservative US equity/ETF shape for Finnhub quote calls.
 * Avoids sending labels such as "Growth", "Large-Cap", manual account names, commodities, or Tadawul aliases.
 */
export function isUsEquityQuoteSymbol(symbol: string | null | undefined): boolean {
  const upper = String(symbol ?? '').trim().toUpperCase();
  if (!upper) return false;
  if (isTadawulQuoteSymbol(upper) || isCommodityOrProviderSymbol(upper)) return false;
  return /^[A-Z][A-Z0-9]{0,4}([.-][A-Z])?$/.test(upper);
}

export function uniqueQuoteSymbols(symbols: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of symbols) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    const key = s.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
