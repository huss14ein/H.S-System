/**
 * Chronological portfolio replay with corporate actions (chunked, abortable).
 */
import type { CorporateAction } from './corporateActions';
import { applyCorporateAction } from './corporateActions';
import type { InvestmentTransaction } from '../types';
import { yieldToMain } from '../utils/yieldToMain';

export type ReplayHolding = { symbol: string; quantity: number; avgCost: number };

export type CorporateActionReplayEvent = {
  id: string;
  executionDate: string;
  symbol: string;
  action: CorporateAction;
};

export type PortfolioReplayResult = {
  holdings: Map<string, ReplayHolding>;
  cashSar: number;
};

const CHUNK_SIZE = 100;

function sortKey(tx: InvestmentTransaction): number {
  const d = String(tx.date ?? '').slice(0, 10);
  return new Date(d).getTime() || 0;
}

export async function rebuildPortfolioFromEvents(args: {
  transactions: InvestmentTransaction[];
  corporateActions: CorporateActionReplayEvent[];
  fromDate?: string;
  initialHoldings?: ReplayHolding[];
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}): Promise<PortfolioReplayResult> {
  const holdings = new Map<string, ReplayHolding>();
  for (const h of args.initialHoldings ?? []) {
    holdings.set(h.symbol.toUpperCase(), { ...h, symbol: h.symbol.toUpperCase() });
  }
  let cashSar = 0;

  type TimelineItem =
    | { kind: 'tx'; at: string; tx: InvestmentTransaction }
    | { kind: 'ca'; at: string; ev: CorporateActionReplayEvent };

  const fromMs = args.fromDate ? new Date(args.fromDate).getTime() : 0;
  const timeline: TimelineItem[] = [];

  for (const tx of args.transactions) {
    const at = String(tx.date ?? '').slice(0, 10);
    if (fromMs && new Date(at).getTime() < fromMs) continue;
    timeline.push({ kind: 'tx', at, tx });
  }
  for (const ev of args.corporateActions) {
    if (fromMs && new Date(ev.executionDate).getTime() < fromMs) continue;
    timeline.push({ kind: 'ca', at: ev.executionDate, ev });
  }

  timeline.sort((a, b) => {
    const da = a.at.localeCompare(b.at);
    if (da !== 0) return da;
    if (a.kind !== b.kind) return a.kind === 'tx' ? -1 : 1;
    return 0;
  });

  let processed = 0;
  for (let i = 0; i < timeline.length; i++) {
    if (args.signal?.aborted) break;
    if (i > 0 && i % CHUNK_SIZE === 0) {
      await yieldToMain();
      args.onProgress?.(Math.round((i / timeline.length) * 100));
    }

    const item = timeline[i]!;
    if (item.kind === 'tx') {
      const tx = item.tx;
      const sym = String(tx.symbol ?? '').trim().toUpperCase();
      const qty = Math.abs(Number(tx.quantity) || 0);
      const total = Math.abs(Number(tx.total) || Number(tx.price) * qty || 0);
      if (tx.type === 'buy' && sym) {
        const cur = holdings.get(sym) ?? { symbol: sym, quantity: 0, avgCost: 0 };
        const newQty = cur.quantity + qty;
        const newCost = newQty > 0 ? (cur.quantity * cur.avgCost + total) / newQty : 0;
        holdings.set(sym, { symbol: sym, quantity: newQty, avgCost: newCost });
        cashSar -= total;
      } else if (tx.type === 'sell' && sym) {
        const cur = holdings.get(sym);
        if (cur) {
          const newQty = Math.max(0, cur.quantity - qty);
          holdings.set(sym, { symbol: sym, quantity: newQty, avgCost: cur.avgCost });
        }
        cashSar += total;
      } else if (tx.type === 'dividend') {
        cashSar += total;
      } else if (tx.type === 'deposit') {
        cashSar += total;
      } else if (tx.type === 'withdrawal') {
        cashSar -= total;
      }
    } else {
      const ev = item.ev;
      const sym = ev.symbol.toUpperCase();
      const cur = holdings.get(sym) ?? { symbol: sym, quantity: 0, avgCost: 0 };
      const applied = applyCorporateAction({ action: ev.action, holding: cur });
      holdings.set(sym, { symbol: sym, quantity: applied.quantity, avgCost: applied.avgCost });
      if (applied.cashReceived) cashSar += applied.cashReceived;
      if (applied.cashInLieu) cashSar += applied.cashInLieu;
      if (applied.spinoffGrant) {
        const g = applied.spinoffGrant;
        holdings.set(g.symbol.toUpperCase(), {
          symbol: g.symbol.toUpperCase(),
          quantity: g.quantity,
          avgCost: g.avgCost,
        });
      }
      if (applied.mergerGrant) {
        holdings.delete(sym);
        const g = applied.mergerGrant;
        holdings.set(g.symbol.toUpperCase(), {
          symbol: g.symbol.toUpperCase(),
          quantity: g.quantity,
          avgCost: g.avgCost,
        });
      }
    }
    processed++;
  }

  args.onProgress?.(100);
  for (const [k, h] of holdings) {
    if (h.quantity <= 1e-9) holdings.delete(k);
  }
  return { holdings, cashSar };
}

/** Sort transactions for replay (execution date, then id). */
export function sortInvestmentTransactionsChronological(txs: InvestmentTransaction[]): InvestmentTransaction[] {
  return [...txs].sort((a, b) => {
    const da = sortKey(a);
    const db = sortKey(b);
    if (da !== db) return da - db;
    return String(a.id).localeCompare(String(b.id));
  });
}
