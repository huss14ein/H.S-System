import type { FinancialData, Holding, InvestmentTransaction } from '../types';
import { getPersonalInvestments, getPersonalTransactions } from '../utils/wealthScope';
import { getPersonalInvestmentTransactionsForKpis } from './investmentKpiCore';

export type HoldingsReconcileSeverity = 'ok' | 'warn' | 'fail';

export interface HoldingsReconcileRow {
  id: string;
  severity: HoldingsReconcileSeverity;
  category: 'holdings_qty' | 'dividend_cash';
  symbol: string;
  portfolioId?: string;
  message: string;
  expected?: number;
  actual?: number;
  drillTarget: 'Investments' | 'Transactions';
}

export interface HoldingsDividendReconciliationReport {
  rows: HoldingsReconcileRow[];
  holdingsMismatchCount: number;
  dividendMismatchCount: number;
  isClean: boolean;
}

function ledgerQtyBySymbol(
  txs: InvestmentTransaction[],
  portfolioId: string,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const tx of txs) {
    if (tx.portfolioId !== portfolioId) continue;
    const sym = String(tx.symbol ?? '').trim().toUpperCase();
    if (!sym) continue;
    const q = Number(tx.quantity) || 0;
    if (tx.type === 'buy') m.set(sym, (m.get(sym) ?? 0) + q);
    else if (tx.type === 'sell') m.set(sym, (m.get(sym) ?? 0) - q);
  }
  return m;
}

/** Compare holding quantity vs buy/sell ledger per portfolio; flag dividend tx without cash mirror. */
export function buildHoldingsDividendReconciliationReport(data: FinancialData): HoldingsDividendReconciliationReport {
  const rows: HoldingsReconcileRow[] = [];
  const portfolios = getPersonalInvestments(data);
  const invTxs = getPersonalInvestmentTransactionsForKpis(data);
  const cashTxs = getPersonalTransactions(data);

  for (const p of portfolios) {
    const ledger = ledgerQtyBySymbol(invTxs, p.id);
    for (const h of (p.holdings ?? []) as Holding[]) {
      if (h.holdingType === 'commodity') continue;
      const sym = String(h.symbol ?? '').trim().toUpperCase();
      if (!sym) continue;
      const held = Number(h.quantity) || 0;
      const led = ledger.get(sym) ?? 0;
      const drift = Math.abs(held - led);
      if (drift > 0.0001) {
        rows.push({
          id: `hq-${p.id}-${sym}`,
          severity: drift > Math.max(1, held * 0.05) ? 'fail' : 'warn',
          category: 'holdings_qty',
          symbol: sym,
          portfolioId: p.id,
          message: `Holding qty ${held} vs ledger net ${led} (${drift > 0 ? '+' : ''}${(held - led).toFixed(4)})`,
          expected: led,
          actual: held,
          drillTarget: 'Investments',
        });
      }
    }
  }

  const dividendInv = invTxs.filter((t) => t.type === 'dividend');
  const dividendCash = cashTxs.filter(
    (t) =>
      /dividend/i.test(String(t.category ?? '')) ||
      /dividend/i.test(String(t.description ?? '')) ||
      /dividend/i.test(String(t.budgetCategory ?? '')),
  );
  const invTotal = dividendInv.reduce((s, t) => s + Math.abs(Number(t.total) || 0), 0);
  const cashTotal = dividendCash.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
  const divDrift = Math.abs(invTotal - cashTotal);
  if (dividendInv.length > 0 && divDrift > Math.max(50, invTotal * 0.15)) {
    rows.push({
      id: 'div-cash-mirror',
      severity: divDrift > invTotal * 0.35 ? 'fail' : 'warn',
      category: 'dividend_cash',
      symbol: '—',
      message: `Investment dividend total ${invTotal.toFixed(0)} vs cash dividend-like tx ${cashTotal.toFixed(0)} (review categorization)`,
      expected: invTotal,
      actual: cashTotal,
      drillTarget: 'Transactions',
    });
  }

  const holdingsMismatchCount = rows.filter((r) => r.category === 'holdings_qty').length;
  const dividendMismatchCount = rows.filter((r) => r.category === 'dividend_cash').length;
  return {
    rows,
    holdingsMismatchCount,
    dividendMismatchCount,
    isClean: rows.length === 0,
  };
}
