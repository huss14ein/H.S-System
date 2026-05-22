import React from 'react';
import type { PlannedTrade, RecoveryPlanResult } from '../types';
import type { UnifiedRecoveryPlan } from '../services/unifiedRecoveryPlan';
import PositionRecyclingPanel, { type PositionRecyclingPrefsUi } from './PositionRecyclingPanel';
import type { PositionRecyclingPlan } from '../services/positionRecyclingPlan';
import InfoHint from './InfoHint';

const STRATEGY_LABELS: Record<UnifiedRecoveryPlan['strategy'], string> = {
  recycling_only: 'Recycling only (no new cash)',
  cash_ladder_only: 'Buy ladder (deployable cash)',
  hybrid_recycling_first: 'Hybrid — recycling first, then ladder',
  hybrid_parallel: 'Hybrid — recycling + ladder in parallel',
};

export interface UnifiedRecoveryPanelProps {
  plan: UnifiedRecoveryPlan;
  formatMoney: (n: number) => string;
  formatCurrency: (n: number, currency?: string) => string;
  bookCurrency: string;
  recyclingPrefs: PositionRecyclingPrefsUi;
  onRecyclingPrefsChange: (patch: Partial<PositionRecyclingPrefsUi>) => void;
  activeRecyclingPlan: PositionRecyclingPlan | null;
  activeCashLadder: RecoveryPlanResult | null;
  onGenerateAllDrafts?: () => void;
  onPushAllDrafts?: () => void;
  onSaveRecycling?: () => void;
  onExportRecyclingJson?: () => void;
  isPushing?: boolean;
  linkedPlannedTrades?: PlannedTrade[];
  onOpenInvestmentPlan?: () => void;
}

const UnifiedRecoveryPanel: React.FC<UnifiedRecoveryPanelProps> = ({
  plan,
  formatMoney,
  formatCurrency,
  bookCurrency,
  recyclingPrefs,
  onRecyclingPrefsChange,
  activeRecyclingPlan,
  activeCashLadder,
  onGenerateAllDrafts,
  onPushAllDrafts,
  onSaveRecycling,
  onExportRecyclingJson,
  isPushing = false,
  linkedPlannedTrades = [],
  onOpenInvestmentPlan,
}) => {
  const showRecycling = Boolean(activeRecyclingPlan);
  const showLadder = Boolean(activeCashLadder?.qualified && activeCashLadder.ladder.length > 0);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/80 via-white to-teal-50/50 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-indigo-950 uppercase tracking-wide">
              Unified recovery strategy
              <InfoHint text="Combines position recycling (sale proceeds only) and staged buy ladder (deployable cash). Conviction syncs from universe tier, watchlist scores, and thesis journal." />
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{STRATEGY_LABELS[plan.strategy]}</p>
            <p className="mt-1 text-xs text-slate-600">{plan.strategyReason}</p>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-indigo-100 text-indigo-900 border border-indigo-200">
            {plan.executionProgress}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-white/80 border border-slate-200 p-3">
            <p className="font-bold text-slate-700 mb-1">Synced conviction</p>
            <p className="text-lg font-black text-slate-900">
              {plan.conviction.convictionGrade} · {plan.conviction.stockQualityStatus}
            </p>
            <ul className="mt-2 space-y-0.5 text-slate-600 list-disc list-inside">
              {plan.conviction.sources.slice(0, 4).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg bg-white/80 border border-slate-200 p-3">
            <p className="font-bold text-slate-700 mb-1">Next step</p>
            <p className="text-slate-800 leading-snug">{plan.recommendedNextAction}</p>
            <p className="mt-2 text-slate-500">
              {plan.pendingDrafts.length} pending limit{plan.pendingDrafts.length !== 1 ? 's' : ''}
              {plan.trancheStates.filter((t) => t.status === 'filled').length > 0 &&
                ` · ${plan.trancheStates.filter((t) => t.status === 'filled').length} filled`}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {onGenerateAllDrafts && (
            <button type="button" className="btn-primary text-sm" onClick={onGenerateAllDrafts}>
              Generate all drafts
            </button>
          )}
          {onPushAllDrafts && plan.pendingDrafts.length > 0 && (
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={isPushing}
              onClick={onPushAllDrafts}
            >
              {isPushing ? 'Adding…' : `Push ${plan.pendingDrafts.length} to Investment Plan`}
            </button>
          )}
        </div>
      </div>

      {plan.trancheStates.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <p className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-600 bg-slate-50 border-b border-slate-200">
            Tranche execution
            <InfoHint text="Matches limits in Investment Plan. When a tranche is marked Executed, remaining tranches are recomputed from your updated position." />
          </p>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">Tranche</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-right px-3 py-2">Limit</th>
                <th className="text-center px-3 py-2">Status</th>
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
                      {row.status === 'filled' ? 'Filled' : 'Pending'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showRecycling && activeRecyclingPlan && (
        <PositionRecyclingPanel
          plan={activeRecyclingPlan}
          formatMoney={formatMoney}
          prefs={recyclingPrefs}
          onPrefsChange={onRecyclingPrefsChange}
          onGenerateDrafts={onGenerateAllDrafts}
          onPushDrafts={onPushAllDrafts}
          onSavePlan={onSaveRecycling}
          onExportJson={onExportRecyclingJson}
          embedded
          isPushingDrafts={isPushing}
          linkedPlannedTrades={linkedPlannedTrades}
          onOpenInvestmentPlan={onOpenInvestmentPlan}
        />
      )}

      {showLadder && activeCashLadder && (
        <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/40 to-white p-5 space-y-3">
          <p className="text-sm font-bold text-violet-950 uppercase tracking-wide">
            Buy ladder (deployable cash)
            <InfoHint text="Staged limit buys using recovery budget. Filled levels are removed and remaining levels recomputed." />
          </p>
          {activeCashLadder.state === 'PARTIAL_FILL' && (
            <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Partial fill detected — ladder below reflects remaining levels only.
            </p>
          )}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-white border border-violet-100 p-2">
              <p className="text-slate-500">New avg</p>
              <p className="font-bold text-slate-900">{formatMoney(activeCashLadder.newAvgCost)}</p>
            </div>
            <div className="rounded-lg bg-white border border-violet-100 p-2">
              <p className="text-slate-500">New shares</p>
              <p className="font-bold text-slate-900 tabular-nums">{activeCashLadder.newShares}</p>
            </div>
            <div className="rounded-lg bg-white border border-violet-100 p-2">
              <p className="text-slate-500">Budget</p>
              <p className="font-bold text-slate-900">
                {formatCurrency(activeCashLadder.totalPlannedCost, bookCurrency)}
              </p>
            </div>
          </div>
          <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">Level</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Limit</th>
                <th className="px-3 py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {activeCashLadder.ladder.map((l) => (
                <tr key={l.level} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold">L{l.level}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.price)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.cost, bookCurrency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!showRecycling && !showLadder && (
        <p className="text-sm text-slate-600 rounded-lg border border-slate-200 bg-slate-50 p-4">
          No active recovery path for this position. Check guardrails, conviction (Broken/D blocks recycling), or
          deployable cash for the buy ladder.
        </p>
      )}
    </div>
  );
};

export default UnifiedRecoveryPanel;
