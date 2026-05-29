import React from 'react';
import CollapsibleSection from '../CollapsibleSection';
import InfoHint from '../InfoHint';
import { SHOCK_TEMPLATES } from '../../services/shockDrillEngine';
import type { attributeNetWorthWithFlows } from '../../services/portfolioAttribution';
import type { computeWealthSummaryReportModel } from '../../services/wealthSummaryReportModel';

type ReportModel = NonNullable<ReturnType<typeof computeWealthSummaryReportModel>>;
type NwAttr = ReturnType<typeof attributeNetWorthWithFlows>;

function householdStressStyles(level: string) {
    const L = (level || '').toLowerCase();
    if (L === 'high') {
        return {
            card: 'border-l-rose-500 bg-rose-50/50',
            pill: 'bg-rose-100 text-rose-900 ring-1 ring-rose-200',
            hint: 'High stress — pause optional spending and shore up cash.',
        };
    }
    if (L === 'medium') {
        return {
            card: 'border-l-amber-500 bg-amber-50/50',
            pill: 'bg-amber-100 text-amber-950 ring-1 ring-amber-200',
            hint: 'Some pressure — keep flexibility and watch large purchases.',
        };
    }
    return {
        card: 'border-l-emerald-500 bg-emerald-50/40',
        pill: 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200',
        hint: 'Comfortable room in the household plan.',
    };
}

function runwayStyles(status: 'comfortable' | 'watch' | 'critical' | undefined) {
    if (status === 'critical') return { card: 'border-l-rose-500 bg-rose-50/50', pill: 'bg-rose-100 text-rose-900' };
    if (status === 'watch') return { card: 'border-l-amber-500 bg-amber-50/50', pill: 'bg-amber-100 text-amber-950' };
    return { card: 'border-l-sky-500 bg-sky-50/40', pill: 'bg-sky-100 text-sky-900' };
}

function disciplineStyles(score: number) {
    if (score >= 75) return { card: 'border-l-emerald-500 bg-emerald-50/40', pill: 'bg-emerald-100 text-emerald-900' };
    if (score >= 45) return { card: 'border-l-amber-500 bg-amber-50/40', pill: 'bg-amber-100 text-amber-950' };
    return { card: 'border-l-rose-500 bg-rose-50/50', pill: 'bg-rose-100 text-rose-900' };
}

export const WealthAnalyticsSummaryPanels: React.FC<{
    reportModel: ReportModel;
    maskBalance: (s: string) => string;
    formatCurrencyString: (n: number, opts?: { digits?: number }) => string;
    nwSnapshotInsight: {
        snaps: { at: string }[];
        attr: NwAttr | null;
    };
    setActivePage?: (page: import('../../types').Page) => void;
    triggerPageAction?: (page: import('../../types').Page, action: string) => void;
}> = ({ reportModel, maskBalance, formatCurrencyString, nwSnapshotInsight, setActivePage, triggerPageAction }) => {
    const { householdStress, riskLane, liquidityRunway, discipline, shockDrill, liquidNw } = reportModel;

    return (
        <>
            <CollapsibleSection
                title="Spendable-style wealth (liquid)"
                summary={maskBalance(formatCurrencyString(liquidNw.liquidNetWorth, { digits: 0 }))}
                defaultExpanded
                className="border border-emerald-100 bg-gradient-to-br from-emerald-50/40 to-white"
            >
                <p className="text-sm text-slate-600 mb-2 max-w-prose">
                    Quick-access wealth: cash, brokerage, Sukuk, commodities, receivables, minus cards and loans. Uses the same SAR/USD rate as Dashboard net worth.
                </p>
                <p className="text-2xl font-extrabold text-emerald-800 mb-4">
                    {maskBalance(formatCurrencyString(liquidNw.liquidNetWorth, { digits: 0 }))}
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-white/80 bg-white/90 p-3 shadow-sm">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">Adds</p>
                        <ul className="space-y-2 text-xs text-slate-700">
                            <li className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                                <span>Cash &amp; brokerage cash</span>
                                <span className="tabular-nums font-medium">
                                    {maskBalance(formatCurrencyString(liquidNw.liquidCash, { digits: 0 }))}
                                </span>
                            </li>
                            <li className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                                <span>Stocks &amp; funds</span>
                                <span className="tabular-nums font-medium">
                                    {maskBalance(formatCurrencyString(liquidNw.portfolioHoldingsSar, { digits: 0 }))}
                                </span>
                            </li>
                            <li className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                                <span>Sukuk</span>
                                <span className="tabular-nums font-medium">
                                    {maskBalance(formatCurrencyString(liquidNw.sukukSar, { digits: 0 }))}
                                </span>
                            </li>
                            <li className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                                <span>Commodities</span>
                                <span className="tabular-nums font-medium">
                                    {maskBalance(formatCurrencyString(liquidNw.commodities, { digits: 0 }))}
                                </span>
                            </li>
                            <li className="flex justify-between gap-2">
                                <span>Receivables</span>
                                <span className="tabular-nums font-medium">
                                    {maskBalance(formatCurrencyString(liquidNw.receivables, { digits: 0 }))}
                                </span>
                            </li>
                        </ul>
                    </div>
                    <div className="rounded-xl border border-white/80 bg-white/90 p-3 shadow-sm">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">Subtracts</p>
                        <ul className="space-y-2 text-xs text-slate-700">
                            <li className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                                <span>Credit cards</span>
                                <span className="tabular-nums font-medium text-rose-800">
                                    −{maskBalance(formatCurrencyString(liquidNw.creditCardDebtSar, { digits: 0 }))}
                                </span>
                            </li>
                            <li className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                                <span>Mortgages &amp; loans</span>
                                <span className="tabular-nums font-medium text-rose-900">
                                    −{maskBalance(formatCurrencyString(liquidNw.loanAndMortgageDebtSar, { digits: 0 }))}
                                </span>
                            </li>
                            <li className="flex justify-between gap-2 pt-1 text-slate-800 font-semibold">
                                <span>Total debt in this view</span>
                                <span className="tabular-nums">
                                    −{maskBalance(formatCurrencyString(liquidNw.shortTermDebt, { digits: 0 }))}
                                </span>
                            </li>
                        </ul>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
                    <span className="rounded-lg bg-slate-100 px-2 py-1">
                        Last ~30 days net in/out: {maskBalance(formatCurrencyString(liquidNw.contributionEstimate30d, { digits: 0 }))}
                    </span>
                    <InfoHint text="Rough cashflow from dated transactions; not a bank statement." hintId="analytics-liquid-flow" hintPage="Wealth Analytics" />
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="Resilience & discipline"
                summary="Household stress, runway, budget discipline"
                defaultExpanded
                className="mb-4 border border-slate-200"
            >
                {householdStress && (() => {
                    const hs = householdStressStyles(householdStress.level);
                    return (
                        <div className={`section-card border-l-4 ${hs.card} mb-4`}>
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                <h3 className="section-title !mb-0">Household cashflow stress</h3>
                                <span className={`text-[11px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${hs.pill}`}>
                                    {householdStress.level}
                                </span>
                            </div>
                            <p className="text-xs text-slate-600 mb-2">{hs.hint}</p>
                            <p className="text-sm text-slate-800 mb-2">{householdStress.summary}</p>
                        </div>
                    );
                })()}
                <div className="cards-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="section-card border-l-4 border-l-violet-500 bg-violet-50/30">
                        <h3 className="section-title mb-1">Investment risk lane</h3>
                        <p className="text-sm text-slate-800">
                            Where you are: <span className="font-semibold">{riskLane.lane}</span>
                        </p>
                        <p className="text-xs text-slate-600 mt-1">
                            Suggested: <span className="font-semibold">{riskLane.suggestedProfile}</span>
                        </p>
                    </div>
                    <div className={`section-card border-l-4 ${liquidityRunway ? runwayStyles(liquidityRunway.status).card : 'border-l-slate-300'}`}>
                        <h3 className="section-title !mb-0">Cash runway</h3>
                        {liquidityRunway ? (
                            <p className="text-lg font-bold text-slate-900 tabular-nums mt-1">
                                {(liquidityRunway.monthsOfRunway ?? 0).toFixed(1)} months
                            </p>
                        ) : (
                            <p className="text-sm text-slate-500 mt-1">Add accounts and expenses to estimate.</p>
                        )}
                    </div>
                    <div className={`section-card border-l-4 ${disciplineStyles(discipline?.score ?? 0).card}`}>
                        <h3 className="section-title mb-1">Budget discipline</h3>
                        <p className="text-lg font-bold text-slate-900">{discipline?.score ?? 0}/100</p>
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="Net worth change vs flows (saved snapshots)"
                summary="Savings vs market moves"
                defaultExpanded={false}
                className="border border-violet-100 bg-violet-50/40"
            >
                {nwSnapshotInsight.attr ? (
                    <>
                        <p className="text-sm text-slate-700 mb-2">
                            Uses your last two net worth snapshots — splits activity from market-style swings (canonical headline NW).
                        </p>
                        <ul className="text-sm text-slate-700 space-y-1 list-disc list-inside">
                            {nwSnapshotInsight.attr.bullets.map((line, i) => (
                                <li key={i}>{line}</li>
                            ))}
                        </ul>
                    </>
                ) : (
                    <p className="text-sm text-slate-600">
                        Open Dashboard on two different days to store snapshots.{' '}
                        {nwSnapshotInsight.snaps.length === 0 && (
                            <span className="block mt-1 text-slate-500">No snapshots yet.</span>
                        )}
                    </p>
                )}
            </CollapsibleSection>

            <CollapsibleSection title="Stress test (shock drill)" summary="Job-loss style scenario" defaultExpanded={false} className="mb-4">
                <p className="text-xs text-slate-500 mb-2">
                    Template: <span className="font-semibold">{SHOCK_TEMPLATES.find((t) => t.id === 'job_loss')?.label}</span>
                </p>
                {shockDrill ? (
                    <>
                        <p className="text-sm text-slate-700">
                            Household year-end delta:{' '}
                            <span className="font-semibold">
                                {formatCurrencyString(shockDrill.householdProjectedYearEndDelta ?? 0, { digits: 0 })}
                            </span>
                        </p>
                        <p className="text-sm text-slate-700 mt-1">
                            Wealth Ultra value delta:{' '}
                            <span className="font-semibold">{(shockDrill.wealthUltraPortfolioValueDeltaPct ?? 0).toFixed(1)}%</span>
                        </p>
                        <p className="text-xs text-slate-600 mt-2">{shockDrill.combinedRiskNote ?? '—'}</p>
                    </>
                ) : (
                    <p className="text-sm text-slate-500">Not enough data to run a drill.</p>
                )}
                {setActivePage && (
                    <button
                        type="button"
                        className="mt-2 text-sm font-medium text-primary hover:underline"
                        onClick={() =>
                            triggerPageAction
                                ? triggerPageAction('Engines & Tools', 'openRiskTradingHub')
                                : setActivePage('Engines & Tools')
                        }
                    >
                        Open safety &amp; rules hub →
                    </button>
                )}
            </CollapsibleSection>
        </>
    );
};
