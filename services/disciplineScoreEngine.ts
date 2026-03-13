import type { FinancialData, PlannedTrade, InvestmentTransaction } from '../types';

export interface DisciplineScoreSummary {
  score: number; // 0-100
  label: 'Strong' | 'Needs work' | 'At risk';
  reasons: string[];
}

export function computeDisciplineScore(data: FinancialData | null | undefined): DisciplineScoreSummary {
  if (!data) return { score: 0, label: 'At risk', reasons: ['No data available.'] };

  const plannedTrades = (data.plannedTrades ?? []) as PlannedTrade[];
  const txs = (data.investmentTransactions ?? []) as InvestmentTransaction[];

  const executed = plannedTrades.filter(p => p.status === 'Executed');

  const last90d = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const recentDeposits = txs.filter(t => t.type === 'deposit' && new Date(t.date).getTime() >= last90d);
  const recentBuys = txs.filter(t => t.type === 'buy' && new Date(t.date).getTime() >= last90d);

  let score = 100;
  const reasons: string[] = [];

  const planCount = plannedTrades.length;
  if (planCount >= 5 && executed.length / Math.max(1, planCount) < 0.2) {
    score -= 25;
    reasons.push('Many planned trades but few executed.');
  }

  if (recentDeposits.length === 0) {
    score -= 20;
    reasons.push('No investment deposits recorded in the last 90 days.');
  }
  if (recentBuys.length === 0) {
    score -= 10;
    reasons.push('No buys recorded in the last 90 days.');
  }

  // Basic cadence signal: if deposits exist but are very irregular, reduce score.
  if (recentDeposits.length >= 2) {
    const dates = recentDeposits.map(t => new Date(t.date).getTime()).sort((a, b) => a - b);
    const gaps = dates.slice(1).map((d, i) => (d - dates[i]) / (24 * 60 * 60 * 1000));
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avgGap > 40) {
      score -= 10;
      reasons.push('Deposit cadence is irregular (long gaps between contributions).');
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let label: DisciplineScoreSummary['label'] = 'Strong';
  if (score < 50) label = 'At risk';
  else if (score < 75) label = 'Needs work';

  if (reasons.length === 0) reasons.push('Consistent execution and contribution cadence.');

  return { score, label, reasons };
}

