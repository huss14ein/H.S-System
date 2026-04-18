import type { Liability } from '../types';
import { isPersonalWealth } from '../utils/wealthScope';

/**
 * SAR amount from one liability row if it is an active personal receivable linked to `goalId`.
 */
export function receivableContributionForGoal(l: Liability, goalId: string): number {
  if (l.goalId !== goalId || l.type !== 'Receivable') return 0;
  if ((l.status ?? 'Active') !== 'Active') return 0;
  if ((l.amount ?? 0) <= 0) return 0;
  if (!isPersonalWealth(l)) return 0;
  return Math.abs(Number(l.amount) || 0);
}
