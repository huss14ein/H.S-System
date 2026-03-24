import { getAICommodityPrices } from '../services/geminiService';
import type { CommodityHolding } from '../types';
import { roundMoney } from './money';

/**
 * Resolves total SAR current value from live quotes (Finnhub metals + Binance crypto fallback).
 * Not used for commodity name "Other".
 */
export async function fetchLiveCommodityValueSar(params: {
  symbol: string;
  name: CommodityHolding['name'];
  quantity: number;
  goldKarat?: CommodityHolding['goldKarat'];
  /** SAR per 1 USD; should match `resolveSarPerUsd` so metal/crypto values align with the rest of the app. */
  sarPerUsd?: number;
}): Promise<{ ok: true; currentValue: number } | { ok: false; message: string }> {
  const { symbol, name, quantity, goldKarat, sarPerUsd } = params;
  const { prices } = await getAICommodityPrices([{ symbol, name, goldKarat }], { sarPerUsd });
  const p = prices.find((pr) => (pr.symbol || '').toUpperCase() === symbol.toUpperCase());
  if (!p || !Number.isFinite(p.price) || p.price <= 0) {
    return {
      ok: false,
      message:
        'Could not fetch a live price. Gold/silver try CoinGecko fallback after Finnhub; ensure network access. For Bitcoin, Binance is used if Finnhub is unavailable. Then try again.',
    };
  }
  return { ok: true, currentValue: roundMoney(p.price * quantity) };
}

/** Spot 24K gold in SAR per gram (Finnhub OANDA XAU/USD × app FX ÷ troy oz). */
export async function fetchLiveGoldPriceSarPerGram(sarPerUsd?: number): Promise<{ ok: true; price: number } | { ok: false; message: string }> {
  const symbol = 'XAU_GRAM_24K';
  const { prices } = await getAICommodityPrices([{ symbol, name: 'Gold', goldKarat: 24 }], { sarPerUsd });
  const p = prices.find((pr) => (pr.symbol || '').toUpperCase() === symbol);
  if (!p || !Number.isFinite(p.price) || p.price <= 0) {
    return {
      ok: false,
      message:
        'Could not load live gold (Finnhub and public spot fallback both failed). Check your USD→SAR rate (header/settings) and network, then try again.',
    };
  }
  return { ok: true, price: roundMoney(p.price) };
}
