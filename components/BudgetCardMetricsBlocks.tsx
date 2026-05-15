import React from 'react';
import BudgetSplitProgressBar from './BudgetSplitProgressBar';
import {
    budgetConsumedSegmentGradient,
    budgetMonthlyConsumedSegmentGradient,
    budgetOverBudgetConsumedGradient,
    budgetRemainingSegmentClasses,
} from '../services/budgetCardVisuals';

const BudgetSpentRemainingLegend: React.FC<{
    spent: number;
    cap: number;
    formatCurrencyString: (amount: number, opts?: { digits?: number }) => string;
    /** Dot + chip styling for “Spent” (matches bar’s consumed segment). */
    spentDotClass: string;
    spentChipClass: string;
}> = ({ spent, cap, formatCurrencyString, spentDotClass, spentChipClass }) => {
    const over = spent > cap;
    const left = Math.max(0, cap - spent);
    return (
        <div
            className="mb-2 flex flex-wrap items-stretch gap-2"
            role="group"
            aria-label="Spent and remaining budget amounts"
        >
            <span
                className={`inline-flex min-h-[2.25rem] items-center gap-2 rounded-xl px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide ring-1 ${spentChipClass}`}
            >
                <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full shadow-sm ring-1 ring-black/10 ${spentDotClass}`}
                    aria-hidden
                />
                <span className="text-slate-800">Spent</span>
                <span className="tabular-nums text-slate-950">{formatCurrencyString(spent, { digits: 0 })}</span>
            </span>
            {over ? (
                <span className="inline-flex min-h-[2.25rem] items-center gap-2 rounded-xl bg-rose-50 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-rose-900 ring-1 ring-rose-300/80">
                    <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-r from-rose-600 to-red-700 shadow-sm ring-1 ring-black/10"
                        aria-hidden
                    />
                    <span>Over</span>
                    <span className="tabular-nums">{formatCurrencyString(spent - cap, { digits: 0 })}</span>
                </span>
            ) : (
                <span className="inline-flex min-h-[2.25rem] items-center gap-2 rounded-xl bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-900 ring-1 ring-emerald-300/80">
                    <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 shadow-sm ring-1 ring-black/10"
                        aria-hidden
                    />
                    <span>Remaining</span>
                    <span className="tabular-nums">{formatCurrencyString(left, { digits: 0 })}</span>
                </span>
            )}
        </div>
    );
};

export type BudgetCardMetricsModel = {
    period?: string;
    spent: number;
    spentYtd?: number;
    displayLimit: number;
    monthlyLimit: number;
    limit?: number;
    percentage: number;
    annualPercentage?: number;
    annualEnvelopeLimit?: number;
    primaryBarValue?: number;
    primaryBarMax?: number;
    secondaryBarValue?: number;
    secondaryBarMax?: number;
    showDualEnvelope?: boolean;
    annualUtilizationLabel?: 'Healthy' | 'Watch' | 'Critical';
    colorClass: string;
    utilizationLabel?: 'Healthy' | 'Watch' | 'Critical';
    trendDelta?: number;
    trendDirection?: 'up' | 'down' | 'flat';
};

const BudgetCardMetricsBlocks: React.FC<{
    budget: BudgetCardMetricsModel;
    budgetView: 'Monthly' | 'Weekly' | 'Daily' | 'Yearly';
    currentYear: number;
    formatCurrencyString: (amount: number, opts?: { digits?: number }) => string;
    showTrendFooter?: boolean;
    /** Active spend window for this view (financial month, week, day, or year). */
    periodWindowLabel?: string;
}> = ({ budget, budgetView, currentYear, formatCurrencyString, showTrendFooter = true, periodWindowLabel }) => {
    const utilLabel = budget.utilizationLabel ?? 'Healthy';
    const annualUtil = budget.annualUtilizationLabel ?? utilLabel;
    const showDual =
        budget.showDualEnvelope ??
        (budgetView === 'Monthly' &&
            (budget.period ?? 'monthly') === 'monthly' &&
            budget.secondaryBarMax != null &&
            budget.secondaryBarValue != null &&
            (budget.annualEnvelopeLimit ?? 0) > 0);
    const secondaryMax = budget.secondaryBarMax ?? budget.monthlyLimit;
    const secondaryVal = budget.secondaryBarValue ?? budget.spent;
    const primaryMax =
        budget.primaryBarMax ?? (budgetView === 'Yearly' ? budget.limit ?? 1 : budget.monthlyLimit) ?? 1;
    const primaryVal = budget.primaryBarValue ?? budget.spent;
    const primaryRem = primaryMax - primaryVal;

    const consumedSegment = (spent: number, cap: number, util: 'Healthy' | 'Watch' | 'Critical', monthlyStyle: boolean) =>
        spent > cap
            ? budgetOverBudgetConsumedGradient()
            : monthlyStyle
              ? budgetMonthlyConsumedSegmentGradient()
              : budgetConsumedSegmentGradient(util);

    const defaultPeriodCap = budgetView === 'Yearly' ? budget.limit ?? 1 : budget.monthlyLimit ?? 1;
    const defaultPeriodSpent = budget.spent;
    const defaultPeriodRem =
        budgetView === 'Yearly' ? (budget.limit ?? 0) - budget.spent : budget.monthlyLimit - budget.spent;

    const periodLimitSuffix =
        budgetView === 'Yearly'
            ? ` (${formatCurrencyString(budget.displayLimit, { digits: 0 })}/yr)`
            : (budget.period ?? 'monthly') === 'yearly'
              ? ` (${formatCurrencyString(budget.displayLimit, { digits: 0 })}/yr)`
              : (budget.period ?? 'monthly') === 'weekly'
                ? ` (${formatCurrencyString(budget.displayLimit, { digits: 0 })}/wk)`
                : (budget.period ?? 'monthly') === 'daily'
                  ? ` (${formatCurrencyString(budget.displayLimit, { digits: 0 })}/day)`
                  : '';

    return (
        <div className="mt-5 flex min-h-0 flex-1 flex-col gap-0">
            <div className="shrink-0 space-y-3">
                {showDual ? (
                    <>
                        <div className="rounded-2xl border-2 border-violet-300/90 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50/80 p-4 shadow-[0_8px_24px_-12px_rgba(109,40,217,0.35)] ring-1 ring-violet-200/60">
                                
                            <div className="flex justify-between items-baseline gap-2 mb-1">
                                <span className="text-[11px] font-extrabold uppercase tracking-wide text-violet-900">This month</span>
                                <span className="text-sm font-bold text-violet-950 tabular-nums">
                                    {formatCurrencyString(secondaryVal, { digits: 0 })} / {formatCurrencyString(secondaryMax, { digits: 0 })}
                                </span>
                            </div>
                            {periodWindowLabel ? (
                                <p className="text-[10px] text-violet-800/75 mb-2 tabular-nums">{periodWindowLabel}</p>
                            ) : null}
                            <BudgetSpentRemainingLegend
                                spent={secondaryVal}
                                cap={secondaryMax}
                                formatCurrencyString={formatCurrencyString}
                                spentDotClass={budgetMonthlyConsumedSegmentGradient()}
                                spentChipClass="bg-violet-100/90 ring-violet-300/80"
                            />
                            <BudgetSplitProgressBar
                                value={secondaryVal}
                                max={secondaryMax}
                                consumedClassName={consumedSegment(secondaryVal, secondaryMax, utilLabel, true)}
                                remainingClassName={budgetRemainingSegmentClasses()}
                                heightClass="h-4"
                            />
                            <p className="mt-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                <span className="text-violet-700">Consumed</span>
                                <span className="mx-1 text-slate-400" aria-hidden>
                                    ·
                                </span>
                                <span className="text-emerald-700">Remaining</span>
                            </p>
                            <p
                                className={`text-right text-sm mt-2 font-semibold tabular-nums ${
                                    secondaryMax - secondaryVal >= 0 ? "text-emerald-700" : "text-rose-600"
                                }`}
                            >
                                {secondaryMax - secondaryVal >= 0
                                    ? `${formatCurrencyString(secondaryMax - secondaryVal, { digits: 0 })} left this month`
                                    : `${formatCurrencyString(Math.abs(secondaryMax - secondaryVal), { digits: 0 })} over this month`}
                            </p>
                            <p className="mt-2 text-center text-xs font-bold uppercase tracking-wider text-violet-800/90 tabular-nums">
                                {Math.round(budget.percentage)}% of monthly plan
                            </p>
                        </div>
                        <div className="rounded-2xl border border-slate-200/90 bg-white/55 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-sm">
                            <div className="flex justify-between items-baseline gap-2 mb-2">
                                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Annual envelope</span>
                                <span className="text-xs font-medium text-slate-600 tabular-nums">
                                    YTD {formatCurrencyString(budget.spentYtd ?? 0, { digits: 0 })} /{" "}
                                    {formatCurrencyString(budget.annualEnvelopeLimit ?? 0, { digits: 0 })}
                                </span>
                            </div>
                            <BudgetSpentRemainingLegend
                                spent={primaryVal}
                                cap={primaryMax}
                                formatCurrencyString={formatCurrencyString}
                                spentDotClass={
                                    annualUtil === 'Critical'
                                        ? 'bg-gradient-to-r from-rose-600 to-red-700'
                                        : 'bg-gradient-to-r from-amber-500 to-orange-600'
                                }
                                spentChipClass={
                                    annualUtil === 'Critical'
                                        ? 'bg-rose-50 ring-rose-200/80'
                                        : 'bg-amber-50 ring-amber-200/90'
                                }
                            />
                            <BudgetSplitProgressBar
                                value={primaryVal}
                                max={primaryMax}
                                consumedClassName={consumedSegment(primaryVal, primaryMax, annualUtil, false)}
                                remainingClassName={budgetRemainingSegmentClasses()}
                                heightClass="h-3"
                            />
                            <p className="mt-1 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                <span className="text-amber-800">YTD consumed</span>
                                <span className="mx-1 text-slate-400" aria-hidden>
                                    ·
                                </span>
                                <span className="text-emerald-700">Annual headroom</span>
                            </p>
                            <p
                                className={`text-right text-xs mt-2 font-medium tabular-nums ${
                                    primaryRem >= 0 ? "text-emerald-700" : "text-rose-600"
                                }`}
                            >
                                {primaryRem >= 0
                                    ? `${formatCurrencyString(primaryRem, { digits: 0 })} left this year`
                                    : `${formatCurrencyString(Math.abs(primaryRem), { digits: 0 })} over annual cap`}
                                {budget.annualPercentage != null ? (
                                    <span className="ml-1 text-slate-400">· {Math.round(budget.annualPercentage)}% YTD</span>
                                ) : null}
                            </p>
                        </div>
                    </>
                ) : budgetView === "Monthly" && (budget.period ?? "monthly") === "yearly" ? (
                    <div className="rounded-2xl border border-slate-200/90 bg-white/60 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-sm">
                        <div className="flex justify-between items-baseline gap-2 mb-2">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Year to date</span>
                            <span className="text-xs font-medium text-slate-600 tabular-nums">
                                {formatCurrencyString(budget.spentYtd ?? budget.spent, { digits: 0 })} /{" "}
                                {formatCurrencyString(budget.displayLimit, { digits: 0 })} / yr
                            </span>
                        </div>
                        <BudgetSpentRemainingLegend
                            spent={primaryVal}
                            cap={Math.max(primaryMax, 1)}
                            formatCurrencyString={formatCurrencyString}
                            spentDotClass={
                                utilLabel === 'Critical'
                                    ? 'bg-gradient-to-r from-rose-600 to-red-700'
                                    : 'bg-gradient-to-r from-amber-500 to-orange-600'
                            }
                            spentChipClass={
                                utilLabel === 'Critical'
                                    ? 'bg-rose-50 ring-rose-200/80'
                                    : 'bg-amber-50 ring-amber-200/90'
                            }
                        />
                        <BudgetSplitProgressBar
                            value={primaryVal}
                            max={Math.max(primaryMax, 1)}
                            consumedClassName={consumedSegment(primaryVal, primaryMax, utilLabel, false)}
                            remainingClassName={budgetRemainingSegmentClasses()}
                            heightClass="h-3.5"
                        />
                        <p className="mt-1 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            <span className="text-teal-700">Consumed (YTD)</span>
                            <span className="mx-1 text-slate-400" aria-hidden>
                                ·
                            </span>
                            <span className="text-emerald-700">Remaining (year)</span>
                        </p>
                        <p
                            className={`text-right text-sm font-semibold mt-2 tabular-nums ${
                                primaryRem >= 0 ? "text-emerald-700" : "text-rose-600"
                            }`}
                        >
                            {primaryRem >= 0
                                ? `${formatCurrencyString(primaryRem, { digits: 0 })} remaining in ${currentYear}`
                                : `${formatCurrencyString(Math.abs(primaryRem), { digits: 0 })} over full-year budget`}
                        </p>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-slate-200/90 bg-white/60 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-sm">
                        <div className="flex justify-between items-baseline gap-2 mb-2">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">This period</span>
                            <span className="text-xs font-medium text-slate-600 tabular-nums">
                                {formatCurrencyString(budget.spent, { digits: 0 })} / {formatCurrencyString(budget.monthlyLimit, { digits: 0 })}
                                {periodLimitSuffix}
                            </span>
                        </div>
                        {periodWindowLabel ? (
                            <p className="text-[10px] text-slate-500 mb-2 tabular-nums">{periodWindowLabel}</p>
                        ) : null}
                        <BudgetSpentRemainingLegend
                            spent={defaultPeriodSpent}
                            cap={defaultPeriodCap}
                            formatCurrencyString={formatCurrencyString}
                            spentDotClass={
                                utilLabel === 'Critical'
                                    ? 'bg-gradient-to-r from-rose-600 to-red-700'
                                    : 'bg-gradient-to-r from-amber-500 to-orange-600'
                            }
                            spentChipClass={
                                utilLabel === 'Critical'
                                    ? 'bg-rose-50 ring-rose-200/80'
                                    : 'bg-amber-50 ring-amber-200/90'
                            }
                        />
                        <BudgetSplitProgressBar
                            value={defaultPeriodSpent}
                            max={defaultPeriodCap}
                            consumedClassName={consumedSegment(defaultPeriodSpent, defaultPeriodCap, utilLabel, false)}
                            remainingClassName={budgetRemainingSegmentClasses()}
                            heightClass="h-3.5"
                        />
                        <p className="mt-1 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            <span className="text-amber-800">Consumed</span>
                            <span className="mx-1 text-slate-400" aria-hidden>
                                ·
                            </span>
                            <span className="text-emerald-700">Remaining</span>
                        </p>
                        <p
                            className={`text-right text-sm font-semibold mt-2 tabular-nums ${
                                defaultPeriodRem >= 0 ? 'text-emerald-700' : 'text-rose-600'
                            }`}
                        >
                            {defaultPeriodRem >= 0
                                ? `${formatCurrencyString(defaultPeriodRem, { digits: 0 })} remaining`
                                : `${formatCurrencyString(Math.abs(defaultPeriodRem), { digits: 0 })} over`}
                        </p>
                    </div>
                )}
            </div>
            {showTrendFooter ? (
                <div className="flex shrink-0 items-center justify-between gap-2 rounded-xl border border-slate-200/70 bg-slate-900/[0.03] px-3 py-2.5 text-[11px] shadow-inner mt-3">
                    <span className="font-medium text-slate-600 tabular-nums">
                        <span className="text-slate-400 font-semibold uppercase tracking-wide mr-1">
                            {showDual ? "This month" : "Plan use"}
                        </span>
                        {budget.percentage.toFixed(0)}%
                    </span>
                    <span
                        className={
                            budget.trendDirection === "up"
                                ? "text-rose-600 font-semibold"
                                : budget.trendDirection === "down"
                                  ? "text-emerald-600 font-semibold"
                                  : "text-slate-400"
                        }
                    >
                        {budget.trendDirection === "up" ? "↑" : budget.trendDirection === "down" ? "↓" : "→"}{" "}
                        {formatCurrencyString(Math.abs(budget.trendDelta ?? 0), { digits: 0 })} vs previous
                    </span>
                </div>
            ) : null}
        </div>
    );
};

export default BudgetCardMetricsBlocks;
