/**
 * SAHMK (sahmk.sa) — live Tadawul / Nomu quotes when Finnhub + Stooq fail (common on free Finnhub tiers).
 * Requires Netlify `sahmk-proxy` + `SAHMK_API_KEY`. Free plan: ~100 quote requests/day (poll sparingly).
 */

import { fetchSahmkQuote } from './sahmkClient';
import { normalizeTadawulUnitPriceSAR } from './tadawulQuoteSanity';

export type SahmkQuoteTick = { price: number; change: number; changePercent: number };

const SINGLE_FLIGHT_TTL_MS = 12_000;
const inFlightByCode = new Map<string, Promise<SahmkQuoteTick | null>>();
const cachedByCode = new Map<string, { at: number; tick: SahmkQuoteTick | null }>();

/** Map `2222.SR` / bare `2222` / `REITF.SA` → code for `/quote/{code}/`. Letter tickers require a Saudi suffix to avoid US ticker collisions. */
export function extractTadawulCodeForSahmk(symbol: string): string | null {
  const u = (symbol || '').trim().toUpperCase();
  if (!u) return null;
  const suffixed = u.match(/^([A-Z0-9]{1,8})\.(SR|SA|SE)$/);
  if (suffixed) return suffixed[1];
  if (/^[0-9]{4,6}$/.test(u)) return u;
  return null;
}

async function fetchSahmkTickByCode(code: string): Promise<SahmkQuoteTick | null> {
  const c = code.trim().toUpperCase();
  if (!c) return null;

  const now = Date.now();
  const cached = cachedByCode.get(c);
  if (cached && now - cached.at <= SINGLE_FLIGHT_TTL_MS) return cached.tick;

  const inflight = inFlightByCode.get(c);
  if (inflight) return inflight;

  const p = (async (): Promise<SahmkQuoteTick | null> => {
    const res = await fetchSahmkQuote(c);
    if (res.status === 429) {
      // Let callers trigger cooldown/backoff by matching on message.
      throw new Error('HTTP 429 Too Many Requests');
    }
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    if ((json as any)?.error) return null;
    return parseSahmkQuoteJson(json);
  })()
    .then((tick) => {
      cachedByCode.set(c, { at: Date.now(), tick });
      return tick;
    })
    .finally(() => {
      inFlightByCode.delete(c);
    });

  inFlightByCode.set(c, p);
  return p;
}

function parseSahmkQuoteJson(raw: Record<string, unknown>): SahmkQuoteTick | null {
  const rawPrice = Number(raw.price);
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return null;
  const prevCloseRaw = Number(raw.previous_close ?? raw.previousClose);
  const ref =
    Number.isFinite(prevCloseRaw) && prevCloseRaw > 0 ? prevCloseRaw : undefined;
  const price = normalizeTadawulUnitPriceSAR(rawPrice, { storedPricePerShare: ref });
  if (price == null) return null;

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
    return await fetchSahmkTickByCode(code);
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

  const codeToDisplaySymbols = new Map<string, string[]>();
  for (const rawSymbol of symbols) {
    const code = extractTadawulCodeForSahmk(rawSymbol);
    if (!code) continue;
    const list = codeToDisplaySymbols.get(code) ?? [];
    list.push(rawSymbol);
    codeToDisplaySymbols.set(code, list);
  }

  let rateLimitHits = 0;

  for (const [code, displaySymbols] of codeToDisplaySymbols) {
    try {
      const quote = await fetchSahmkTickByCode(code);
      if (!quote) continue;

      for (const rawSymbol of displaySymbols) {
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
      }
    } catch (err) {
      if (/429|rate.?limit|throttl|quota/i.test(err instanceof Error ? err.message : String(err ?? ''))) {
        rateLimitHits += 1;
      }
    }

    await new Promise((r) => setTimeout(r, 350));
  }

  if (rateLimitHits > 0 && Object.keys(out).length === 0) {
    throw new Error('SAHMK rate limit (429). Wait before retrying live quotes.');
  }
  if (rateLimitHits >= 2) {
    throw new Error('SAHMK rate limit (429). Wait before retrying live quotes.');
  }

  return out;
}
