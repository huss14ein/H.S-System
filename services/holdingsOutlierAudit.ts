import type { FinancialData } from '../types';
import { getPersonalInvestments } from '../utils/wealthScope';
import { MAX_HOLDING_BOOK_NOTIONAL } from './marketSimulatorHoldingPersist';

export type HoldingOutlierRow = {
  holdingId: string;
  symbol: string;
  portfolioName: string;
  currentValue: number;
  quantity: number;
  reason: string;
};

/** Client-side scan for absurd stored notionals (run after hydrate; fix in Supabase). */
export function findHoldingsValueOutliers(
  data: FinancialData,
  maxNotional = MAX_HOLDING_BOOK_NOTIONAL,
): HoldingOutlierRow[] {
  const rows: HoldingOutlierRow[] = [];
  for (const p of getPersonalInvestments(data)) {
    for (const h of p.holdings ?? []) {
      const v = Number(h.currentValue) || 0;
      const qty = Number(h.quantity) || 0;
      if (!h.id) continue;
      if (v > maxNotional) {
        rows.push({
          holdingId: h.id,
          symbol: String(h.symbol ?? '—'),
          portfolioName: String(p.name ?? p.id ?? 'Portfolio'),
          currentValue: v,
          quantity: qty,
          reason: `current_value exceeds ${maxNotional.toLocaleString()} SAR`,
        });
      } else if (qty > 0 && v / qty > maxNotional / 100) {
        rows.push({
          holdingId: h.id,
          symbol: String(h.symbol ?? '—'),
          portfolioName: String(p.name ?? p.id ?? 'Portfolio'),
          currentValue: v,
          quantity: qty,
          reason: 'implied price per unit is extreme',
        });
      }
    }
  }
  return rows.sort((a, b) => b.currentValue - a.currentValue);
}
