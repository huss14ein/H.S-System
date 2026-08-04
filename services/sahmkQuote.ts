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
/**
 * Free-tier budget: cap distinct codes per outer tick.
 * Keep ≤8 so daily quota (~100) survives a full Awaed-sized book without one-shot burn.
 */
export const SAHMK_MAX_CODES_PER_BATCH = 8;
/** Parallel proxy calls within a batch — cuts wall time vs pure sequential without blasting the API. */
const SAHMK_FETCH_CONCURRENCY = 3;
/** Pause between concurrent waves (not between every single code). */
const INTER_WAVE_GAP_MS = 120;

const inFlightByCode = new Map<string, Promise<SahmkQuoteTick | null>>();
const cachedByCode = new Map<string, { at: number; tick: SahmkQuoteTick | null; rateLimited?: boolean }>();
/** Display symbols omitted by the per-batch code cap — MarketSimulator requeues these. */
let lastBatchDeferredDisplaySymbols: string[] = [];

/** Drain symbols skipped by `SAHMK_MAX_CODES_PER_BATCH` so the outer queue can retry them. */
export function consumeSahmkBatchDeferredSymbols(): string[] {
  const out = lastBatchDeferredDisplaySymbols;
  lastBatchDeferredDisplaySymbols = [];
  return out;
}

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
  // SAHMK-only — must not block Finnhub/Stooq for US (or mixed) refreshes.
  startQuoteRefreshCooldown(SAHMK_RATE_LIMIT_COOLDOWN_MS, 'sahmk');
}

async function fetchSahmkTickByCode(code: string): Promise<SahmkQuoteTick | null> {
  const c = code.trim().toUpperCase();
  if (!c) return null;

  if (isQuoteRefreshInCooldown('sahmk')) {
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
 * Caps distinct SAHMK codes per call, aborts on first 429, and respects SAHMK-only cooldown.
 * Codes beyond the cap are exposed via `consumeSahmkBatchDeferredSymbols()` for requeue.
 */
export async function getSahmkLivePrices(
  symbols: string[],
): Promise<Record<string, SahmkQuoteTick>> {
  lastBatchDeferredDisplaySymbols = [];
  if (symbols.length === 0) return {};
  if (isQuoteRefreshInCooldown('sahmk')) return {};

  const out: Record<string, SahmkQuoteTick> = {};

  const codeToDisplaySymbols = new Map<string, string[]>();
  for (const rawSymbol of symbols) {
    const code = extractTadawulCodeForSahmk(rawSymbol);
    if (!code) continue;
    const list = codeToDisplaySymbols.get(code) ?? [];
    list.push(rawSymbol);
    codeToDisplaySymbols.set(code, list);
  }

  const allCodes = Array.from(codeToDisplaySymbols.keys());
  const codes = allCodes.slice(0, SAHMK_MAX_CODES_PER_BATCH);
  const deferredCodes = allCodes.slice(SAHMK_MAX_CODES_PER_BATCH);
  lastBatchDeferredDisplaySymbols = deferredCodes.flatMap((c) => codeToDisplaySymbols.get(c) ?? []);
  let rateLimited = false;
  const succeededCodes = new Set<string>();

  for (let waveStart = 0; waveStart < codes.length; waveStart += SAHMK_FETCH_CONCURRENCY) {
    if (isQuoteRefreshInCooldown('sahmk') || rateLimited) break;
    const wave = codes.slice(waveStart, waveStart + SAHMK_FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      wave.map(async (code) => {
        const displaySymbols = codeToDisplaySymbols.get(code) ?? [];
        const quote = await fetchSahmkTickByCode(code);
        return { code, displaySymbols, quote };
      }),
    );

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        const { code, displaySymbols, quote } = result.value;
        if (quote) {
          assignQuoteKeys(out, displaySymbols, code, quote);
          succeededCodes.add(code);
        }
        continue;
      }
      const err = result.reason;
      if (/429|rate.?limit|throttl|quota/i.test(err instanceof Error ? err.message : String(err ?? ''))) {
        rateLimited = true;
      }
    }

    if (rateLimited) {
      // Requeue this wave’s unfinished codes + everything after (siblings may have succeeded).
      const remaining = codes
        .slice(waveStart)
        .filter((c) => !succeededCodes.has(c))
        .flatMap((c) => codeToDisplaySymbols.get(c) ?? []);
      lastBatchDeferredDisplaySymbols = Array.from(
        new Set([...remaining, ...lastBatchDeferredDisplaySymbols]),
      );
      break;
    }

    if (waveStart + SAHMK_FETCH_CONCURRENCY < codes.length) {
      await new Promise((r) => setTimeout(r, INTER_WAVE_GAP_MS));
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
  lastBatchDeferredDisplaySymbols = [];
}
