/**
 * Monte Carlo / probabilistic planning layer (logic layer).
 *
 * This provides simplified probability estimations. It uses random
 * lognormal-ish return approximations driven by mean+volatility inputs.
 *
 * For accuracy, replace with historical distributions later.
 */

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = clamp(Math.floor((p / 100) * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
}

export function simulateGoalCompletionProbability(args: {
  /** Starting net worth/corpus available to fund the goal. */
  startingValue: number;
  /** Monthly contribution toward the goal. */
  monthlyContribution: number;
  /** Required goal amount. */
  goalAmount: number;
  /** Years until deadline. */
  years: number;
  /** Expected annual return in percent. */
  expectedAnnualReturnPct: number;
  /** Annual volatility (std dev) in percent. */
  annualVolatilityPct: number;
  simulations?: number;
  seed?: number; // optional deterministic seed for repeatability
}): { probability: number; stats: { p10: number; p50: number; p90: number } } {
  const sims = args.simulations ?? 2000;
  const months = Math.max(1, Math.floor(args.years * 12));
  const meanMonthly = (Number(args.expectedAnnualReturnPct) || 0) / 100 / 12;
  const volMonthly = (Number(args.annualVolatilityPct) || 0) / 100 / Math.sqrt(12);

  // Deterministic RNG when seed provided.
  let state = Number.isFinite(args.seed as number) ? (args.seed as number) : Math.floor(Math.random() * 1e9);
  const rand = () => {
    // LCG
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };

  // Normal approx using Box-Muller.
  const randNormal = () => {
    const u1 = Math.max(1e-12, rand());
    const u2 = Math.max(1e-12, rand());
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const outcomes: number[] = [];
  for (let s = 0; s < sims; s++) {
    let value = Math.max(0, args.startingValue);
    for (let m = 0; m < months; m++) {
      const z = randNormal();
      const monthlyReturn = meanMonthly + volMonthly * z;
      value = value * (1 + monthlyReturn) + Math.max(0, args.monthlyContribution);
    }
    outcomes.push(value);
  }
  const goal = Math.max(0, args.goalAmount);
  const success = outcomes.filter((v) => v >= goal).length;
  const probability = sims > 0 ? (success / sims) * 100 : 0;
  const sorted = outcomes.slice().sort((a, b) => a - b);
  return {
    probability,
    stats: {
      p10: percentile(sorted, 10),
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
    },
  };
}

export function simulatePortfolioRange(args: {
  startingValue: number;
  monthlyContribution?: number;
  years: number;
  expectedAnnualReturnPct: number;
  annualVolatilityPct: number;
  simulations?: number;
  seed?: number;
}): { p10: number; p25: number; p50: number; p75: number; p90: number } {
  const sims = args.simulations ?? 2000;
  const months = Math.max(1, Math.floor(args.years * 12));
  const meanMonthly = (Number(args.expectedAnnualReturnPct) || 0) / 100 / 12;
  const volMonthly = (Number(args.annualVolatilityPct) || 0) / 100 / Math.sqrt(12);
  const monthlyContribution = Math.max(0, Number(args.monthlyContribution) || 0);

  let state = Number.isFinite(args.seed as number) ? (args.seed as number) : Math.floor(Math.random() * 1e9);
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const randNormal = () => {
    const u1 = Math.max(1e-12, rand());
    const u2 = Math.max(1e-12, rand());
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const outcomes: number[] = [];
  for (let s = 0; s < sims; s++) {
    let value = Math.max(0, args.startingValue);
    for (let m = 0; m < months; m++) {
      const monthlyReturn = meanMonthly + volMonthly * randNormal();
      value = value * (1 + monthlyReturn) + monthlyContribution;
    }
    outcomes.push(value);
  }
  const sorted = outcomes.slice().sort((a, b) => a - b);
  return {
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
  };
}

export function simulateCashShortfallRisk(args: {
  startingCash: number;
  /** Monthly net cash flow (income - expenses), positive or negative. */
  monthlyNetCashflow: number;
  years: number;
  expectedAnnualReturnPct?: number;
  annualVolatilityPct?: number;
  simulations?: number;
  seed?: number;
  /** Shortfall threshold. 0 means cash < 0 is a shortfall. */
  shortfallBelow?: number;
}): { shortfallProbability: number; stats: { p10: number; p50: number; p90: number } } {
  const sims = args.simulations ?? 2000;
  const months = Math.max(1, Math.floor(args.years * 12));
  const shortfallBelow = Number.isFinite(args.shortfallBelow) ? args.shortfallBelow! : 0;

  // Optional: model cash as deterministic netflow + optional return noise.
  const expReturn = (Number(args.expectedAnnualReturnPct) || 0) / 100 / 12;
  const vol = (Number(args.annualVolatilityPct) || 0) / 100 / Math.sqrt(12);

  let state = Number.isFinite(args.seed as number) ? (args.seed as number) : Math.floor(Math.random() * 1e9);
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const randNormal = () => {
    const u1 = Math.max(1e-12, rand());
    const u2 = Math.max(1e-12, rand());
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const endings: number[] = [];
  let shortfalls = 0;
  for (let s = 0; s < sims; s++) {
    let cash = Math.max(0, Number(args.startingCash) || 0);
    for (let m = 0; m < months; m++) {
      const noise = vol > 0 ? vol * randNormal() : 0;
      cash = cash * (1 + expReturn + noise) + Number(args.monthlyNetCashflow) || 0;
      cash = cash; // keep value
      if (cash < shortfallBelow) shortfalls++;
    }
    endings.push(cash);
  }
  const shortfallProbability = sims > 0 ? (shortfalls / (sims * months)) * 100 : 0;
  const sorted = endings.slice().sort((a, b) => a - b);
  return {
    shortfallProbability,
    stats: {
      p10: percentile(sorted, 10),
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
    },
  };
}

