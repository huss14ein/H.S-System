import type { Page } from '../types';
import type { BuyScoreBreakdown } from './decisionEngine';

export type DecisionVerdictSeverity = 'positive' | 'caution' | 'urgent';

export type DecisionPreviewAction = {
  label: string;
  page: Page;
  /** Optional action id for `triggerPageAction` */
  action?: string;
};

export type DecisionPreviewVerdict = {
  severity: DecisionVerdictSeverity;
  headline: string;
  /** 2–4 user-facing lines */
  bullets: string[];
  nextActions: DecisionPreviewAction[];
};

/**
 * Rule-based “what to do” copy for the Settings decision cockpit. Deterministic; no network.
 */
export function computeDecisionPreviewVerdict(input: {
  buy: BuyScoreBreakdown;
  /** Measured max |sleeve drift| % or null if not computable */
  sleeveDriftPct: number | null;
  driftAlertThresholdPct: number;
  minRunwayMonthsToAllowBuys: number;
}): DecisionPreviewVerdict {
  const { buy, sleeveDriftPct, driftAlertThresholdPct, minRunwayMonthsToAllowBuys } = input;
  const run = buy.runwayMonths;
  const atCap = buy.currentPositionPct >= buy.maxPositionPct;
  const driftHot =
    sleeveDriftPct != null && sleeveDriftPct > driftAlertThresholdPct + 0.01;
  const runwayOk = run >= minRunwayMonthsToAllowBuys;
  const fragile = run < 1 || buy.emergencyFundMonths < 1;

  const nextActions: DecisionPreviewAction[] = [
    { label: 'Wealth Ultra (sleeves)', page: 'Wealth Ultra' },
    { label: 'Investment Plan', page: 'Investment Plan', action: 'investment-tab:Investment Plan' },
    { label: 'Investments holdings', page: 'Investments' },
    { label: 'Trading policy', page: 'Settings' },
  ];

  if (fragile) {
    return {
      severity: 'urgent',
      headline: 'Liquidity is fragile — pause discretionary investing until runway stabilizes.',
      bullets: [
        `Runway ~${run.toFixed(1)} mo and emergency buffer ~${buy.emergencyFundMonths.toFixed(1)} mo are below a safe band.`,
        'Fund the emergency reserve and trim non-essential outflows before adding risk.',
      ],
      nextActions: [
        { label: 'Accounts & cash', page: 'Accounts' },
        { label: 'Budgets', page: 'Budgets' },
        ...nextActions.slice(0, 2),
      ],
    };
  }

  if (driftHot) {
    return {
      severity: 'urgent',
      headline: 'Sleeves are off target — rebalance before scaling new buys.',
      bullets: [
        `Measured sleeve drift ${sleeveDriftPct!.toFixed(1)}% exceeds your ${driftAlertThresholdPct}% alert.`,
        'Alignment with Wealth Ultra targets reduces accidental concentration and wrong-risk bets.',
      ],
      nextActions: [
        { label: 'Open Wealth Ultra', page: 'Wealth Ultra' },
        { label: 'AI Rebalancer', page: 'AI Rebalancer' },
        { label: 'Investments', page: 'Investments' },
      ],
    };
  }

  if (atCap) {
    return {
      severity: 'caution',
      headline: 'Largest holding is at your policy weight cap.',
      bullets: [
        `${buy.currentPositionPct}% of portfolio is in one line vs max ${buy.maxPositionPct}% — new buys in the same name won’t improve diversification.`,
        'Consider new tickets elsewhere or trim on strength before adding size.',
      ],
      nextActions: [
        { label: 'Holdings', page: 'Investments' },
        { label: 'Watchlist', page: 'Watchlist' },
        ...nextActions.slice(0, 2),
      ],
    };
  }

  if (!runwayOk) {
    return {
      severity: 'caution',
      headline: `Runway below your trading policy minimum (${minRunwayMonthsToAllowBuys} mo).`,
      bullets: [
        `You show ~${run.toFixed(1)} mo runway — buys may be blocked or warned in Investments until this clears.`,
        'Raise cash runway or loosen policy only if that matches your risk tolerance.',
      ],
      nextActions: [
        { label: 'Trading policy', page: 'Settings' },
        { label: 'Engines & Tools', page: 'Engines & Tools', action: 'openRiskTradingHub' },
        { label: 'Accounts', page: 'Accounts' },
      ],
    };
  }

  if (buy.total >= 68) {
    return {
      severity: 'positive',
      headline: 'Gates look open under your rules — deploy via Investment Plan when ready.',
      bullets: [
        `Buy score ${buy.total}: liquidity OK, concentration below cap, drift within tolerance.`,
        'The lump-sum split below is a prioritization model only — it does not move money automatically.',
      ],
      nextActions,
    };
  }

  return {
    severity: 'caution',
    headline: 'Mixed signals — review sleeves and policy before sizing new trades.',
    bullets: [
      `Buy score ${buy.total}/100 — one or more factors (runway, drift, concentration) warrant a quick check.`,
      'Use Wealth Ultra for sleeve alignment and Trading policy for buy gates.',
    ],
    nextActions,
  };
}
