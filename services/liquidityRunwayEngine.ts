import type { FinancialData } from '../types';
import { computeHouseholdStressFromData } from './householdBudgetStress';
import { getPerformanceSnapshots } from './wealthUltraPerformance';

export interface LiquidityRunwaySummary {
  monthsOfRunway: number;
  drawdownPct: number;
  status: 'comfortable' | 'watch' | 'critical';
  reasons: string[];
}

export function computeLiquidityRunwayFromData(data: FinancialData | null | undefined): LiquidityRunwaySummary | null {
  if (!data) return null;

  const stress = computeHouseholdStressFromData(data);
  const accounts = data.accounts ?? [];
  const transactions = data.transactions ?? [];

  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const recentExpenses = transactions.filter(t => {
    if (t.type !== 'expense') return false;
    const d = new Date(t.date);
    return d >= sixMonthsAgo && d <= now;
  });
  const byMonth = new Map<string, number>();
  recentExpenses.forEach(t => {
    const d = new Date(t.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + Math.abs(t.amount));
  });
  const avgMonthlyExpense =
    byMonth.size > 0
      ? Array.from(byMonth.values()).reduce((a, b) => a + b, 0) / byMonth.size
      : 0;

  const liquidCash = accounts
    .filter(a => a.type === 'Checking' || a.type === 'Savings')
    .reduce((sum, a) => sum + Math.max(0, a.balance ?? 0), 0);

  const monthsOfRunway = avgMonthlyExpense > 0 ? liquidCash / avgMonthlyExpense : liquidCash > 0 ? 99 : 0;

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

