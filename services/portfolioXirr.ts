import { toSAR } from '../utils/currencyMath';

/**
 * Simple money-weighted return (IRR) via bisection on periodic cashflows.
 * cashflows: negative = invest, positive = withdraw/terminal value.
 * Not a substitute for audited performance; document limitations.
 */
export function approximatePortfolioMWRR(
  flows: { date: string; amount: number }[],
  terminalValue: number,
  terminalDate: string
): number | null {
  if (flows.length === 0 && terminalValue <= 0) return null;
  const all = [...flows, { date: terminalDate, amount: terminalValue }];
  const t0 = new Date(all.reduce((m, f) => Math.min(m, new Date(f.date).getTime()), Infinity)).getTime();
  const days = (d: string) => (new Date(d).getTime() - t0) / 86400000;
  const npv = (r: number) => {
    const daily = Math.pow(1 + r, 1 / 365) - 1;
    return all.reduce((s, f) => s + f.amount / Math.pow(1 + daily, days(f.date)), 0);
  };
  let lo = -0.99,
    hi = 10;
  let vlo = npv(lo),
    vhi = npv(hi);
  if (!Number.isFinite(vlo) || !Number.isFinite(vhi)) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const vm = npv(mid);
    if (Math.abs(vm) < 1e-6) return mid * 100;
    if (vm > 0) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 100;
}

export function flowsFromInvestmentTransactions(
  txs: { date: string; type: string; total?: number }[]
): { date: string; amount: number }[] {
  const out: { date: string; amount: number }[] = [];
  txs.forEach((t) => {
    const x = Math.abs(Number(t.total) || 0);
    if (t.type === 'buy' || t.type === 'deposit') out.push({ date: t.date, amount: -x });
    if (t.type === 'sell' || t.type === 'withdrawal') out.push({ date: t.date, amount: x });
  });
  return out;
}

/** Same as `flowsFromInvestmentTransactions` but converts each flow to SAR using `currency` (defaults USD), matching `getAllInvestmentsValueInSAR` for MWRR. */
export function flowsFromInvestmentTransactionsInSAR(
  txs: { date: string; type: string; total?: number; currency?: string }[],
  exchangeRate: number
): { date: string; amount: number }[] {
  const out: { date: string; amount: number }[] = [];
  txs.forEach((t) => {
    const x = Math.abs(Number(t.total) || 0);
    const sar = toSAR(x, (t.currency ?? 'USD') as 'USD' | 'SAR', exchangeRate);
    if (t.type === 'buy' || t.type === 'deposit') out.push({ date: t.date, amount: -sar });
    if (t.type === 'sell' || t.type === 'withdrawal') out.push({ date: t.date, amount: sar });
  });
  return out;
}
