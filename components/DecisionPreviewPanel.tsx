import type { Page } from '../types';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import InfoHint from './InfoHint';
import type { BuyScoreBreakdown } from '../services/decisionEngine';
import type { DecisionPreviewVerdict } from '../services/decisionPreviewVerdict';
import type { CapitalUse } from '../services/decisionEngine';

const KPI_WRAP = 'grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 items-stretch [&>*]:min-h-[5.75rem]';

type LiveInputs = {
  maxPositionPct: number;
  currentPositionPct: number;
  sleeveDriftPct: number | null;
  driftThresholdSettingPct: number;
};

function ScoreRing({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const c = 2 * Math.PI * 38;
  const dash = (pct / 100) * c;
  const tone =
    pct >= 68 ? 'text-emerald-600 stroke-emerald-500' : pct >= 45 ? 'text-amber-700 stroke-amber-500' : 'text-rose-700 stroke-rose-500';
  return (
    <div className={`relative mx-auto h-40 w-40 ${tone}`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="none"
          className="stroke-current"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums text-slate-900">{score}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Buy score</span>
      </div>
    </div>
  );
}

function AdjustRow({ label, value, hint }: { label: string; value: number; hint: string }) {
  const neg = value < 0;
  const pos = value > 0;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white/90 px-3 py-2 text-sm">
      <span className="text-slate-600">{label}</span>
      <span
        className={`tabular-nums font-semibold ${neg ? 'text-rose-700' : pos ? 'text-emerald-700' : 'text-slate-500'}`}
        title={hint}
      >
        {value > 0 ? '+' : ''}
        {value}
      </span>
    </div>
  );
}

export default function DecisionPreviewPanel(props: {
  liquidCashSar: number;
  capitalPreviewAmount: number;
  onCapitalChange: (n: number) => void;
  onResetCapitalToAutomatedDefault: () => void;
  capitalRanks: { use: CapitalUse; amount: number; rationale: string }[];
  liveDecisionInputs: LiveInputs;
  runwayMonths: number;
  buyBreakdown: BuyScoreBreakdown;
  verdict: DecisionPreviewVerdict;
  minRunwayMonthsPolicy: number;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}) {
  const { formatCurrencyString } = useFormatCurrency();
  const {
    liquidCashSar,
    capitalPreviewAmount,
    onCapitalChange,
    onResetCapitalToAutomatedDefault,
    capitalRanks,
    liveDecisionInputs,
    runwayMonths,
    buyBreakdown,
    verdict,
    minRunwayMonthsPolicy,
    setActivePage,
    triggerPageAction,
  } = props;

  const go = (page: Page, action?: string) => {
    if (action && triggerPageAction) triggerPageAction(page, action);
    else setActivePage?.(page);
  };

  const verdictTone =
    verdict.severity === 'urgent'
      ? 'border-rose-200 bg-gradient-to-r from-rose-50 to-rose-50/30'
      : verdict.severity === 'caution'
        ? 'border-amber-200 bg-gradient-to-r from-amber-50 to-amber-50/20'
        : 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-white';

  const autoLumpDefault = Math.max(5000, Math.round(liquidCashSar * 0.15));

  return (
    <div className="space-y-6">
      <div className={`rounded-2xl border px-4 py-4 sm:px-5 ${verdictTone}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Automated read</p>
            <p className="mt-1 text-base font-semibold text-slate-900">{verdict.headline}</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {verdict.bullets.map((b, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            {verdict.nextActions.slice(0, 4).map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => go(a.page, a.action)}
                disabled={!setActivePage && !triggerPageAction}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-primary shadow-sm hover:bg-slate-50 disabled:opacity-50"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-sm text-slate-600 flex flex-wrap items-center gap-2">
        <strong className="text-slate-800">Live signals</strong>
        — same engines as Wealth Ultra (drift) and your device trading policy (caps).
        <InfoHint text="Updates when you change accounts, investments, financial preferences drift %, or trading policy. Lump-sum allocation is a static prioritization model, not an executed transfer." />
      </p>

      <div className={KPI_WRAP}>
        <div className="flex flex-col justify-between rounded-xl border border-indigo-100 bg-indigo-50/90 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-800">Policy max position</p>
          <p className="text-xl font-bold tabular-nums text-indigo-950">{liveDecisionInputs.maxPositionPct}%</p>
          <p className="text-[10px] text-indigo-800/80">Trading policy (this device)</p>
        </div>
        <div className="flex flex-col justify-between rounded-xl border border-sky-100 bg-sky-50/90 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-900">Largest holding</p>
          <p className="text-xl font-bold tabular-nums text-sky-950">{liveDecisionInputs.currentPositionPct}%</p>
          <p className="text-[10px] text-sky-900/85">Of personal portfolio value</p>
        </div>
        <div className="flex flex-col justify-between rounded-xl border border-amber-100 bg-amber-50/90 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-950">Sleeve drift (max)</p>
          <p className="text-xl font-bold tabular-nums text-amber-950">
            {liveDecisionInputs.sleeveDriftPct == null ? '—' : `${liveDecisionInputs.sleeveDriftPct}%`}
          </p>
          <p className="text-[10px] leading-tight text-amber-900">
            Alert if &gt; {liveDecisionInputs.driftThresholdSettingPct}% (Financial preferences)
          </p>
        </div>
        <div className="flex flex-col justify-between rounded-xl border border-emerald-100 bg-emerald-50/90 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-900">Runway</p>
          <p className="text-xl font-bold tabular-nums text-emerald-950">{runwayMonths.toFixed(1)} mo</p>
          <p className="text-[10px] text-emerald-900/90">
            Min to buy (policy): {minRunwayMonthsPolicy} mo
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-8">
        <div className="space-y-4 lg:col-span-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <label htmlFor="cap-prev" className="block text-sm font-medium text-slate-800">
                Windfall / lump-sum simulator (SAR)
              </label>
              <p className="text-xs text-slate-500 mt-0.5">
                Auto default = max(5k, 15% liquid). Liquid cash today ≈{' '}
                <strong className="text-slate-700">{formatCurrencyString(liquidCashSar, { digits: 0 })}</strong>
              </p>
            </div>
            <button
              type="button"
              onClick={onResetCapitalToAutomatedDefault}
              className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
            >
              Reset to {formatCurrencyString(autoLumpDefault, { digits: 0 })} (15% liquid)
            </button>
          </div>
          <input
            id="cap-prev"
            type="number"
            min={0}
            step={1000}
            value={capitalPreviewAmount}
            onChange={(e) => onCapitalChange(Number(e.target.value) || 0)}
            className="input-base w-full max-w-xs"
          />
          <p className="text-xs text-slate-500">
            Fixed rule-of-thumb split for <strong>one-time cash</strong> — debt → emergency → goals → invest → buffer. Adjust the amount to stress-test only.
          </p>
          <div className="space-y-2">
            {capitalRanks.map((row) => {
              const pct = capitalPreviewAmount > 0 ? (row.amount / capitalPreviewAmount) * 100 : 0;
              return (
                <div key={row.use} className="rounded-xl border border-slate-100 bg-slate-50/90 p-3">
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="font-medium capitalize text-slate-800">{row.use.replace(/_/g, ' ')}</span>
                    <span className="tabular-nums text-slate-800">{formatCurrencyString(row.amount, { digits: 0 })}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-primary/80 transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{row.rationale}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-5 space-y-4 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.07] to-white p-5 shadow-sm">
          <ScoreRing score={buyBreakdown.total} />
          <div className="space-y-2">
            <p className="text-center text-xs font-semibold uppercase tracking-wide text-slate-500">Score adjustments</p>
            <AdjustRow label="Liquidity (runway & EF)" value={buyBreakdown.liquidityAdjust} hint="Strong if both ≥3 mo; weak if either &lt;1 mo." />
            <AdjustRow label="Concentration vs cap" value={buyBreakdown.concentrationAdjust} hint="Penalty when largest holding ≥ policy max weight." />
            <AdjustRow label="Sleeve drift pressure" value={buyBreakdown.driftAdjust} hint="+10 when |drift| &gt; 5% (per decisionEngine)." />
          </div>
          <p className="text-[11px] leading-relaxed text-slate-600 border-t border-slate-100 pt-3">
            Buys in <strong>Investments</strong> still pass trading policy gates (runway, monthly cashflow flags, confirmations). This score is a prioritization hint, not approval to trade.
          </p>
        </div>
      </div>
    </div>
  );
}
