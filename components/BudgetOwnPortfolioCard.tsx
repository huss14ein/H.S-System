import React from 'react';
import type { Budget } from '../types';
import BudgetCardShell from './BudgetCardShell';
import BudgetCardMetricsBlocks, { type BudgetCardMetricsModel } from './BudgetCardMetricsBlocks';
import BudgetUsageDial from './BudgetUsageDial';
import { ChevronRightIcon } from './icons/ChevronRightIcon';
import { PencilIcon } from './icons/PencilIcon';
import { TrashIcon } from './icons/TrashIcon';
import InfoHint from './InfoHint';
import {
    budgetTierBadgeClasses,
    budgetUtilizationBadgeClasses,
    type BudgetTierVisual,
    type BudgetUtilizationLabel,
} from '../services/budgetCardVisuals';

export type OwnPortfolioBudgetRow = Budget &
    BudgetCardMetricsModel & {
        budgetTier?: BudgetTierVisual;
        trendDelta?: number;
        trendDirection?: 'up' | 'down' | 'flat';
    };

export type BudgetOwnPortfolioCardProps = {
    budget: OwnPortfolioBudgetRow;
    budgetView: 'Monthly' | 'Weekly' | 'Daily' | 'Yearly';
    currentYear: number;
    periodWindowLabel?: string;
    expanded: boolean;
    getCategoryHint: (category: string) => string;
    formatCurrencyString: (amount: number, opts?: { digits?: number }) => string;
    onNavigateToTransactions: (budget: OwnPortfolioBudgetRow) => void;
    onToggleExpand: (id: string) => void;
    onEdit: (budget: OwnPortfolioBudgetRow) => void;
    onDelete: (budget: OwnPortfolioBudgetRow) => void;
    canDelete: boolean;
};

const BudgetOwnPortfolioCard: React.FC<BudgetOwnPortfolioCardProps> = React.memo(function BudgetOwnPortfolioCard({
    budget,
    budgetView,
    currentYear,
    periodWindowLabel,
    expanded,
    getCategoryHint,
    formatCurrencyString,
    onNavigateToTransactions,
    onToggleExpand,
    onEdit,
    onDelete,
    canDelete,
}) {
    const utilLabel = (budget.utilizationLabel ?? 'Healthy') as BudgetUtilizationLabel;
    const periodBadge =
        (budget.period ?? 'monthly') === 'yearly'
            ? 'Yearly total'
            : (budget.period ?? 'monthly') === 'weekly'
              ? 'Weekly'
              : (budget.period ?? 'monthly') === 'daily'
                ? 'Daily'
                : 'Monthly';

    return (
        <button
            type="button"
            className={`group flex h-full min-h-0 w-full flex-col text-left rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary/80 transition-shadow duration-200 hover:shadow-md ${expanded ? 'md:col-span-2' : ''}`}
            onClick={() => onNavigateToTransactions(budget)}
        >
            <BudgetCardShell utilizationLabel={utilLabel} budgetTier={budget.budgetTier ?? 'Optional'}>
                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 gap-3 sm:gap-4">
                        <BudgetUsageDial percentage={budget.percentage} utilizationLabel={utilLabel} size={58} />
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-2">
                                <div className="min-w-0">
                                    <h3 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 inline-flex items-center gap-1.5">
                                        {budget.category}
                                        <InfoHint text={getCategoryHint(budget.category)} placement="bottom" />
                                    </h3>
                                    <span className="mt-2 inline-flex items-center rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 shadow-sm backdrop-blur-sm">
                                        {periodBadge}
                                    </span>
                                </div>
                                <div className="flex shrink-0 flex-row flex-wrap items-center justify-end gap-1.5">
                                    <span
                                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${budgetTierBadgeClasses(budget.budgetTier ?? 'Optional')}`}
                                    >
                                        {budget.budgetTier ?? 'Optional'}
                                    </span>
                                    <span
                                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${budgetUtilizationBadgeClasses(utilLabel)}`}
                                    >
                                        {utilLabel}
                                    </span>
                                </div>
                            </div>
                            <p className="mt-2 text-[11px] text-slate-500 leading-snug">
                                Tap to open matching transactions for this view.
                            </p>
                        </div>
                    </div>

                    <BudgetCardMetricsBlocks
                        budget={budget}
                        budgetView={budgetView}
                        currentYear={currentYear}
                        formatCurrencyString={formatCurrencyString}
                        periodWindowLabel={periodWindowLabel}
                    />

                    <div className="min-h-[1px] flex-1" aria-hidden />

                    <div className="mt-auto flex shrink-0 justify-end items-center gap-1 border-t border-slate-200/50 pt-3">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleExpand(budget.id);
                            }}
                            className="p-2 text-slate-400 hover:text-primary rounded-lg hover:bg-white/80"
                            title={expanded ? 'Compact card' : 'Expand card'}
                            aria-label={expanded ? 'Compact card' : 'Expand card'}
                        >
                            <ChevronRightIcon className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                        </button>
                        <button
                            type="button"
                            disabled={budgetView === 'Yearly'}
                            onClick={(e) => {
                                e.stopPropagation();
                                onEdit(budget);
                            }}
                            className="p-2 text-slate-400 hover:text-primary rounded-lg hover:bg-white/80 disabled:opacity-40"
                        >
                            <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            disabled={!canDelete || budgetView === 'Yearly'}
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(budget);
                            }}
                            className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 disabled:opacity-40"
                        >
                            <TrashIcon className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </BudgetCardShell>
        </button>
    );
});

export default BudgetOwnPortfolioCard;
