/**
 * Budget coverage for expense transactions (add / edit / split).
 * Over-utilized envelopes show warnings only — saving is never blocked by remaining headroom.
 */

export type BudgetCoverageTone = 'green' | 'yellow' | 'red' | 'neutral';

export interface BudgetCoverageLineInput {
  category: string;
  amountSar: number;
  remainingSar: number;
  shortfallSar: number;
  /** Monthly limit for tone (yellow near 90%); omit when unknown. */
  limitSar?: number;
}

const TONE_RANK: Record<Exclude<BudgetCoverageTone, 'neutral'>, number> = {
  green: 0,
  yellow: 1,
  red: 2,
};

const EPS = 0.0001;

/** @internal exported for tests */
export function worstBudgetCoverageTone(tones: BudgetCoverageTone[]): BudgetCoverageTone {
  const nonNeutral = tones.filter((t) => t !== 'neutral') as Exclude<BudgetCoverageTone, 'neutral'>[];
  if (nonNeutral.length === 0) return 'neutral';
  return nonNeutral.reduce((worst, t) => (TONE_RANK[t] > TONE_RANK[worst] ? t : worst), nonNeutral[0]);
}

export function computeBudgetCoverageTone(args: {
  limitSar: number;
  remainingSar: number;
  amountSar: number;
}): BudgetCoverageTone {
  const limitSar = Number(args.limitSar) || 0;
  const remainingSar = Number(args.remainingSar) || 0;
  const amountSar = Math.max(0, Number(args.amountSar) || 0);
  if (!(amountSar > EPS)) return 'neutral';
  /** No monthly limit on this envelope — informational, not an error. */
  if (!(limitSar > EPS)) return 'neutral';
  const projectedRemaining = remainingSar - amountSar;
  /** Over budget only when amount strictly exceeds remaining. */
  if (projectedRemaining < -EPS) return 'red';
  const consumedPctAfter = (limitSar - Math.max(0, projectedRemaining)) / limitSar;
  /** Exactly uses remaining, or ≥90% of the monthly limit after this expense. */
  if (projectedRemaining <= EPS || (Number.isFinite(consumedPctAfter) && consumedPctAfter >= 0.9)) {
    return 'yellow';
  }
  return 'green';
}

export function evaluateTransactionBudgetCoverageState(args: {
  transactionType: 'income' | 'expense';
  hasAmount: boolean;
  budgetCategory: string;
  useSplitExpense: boolean;
  splitCoverage: BudgetCoverageLineInput[];
  budgetCoverageSummary: { limitSar: number; remainingSar: number; spentSar?: number } | null;
  inputAmountSar: number;
}): {
  tone: BudgetCoverageTone;
  title: string;
  summary: string;
  shortfalls: BudgetCoverageLineInput[];
  isWithinBudget: boolean;
  /** Single-category detail for the status card (null when split / N/A). */
  detail: {
    category: string;
    limitSar: number;
    spentSar: number;
    remainingSar: number;
    afterSar: number;
  } | null;
} {
  const {
    transactionType,
    hasAmount,
    budgetCategory,
    useSplitExpense,
    splitCoverage,
    budgetCoverageSummary,
    inputAmountSar,
  } = args;

  if (transactionType !== 'expense') {
    return {
      tone: 'neutral',
      title: 'Budget',
      summary: 'Income does not use budget limits.',
      shortfalls: [],
      isWithinBudget: true,
      detail: null,
    };
  }
  if (!hasAmount) {
    return {
      tone: 'neutral',
      title: 'Budget',
      summary: 'Enter an amount to check remaining budget.',
      shortfalls: [],
      isWithinBudget: true,
      detail: null,
    };
  }
  if (!String(budgetCategory || '').trim()) {
    return {
      tone: 'neutral',
      title: 'Budget',
      summary: 'Select a budget category to check limits.',
      shortfalls: [],
      isWithinBudget: true,
      detail: null,
    };
  }

  const shortfalls = splitCoverage.filter((line) => line.shortfallSar > EPS);
  const isWithinBudget = shortfalls.length === 0;

  if (useSplitExpense) {
    if (!isWithinBudget) {
      return {
        tone: 'red',
        title: 'Over budget on some splits',
        summary: 'Some split lines exceed remaining budget. You can still save; totals will show as over budget.',
        shortfalls,
        isWithinBudget: false,
        detail: null,
      };
    }
    const tones = splitCoverage
      .filter((line) => String(line.category || '').trim() !== '' && (Number(line.amountSar) || 0) > 0)
      .map((line) =>
        computeBudgetCoverageTone({
          limitSar: Number(line.limitSar) || 0,
          remainingSar: line.remainingSar,
          amountSar: line.amountSar,
        }),
      );
    const tone = worstBudgetCoverageTone(tones);
    return {
      tone,
      title: tone === 'yellow' ? 'Near budget limit' : 'Within budget',
      summary: 'Split allocation fits the selected budget limits.',
      shortfalls: [],
      isWithinBudget: true,
      detail: null,
    };
  }

  const tone = budgetCoverageSummary
    ? computeBudgetCoverageTone({
        limitSar: budgetCoverageSummary.limitSar,
        remainingSar: budgetCoverageSummary.remainingSar,
        amountSar: inputAmountSar,
      })
    : 'neutral';

  const limitSar = budgetCoverageSummary?.limitSar ?? 0;
  const remainingSar = budgetCoverageSummary?.remainingSar ?? 0;
  const spentSar =
    budgetCoverageSummary?.spentSar != null
      ? budgetCoverageSummary.spentSar
      : Math.max(0, limitSar - remainingSar);
  const afterSar = remainingSar - inputAmountSar;
  const detail = {
    category: String(budgetCategory || '').trim(),
    limitSar,
    spentSar,
    remainingSar,
    afterSar,
  };

  if (!isWithinBudget) {
    return {
      tone: 'red',
      title: 'Over remaining budget',
      summary: 'This amount exceeds what is left in the budget. You can still save; it will show as over budget.',
      shortfalls,
      isWithinBudget: false,
      detail,
    };
  }

  if (tone === 'yellow') {
    return {
      tone: 'yellow',
      title: afterSar <= EPS ? 'Uses remaining budget' : 'Near monthly limit',
      summary:
        afterSar <= EPS
          ? 'This transaction uses the rest of the available budget for this category.'
          : 'After this transaction you will be at or above 90% of the monthly limit.',
      shortfalls: [],
      isWithinBudget: true,
      detail,
    };
  }

  if (tone === 'neutral') {
    return {
      tone: 'neutral',
      title: 'Budget',
      summary: limitSar > EPS ? 'Budget check ready.' : 'No monthly limit set for this category.',
      shortfalls: [],
      isWithinBudget: true,
      detail,
    };
  }

  return {
    tone: 'green',
    title: 'Within budget',
    summary: 'This amount fits the remaining budget for the selected category.',
    shortfalls: [],
    isWithinBudget: true,
    detail,
  };
}

/** Saving is never blocked solely because a budget is fully utilized or over limit. */
export const BUDGET_OVER_UTILIZATION_BLOCKS_SUBMIT = false;

export type TransactionBudgetCoverageState = ReturnType<typeof evaluateTransactionBudgetCoverageState>;

/**
 * Returns a user-facing block reason when budget headroom rules forbid submit.
 * With {@link BUDGET_OVER_UTILIZATION_BLOCKS_SUBMIT} false (default), always returns null.
 */
export function getTransactionBudgetSubmitBlockReason(
  state: Pick<TransactionBudgetCoverageState, 'isWithinBudget' | 'shortfalls'>,
  formatSar: (amount: number) => string = (n) => String(Math.round(n)),
): string | null {
  if (!BUDGET_OVER_UTILIZATION_BLOCKS_SUBMIT || state.isWithinBudget) return null;
  if (state.shortfalls.length === 1) {
    const line = state.shortfalls[0];
    return `Selected budget cannot cover this amount. Shortfall: ${formatSar(line.shortfallSar)}.`;
  }
  const totalShortfall = state.shortfalls.reduce((sum, line) => sum + (Number(line.shortfallSar) || 0), 0);
  return `Split allocation exceeds remaining budget limits by ${formatSar(totalShortfall)}.`;
}

/**
 * Optional confirm-dialog warning when an expense exceeds remaining budget headroom.
 */
export function buildTransactionBudgetConfirmWarning(
  state: Pick<TransactionBudgetCoverageState, 'isWithinBudget' | 'tone' | 'summary' | 'shortfalls'>,
  formatSar: (amount: number) => string = (n) => String(Math.round(n)),
): string | null {
  if (state.isWithinBudget || state.tone === 'neutral') return null;
  if (state.shortfalls.length > 0) {
    const lines = state.shortfalls.map(
      (line) => `${line.category}: over by ${formatSar(line.shortfallSar)}`,
    );
    return `${state.summary} (${lines.join('; ')})`;
  }
  return state.summary;
}
