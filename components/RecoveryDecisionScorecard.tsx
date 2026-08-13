import type { RecoveryInvestorDecision } from '../services/recoveryDecisionEngine';
import { decisionTone } from '../services/recoveryDecisionEngine';
import type { RecyclingPlanSummary } from '../services/positionRecyclingIntegration';
import InfoHint from './InfoHint';

function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function RecoveryDecisionScorecard({
  decision,
  formatMoney,
  bookCurrency,
  recyclingSummary,
  currentPrice,
  avgCost,
}: {
  decision: RecoveryInvestorDecision;
  formatMoney: (n: number) => string;
  bookCurrency: string;
  recyclingSummary?: RecyclingPlanSummary | null;
  currentPrice?: number;
  avgCost?: number;
}) {
  const tone = decisionTone(decision.action);
  const m = decision.metrics;
  const isAdd = decision.action === 'add_ladder';
  const isRecycle = decision.action === 'recycle';
  const recycleBe = recyclingSummary?.finalBreakEven;
  const recycleImp = recyclingSummary?.breakEvenImprovement;
  const px = Number(currentPrice);
  const avg = Number(avgCost);
  const recycleRebound =
    recycleBe != null && Number.isFinite(px) && px > 0 ? ((recycleBe - px) / px) * 100 : null;
  const holdRebound = Number.isFinite(avg) && Number.isFinite(px) && px > 0 ? ((avg - px) / px) * 100 : null;

  return (
    <div
      id="recovery-decision-scorecard"
      className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 sm:p-6 shadow-md space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Investor decision</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-bold ${tone.chip}`}>
              {decision.label}
            </span>
            <span className="text-xs font-semibold text-slate-500">
              {decision.confidence} confidence · priority {decision.priority}
            </span>
          </div>
        </div>
        {m.budgetDeferred && (
          <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-950">
            Cash assigned to higher-priority names
          </span>
        )}
      </div>
      <p className="text-sm text-slate-800 leading-relaxed">{decision.why}</p>
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Next step</p>
        <p className="mt-1 text-sm font-semibold text-indigo-950">{decision.nextStep}</p>
      </div>
      {isAdd ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
              New break-even
              <InfoHint text="Average cost after planned ladder fills. Price must reclaim this level for the add to be flat." />
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-slate-900">{fmtPx(m.breakEvenAfter)}</p>
            <p className="text-xs text-slate-500">Avg improves {fmtPct(m.avgImprovementPct, 1)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
              Rebound needed
              <InfoHint text="Rally from today’s price back to the new average. Compare with “if you hold” — bounce to the old average with no add." />
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-slate-900">{fmtPct(m.reboundToNewBreakevenPct)}</p>
            <p className="text-xs text-slate-500">If you hold: {fmtPct(m.reboundToOldBreakevenPct)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
              Cash to deploy
              <InfoHint text="Planned ladder spend from this portfolio’s platform cash. Lower-priority names on the same broker wait or recycle. First rung may fund when the full ladder does not fit." />
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-slate-900">{formatMoney(m.cashToDeploy)}</p>
            <p className="text-xs text-slate-500">
              {bookCurrency} · {m.sharesToAdd.toFixed(2)} shares
              {m.firstBuyCash != null ? ` · first buy ~${formatMoney(m.firstBuyCash)}` : ''}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">First buy</p>
            <p className="mt-1 text-lg font-black tabular-nums text-slate-900">{fmtPx(m.firstBuyPrice)}</p>
            <p className="text-xs text-slate-500">
              {m.firstBuyDiscountPct != null ? `${m.firstBuyDiscountPct.toFixed(1)}% below last` : 'No rung yet'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
              Extra loss if −10%
              <InfoHint text="Paper loss on new cash only if price falls another 10% after you add." />
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-rose-800">{formatMoney(m.extraLossIfDown10)}</p>
            <p className="text-xs text-slate-500">On new cash, not the whole book</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Bounce saved</p>
            <p className="mt-1 text-lg font-black tabular-nums text-slate-900">{fmtPct(m.reboundReductionPct)}</p>
            <p className="text-xs text-slate-500">Points of rally no longer required</p>
          </div>
        </div>
      ) : isRecycle ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Recycle break-even</p>
            <p className="mt-1 text-lg font-black tabular-nums text-slate-900">
              {recycleBe != null ? fmtPx(recycleBe) : '—'}
            </p>
            <p className="text-xs text-slate-500">
              {recycleImp != null && recycleImp > 0 ? `Improves ~${fmtPx(recycleImp)} / share` : 'Sale proceeds only — no new cash'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Rebound if recycle fills</p>
            <p className="mt-1 text-lg font-black tabular-nums text-slate-900">{fmtPct(recycleRebound)}</p>
            <p className="text-xs text-slate-500">If you hold: {fmtPct(holdRebound ?? m.reboundToOldBreakevenPct)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">New cash</p>
            <p className="mt-1 text-lg font-black tabular-nums text-slate-900">0</p>
            <p className="text-xs text-slate-500">
              {recyclingSummary?.trancheCount
                ? `${recyclingSummary.trancheCount} sell/rebuy step${recyclingSummary.trancheCount === 1 ? '' : 's'}`
                : 'Uses winner sale cash only'}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          {decision.action === 'review_exit'
            ? 'Do not add cash. Review a trim or exit before any ladder or recycle.'
            : decision.action === 'do_not_add'
              ? 'Frozen for new cash. Preserve dry powder for higher-conviction Core/Upside names.'
              : 'No cash deploy yet. Watch the trigger, refresh quotes, or free budget before acting.'}
          {Number.isFinite(holdRebound) || m.reboundToOldBreakevenPct ? (
            <span className="block mt-1 text-xs text-slate-500">
              Rally to old average if you hold: {fmtPct(holdRebound ?? m.reboundToOldBreakevenPct)}
            </span>
          ) : null}
        </div>
      )}
      <p className="text-xs text-slate-600 leading-relaxed">{decision.riskNote}</p>
    </div>
  );
}
