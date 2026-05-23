/**
 * Plain-language summaries for recovery paths (non-financial readers).
 */

import type { RecoveryPlanResult } from '../types';
import type { RecyclingPlanSummary } from './positionRecyclingIntegration';
import type { PositionRecyclingPlan } from './positionRecyclingPlan';
import type { ResolvedRecoveryConviction } from './recoveryConvictionSync';

export type PathReadiness = 'ready' | 'blocked' | 'unavailable';

export interface RecoveryPathBrief {
  mode: 'recycling' | 'recovery_ladder';
  readiness: PathReadiness;
  headline: string;
  oneLiner: string;
  /** Traffic-light style for UI */
  indicator: 'green' | 'amber' | 'slate';
  bullets: string[];
  caution?: string;
}

function formatPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function buildRecyclingPathBrief(args: {
  plPct: number;
  recycling: PositionRecyclingPlan | null;
  summary: RecyclingPlanSummary | null;
  conviction: ResolvedRecoveryConviction;
}): RecoveryPathBrief {
  const { plPct, recycling, summary, conviction } = args;

  if (plPct >= 0) {
    return {
      mode: 'recycling',
      readiness: 'unavailable',
      headline: 'Not in loss',
      oneLiner: 'Recycling is only used when the position is underwater.',
      indicator: 'slate',
      bullets: ['Wait for a dip or use the buy ladder if you want to add on weakness.'],
    };
  }

  if (!recycling) {
    return {
      mode: 'recycling',
      readiness: 'unavailable',
      headline: 'No price data',
      oneLiner: 'Refresh live quotes, then reopen this plan.',
      indicator: 'slate',
      bullets: [],
    };
  }

  if (recycling.planStatus === 'exit_review') {
    return {
      mode: 'recycling',
      readiness: 'blocked',
      headline: 'Exit review suggested',
      oneLiner: 'The model flags weak quality — consider reducing risk instead of recycling.',
      indicator: 'amber',
      bullets: [
        `Stock quality: ${conviction.stockQualityStatus}`,
        `Conviction: ${conviction.convictionGrade}`,
        recycling.actionMessage || recycling.summary,
      ],
      caution: 'Talk to your plan rules or advisor before adding more size.',
    };
  }

  if (!summary?.planAvailable) {
    return {
      mode: 'recycling',
      readiness: 'blocked',
      headline: 'Recycling blocked',
      oneLiner: recycling.actionMessage || 'Guardrails prevent a sell/rebuy ladder right now.',
      indicator: 'amber',
      bullets: [
        `Conviction ${conviction.convictionGrade} · quality ${conviction.stockQualityStatus}`,
        'Broken quality or grade D usually blocks recycling.',
      ],
      caution: 'Try improving conviction inputs (universe, watchlist) or adjust quality override.',
    };
  }

  const be = summary.finalBreakEven;
  const beImp = summary.breakEvenImprovement;
  return {
    mode: 'recycling',
    readiness: 'ready',
    headline: 'Sell & rebuy — no new cash',
    oneLiner: `Sell up to ${summary.maxRecycleShares} shares in steps on rebounds, then rebuy lower using only that sale money. Core ${summary.coreShares} shares stay untouched.`,
    indicator: 'green',
    bullets: [
      `${summary.trancheCount} planned step${summary.trancheCount !== 1 ? 's' : ''} (sell then rebuy pairs)`,
      be != null ? `If all steps complete, break-even near ${formatMoney(be)} per share` : 'Break-even improves as rebuys fill below your average',
      beImp != null && beImp > 0 ? `Estimated improvement: ${formatMoney(beImp)} per share vs today` : 'Uses proceeds only — no deposit from your wallet',
    ],
  };
}

export function buildRecoveryLadderPathBrief(args: {
  plPct: number;
  lossTriggerPct: number;
  deployableCash: number;
  bookCurrency: string;
  ladder: RecoveryPlanResult | null;
}): RecoveryPathBrief {
  const { plPct, lossTriggerPct, deployableCash, bookCurrency, ladder } = args;

  if (plPct >= 0) {
    return {
      mode: 'recovery_ladder',
      readiness: 'unavailable',
      headline: 'Not in loss',
      oneLiner: 'The buy ladder activates when loss exceeds your trigger.',
      indicator: 'slate',
      bullets: [`Trigger is set at ${formatPct(-lossTriggerPct)} or worse.`],
    };
  }

  if (!ladder) {
    return {
      mode: 'recovery_ladder',
      readiness: 'unavailable',
      headline: 'No price data',
      oneLiner: 'Refresh live quotes, then reopen this plan.',
      indicator: 'slate',
      bullets: [],
    };
  }

  if (!ladder.qualified) {
    const reason = ladder.reason || 'Does not meet recovery rules yet.';
    const needsMoreLoss = plPct > -lossTriggerPct;
    return {
      mode: 'recovery_ladder',
      readiness: needsMoreLoss ? 'unavailable' : 'blocked',
      headline: needsMoreLoss ? 'Loss not deep enough yet' : 'Buy ladder blocked',
      oneLiner: needsMoreLoss
        ? `You are at ${formatPct(plPct)}. Ladder starts at ${formatPct(-lossTriggerPct)} or worse.`
        : reason,
      indicator: needsMoreLoss ? 'slate' : 'amber',
      bullets: needsMoreLoss
        ? ['Wait for a deeper dip or lower your loss trigger in settings.']
        : [
            deployableCash <= 0
              ? 'No deployable cash detected for staged buys.'
              : `Deployable cash (${bookCurrency}): about ${formatMoney(deployableCash)}`,
            ladder.state === 'FROZEN' ? 'Speculative sleeve may freeze recovery buys.' : reason,
          ],
      caution: needsMoreLoss ? undefined : 'Free up cash or relax caps to unlock the ladder.',
    };
  }

  const levels = ladder.ladder.length;
  const cost = ladder.totalPlannedCost;
  return {
    mode: 'recovery_ladder',
    readiness: 'ready',
    headline: 'Staged buys with your cash',
    oneLiner: `Place ${levels} limit buy${levels !== 1 ? 's' : ''} at lower prices using deployable cash — average cost can move from ${formatMoney(ladder.currentPrice)} toward ${formatMoney(ladder.newAvgCost)}.`,
    indicator: 'green',
    bullets: [
      `Planned spend: about ${formatMoney(cost)} ${bookCurrency} (within your recovery budget)`,
      `After all fills: ~${ladder.newShares} shares at ~${formatMoney(ladder.newAvgCost)} avg (estimate)`,
      ladder.state === 'PARTIAL_FILL'
        ? 'Some levels already filled — remaining steps were recalculated.'
        : `Loss now: ${formatPct(plPct)} · trigger was ${formatPct(-lossTriggerPct)}`,
    ],
  };
}

export function suggestDefaultRecoveryPathMode(args: {
  recyclingReady: boolean;
  ladderReady: boolean;
  plPct: number;
}): 'recycling' | 'recovery_ladder' {
  const { recyclingReady, ladderReady, plPct } = args;
  if (recyclingReady && !ladderReady) return 'recycling';
  if (ladderReady && !recyclingReady) return 'recovery_ladder';
  if (recyclingReady && ladderReady) {
    return Math.abs(plPct) >= 25 ? 'recycling' : 'recovery_ladder';
  }
  return 'recycling';
}
