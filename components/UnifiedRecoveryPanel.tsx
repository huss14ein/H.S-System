import React, { useMemo } from 'react';
import type { PlannedTrade, RecoveryPlanResult } from '../types';
import type { UnifiedRecoveryPlan } from '../services/unifiedRecoveryPlan';
import type { RecoveryPathMode } from '../services/recoveryPathMode';
import {
  buildRecyclingPathBrief,
  buildRecoveryLadderPathBrief,
  type RecoveryPathBrief,
} from '../services/recoveryPathSummaries';
import PositionRecyclingPanel, { type PositionRecyclingPrefsUi } from './PositionRecyclingPanel';
import type { PositionRecyclingPlan } from '../services/positionRecyclingPlan';
import InfoHint from './InfoHint';

const MODE_LABELS: Record<RecoveryPathMode, { title: string; subtitle: string }> = {
  recycling: {
    title: 'Position recycling',
    subtitle: 'No new money — sell part on rebounds, rebuy lower with that cash',
  },
  recovery_ladder: {
    title: 'Recovery buy ladder',
    subtitle: 'Use deployable cash — staged limit buys at lower prices',
  },
};

function indicatorClasses(indicator: RecoveryPathBrief['indicator']): string {
  switch (indicator) {
    case 'green':
      return 'bg-emerald-100 text-emerald-900 border-emerald-300';
    case 'amber':
      return 'bg-amber-100 text-amber-950 border-amber-300';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function readinessLabel(readiness: RecoveryPathBrief['readiness']): string {
  switch (readiness) {
    case 'ready':
      return 'Ready';
    case 'blocked':
      return 'Blocked';
    default:
      return 'Not available';
  }
}

function PathSummaryCard({
  brief,
  selected,
  onSelect,
}: {
  brief: RecoveryPathBrief;
  selected: boolean;
  onSelect: () => void;
}) {
  const modeMeta = MODE_LABELS[brief.mode];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
        selected
          ? brief.mode === 'recycling'
            ? 'border-teal-500 bg-teal-50/80 ring-2 ring-teal-200'
            : 'border-violet-500 bg-violet-50/80 ring-2 ring-violet-200'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{modeMeta.title}</p>
          <p className="text-sm font-semibold text-slate-900 mt-0.5">{brief.headline}</p>
        </div>
        <span
          className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${indicatorClasses(brief.indicator)}`}
        >
          {readinessLabel(brief.readiness)}
        </span>
      </div>
      <p className="text-sm text-slate-700 leading-snug">{brief.oneLiner}</p>
      {selected && brief.bullets.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-slate-600 list-disc pl-4">
          {brief.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {selected && brief.caution && (
        <p className="mt-2 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          {brief.caution}
        </p>
      )}
    </button>
  );
}

export interface UnifiedRecoveryPanelProps {
  plan: UnifiedRecoveryPlan;
  pathMode: RecoveryPathMode;
  onPathModeChange: (mode: RecoveryPathMode) => void;
  plPct: number;
  lossTriggerPct: number;
  deployableCash: number;
  formatMoney: (n: number) => string;
  formatCurrency: (n: number, currency?: string) => string;
  bookCurrency: string;
  recyclingPrefs: PositionRecyclingPrefsUi;
  onRecyclingPrefsChange: (patch: Partial<PositionRecyclingPrefsUi>) => void;
  activeRecyclingPlan: PositionRecyclingPlan | null;
  activeCashLadder: RecoveryPlanResult | null;
  onGenerateDrafts?: () => void;
  onPushDrafts?: () => void;
  onSaveRecycling?: () => void;
  onExportRecyclingJson?: () => void;
  isPushing?: boolean;
  linkedPlannedTrades?: PlannedTrade[];
  onOpenInvestmentPlan?: () => void;
}

const UnifiedRecoveryPanel: React.FC<UnifiedRecoveryPanelProps> = ({
  plan,
  pathMode,
  onPathModeChange,
  plPct,
  lossTriggerPct,
  deployableCash,
  formatMoney,
  formatCurrency,
  bookCurrency,
  recyclingPrefs,
  onRecyclingPrefsChange,
  activeRecyclingPlan,
  activeCashLadder,
  onGenerateDrafts,
  onPushDrafts,
  onSaveRecycling,
  onExportRecyclingJson,
  isPushing = false,
  linkedPlannedTrades = [],
  onOpenInvestmentPlan,
}) => {
  const recyclingBrief = useMemo(
    () =>
      buildRecyclingPathBrief({
        plPct,
        recycling: plan.recycling,
        summary: plan.recyclingSummary,
        conviction: plan.conviction,
      }),
    [plPct, plan.recycling, plan.recyclingSummary, plan.conviction],
  );

  const ladderBrief = useMemo(
    () =>
      buildRecoveryLadderPathBrief({
        plPct,
        lossTriggerPct,
        deployableCash,
        bookCurrency,
        ladder: plan.cashLadder,
      }),
    [plPct, lossTriggerPct, deployableCash, bookCurrency, plan.cashLadder],
  );

  const activeBrief = pathMode === 'recycling' ? recyclingBrief : ladderBrief;
  const showRecycling = pathMode === 'recycling' && Boolean(activeRecyclingPlan);
  const showLadder =
    pathMode === 'recovery_ladder' &&
    Boolean(activeCashLadder?.qualified && activeCashLadder.ladder.length > 0);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
        <p className="text-sm font-bold text-slate-900">
          Choose one approach
          <InfoHint text="Pick either recycling (no new cash) OR a buy ladder (deployable cash). The app will not combine both unless you switch tabs and generate drafts separately." />
        </p>
        <p className="text-xs text-slate-600 mt-1 mb-1">
          Recommended: <strong>{MODE_LABELS[plan.suggestedPathMode].title}</strong> —{' '}
          {MODE_LABELS[plan.suggestedPathMode].subtitle}
        </p>
        <p className="text-xs text-slate-500 mb-4">Your choice is saved for this symbol.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PathSummaryCard
            brief={recyclingBrief}
            selected={pathMode === 'recycling'}
            onSelect={() => onPathModeChange('recycling')}
          />
          <PathSummaryCard
            brief={ladderBrief}
            selected={pathMode === 'recovery_ladder'}
            onSelect={() => onPathModeChange('recovery_ladder')}
          />
        </div>
      </div>

      <div
        className={`rounded-2xl border-2 p-4 sm:p-5 ${
          pathMode === 'recycling'
            ? 'border-teal-200 bg-gradient-to-br from-teal-50/60 via-white to-slate-50/40'
            : 'border-violet-200 bg-gradient-to-br from-violet-50/50 via-white to-slate-50/40'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Active plan · {MODE_LABELS[pathMode].title}
            </p>
            <p className="text-lg font-bold text-slate-900 mt-1">{activeBrief.headline}</p>
            <p className="text-sm text-slate-700 mt-1 leading-relaxed">{activeBrief.oneLiner}</p>
          </div>
          <span
            className={`shrink-0 text-xs font-bold px-3 py-1.5 rounded-full border ${indicatorClasses(activeBrief.indicator)}`}
          >
            {readinessLabel(activeBrief.readiness)}
          </span>
        </div>

        {activeBrief.bullets.length > 0 && (
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-slate-700">
            {activeBrief.bullets.map((b, i) => (
              <li key={i} className="flex gap-2 items-start">
                <span className="text-emerald-600 font-bold shrink-0" aria-hidden>
                  ✓
                </span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}

        {activeBrief.caution && (
          <p className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {activeBrief.caution}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2 items-center">
          {onGenerateDrafts && activeBrief.readiness === 'ready' && (
            <button type="button" className="btn-primary text-sm" onClick={onGenerateDrafts}>
              Generate {pathMode === 'recycling' ? 'recycling' : 'ladder'} drafts
            </button>
          )}
          {onPushDrafts && plan.pendingDrafts.length > 0 && (
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={isPushing}
              onClick={onPushDrafts}
            >
              {isPushing ? 'Adding…' : `Add ${plan.pendingDrafts.length} to Investment Plan`}
            </button>
          )}
          <span className="text-xs text-slate-500 ml-auto">{plan.executionProgress}</span>
        </div>
        <p className="text-xs text-slate-600 mt-2">{plan.recommendedNextAction}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
          <p className="font-bold text-slate-700 mb-1">Conviction (synced)</p>
          <p className="text-base font-black text-slate-900">
            {plan.conviction.convictionGrade} · {plan.conviction.stockQualityStatus}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
          <p className="font-bold text-slate-700 mb-1">Next limit</p>
          <p className="text-slate-800 leading-snug">
            {plan.trancheStates.find((t) => t.status === 'pending')
              ? `${plan.trancheStates.find((t) => t.status === 'pending')!.label} @ ${formatMoney(plan.trancheStates.find((t) => t.status === 'pending')!.limitPrice)}`
              : 'None pending — generate drafts or mark fills in Investment Plan'}
          </p>
        </div>
      </div>

      {plan.trancheStates.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <p className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-600 bg-slate-50 border-b border-slate-200">
            Steps for {pathMode === 'recycling' ? 'recycling' : 'buy ladder'}
            <InfoHint text="Synced with Investment Plan. Executed limits are removed and remaining steps recalculate." />
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[320px]">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Step</th>
                  <th className="text-right px-3 py-2 font-semibold">Qty</th>
                  <th className="text-right px-3 py-2 font-semibold">Limit</th>
                  <th className="text-center px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {plan.trancheStates.map((row, i) => (
                  <tr key={`${row.label}-${i}`} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">{row.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.qty}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.limitPrice)}</td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full font-bold ${
                          row.status === 'filled'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        {row.status === 'filled' ? 'Done' : 'Waiting'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showRecycling && activeRecyclingPlan && (
        <PositionRecyclingPanel
          plan={activeRecyclingPlan}
          formatMoney={formatMoney}
          prefs={recyclingPrefs}
          onPrefsChange={onRecyclingPrefsChange}
          onGenerateDrafts={onGenerateDrafts}
          onPushDrafts={onPushDrafts}
          onSavePlan={onSaveRecycling}
          onExportJson={onExportRecyclingJson}
          embedded
          isPushingDrafts={isPushing}
          linkedPlannedTrades={linkedPlannedTrades}
          onOpenInvestmentPlan={onOpenInvestmentPlan}
        />
      )}

      {showLadder && activeCashLadder && (
        <div className="rounded-2xl border border-violet-200 bg-white p-4 sm:p-5 space-y-4">
          <p className="text-sm font-bold text-violet-950">
            Buy ladder detail
            <InfoHint text="Each row is a limit buy at a lower price. Uses deployable cash only." />
          </p>
          {activeCashLadder.state === 'PARTIAL_FILL' && (
            <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Some buys already filled — table shows remaining steps only.
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
            <div className="rounded-lg bg-violet-50 border border-violet-100 p-2.5">
              <p className="text-slate-500 font-medium">Loss now</p>
              <p className="font-bold text-rose-700 tabular-nums">{plPct.toFixed(1)}%</p>
            </div>
            <div className="rounded-lg bg-violet-50 border border-violet-100 p-2.5">
              <p className="text-slate-500 font-medium">New avg (if all fill)</p>
              <p className="font-bold text-slate-900 tabular-nums">{formatMoney(activeCashLadder.newAvgCost)}</p>
            </div>
            <div className="rounded-lg bg-violet-50 border border-violet-100 p-2.5">
              <p className="text-slate-500 font-medium">Shares after</p>
              <p className="font-bold text-slate-900 tabular-nums">{activeCashLadder.newShares}</p>
            </div>
            <div className="rounded-lg bg-violet-50 border border-violet-100 p-2.5">
              <p className="text-slate-500 font-medium">Cash needed</p>
              <p className="font-bold text-slate-900 tabular-nums">
                {formatCurrency(activeCashLadder.totalPlannedCost, bookCurrency)}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs min-w-[280px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Level</th>
                  <th className="px-3 py-2 text-right font-semibold">Shares</th>
                  <th className="px-3 py-2 text-right font-semibold">Buy at</th>
                  <th className="px-3 py-2 text-right font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {activeCashLadder.ladder.map((l) => (
                  <tr key={l.level} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold text-slate-800">Step {l.level}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.qty}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.price)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.cost, bookCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeBrief.readiness !== 'ready' && (
        <p className="text-sm text-slate-600 rounded-lg border border-slate-200 bg-slate-50 p-4">
          {pathMode === 'recycling'
            ? 'Switch to Recovery buy ladder if recycling is blocked, or adjust conviction/quality above.'
            : 'Switch to Position recycling if you prefer not to deploy new cash, or wait until loss reaches your trigger.'}
        </p>
      )}
    </div>
  );
};

export default UnifiedRecoveryPanel;
