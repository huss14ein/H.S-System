/**
 * SAHMK (sahmk.sa) — live Tadawul / Nomu quotes when Finnhub + Stooq fail (common on free Finnhub tiers).
 * Requires Netlify `sahmk-proxy` + `SAHMK_API_KEY`. Free plan: ~100 quote requests/day (poll sparingly).
 */

import { fetchSahmkQuote } from './sahmkClient';
import { normalizeTadawulUnitPriceSAR } from './tadawulQuoteSanity';
import {
  isQuoteRefreshInCooldown,
  startQuoteRefreshCooldown,
  SAHMK_RATE_LIMIT_COOLDOWN_MS,
} from './quoteRefreshCooldown';
import { buildRateLimitBatchError } from './quoteProviderRateLimit';

export type SahmkQuoteTick = { price: number; change: number; changePercent: number };

const SUCCESS_CACHE_TTL_MS = 60_000;
/** After a 429, do not hit the proxy again for this code until cooldown-ish TTL. */
const RATE_LIMIT_CACHE_TTL_MS = SAHMK_RATE_LIMIT_COOLDOWN_MS;
/** Free-tier budget: never blast more than this many distinct codes in one batch. */
export const SAHMK_MAX_CODES_PER_BATCH = 5;
const INTER_CODE_GAP_MS = 200;

const inFlightByCode = new Map<string, Promise<SahmkQuoteTick | null>>();
const cachedByCode = new Map<string, { at: number; tick: SahmkQuoteTick | null; rateLimited?: boolean }>();

/** Map `2222.SR` / bare `2222` / `REITF.SA` → code for `/quote/{code}/`. Letter tickers require a Saudi suffix to avoid US ticker collisions. */
export function extractTadawulCodeForSahmk(symbol: string): string | null {
  const u = (symbol || '').trim().toUpperCase();
  if (!u) return null;
  const suffixed = u.match(/^([A-Z0-9]{1,8})\.(SR|SA|SE)$/);
  if (suffixed) return suffixed[1];
  if (/^[0-9]{4,6}$/.test(u)) return u;
  return null;
}

function noteSahmkRateLimited(): void {
  startQuoteRefreshCooldown(SAHMK_RATE_LIMIT_COOLDOWN_MS);
}

async function fetchSahmkTickByCode(code: string): Promise<SahmkQuoteTick | null> {
  const c = code.trim().toUpperCase();
  if (!c) return null;

  if (isQuoteRefreshInCooldown()) {
    const cached = cachedByCode.get(c);
    return cached?.tick ?? null;
  }

  const now = Date.now();
  const cached = cachedByCode.get(c);
  if (cached) {
    const ttl = cached.rateLimited ? RATE_LIMIT_CACHE_TTL_MS : SUCCESS_CACHE_TTL_MS;
    if (now - cached.at <= ttl) {
      if (cached.rateLimited) throw new Error('HTTP 429 Too Many Requests');
      return cached.tick;
    }
  }

  const inflight = inFlightByCode.get(c);
  if (inflight) return inflight;

  const p = (async (): Promise<SahmkQuoteTick | null> => {
    const res = await fetchSahmkQuote(c);
    if (res.status === 429) {
      cachedByCode.set(c, { at: Date.now(), tick: null, rateLimited: true });
      noteSahmkRateLimited();
      throw new Error('HTTP 429 Too Many Requests');
    }
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    if ((json as any)?.error) return null;
    return parseSahmkQuoteJson(json);
  })()
    .then((tick) => {
      cachedByCode.set(c, { at: Date.now(), tick, rateLimited: false });
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

function assignQuoteKeys(
  out: Record<string, SahmkQuoteTick>,
  displaySymbols: string[],
  code: string,
  quote: SahmkQuoteTick,
): void {
  for (const rawSymbol of displaySymbols) {
    const rawUpper = (rawSymbol || '').trim().toUpperCase();
    const fhTad = rawUpper.match(/^TADAWUL:([A-Z0-9]{1,8})$/);
    const displayKey = fhTad ? `${fhTad[1]}.SR` : rawUpper;
    const keys = new Set<string>(
      [displayKey, rawUpper, `${code}.SR`, `${code}.SA`, `${code}.SE`, code].filter(Boolean),
    );
    const tad = displayKey.match(/^([0-9]{4,6})\.SR$/);
    if (tad) {
      keys.add(`${tad[1]}.SA`);
      keys.add(`${tad[1]}.SE`);
    }
    for (const k of keys) out[k] = quote;
  }
}

/**
 * Batch live map compatible with `getLivePrices` / Finnhub output keys.
 * Caps distinct SAHMK codes per call, aborts on first 429, and respects global cooldown.
 */
export async function getSahmkLivePrices(
  symbols: string[],
): Promise<Record<string, SahmkQuoteTick>> {
  if (symbols.length === 0) return {};
  if (isQuoteRefreshInCooldown()) return {};

  const out: Record<string, SahmkQuoteTick> = {};

  const codeToDisplaySymbols = new Map<string, string[]>();
  for (const rawSymbol of symbols) {
    const code = extractTadawulCodeForSahmk(rawSymbol);
    if (!code) continue;
    const list = codeToDisplaySymbols.get(code) ?? [];
    list.push(rawSymbol);
    codeToDisplaySymbols.set(code, list);
  }

  const codes = Array.from(codeToDisplaySymbols.keys()).slice(0, SAHMK_MAX_CODES_PER_BATCH);
  let rateLimited = false;

  for (let i = 0; i < codes.length; i++) {
    if (isQuoteRefreshInCooldown()) break;
    const code = codes[i]!;
    const displaySymbols = codeToDisplaySymbols.get(code) ?? [];
    try {
      const quote = await fetchSahmkTickByCode(code);
      if (!quote) continue;
      assignQuoteKeys(out, displaySymbols, code, quote);
    } catch (err) {
      if (/429|rate.?limit|throttl|quota/i.test(err instanceof Error ? err.message : String(err ?? ''))) {
        rateLimited = true;
        // Stop immediately — continuing burns the free-tier daily budget.
        break;
      }
    }

    if (i + 1 < codes.length) {
      await new Promise((r) => setTimeout(r, INTER_CODE_GAP_MS));
    }
  }

  if (rateLimited && Object.keys(out).length === 0) {
    throw buildRateLimitBatchError('SAHMK');
  }
  if (rateLimited) {
    // Partial success — still enter cooldown so the rest of the book waits.
    noteSahmkRateLimited();
  }

  return out;
}

/** Test helper */
export function resetSahmkQuoteCacheForTests(): void {
  inFlightByCode.clear();
  cachedByCode.clear();
}
