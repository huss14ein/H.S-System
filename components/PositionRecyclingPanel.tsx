import React from 'react';
import type { PlannedTrade } from '../types';
import type { PositionRecyclingPlan, ConvictionGrade, StockQualityStatus } from '../services/positionRecyclingPlan';
import InfoHint from './InfoHint';

export interface PositionRecyclingPrefsUi {
  convictionGrade?: ConvictionGrade;
  stockQualityStatus?: StockQualityStatus;
  minRebuyDiscountPercent: number;
  avoidSellingBelowAverage: boolean;
}

export interface PositionRecyclingPanelProps {
  plan: PositionRecyclingPlan;
  formatMoney: (n: number) => string;
  prefs: PositionRecyclingPrefsUi;
  onPrefsChange: (patch: Partial<PositionRecyclingPrefsUi>) => void;
  onPushDrafts?: () => void;
  onGenerateDrafts?: () => void;
  onSavePlan?: () => void;
  onExportJson?: () => void;
  embedded?: boolean;
  isPushingDrafts?: boolean;
  linkedPlannedTrades?: PlannedTrade[];
  onOpenInvestmentPlan?: () => void;
}

const GRADES: ConvictionGrade[] = ['A', 'B', 'C', 'D'];
const QUALITIES: StockQualityStatus[] = ['Strong', 'Medium', 'Weak', 'Broken'];

const PositionRecyclingPanel: React.FC<PositionRecyclingPanelProps> = ({
  plan,
  formatMoney,
  prefs,
  onPrefsChange,
  onPushDrafts,
  onGenerateDrafts,
  onSavePlan,
  onExportJson,
  embedded = false,
  isPushingDrafts = false,
  linkedPlannedTrades = [],
  onOpenInvestmentPlan,
}) => {
  const pos = plan.currentPosition;
  const split = plan.positionSplit;
  const shellClass = embedded
    ? 'space-y-4'
    : 'rounded-2xl border border-teal-200/80 bg-gradient-to-br from-teal-50/50 via-white to-slate-50/80 p-5 shadow-sm space-y-4';

  return (
    <div className={shellClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {!embedded && (
            <p className="text-sm font-bold text-teal-950 uppercase tracking-wide">
              Position recycling (no new cash)
              <InfoHint text="Sell part of your position on rebounds, rebuy lower with the same proceeds. Core shares are never in the sell ladder." />
            </p>
          )}
          <p className={`text-xs text-slate-600 ${embedded ? '' : 'mt-1'}`}>{plan.summary}</p>
        </div>
        <span
          className={`text-xs font-bold px-2.5 py-1 rounded-full ${
            plan.planStatus === 'active'
              ? 'bg-emerald-100 text-emerald-800'
              : plan.planStatus === 'blocked'
                ? 'bg-amber-100 text-amber-900'
                : 'bg-rose-100 text-rose-800'
          }`}
        >
          {plan.planStatus === 'active' ? 'Plan ready' : plan.planStatus === 'blocked' ? 'Blocked' : 'Exit review'}
        </span>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-slate-600">Conviction</span>
          <select
            className="select-base text-xs min-w-[88px]"
            value={prefs.convictionGrade ?? ''}
            onChange={(e) =>
              onPrefsChange({
                convictionGrade: (e.target.value || undefined) as ConvictionGrade | undefined,
              })
            }
          >
            <option value="">Auto</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-slate-600">Quality</span>
          <select
            className="select-base text-xs min-w-[100px]"
            value={prefs.stockQualityStatus ?? ''}
            onChange={(e) =>
              onPrefsChange({
                stockQualityStatus: (e.target.value || undefined) as StockQualityStatus | undefined,
              })
            }
          >
            <option value="">Auto (P/L)</option>
            {QUALITIES.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-slate-600">Min rebuy %</span>
          <input
            type="number"
            min={8}
            max={20}
            className="input-base text-xs w-20"
            value={prefs.minRebuyDiscountPercent}
            onChange={(e) =>
              onPrefsChange({ minRebuyDiscountPercent: Math.max(8, Number(e.target.value) || 10) })
            }
          />
        </label>
        <label className="flex items-center gap-2 self-end pb-1">
          <input
            type="checkbox"
            checked={prefs.avoidSellingBelowAverage}
            onChange={(e) => onPrefsChange({ avoidSellingBelowAverage: e.target.checked })}
          />
          <span className="text-slate-700">Avoid sells below average</span>
        </label>
      </div>

      {plan.marketContext && plan.marketContext.notes.length > 0 && (
        <ul className="text-[11px] text-slate-600 list-disc pl-4 space-y-0.5">
          {plan.marketContext.rangePositionPercent != null && (
            <li>
              52-week range position: {plan.marketContext.rangePositionPercent.toFixed(0)}%
            </li>
          )}
          {plan.marketContext.notes.map((n, i) => (
            <li key={`mc-${i}`}>{n}</li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg border border-slate-200 bg-white/80 p-2">
          <p className="text-slate-500">Shares / avg</p>
          <p className="font-bold tabular-nums">
            {pos.sharesOwned} @ {formatMoney(pos.averageCost)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white/80 p-2">
          <p className="text-slate-500">Price / P/L</p>
          <p className="font-bold tabular-nums">
            {formatMoney(pos.currentPrice)}{' '}
            <span className={pos.unrealizedPnL >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
              ({pos.unrealizedPnLPercent >= 0 ? '+' : ''}
              {pos.unrealizedPnLPercent.toFixed(1)}%)
            </span>
          </p>
        </div>
        {split && (
          <>
            <div className="rounded-lg border border-teal-200 bg-white/80 p-2">
              <p className="text-slate-500">Core</p>
              <p className="font-bold tabular-nums text-teal-900">{split.coreShares} sh</p>
            </div>
            <div className="rounded-lg border border-teal-200 bg-white/80 p-2">
              <p className="text-slate-500">Recycle max</p>
              <p className="font-bold tabular-nums text-teal-900">{split.maxRecycleShares} sh</p>
            </div>
          </>
        )}
      </div>

      {plan.readiness && (
        <div className="text-xs text-slate-600">
          Readiness {plan.readiness.score}% —{' '}
          {plan.readiness.checks.filter((c) => !c.ok).map((c) => c.label).join('; ') || 'all checks passed'}
        </div>
      )}

      {plan.planAvailable && plan.recyclingLadder.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-right">Sell sh</th>
                <th className="px-2 py-2 text-right">Sell $</th>
                <th className="px-2 py-2 text-right">Rebuy $</th>
                <th className="px-2 py-2 text-right">Rebuy sh</th>
                <th className="px-2 py-2 text-right">After</th>
                <th className="px-2 py-2 text-right">Break-even</th>
              </tr>
            </thead>
            <tbody>
              {plan.recyclingLadder.map((row) => (
                <tr key={row.trancheIndex} className="border-t border-slate-100">
                  <td className="px-2 py-2 font-semibold">T{row.trancheIndex}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.sharesToSell}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.sellPrice)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.rebuyPrice)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.sharesToRebuy}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.sharesAfterRebuy}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-emerald-800">
                    {formatMoney(row.newEconomicBreakEven)}
                    <span className="text-slate-500"> (−{formatMoney(row.breakEvenImprovement)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {plan.projectedOutcome && (
        <p className="text-xs text-slate-700">
          If all tranches fill: {plan.projectedOutcome.finalSharesIfAllTranchesComplete} shares, break-even{' '}
          {formatMoney(plan.projectedOutcome.finalBreakEvenIfAllTranchesComplete)} (
          {plan.projectedOutcome.meaningfulImprovement ? 'meaningful' : 'marginal'} improvement).
        </p>
      )}

      <p className="text-sm text-slate-800 leading-relaxed border-l-4 border-teal-400 pl-3">{plan.actionMessage}</p>

      {plan.warnings.length > 0 && (
        <ul className="text-xs text-amber-900 list-disc pl-4 space-y-0.5">
          {plan.warnings.map((w, i) => (
            <li key={`rw-${i}`}>{w}</li>
          ))}
        </ul>
      )}

      {plan.optionsNotes.length > 0 && (
        <ul className="text-xs text-slate-600 list-disc pl-4">
          {plan.optionsNotes.map((n, i) => (
            <li key={`opt-${i}`}>{n}</li>
          ))}
        </ul>
      )}

      {linkedPlannedTrades.length > 0 && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-900">
          <p className="font-semibold">
            {linkedPlannedTrades.length} recycling limit(s) already in Investment Plan for {plan.ticker}.
          </p>
          {onOpenInvestmentPlan && (
            <button type="button" className="mt-1 font-semibold text-primary hover:underline" onClick={onOpenInvestmentPlan}>
              Open Investment Plan →
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {onGenerateDrafts && plan.planAvailable && (
          <button type="button" className="px-3 py-2 text-xs font-semibold rounded-lg border border-teal-300 bg-white text-teal-900 hover:bg-teal-50" onClick={onGenerateDrafts}>
            Preview draft orders
          </button>
        )}
        {onSavePlan && (
          <button type="button" className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50" onClick={onSavePlan}>
            Save plan to history
          </button>
        )}
        {onExportJson && (
          <button type="button" className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50" onClick={onExportJson}>
            Export JSON
          </button>
        )}
        {onPushDrafts && plan.planAvailable && (
          <button type="button" className="btn-primary text-xs" disabled={isPushingDrafts} onClick={onPushDrafts}>
            {isPushingDrafts ? 'Adding limits…' : 'Add recycle limits to Investment Plan'}
          </button>
        )}
      </div>
    </div>
  );
};

export default PositionRecyclingPanel;
