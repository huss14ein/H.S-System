/**
 * Maps Recovery Plan draft limit orders → Investment Plan (planned_trades) rows.
 * Ladder limits are in portfolio book currency per share; we convert to instrument currency for `targetValue`
 * so triggers match live quotes and Trade plan rules (buy ≤ / sell ≥).
 */

import type { PlannedTrade, RecoveryOrderDraft, TradeCurrency } from '../types';
import { convertBetweenTradeCurrencies, inferInstrumentCurrencyFromSymbol } from '../utils/currencyMath';

const NAME_MAX = 200;

export function recoveryOrderDraftToPlannedTrade(
  draft: RecoveryOrderDraft,
  opts: {
    displayName: string;
    planCurrency: TradeCurrency;
    sarPerUsd: number;
    /** Currency of `draft.limitPrice` (recovery ladder uses portfolio book currency per share). */
    limitPriceCurrency: TradeCurrency;
  },
): Omit<PlannedTrade, 'id' | 'user_id'> {
  const sym = String(draft.symbol || '').trim().toUpperCase();
  if (!sym) throw new Error('Draft symbol is required.');

  const instr = inferInstrumentCurrencyFromSymbol(sym);
  const rawLimit = Number(draft.limitPrice);
  if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
    throw new Error('Invalid limit price on recovery draft.');
  }

  const qty = Number(draft.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error('Invalid quantity on recovery draft.');
  }

  /** Per-share trigger in instrument currency (matches Trade plans / live quotes). */
  const targetPriceInstr =
    opts.limitPriceCurrency === instr
      ? rawLimit
      : convertBetweenTradeCurrencies(rawLimit, opts.limitPriceCurrency, instr, opts.sarPerUsd);

  const notionalInstr = qty * targetPriceInstr;
  const amountPlan = convertBetweenTradeCurrencies(notionalInstr, instr, opts.planCurrency, opts.sarPerUsd);

  const tradeType = draft.type === 'BUY' ? 'buy' : 'sell';
  const priority: PlannedTrade['priority'] =
    draft.label?.toLowerCase().includes('exit') || draft.type === 'SELL' ? 'Medium' : 'High';

  const rawName = String(opts.displayName || sym).trim() || sym;
  const name = rawName.length > NAME_MAX ? rawName.slice(0, NAME_MAX) : rawName;

  const triggerHint = tradeType === 'buy' ? '≤' : '≥';
  const notes = [
    `Recovery engine: ${draft.label ?? draft.type}.`,
    `Trigger ${triggerHint} ${targetPriceInstr.toFixed(4)} ${instr}/sh (from ${rawLimit} ${opts.limitPriceCurrency}); est. ${amountPlan.toFixed(2)} ${opts.planCurrency} notional.`,
  ].join(' ');

  return {
    symbol: sym,
    name,
    tradeType,
    conditionType: 'price',
    targetValue: targetPriceInstr,
    quantity: qty,
    amount: amountPlan,
    priority,
    status: 'Planned',
    notes: notes.length > 2000 ? `${notes.slice(0, 1997)}...` : notes,
  };
}

/** True if an equivalent price plan already exists (same symbol, side, trigger, qty). */
export function plannedTradeMatchesRecoveryDraft(
  existing: PlannedTrade[],
  candidate: Omit<PlannedTrade, 'id' | 'user_id'>,
): boolean {
  return existing.some((p) => {
    if (p.status === 'Executed') return false;
    if ((p.symbol || '').toUpperCase() !== candidate.symbol.toUpperCase()) return false;
    if (p.tradeType !== candidate.tradeType || p.conditionType !== 'price') return false;
    if (Math.abs(Number(p.targetValue) - Number(candidate.targetValue)) > 1e-4) return false;
    const pq = Number(p.quantity ?? 0);
    const cq = Number(candidate.quantity ?? 0);
    if (Number.isFinite(pq) && Number.isFinite(cq) && pq > 0 && cq > 0) {
      return Math.abs(pq - cq) < 1e-4;
    }
    return false;
  });
}
