import type { FinancialData } from '../types';
import { approximatePortfolioMWRR } from './portfolioXirr';
import { getPersonalInvestmentTransactionsForKpis } from './investmentKpiCore';

export type PortfolioPerformanceSnapshot = {
  mwrrPct: number | null;
  twrrApproxPct: number | null;
  benchmarkExcessPct: number | null;
  periodLabel: string;
};

/** TWRR approximation via month-end value chain from investment txs (simplified). */
export function approximateTimeWeightedReturnPct(
  _data: FinancialData,
  startValueSar: number,
  endValueSar: number,
  months = 12,
): number | null {
  if (startValueSar <= 0 || endValueSar <= 0 || months <= 0) return null;
  const r = Math.pow(endValueSar / startValueSar, 12 / months) - 1;
  return r * 100;
}

export function buildPortfolioPerformanceSnapshot(
  data: FinancialData,
  currentValueSar: number,
  priorValueSar: number,
  months = 12,
): PortfolioPerformanceSnapshot {
  const txs = getPersonalInvestmentTransactionsForKpis(data);
  const flows = txs
    .filter((t: { type: string }) => t.type === 'buy' || t.type === 'sell')
    .map((t: { date: string; type: string; total?: number }) => ({
      date: t.date,
      amount: t.type === 'buy' ? -Math.abs(Number(t.total) || 0) : Math.abs(Number(t.total) || 0),
    }));
  const mwrr = approximatePortfolioMWRR(flows, currentValueSar, new Date().toISOString().slice(0, 10));
  const twrr = approximateTimeWeightedReturnPct(data, priorValueSar, currentValueSar, months);
  return {
    mwrrPct: mwrr != null && Number.isFinite(mwrr) ? mwrr * 100 : null,
    twrrApproxPct: twrr,
    benchmarkExcessPct: null,
    periodLabel: `${months}m`,
  };
}
