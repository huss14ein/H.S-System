import type { FinancialData } from '../types';
import { normalizedMonthlyExpenseSar, cashRunwayMonths } from './financeMetrics';
import { computeHouseholdStressFromData } from './householdBudgetStress';
import { getPerformanceSnapshots } from './wealthUltraPerformance';
import { resolveSarPerUsd, totalLiquidCashSARFromAccounts, toSAR } from '../utils/currencyMath';

export interface LiquidityRunwaySummary {
  monthsOfRunway: number;
  drawdownPct: number;
  status: 'comfortable' | 'watch' | 'critical';
  reasons: string[];
}

export function computeLiquidityRunwayFromData(
  data: FinancialData | null | undefined,
  options?: { exchangeRate?: number; getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number } }
): LiquidityRunwaySummary | null {
  if (!data) return null;

  const stress = computeHouseholdStressFromData(data);
  const accounts = (data as any).personalAccounts ?? data.accounts ?? [];
  const transactions = (data as any).personalTransactions ?? data.transactions ?? [];
  const sarPerUsd = resolveSarPerUsd(data as { wealthUltraConfig?: { fxRate?: number | null } | null }, options?.exchangeRate);

  const avgMonthlyExpense = normalizedMonthlyExpenseSar(
    transactions as any,
    accounts as any,
    sarPerUsd,
    { monthsLookback: 6 }
  );

  const liquidCash = options?.getAvailableCashForAccount
    ? totalLiquidCashSARFromAccounts(accounts as { id: string; type?: string; balance?: number; currency?: 'USD' | 'SAR' }[], options.getAvailableCashForAccount, sarPerUsd)
    : accounts
        .filter((a: { type?: string }) => a.type === 'Checking' || a.type === 'Savings')
        .reduce((sum: number, a: { balance?: number; currency?: 'USD' | 'SAR' }) => {
          const bal = Math.max(0, Number(a.balance) || 0);
          const cur = a.currency === 'USD' ? 'USD' : 'SAR';
          return sum + toSAR(bal, cur, sarPerUsd);
        }, 0);

  const monthsOfRunway = cashRunwayMonths(liquidCash, avgMonthlyExpense);

  const snaps = getPerformanceSnapshots();
  let drawdownPct = 0;
  if (snaps.length > 1) {
    const peak = Math.max(...snaps.map(s => s.totalPortfolioValue));
    const last = snaps[0]?.totalPortfolioValue ?? 0;
    if (peak > 0 && last > 0) {
      drawdownPct = ((last - peak) / peak) * 100;
    }
  }

  const reasons: string[] = [];
  let status: LiquidityRunwaySummary['status'] = 'comfortable';

  if (monthsOfRunway < 3) {
    status = 'critical';
    reasons.push('Cash runway below 3 months of expenses.');
  } else if (monthsOfRunway < 6) {
    status = 'watch';
    reasons.push('Cash runway below 6 months of expenses.');
  } else {
    status = 'comfortable';
    reasons.push('Cash runway above 6 months of expenses.');
  }

  if (drawdownPct < -20) {
    status = 'critical';
    reasons.push('Portfolio is in a deep drawdown (20%+).');
  } else if (drawdownPct < -10) {
    if (status === 'comfortable') status = 'watch';
    reasons.push('Portfolio is in a notable drawdown (10–20%).');
  }

  if (stress && stress.level === 'high') {
    status = 'critical';
    reasons.push('Household stress is high; combine with limited runway for elevated risk.');
  }

  return {
    monthsOfRunway,
    drawdownPct,
    status,
    reasons,
  };
}
