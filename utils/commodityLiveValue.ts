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
}): Promise<{ ok: true; currentValue: number } | { ok: false; message: string }> {
  const { symbol, name, quantity, goldKarat } = params;
  const { prices } = await getAICommodityPrices([{ symbol, name, goldKarat }]);
  const p = prices.find((pr) => (pr.symbol || '').toUpperCase() === symbol.toUpperCase());
  if (!p || !Number.isFinite(p.price) || p.price <= 0) {
    return {
      ok: false,
      message:
        'Could not fetch a live price. For gold and silver, set VITE_FINNHUB_API_KEY. For Bitcoin, check your network. Then try again.',
    };
  }
  return { ok: true, currentValue: roundMoney(p.price * quantity) };
}
