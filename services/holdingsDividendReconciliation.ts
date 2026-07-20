import type { FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { getPersonalInvestments, getPersonalTransactions } from '../utils/wealthScope';
import { getPersonalInvestmentTransactionsForKpis } from './investmentKpiCore';
import { reconcileHoldingsWithCorporateActionsSync } from './reconciliationEngine';

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

const QTY_EPS = 1e-4;

function ledgerQtyBySymbol(
  txs: InvestmentTransaction[],
  portfolioId: string,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const tx of txs) {
    if (String(tx.portfolioId ?? '') !== String(portfolioId)) continue;
    const sym = String(tx.symbol ?? '').trim().toUpperCase();
    if (!sym) continue;
    const q = Number(tx.quantity) || 0;
    if (tx.type === 'buy') m.set(sym, (m.get(sym) ?? 0) + q);
    else if (tx.type === 'sell') m.set(sym, (m.get(sym) ?? 0) - q);
  }
  return m;
}

/** @deprecated Raw buy-sell only — use reconcileHoldingsWithCorporateActionsSync for split-aware qty. */
export { ledgerQtyBySymbol };

/**
 * Investment txs for holdings qty checks.
 * Prefer personal KPI scope; when accounts are missing (fixtures / partial hydrate),
 * keep portfolio-linked rows so buy/sell drift is still detectable.
 */
function investmentTxsForHoldingsReconcile(
  data: FinancialData,
  portfolios: InvestmentPortfolio[],
): InvestmentTransaction[] {
  const kpiScoped = getPersonalInvestmentTransactionsForKpis(data);
  const all = (data.investmentTransactions ?? []) as InvestmentTransaction[];
  if (kpiScoped.length > 0) return kpiScoped;

  const portfolioIds = new Set(portfolios.map((p) => String(p.id)));
  const byPortfolio = all.filter((t) => {
    const pid = String(t.portfolioId ?? (t as { portfolio_id?: string }).portfolio_id ?? '');
    return pid.length > 0 && portfolioIds.has(pid);
  });
  if (byPortfolio.length > 0) return byPortfolio;
  // Last resort for minimal fixtures with no portfolioId on txs.
  return all;
}

function hasBuyOrSellForSymbol(txs: InvestmentTransaction[], portfolioId: string, symbol: string): boolean {
  const sym = symbol.toUpperCase();
  return txs.some((t) => {
    if (String(t.portfolioId ?? '') !== String(portfolioId)) return false;
    if (String(t.symbol ?? '').trim().toUpperCase() !== sym) return false;
    return t.type === 'buy' || t.type === 'sell';
  });
}

/** Compare holding quantity vs buy/sell ledger per portfolio; flag dividend tx without cash mirror. */
export function buildHoldingsDividendReconciliationReport(data: FinancialData): HoldingsDividendReconciliationReport {
  const rows: HoldingsReconcileRow[] = [];
  const portfolios = getPersonalInvestments(data);
  const invTxs = investmentTxsForHoldingsReconcile(data, portfolios);
  const cashTxs = getPersonalTransactions(data);
  const corporateActionEvents = data.corporateActionEvents ?? [];

  for (const p of portfolios) {
    const rawLedgerBySym = ledgerQtyBySymbol(invTxs, p.id);
    for (const h of (p.holdings ?? []) as Holding[]) {
      if (h.holdingType === 'commodity') continue;
      const sym = String(h.symbol ?? '').trim().toUpperCase();
      if (!sym) continue;
      const held = Number(h.quantity) || 0;
      const rec = reconcileHoldingsWithCorporateActionsSync({
        portfolio: p,
        symbol: sym,
        transactions: invTxs,
        corporateActionEvents,
      });
      /**
       * Prefer CA-aware ledger qty. When buy/sell history exists and there are no
       * corporate actions for the symbol, also enforce raw buy−sell vs held so
       * empty-account fixtures cannot hide plain quantity drift (holding 10 vs buy 8).
       */
      let led = Number(rec.ledgerQuantity) || 0;
      const hasCaForSymbol = corporateActionEvents.some(
        (e) =>
          e.portfolioId === p.id &&
          e.status !== 'reversed' &&
          String(e.symbol ?? '').trim().toUpperCase() === sym,
      );
      if (!hasCaForSymbol && hasBuyOrSellForSymbol(invTxs, p.id, sym) && rawLedgerBySym.has(sym)) {
        const raw = Number(rawLedgerBySym.get(sym)) || 0;
        if (Math.abs(held - led) <= QTY_EPS && Math.abs(held - raw) > QTY_EPS) {
          led = raw;
        }
      }
      const drift = Math.abs(held - led);
      if (drift > QTY_EPS) {
        rows.push({
          id: `hq-${p.id}-${sym}`,
          severity: drift > Math.max(1, held * 0.05) ? 'fail' : 'warn',
          category: 'holdings_qty',
          symbol: sym,
          portfolioId: p.id,
          message: `Holding qty ${held} vs ledger replay ${led} (${held - led >= 0 ? '+' : ''}${(held - led).toFixed(4)})`,
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
    isClean: holdingsMismatchCount === 0 && dividendMismatchCount === 0,
  };
}
