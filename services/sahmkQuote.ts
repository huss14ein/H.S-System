/**
 * SAHMK (sahmk.sa) — live Tadawul / Nomu quotes when Finnhub + Stooq fail (common on free Finnhub tiers).
 * Requires Netlify `sahmk-proxy` + `SAHMK_API_KEY`. Free plan: ~100 quote requests/day (poll sparingly).
 */

import { fetchSahmkQuote } from './sahmkClient';

export type SahmkQuoteTick = { price: number; change: number; changePercent: number };

/** Map `2222.SR` / bare `2222` / `REITF.SA` → code for `/quote/{code}/`. Letter tickers require a Saudi suffix to avoid US ticker collisions. */
export function extractTadawulCodeForSahmk(symbol: string): string | null {
  const u = (symbol || '').trim().toUpperCase();
  if (!u) return null;
  const suffixed = u.match(/^([A-Z0-9]{1,8})\.(SR|SA|SE)$/);
  if (suffixed) return suffixed[1];
  if (/^[0-9]{4,6}$/.test(u)) return u;
  return null;
}

function parseSahmkQuoteJson(raw: Record<string, unknown>): SahmkQuoteTick | null {
  const price = Number(raw.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  let change = Number(raw.change);
  const changePercent = Number(raw.change_percent ?? raw.changePercent);
  const prev = Number(raw.previous_close ?? raw.previousClose);

  if (!Number.isFinite(change)) {
    if (Number.isFinite(prev) && prev > 0) {
      change = price - prev;
    } else if (Number.isFinite(changePercent)) {
      const impliedPrev = price / (1 + changePercent / 100);
      change = price - impliedPrev;
    } else {
      change = 0;
    }
  }

  let pct = Number.isFinite(changePercent) ? changePercent : NaN;
  if (!Number.isFinite(pct)) {
    const pc = Number.isFinite(prev) && prev > 0 ? prev : price - change;
    pct = pc > 0 ? (change / pc) * 100 : 0;
  }

  return { price, change, changePercent: pct };
}

/** Single quote; returns null if not Tadawul-shaped, proxy missing, or API error. */
export async function getSahmkQuoteForSymbol(symbol: string): Promise<SahmkQuoteTick | null> {
  const code = extractTadawulCodeForSahmk(symbol);
  if (!code) return null;
  try {
    const res = await fetchSahmkQuote(code);
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    if (json.error) return null;
    return parseSahmkQuoteJson(json);
  } catch {
    return null;
  }
}

/**
 * Batch live map compatible with `getLivePrices` / Finnhub output keys.
 * Adds `.SR`, `.SA`, `.SE`, bare digits, and canonical `fromFinnhubSymbol(toFinnhubSymbol(s))`.
 */
export async function getSahmkLivePrices(
  symbols: string[],
): Promise<Record<string, SahmkQuoteTick>> {
  if (symbols.length === 0) return {};
  const out: Record<string, SahmkQuoteTick> = {};

  for (const rawSymbol of symbols) {
    const code = extractTadawulCodeForSahmk(rawSymbol);
    if (!code) continue;

    try {
      const res = await fetchSahmkQuote(code);
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, unknown>;
      if (json.error) continue;
      const quote = parseSahmkQuoteJson(json);
      if (!quote) continue;

      const rawUpper = (rawSymbol || '').trim().toUpperCase();
      const fhTad = rawUpper.match(/^TADAWUL:([A-Z0-9]{1,8})$/);
      const displayKey = fhTad ? `${fhTad[1]}.SR` : rawUpper;
      const keys = new Set<string>([displayKey, rawUpper, `${code}.SR`, `${code}.SA`, `${code}.SE`, code].filter(Boolean));
      const tad = displayKey.match(/^([0-9]{4,6})\.SR$/);
      if (tad) {
        keys.add(`${tad[1]}.SA`);
        keys.add(`${tad[1]}.SE`);
      }
      for (const k of keys) out[k] = quote;
    } catch {
      /* proxy down or quota — skip symbol */
    }

    // Gentle spacing for free-tier daily limits when many Saudi names refresh at once
    await new Promise((r) => setTimeout(r, 350));
  }

  return out;
}
