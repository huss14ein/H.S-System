/**
 * Next-best-action engine (logic layer).
 * Ranks urgent financial actions from liquidity, goals, portfolio, spending, and policy.
 */

export type ActionCategory =
  | 'liquidity'
  | 'goal'
  | 'portfolio'
  | 'spending'
  | 'debt'
  | 'policy'
  | 'review';

export interface NextBestAction {
  id: string;
  category: ActionCategory;
  title: string;
  description: string;
  priorityScore: number; // 0–100, higher = more urgent
  link?: string;
  linkLabel?: string;
  data?: Record<string, unknown>;
}

export interface NextBestActionInput {
  emergencyFundMonths?: number;
  runwayMonths?: number;
  goalAlerts?: { goalId: string; name: string; gapPct?: number; allocPct?: number }[];
  portfolioAlerts?: string[];
  spendingAlerts?: string[];
  debtStressScore?: number;
  policyBlocked?: boolean;
  salaryCoverageRatio?: number;
  nwSnapshotCount?: number;
}

/** Generate a short list of next-best actions from current state. */
export function generateNextBestActions(input: NextBestActionInput): NextBestAction[] {
  const actions: NextBestAction[] = [];
  const ef = input.emergencyFundMonths ?? 0;
  const run = input.runwayMonths ?? 0;
  const salaryOk = (input.salaryCoverageRatio ?? 1) >= 1;

  if (ef < 2 || run < 2) {
    actions.push({
      id: 'top-up-emergency',
      category: 'liquidity',
      title: 'Top up emergency fund',
      description: `Runway is ${run.toFixed(1)} months. Aim for at least 2–3 months of expenses in liquid cash.`,
      priorityScore: 85,
      link: 'Dashboard',
      linkLabel: 'Dashboard',
      data: { runwayMonths: run, emergencyFundMonths: ef },
    });
  }
  if (!salaryOk && (input.salaryCoverageRatio ?? 0) < 1) {
    actions.push({
      id: 'salary-vs-expense',
      category: 'spending',
      title: 'Salary vs expense coverage',
      description: 'Monthly salary is below average expenses. Review spending or income in Analysis.',
      priorityScore: 75,
      link: 'Analysis',
      linkLabel: 'Analysis',
      data: { ratio: input.salaryCoverageRatio },
    });
  }
  (input.goalAlerts ?? []).forEach((g) => {
    if (g.allocPct === 0) {
      actions.push({
        id: `goal-alloc-${g.goalId}`,
        category: 'goal',
        title: `Set allocation for "${g.name}"`,
        description: 'This goal has 0% allocation. Assign a savings % in Goals.',
        priorityScore: 65,
        link: 'Goals',
        linkLabel: 'Goals',
        data: { goalId: g.goalId },
      });
    }
  });
  if (input.debtStressScore != null && input.debtStressScore >= 50) {
    actions.push({
      id: 'debt-review',
      category: 'debt',
      title: 'Review debt burden',
      description: 'Debt stress is elevated. Check Liabilities and payoff options.',
      priorityScore: 70,
      link: 'Liabilities',
      linkLabel: 'Liabilities',
      data: { score: input.debtStressScore },
    });
  }
  if (input.policyBlocked) {
    actions.push({
      id: 'policy-blocked',
      category: 'policy',
      title: 'Trading policy blocking buy',
      description: 'A planned buy is blocked by your trading policy. Review Settings or use override if intended.',
      priorityScore: 40,
      link: 'Settings',
      linkLabel: 'Settings',
    });
  }
  if ((input.nwSnapshotCount ?? 0) < 2) {
    actions.push({
      id: 'snapshot-attribution',
      category: 'review',
      title: 'Add net worth snapshots',
      description: 'Add at least two snapshots (e.g. month-end) to see why your net worth changed.',
      priorityScore: 25,
      link: 'Engines & Tools',
      linkLabel: 'Safety & rules',
      data: { action: 'openRiskTradingHub' },
    });
  }

  return actions.sort((a, b) => b.priorityScore - a.priorityScore);
}

/** Rank actions by priority (already sorted in generateNextBestActions; use for display order). */
export function rankUrgentFinancialActions(actions: NextBestAction[]): NextBestAction[] {
  return [...actions].sort((a, b) => b.priorityScore - a.priorityScore);
}
