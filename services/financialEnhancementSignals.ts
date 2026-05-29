import type { FinancialData } from '../types';
import { detectGoalConflictsFromData } from './goalConflictDetection';
import { detectBudgetDrift } from './budgetDrift';

/** Shared enhancement scan — compute once per data/FX change (not per quote tick). */
export function buildEnhancementSignals(data: FinancialData, sarPerUsd: number) {
  return {
    goalConflicts: detectGoalConflictsFromData(data, sarPerUsd),
    budgetDrift: detectBudgetDrift(data, sarPerUsd),
  };
}
