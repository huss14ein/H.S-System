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
  if (!(amountSar > 0)) return 'neutral';
  if (!(limitSar > 0)) return 'red';
  const projectedRemaining = remainingSar - amountSar;
  if (projectedRemaining <= 0) return 'red';
  const consumedPctAfter = (limitSar - projectedRemaining) / limitSar;
  if (Number.isFinite(consumedPctAfter) && consumedPctAfter >= 0.9) return 'yellow';
  return 'green';
}

export function evaluateTransactionBudgetCoverageState(args: {
  transactionType: 'income' | 'expense';
  hasAmount: boolean;
  budgetCategory: string;
  useSplitExpense: boolean;
  splitCoverage: BudgetCoverageLineInput[];
  budgetCoverageSummary: { limitSar: number; remainingSar: number } | null;
  inputAmountSar: number;
}): {
  tone: BudgetCoverageTone;
  summary: string;
  shortfalls: BudgetCoverageLineInput[];
  isWithinBudget: boolean;
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
      summary: 'Income transactions do not consume budget limits.',
      shortfalls: [],
      isWithinBudget: true,
    };
  }
  if (!hasAmount) {
    return {
      tone: 'neutral',
      summary: 'Enter amount to check budget headroom.',
      shortfalls: [],
      isWithinBudget: true,
    };
  }
  if (!String(budgetCategory || '').trim()) {
    return {
      tone: 'neutral',
      summary: 'Select a budget category to check limits.',
      shortfalls: [],
      isWithinBudget: true,
    };
  }

  const shortfalls = splitCoverage.filter((line) => line.shortfallSar > 0.0001);
  const isWithinBudget = shortfalls.length === 0;

  if (useSplitExpense) {
    if (!isWithinBudget) {
      return {
        tone: 'red',
        summary:
          'Some split lines exceed remaining budget. You can still save; totals will show as over budget.',
        shortfalls,
        isWithinBudget: false,
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
      summary: 'Split allocation is within selected budget limits.',
      shortfalls: [],
      isWithinBudget: true,
    };
  }

  const tone = budgetCoverageSummary
    ? computeBudgetCoverageTone({
        limitSar: budgetCoverageSummary.limitSar,
        remainingSar: budgetCoverageSummary.remainingSar,
        amountSar: inputAmountSar,
      })
    : 'neutral';

  return {
    tone,
    summary: isWithinBudget
      ? 'Selected budget can cover this transaction.'
      : 'This transaction exceeds remaining budget. You can still save; it will count as over budget.',
    shortfalls,
    isWithinBudget,
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
