/**
 * Sensitivity analysis engine (logic layer).
 *
 * Generic utilities to measure how a result changes when a variable moves.
 * You pass a model function that computes the output based on inputs.
 */

export type SensitivityModel<Input extends Record<string, unknown>, Output extends number> = (input: Input) => Output;

export function sensitivityToReturn(args: {
  baseExpectedAnnualReturnPct: number;
  deltaPct: number;
  model: (expectedAnnualReturnPct: number) => number;
}): { baseline: number; up: number; down: number; deltaUp: number; deltaDown: number } {
  const base = args.model(args.baseExpectedAnnualReturnPct);
  const upVal = args.model(args.baseExpectedAnnualReturnPct + Math.max(0, args.deltaPct));
  const downVal = args.model(args.baseExpectedAnnualReturnPct - Math.max(0, args.deltaPct));
  return {
    baseline: base,
    up: upVal,
    down: downVal,
    deltaUp: upVal - base,
    deltaDown: downVal - base,
  };
}

export function sensitivityToIncome(args: {
  baseMonthlyIncome: number;
  deltaAmount: number;
  model: (monthlyIncome: number) => number;
}): { baseline: number; up: number; down: number; deltaUp: number; deltaDown: number } {
  const base = args.model(args.baseMonthlyIncome);
  const upVal = args.model(args.baseMonthlyIncome + Math.max(0, args.deltaAmount));
  const downVal = args.model(args.baseMonthlyIncome - Math.max(0, args.deltaAmount));
  return { baseline: base, up: upVal, down: downVal, deltaUp: upVal - base, deltaDown: downVal - base };
}

export function sensitivityToInflation(args: {
  baseInflationRatePct: number;
  deltaPct: number;
  model: (inflationRatePct: number) => number;
}): { baseline: number; up: number; down: number; deltaUp: number; deltaDown: number } {
  const base = args.model(args.baseInflationRatePct);
  const upVal = args.model(args.baseInflationRatePct + Math.max(0, args.deltaPct));
  const downVal = args.model(args.baseInflationRatePct - Math.max(0, args.deltaPct));
  return { baseline: base, up: upVal, down: downVal, deltaUp: upVal - base, deltaDown: downVal - base };
}

export function sensitivityToExpenseGrowth(args: {
  baseExpenseGrowthPct: number;
  deltaPct: number;
  model: (expenseGrowthPct: number) => number;
}): { baseline: number; up: number; down: number; deltaUp: number; deltaDown: number } {
  const base = args.model(args.baseExpenseGrowthPct);
  const upVal = args.model(args.baseExpenseGrowthPct + Math.max(0, args.deltaPct));
  const downVal = args.model(args.baseExpenseGrowthPct - Math.max(0, args.deltaPct));
  return { baseline: base, up: upVal, down: downVal, deltaUp: upVal - base, deltaDown: downVal - base };
}

