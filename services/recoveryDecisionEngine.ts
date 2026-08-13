/**
 * Investor decision layer for Recovery Plan.
 * Turns ladders + recycling + conviction into one ranked action per losing position:
 * add cash, recycle without new cash, wait, do not average, or review an exit.
 */

import type { RecoveryPlanResult, RecoveryPositionConfig, TradeCurrency } from '../types';
import type { RecyclingPlanSummary } from './positionRecyclingIntegration';
import type { ResolvedRecoveryConviction } from './recoveryConvictionSync';
import type { RecoveryPathMode } from './recoveryPathMode';
import { toSAR } from '../utils/currencyMath';

export type RecoveryInvestorAction =
  | 'add_ladder'
  | 'recycle'
  | 'wait'
  | 'do_not_add'
  | 'review_exit';

export type RecoveryDecisionConfidence = 'high' | 'medium' | 'low';

export type RecoveryInvestorMetrics = {
  /** New average cost after all planned ladder fills — the new break-even. */
  breakEvenAfter: number;
  /** Percent the average cost falls if the ladder fills. */
  avgImprovementPct: number;
  /** Rally needed from today to the new break-even. */
  reboundToNewBreakevenPct: number;
  /** Rally needed from today to the old average (no add). */
  reboundToOldBreakevenPct: number;
  /** How many percentage points the required bounce shrinks if the ladder fills. */
  reboundReductionPct: number;
  cashToDeploy: number;
  extraLossIfDown10: number;
  firstBuyPrice: number | null;
  firstBuyDiscountPct: number | null;
  firstBuyCash: number | null;
  sharesToAdd: number;
  budgetDeferred: boolean;
};

export type RecoveryInvestorDecision = {
  holdingId: string;
  symbol: string;
  action: RecoveryInvestorAction;
  label: string;
  priority: number;
  why: string;
  nextStep: string;
  riskNote: string;
  confidence: RecoveryDecisionConfidence;
  suggestedPath: RecoveryPathMode;
  /** True when a sell/rebuy ladder is available (used if cash is assigned elsewhere). */
  canRecycle: boolean;
  metrics: RecoveryInvestorMetrics;
};

const ACTION_LABEL: Record<RecoveryInvestorAction, string> = {
  add_ladder: 'Add on weakness',
  recycle: 'Recycle — no new cash',
  wait: 'Wait',
  do_not_add: 'Do not average down',
  review_exit: 'Review an exit',
};

function finite(n: number | null | undefined, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function reboundPct(fromPrice: number, toPrice: number): number {
  if (!(fromPrice > 0) || !Number.isFinite(toPrice)) return 0;
  return ((toPrice - fromPrice) / fromPrice) * 100;
}

function gradeRank(g: string | undefined): number {
  return g === 'A' ? 4 : g === 'B' ? 3 : g === 'C' ? 2 : g === 'D' ? 1 : 2;
}

export function computeRecoveryInvestorMetrics(plan: RecoveryPlanResult): RecoveryInvestorMetrics {
  const ladder = (plan.ladder ?? []).filter((l) => finite(l.qty) > 0 && finite(l.price) > 0);
  const first = ladder[0] ?? null;
  const avg = finite(plan.avgCost);
  const newAvg = finite(plan.newAvgCost) || avg;
  const px = finite(plan.currentPrice);
  const sharesAdded = ladder.reduce((s, l) => s + finite(l.qty), 0);
  const cash = finite(plan.totalPlannedCost);
  const reboundNew = reboundPct(px, newAvg);
  const reboundOld = reboundPct(px, avg);
  return {
    breakEvenAfter: newAvg,
    avgImprovementPct: avg > 0 ? ((avg - newAvg) / avg) * 100 : 0,
    reboundToNewBreakevenPct: reboundNew,
    reboundToOldBreakevenPct: reboundOld,
    reboundReductionPct: reboundOld - reboundNew,
    cashToDeploy: cash,
    extraLossIfDown10: cash * 0.1,
    firstBuyPrice: first ? finite(first.price) : null,
    firstBuyDiscountPct: first && px > 0 ? ((px - finite(first.price)) / px) * 100 : null,
    firstBuyCash: first ? finite(first.cost) || finite(first.qty) * finite(first.price) : null,
    sharesToAdd: sharesAdded,
    budgetDeferred: false,
  };
}

export function decideRecoveryAction(args: {
  holdingId: string;
  symbol: string;
  plan: RecoveryPlanResult;
  positionConfig: RecoveryPositionConfig;
  recyclingSummary: RecyclingPlanSummary | null | undefined;
  conviction?: Pick<ResolvedRecoveryConviction, 'convictionGrade' | 'stockQualityStatus'> | null;
  quoteStale?: boolean;
  /** This holding as % of its portfolio market value (0–100). */
  portfolioWeightPct?: number;
}): RecoveryInvestorDecision {
  const { holdingId, symbol, plan, positionConfig, recyclingSummary, conviction, quoteStale } = args;
  const metrics = computeRecoveryInvestorMetrics(plan);
  const plPct = finite(plan.plPct);
  const trigger = finite(positionConfig.lossTriggerPct);
  const sleeve = positionConfig.sleeveType;
  const grade = conviction?.convictionGrade ?? 'C';
  const quality = conviction?.stockQualityStatus ?? 'Medium';
  const recyclingReady = recyclingSummary?.planAvailable === true;
  const exitReview = recyclingSummary?.planStatus === 'exit_review';
  const canRecycle = recyclingReady && !exitReview && quality !== 'Broken';
  const ladderReady = plan.qualified === true && metrics.cashToDeploy > 0;
  const deepLoss = plPct <= -25;
  const concentrated = finite(args.portfolioWeightPct) >= 30;
  const stale = quoteStale === true;

  let action: RecoveryInvestorAction = 'wait';
  let why = '';
  let nextStep = '';
  let riskNote = 'New cash is at risk until price reclaims the new average. Size to the first rung, not the full ladder.';
  let confidence: RecoveryDecisionConfidence = stale ? 'low' : 'medium';
  let suggestedPath: RecoveryPathMode = canRecycle ? 'recycling' : 'recovery_ladder';

  if (exitReview || quality === 'Broken') {
    action = 'review_exit';
    suggestedPath = 'recycling';
    why =
      quality === 'Broken'
        ? 'Quality is flagged broken — averaging down would add risk to a weak thesis.'
        : 'Recycling flags an exit review. Adding cash here is the wrong first move.';
    nextStep = 'Open the plan and review a trim or recycle — do not deploy new cash until the thesis is intact.';
    riskNote = 'Averaging a broken thesis is how a small loss becomes a concentrated bet.';
    confidence = stale ? 'low' : 'high';
  } else if (sleeve === 'Spec' || positionConfig.recoveryEnabled === false) {
    action = 'do_not_add';
    suggestedPath = canRecycle ? 'recycling' : 'recovery_ladder';
    why = 'Speculative names are frozen for recovery buys so a falling knife cannot consume deployable cash.';
    nextStep = canRecycle
      ? 'If you still want activity, use recycling (sale proceeds only).'
      : 'Hold or trim from Record Trade — do not add.';
    riskNote = 'Spec names have no recovery cash claim. Preserve dry powder for Core/Upside.';
    confidence = 'high';
  } else if (grade === 'D' && !canRecycle) {
    action = 'do_not_add';
    why = 'Conviction is D. New cash would double down without a thesis.';
    nextStep = 'Raise conviction (universe / watchlist / thesis) or sell — do not average.';
    riskNote = 'Low-conviction averages rarely recover; they usually enlarge the hole.';
    confidence = stale ? 'low' : 'high';
  } else if (stale && !canRecycle) {
    action = 'wait';
    why = 'The quote is stale. Limit prices from an old mark can buy at the wrong level.';
    nextStep = 'Refresh live prices on Portfolios, then reopen this row.';
    riskNote = 'Stale marks make discount % and rebound math unreliable.';
    confidence = 'low';
  } else if (ladderReady && (sleeve === 'Core' || sleeve === 'Upside') && gradeRank(grade) >= 3 && !concentrated) {
    action = 'add_ladder';
    suggestedPath = 'recovery_ladder';
    why = `Loss is ${plPct.toFixed(1)}% vs a ${trigger.toFixed(0)}% trigger. A filled ladder would lower average cost by ${metrics.avgImprovementPct.toFixed(1)}% so you need a ${metrics.reboundToNewBreakevenPct.toFixed(0)}% bounce instead of ${metrics.reboundToOldBreakevenPct.toFixed(0)}%.`;
    nextStep = `Place the first limit near ${metrics.firstBuyPrice != null ? metrics.firstBuyPrice.toFixed(2) : 'the first step'}, then push drafts to Investment Plan.`;
    riskNote = `If the name drops another 10% after you add, extra paper loss on new cash is about ${metrics.extraLossIfDown10.toFixed(0)}. Size the first buy only.`;
    confidence = stale ? 'low' : sleeve === 'Core' && grade === 'A' ? 'high' : 'medium';
  } else if (ladderReady && deepLoss && canRecycle) {
    action = 'recycle';
    suggestedPath = 'recycling';
    why = 'The hole is deep. Recycling uses sale cash only so you repair average cost without spending more of the book.';
    nextStep = 'Open recycling, generate sell/rebuy drafts, and keep core shares untouched.';
    riskNote = 'Selling a rebound realises tax/Zakat events and may cut a runner. Size the sale to this name’s first rebuy.';
    confidence = stale ? 'low' : 'medium';
  } else if (canRecycle) {
    action = 'recycle';
    suggestedPath = 'recycling';
    why = ladderReady
      ? 'Both paths are open. Recycling is the cash-preserving default until conviction is A/B on a Core/Upside name.'
      : 'Buy ladder is not ready. Recycling can still work without a deposit.';
    nextStep = 'Generate recycling drafts and push them to Investment Plan.';
    riskNote = 'Recycling is not free: you give up some winner upside to repair this average.';
    confidence = stale ? 'low' : 'medium';
  } else if (ladderReady) {
    if (concentrated) {
      why = 'This name is already a large slice of the portfolio. Adding more cash would raise concentration risk.';
      nextStep = 'Wait or trim — do not increase this weight.';
      action = 'do_not_add';
      suggestedPath = 'recovery_ladder';
      riskNote = 'Position size already dominates the book. More cash here is a bet on the whole portfolio.';
    } else {
      action = 'add_ladder';
      suggestedPath = 'recovery_ladder';
      why = `Ladder is eligible. Planned spend ${metrics.cashToDeploy.toFixed(0)} would add ${metrics.sharesToAdd.toFixed(2)} shares and cut the bounce-to-breakeven by ${metrics.reboundReductionPct.toFixed(0)} percentage points.`;
      nextStep = 'Review the ladder steps, then push limit buys to Investment Plan.';
      riskNote = `New cash at risk if price falls another 10%: about ${metrics.extraLossIfDown10.toFixed(0)}.`;
    }
    confidence = stale ? 'low' : 'medium';
  } else if (plPct > -trigger) {
    action = 'wait';
    why = `Loss is ${plPct.toFixed(1)}% — shallower than the ${trigger.toFixed(0)}% trigger. Averaging now pays up for a dip that may not be done.`;
    nextStep = 'Watch this name. The ladder unlocks if the loss reaches the trigger.';
    riskNote = 'Buying before the trigger spends cash that may be needed at a better price.';
    confidence = stale ? 'low' : 'medium';
  } else {
    action = 'wait';
    why = plan.reason || 'Guardrails blocked the ladder (cash, caps, or freeze).';
    nextStep = canRecycle
      ? 'Use recycling, or free deployable cash and reopen.'
      : 'Free deployable cash or relax this ticker’s cap, then reopen.';
    riskNote = 'A blocked ladder is a cash or freeze issue — not a signal to market-buy.';
    confidence = 'medium';
  }

  let priority = 20;
  if (action === 'review_exit') priority = 92 + Math.min(8, Math.abs(plPct) / 8);
  else if (action === 'add_ladder') {
    priority =
      68 +
      Math.min(12, metrics.avgImprovementPct) +
      (sleeve === 'Core' ? 8 : 3) +
      (grade === 'A' ? 8 : grade === 'B' ? 4 : 0) +
      Math.min(8, Math.abs(plPct) / 5);
  } else if (action === 'recycle') priority = 54 + Math.min(16, Math.abs(plPct) / 3);
  else if (action === 'do_not_add') priority = 42 + Math.min(10, Math.abs(plPct) / 6);
  else priority = 22 + Math.min(12, Math.max(0, trigger + plPct));

  if (stale) priority = Math.max(10, priority - 12);

  return {
    holdingId,
    symbol: String(symbol ?? '').trim().toUpperCase(),
    action,
    label: ACTION_LABEL[action],
    priority: Math.round(Math.max(0, Math.min(100, priority))),
    why,
    nextStep,
    riskNote,
    confidence,
    suggestedPath,
    canRecycle,
    metrics,
  };
}

export function allocateRecoveryBudget(args: {
  decisions: RecoveryInvestorDecision[];
  recoveryBudgetSar: number;
  cashToSar: (holdingId: string, cashInBook: number) => number;
}): RecoveryInvestorDecision[] {
  const budget = Math.max(0, finite(args.recoveryBudgetSar));
  const sorted = [...args.decisions].sort((a, b) => b.priority - a.priority);
  let remaining = budget;
  const out: RecoveryInvestorDecision[] = [];
  for (const d of sorted) {
    if (d.action !== 'add_ladder' || d.metrics.cashToDeploy <= 0) {
      out.push(d);
      continue;
    }
    const needSar = Math.max(0, args.cashToSar(d.holdingId, d.metrics.cashToDeploy));
    if (needSar <= remaining + 1e-6) {
      remaining = Math.max(0, remaining - needSar);
      out.push({ ...d, metrics: { ...d.metrics, budgetDeferred: false } });
      continue;
    }
    const deferredAction: RecoveryInvestorAction = d.canRecycle ? 'recycle' : 'wait';
    out.push({
      ...d,
      action: deferredAction,
      label: d.canRecycle ? ACTION_LABEL.recycle : 'Wait — cash assigned elsewhere',
      suggestedPath: d.canRecycle ? 'recycling' : d.suggestedPath,
      why: `${d.why} Recovery cash is already assigned to higher-priority names.`,
      nextStep: d.canRecycle
        ? 'Recycle this name (no new cash) or wait until higher-priority ladders fill or are cancelled.'
        : 'Wait until higher-priority ladders fill, are cancelled, or more cash is deployable.',
      riskNote: d.canRecycle
        ? d.riskNote
        : 'Firing every ladder at once would overspend the recovery budget. One name at a time.',
      metrics: { ...d.metrics, budgetDeferred: true },
      priority: Math.max(30, d.priority - 15),
    });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

export function rankRecoveryDecisions(
  rows: Array<Parameters<typeof decideRecoveryAction>[0] & { bookCurrency?: TradeCurrency }>,
  opts: { recoveryBudgetSar: number; sarPerUsd: number },
): RecoveryInvestorDecision[] {
  const decided = rows.map((row) => decideRecoveryAction(row));
  const byId = new Map(rows.map((r) => [r.holdingId, r]));
  const rate = Number(opts.sarPerUsd) > 0 ? Number(opts.sarPerUsd) : 3.75;
  return allocateRecoveryBudget({
    decisions: decided,
    recoveryBudgetSar: opts.recoveryBudgetSar,
    cashToSar: (holdingId, cash) => {
      const row = byId.get(holdingId);
      const cur = row?.bookCurrency === 'SAR' ? 'SAR' : 'USD';
      return toSAR(cash, cur, rate);
    },
  });
}

export function sumAllocatedLadderSpendSar(
  decisions: RecoveryInvestorDecision[],
  cashToSar: (holdingId: string, cashInBook: number) => number,
): number {
  return decisions
    .filter((d) => d.action === 'add_ladder' && !d.metrics.budgetDeferred)
    .reduce((sum, d) => sum + Math.max(0, cashToSar(d.holdingId, d.metrics.cashToDeploy)), 0);
}

export function decisionTone(
  action: RecoveryInvestorAction,
): { chip: string; text: string } {
  switch (action) {
    case 'add_ladder':
      return { chip: 'bg-violet-50 text-violet-900 border-violet-200', text: 'text-violet-900' };
    case 'recycle':
      return { chip: 'bg-teal-50 text-teal-900 border-teal-200', text: 'text-teal-900' };
    case 'review_exit':
      return { chip: 'bg-amber-50 text-amber-950 border-amber-300', text: 'text-amber-950' };
    case 'do_not_add':
      return { chip: 'bg-rose-50 text-rose-900 border-rose-200', text: 'text-rose-900' };
    default:
      return { chip: 'bg-slate-50 text-slate-700 border-slate-200', text: 'text-slate-800' };
  }
}
