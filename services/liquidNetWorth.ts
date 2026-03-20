import type { FinancialData } from '../types';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from './transactionFilters';

/** Cash-like + investments + commodities + receivables − debt (simplified liquid picture). */
export function computeLiquidNetWorth(data: FinancialData | null | undefined): {
  liquidCash: number;
  investmentsSAR: number;
  commodities: number;
  receivables: number;
  shortTermDebt: number;
  liquidNetWorth: number;
  contributionEstimate30d: number;
  marketMoveEstimate30d: number;
} {
  if (!data) {
    return {
      liquidCash: 0,
      investmentsSAR: 0,
      commodities: 0,
      receivables: 0,
      shortTermDebt: 0,
      liquidNetWorth: 0,
      contributionEstimate30d: 0,
      marketMoveEstimate30d: 0,
    };
  }
  const accounts = (data as any).personalAccounts ?? data.accounts ?? [];
  const liquidCash = accounts
    .filter((a: { type?: string }) => a.type === 'Checking' || a.type === 'Savings')
    .reduce((s: number, a: { balance?: number }) => s + Math.max(0, Number(a.balance) || 0), 0);
  const inv = (data as any).personalInvestments ?? data.investments ?? [];
  let investmentsSAR = 0;
  inv.forEach((p: { holdings?: { currentValue?: number }[] }) => {
    (p.holdings ?? []).forEach((h: { currentValue?: number }) => {
      investmentsSAR += Number(h.currentValue) || 0;
    });
  });
  const comm = (data as any).personalCommodityHoldings ?? data.commodityHoldings ?? [];
  const commodities = comm.reduce((s: number, c: { currentValue?: number }) => s + (Number(c.currentValue) || 0), 0);
  const liab = (data as any).personalLiabilities ?? data.liabilities ?? [];
  const receivables = liab.filter((l: { amount?: number }) => (l.amount ?? 0) > 0).reduce((s: number, l: { amount?: number }) => s + (l.amount ?? 0), 0);
  const shortTermDebt =
    liab.filter((l: { amount?: number }) => (l.amount ?? 0) < 0).reduce((s: number, l: { amount?: number }) => s + Math.abs(l.amount ?? 0), 0) +
    accounts
      .filter((a: { type?: string; balance?: number }) => a.type === 'Credit' && (a.balance ?? 0) < 0)
      .reduce((s: number, a: { balance?: number }) => s + Math.abs(a.balance ?? 0), 0);
  const liquidNetWorth = liquidCash + investmentsSAR + commodities + receivables - shortTermDebt;

  const txs = (data as any).personalTransactions ?? data.transactions ?? [];
  const now = new Date();
  const d30 = new Date(now);
  d30.setDate(d30.getDate() - 30);
  let contributionEstimate30d = 0;
  txs.forEach((t: { date: string; type?: string; category?: string; amount?: number }) => {
    if (new Date(t.date) < d30) return;
    const amt = Number(t.amount) || 0;
    if (countsAsIncomeForCashflowKpi(t)) contributionEstimate30d += amt;
    if (countsAsExpenseForCashflowKpi(t)) contributionEstimate30d -= Math.abs(amt);
  });
  const marketMoveEstimate30d = Math.max(0, contributionEstimate30d) * 0.02;

  return {
    liquidCash,
    investmentsSAR,
    commodities,
    receivables,
    shortTermDebt,
    liquidNetWorth,
    contributionEstimate30d,
    marketMoveEstimate30d,
  };
}
