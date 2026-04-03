import React, { useMemo, useState, useCallback, useContext, useEffect, useRef, lazy, Suspense } from 'react';
import { DataContext } from '../context/DataContext';
import {
    getAIStockAnalysis,
    buildFallbackAnalystReport,
    executeInvestmentPlanStrategy,
    formatAiError,
    getSuggestedAnalystEligibility,
    translateFinancialInsightToArabic,
} from '../services/geminiService';
import { InvestmentPortfolio, Holding, HoldingAssetClass, HOLDING_ASSET_CLASS_OPTIONS, InvestmentTransaction, Account, Goal, InvestmentPlanSettings, TickerStatus, InvestmentPlanExecutionResult, InvestmentPlanExecutionLog, UniverseTicker, TradeCurrency } from '../types';
import type { Page } from '../types';
import Modal from '../components/Modal';
import { ArrowsRightLeftIcon } from '../components/icons/ArrowsRightLeftIcon';
import { BuildingLibraryIcon } from '../components/icons/BuildingLibraryIcon';
import { ScaleIcon } from '../components/icons/ScaleIcon';
import { Squares2X2Icon } from '../components/icons/Squares2X2Icon';
import { EyeIcon } from '../components/icons/EyeIcon';
import AIRebalancerView from './AIRebalancerView';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import WatchlistView from './WatchlistView';
import RecoveryPlanView from './RecoveryPlanView';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { fetchCompanyNameForSymbol, useCompanyNames } from '../hooks/useSymbolCompanyName';
import MiniPriceChart from '../components/charts/MiniPriceChart';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';
import { PlusIcon } from '../components/icons/PlusIcon';
import { ChartPieIcon } from '../components/icons/ChartPieIcon';
import InvestmentOverview from './InvestmentOverview';
import InvestmentPlanView from './InvestmentPlanView';
import { useMarketData } from '../context/MarketDataContext';
import { useCurrency } from '../context/CurrencyContext';
import { useAI } from '../context/AiContext';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import InfoHint from '../components/InfoHint';
import { LinkIcon } from '../components/icons/LinkIcon';
import { ClipboardDocumentListIcon } from '../components/icons/ClipboardDocumentListIcon';
import Card from '../components/Card';
import { getUniverseRowPlanRole } from '../services/universePlanRole';
import CurrencyDualDisplay from '../components/CurrencyDualDisplay';
import SectionCard from '../components/SectionCard';
import AIAdvisor from '../components/AIAdvisor';
import LoadingSpinner from '../components/LoadingSpinner';
import LivePricesStatus from '../components/LivePricesStatus';
import { CurrencyDollarIcon } from '../components/icons/CurrencyDollarIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import type { HoldingFundamentals } from '../services/finnhubService';
import { getHoldingFundamentals } from '../services/finnhubService';
import { dollarToShareQuantity } from '../services/portfolioConstruction';
import { checkExtendedHoursGuardrail, getTIFLabel, getNBBOStub, getSORStub, getVWAPSlices, type TIF } from '../services/tradingExecution';
import { getSettlementDate, isSettled } from '../services/riskCompliance';
import { ClockIcon } from '../components/icons/ClockIcon';
import ExecutionHistoryView from './ExecutionHistoryView';
import { useEmergencyFund } from '../hooks/useEmergencyFund';
import { loadTradingPolicy, evaluateBuyAgainstPolicy } from '../services/tradingPolicy';
import { EXECUTE_PLAN_STORAGE_KEY } from '../content/plainLanguage';
import { sellScore } from '../services/decisionEngine';
import { countsAsIncomeForCashflowKpi, countsAsExpenseForCashflowKpi } from '../services/transactionFilters';
import type { Transaction } from '../types';
import { useSelfLearning } from '../context/SelfLearningContext';
import {
    resolveSarPerUsd,
    toSAR,
    totalLiquidCashSARFromAccounts,
    tradableCashBucketToSAR,
    availableTradableCashInLedgerCurrency,
    inferInstrumentCurrencyFromSymbol,
    convertBetweenTradeCurrencies,
    quoteNotionalInBookCurrency,
    quoteDailyPnLInBookCurrency,
} from '../utils/currencyMath';
import { holdingUsesLiveQuote, HOLDING_PER_UNIT_DECIMALS } from '../utils/holdingValuation';
import { getPersonalAccounts, getPersonalCommodityHoldings, getPersonalInvestments, getPersonalWealthData } from '../utils/wealthScope';
import {
    inferInvestmentTransactionCurrency,
    portfolioBelongsToAccount,
    resolveCanonicalAccountId,
} from '../utils/investmentLedgerCurrency';
import {
    computePersonalCommoditiesContributionSAR,
    computePersonalPlatformsRollupSAR,
    computePlatformCardMetrics,
} from '../services/investmentPlatformCardMetrics';
import { ResolvedSymbolLabel } from '../components/SymbolWithCompanyName';
import { aggregateMonthlyBudgetAcrossPortfolios, getEffectivePlanForPortfolio } from '../utils/investmentPlanPerPortfolio';


const DividendTrackerView = lazy(() => import('./DividendTrackerView'));




type InvestmentSubPage = 'Overview' | 'Portfolios' | 'Investment Plan' | 'Recovery Plan' | 'Watchlist' | 'AI Rebalancer' | 'Dividend Tracker' | 'Execution History';

class InvestmentTabErrorBoundary extends React.Component<
    { activeTab: InvestmentSubPage; onReset: () => void; children: React.ReactNode },
    { hasError: boolean; errorMessage: string | null }
> {
    state = { hasError: false, errorMessage: null as string | null };

    static getDerivedStateFromError(error: unknown) {
        return {
            hasError: true,
            errorMessage: error instanceof Error ? error.message : 'Unexpected rendering error.',
        };
    }

    componentDidUpdate(prevProps: { activeTab: InvestmentSubPage }) {
        if (prevProps.activeTab !== this.props.activeTab && this.state.hasError) {
            this.setState({ hasError: false, errorMessage: null });
        }
    }

    render() {
        if (this.state.hasError) {
            return (
                <SectionCard title="Section temporarily unavailable" className="border-amber-200 bg-amber-50/50" collapsible collapsibleSummary="Error" defaultExpanded>
                    <p className="text-sm text-amber-900">This section failed to render after inactivity. We prevented a full-page crash.</p>
                    {this.state.errorMessage && <p className="text-xs text-amber-700 mt-2">{this.state.errorMessage}</p>}
                    <button
                        type="button"
                        onClick={this.props.onReset}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-secondary text-sm font-medium"
                    >
                        Return to Overview
                    </button>
                </SectionCard>
            );
        }
        return this.props.children;
    }
}

const INVESTMENT_SUB_PAGES: { name: InvestmentSubPage; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
    { name: 'Overview', icon: ChartPieIcon },
    { name: 'Portfolios', icon: Squares2X2Icon },
    { name: 'Investment Plan', icon: ClipboardDocumentListIcon },
    { name: 'Recovery Plan', icon: ArrowsRightLeftIcon },
    { name: 'Dividend Tracker', icon: CurrencyDollarIcon },
    { name: 'AI Rebalancer', icon: ScaleIcon },
    { name: 'Watchlist', icon: EyeIcon },
    { name: 'Execution History', icon: ClockIcon },
];



const PlanSummary: React.FC<{ onEditPlan?: () => void }> = ({ onEditPlan }) => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);

    const investmentProgress = useMemo(() => {
        if (!data?.investmentPlan) {
            return {
                percent: 0,
                amount: 0,
                target: 0,
                corePct: 0.7,
                upsidePct: 0.3,
                specPct: 0,
                planCurrency: 'SAR' as TradeCurrency,
                hasBudgetTarget: false,
                wealthReferenceInPlan: null as number | null,
            };
        }

        const convertAmount = (amount: number, fromCurrency: TradeCurrency, toCurrency: TradeCurrency) => {
            if (!Number.isFinite(amount) || amount <= 0) return 0;
            if (fromCurrency === toCurrency) return amount;
            if (fromCurrency === 'USD' && toCurrency === 'SAR') return amount * sarPerUsd;
            if (fromCurrency === 'SAR' && toCurrency === 'USD') return amount / sarPerUsd;
            return amount;
        };

        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        const plan = data?.investmentPlan;
        const planCurrency: TradeCurrency = (plan?.budgetCurrency as TradeCurrency) || 'SAR';
        const personalAccountIds = new Set(getPersonalAccounts(data).map((a) => a.id));
        const accounts = getPersonalAccounts(data);
        const investments = getPersonalInvestments(data);

        const monthlyInvested = (data?.investmentTransactions ?? [])
            .filter(t => {
                const aid = t.accountId ?? (t as { account_id?: string }).account_id;
                if (!aid || !personalAccountIds.has(aid)) return false;
                const d = new Date(t.date);
                return d.getMonth() === currentMonth && d.getFullYear() === currentYear && t.type === 'buy';
            })
            .reduce((sum, t) => {
                const txCurrency = inferInvestmentTransactionCurrency(t, accounts, investments);
                return sum + convertAmount(t.total || 0, txCurrency, planCurrency);
            }, 0);

        const corePct = plan?.coreAllocation ?? 0.7;
        const upsidePct = plan?.upsideAllocation ?? 0.3;
        const specPct = Math.max(0, 1 - corePct - upsidePct);
        const portfolioIds = investments.map((p) => p.id).filter(Boolean);
        const agg = aggregateMonthlyBudgetAcrossPortfolios(plan, portfolioIds, plan);
        const target = Number.isFinite(agg.total) ? agg.total : 0;
        const hasBudgetTarget = target > 0;
        const wealthRefUsd = Number(data?.wealthUltraConfig?.monthlyDeposit);
        const wealthReferenceInPlan =
            !hasBudgetTarget && Number.isFinite(wealthRefUsd) && wealthRefUsd > 0
                ? convertAmount(wealthRefUsd, 'USD', planCurrency)
                : null;
        return {
            percent: hasBudgetTarget ? Math.min((monthlyInvested / target) * 100, 100) : 0,
            amount: monthlyInvested,
            target,
            corePct,
            upsidePct,
            specPct,
            planCurrency,
            hasBudgetTarget,
            wealthReferenceInPlan,
        };
    }, [data, sarPerUsd]);

    if (!data?.investmentPlan) return null;

    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 mb-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="flex-1">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center space-x-2">
                            <ClipboardDocumentListIcon className="h-5 w-5 text-primary" />
                            <h3 className="text-lg font-bold text-dark">Active Investment Plan</h3>
                        </div>
                        {onEditPlan && (
                            <button type="button" onClick={onEditPlan} className="text-sm font-medium text-primary hover:underline">Edit plan</button>
                        )}
                    </div>
                    {!investmentProgress.hasBudgetTarget && (
                        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-sm text-amber-950">
                            <span className="font-semibold">No monthly investment target saved.</span>{' '}
                            Open <strong>Investment Plan</strong>, enter how much you want to invest <strong>per month</strong>, and save. Until then, the bar below shows <strong>only what you bought this month</strong> (buys on your accounts)—not progress toward a goal.
                            {Number(data?.investmentPlan?.monthlyBudget) === 0 && (
                                <span className="block mt-1 text-xs text-amber-900/90">
                                    Your plan currently has <strong>0</strong> as the monthly amount—raise it if you intend to follow a monthly cap.
                                </span>
                            )}
                            {investmentProgress.wealthReferenceInPlan != null && investmentProgress.wealthReferenceInPlan > 0 && (
                                <span className="block mt-1 text-xs text-amber-900/90">
                                    Reference from Wealth Ultra defaults: ~{formatCurrencyString(investmentProgress.wealthReferenceInPlan, { inCurrency: investmentProgress.planCurrency })} / month (not used until you save a plan budget).
                                </span>
                            )}
                        </div>
                    )}
                    <p className="text-sm text-gray-500 mb-4">
                        {investmentProgress.hasBudgetTarget ? (
                            <>
                                Combined monthly targets across your portfolios:{' '}
                                <span className="font-bold text-dark">{formatCurrencyString(investmentProgress.target, { inCurrency: investmentProgress.planCurrency })}</span>
                                {' '}(sum of per-portfolio budgets in <strong>Investment Plan</strong>). Sleeve mix shown uses your plan defaults: {(investmentProgress.corePct * 100).toFixed(0)}% Core, {(investmentProgress.upsidePct * 100).toFixed(0)}% High-Upside
                                {investmentProgress.specPct > 0.001 ? ` and ${(investmentProgress.specPct * 100).toFixed(0)}% Spec` : ''}. Progress counts <strong>buy</strong> trades this month on <strong>your</strong> investment accounts only (amounts converted with your FX rate).
                            </>
                        ) : (
                            <>
                                Sleeve split is {(investmentProgress.corePct * 100).toFixed(0)}% Core, {(investmentProgress.upsidePct * 100).toFixed(0)}% High-Upside
                                {investmentProgress.specPct > 0.001 ? ` and ${(investmentProgress.specPct * 100).toFixed(0)}% Spec` : ''}. Set a monthly budget to see targets and a progress percentage.
                            </>
                        )}
                    </p>
                    
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-gray-400">
                            <span>Monthly Progress</span>
                            <span>{investmentProgress.hasBudgetTarget ? `${investmentProgress.percent.toFixed(0)}%` : '—'}</span>
                        </div>
                        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-primary transition-all duration-1000 ease-out" 
                                style={{ width: `${investmentProgress.hasBudgetTarget ? investmentProgress.percent : 0}%` }}
                            />
                        </div>
                        <div className="flex justify-between text-xs text-gray-500">
                            <span>
                                Bought this month:{' '}
                                <strong className="text-gray-700">{formatCurrencyString(investmentProgress.amount, { inCurrency: investmentProgress.planCurrency })}</strong>
                                <span className="block text-[10px] font-normal text-gray-400 mt-0.5">Buy trades only, converted to plan currency</span>
                            </span>
                            <span className="text-right">
                                {investmentProgress.hasBudgetTarget ? (
                                    <>
                                        Remaining:{' '}
                                        <strong className="text-gray-700">
                                            {formatCurrencyString(Math.max(0, investmentProgress.target - investmentProgress.amount), { inCurrency: investmentProgress.planCurrency })}
                                        </strong>
                                        {investmentProgress.amount >= investmentProgress.target && investmentProgress.target > 0 && (
                                            <span className="block text-[10px] font-medium text-emerald-700 mt-0.5">Target met for this month</span>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        Remaining: <span className="font-medium text-gray-600">—</span>
                                        <span className="block text-[10px] font-normal text-gray-400 mt-0.5">Set a monthly amount to see what&apos;s left</span>
                                    </>
                                )}
                            </span>
                        </div>
                    </div>
                </div>

                <div className={`grid gap-3 min-w-[240px] ${investmentProgress.specPct > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    <div className="p-3 rounded-xl border border-indigo-100 bg-indigo-50/50 text-center min-w-0 overflow-hidden flex flex-col items-center">
                        <p className="metric-label text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1 w-full">Core Target</p>
                        <p className="metric-value text-sm font-bold text-dark w-full">
                            {investmentProgress.hasBudgetTarget
                                ? formatCurrencyString(investmentProgress.target * investmentProgress.corePct, { inCurrency: investmentProgress.planCurrency })
                                : '—'}
                        </p>
                        <p className="metric-value text-[10px] text-gray-500 w-full">{(investmentProgress.corePct * 100).toFixed(0)}%</p>
                    </div>
                    <div className="p-3 rounded-xl border border-violet-100 bg-violet-50/50 text-center min-w-0 overflow-hidden flex flex-col items-center">
                        <p className="metric-label text-[10px] font-bold text-violet-600 uppercase tracking-wider mb-1 w-full">Upside Target</p>
                        <p className="metric-value text-sm font-bold text-dark w-full">
                            {investmentProgress.hasBudgetTarget
                                ? formatCurrencyString(investmentProgress.target * investmentProgress.upsidePct, { inCurrency: investmentProgress.planCurrency })
                                : '—'}
                        </p>
                        <p className="metric-value text-[10px] text-gray-500 w-full">{(investmentProgress.upsidePct * 100).toFixed(0)}%</p>
                    </div>
                    {investmentProgress.specPct > 0 && (
                        <div className="p-3 rounded-xl border border-amber-100 bg-amber-50/50 text-center min-w-0 overflow-hidden flex flex-col items-center">
                            <p className="metric-label text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-1 w-full">Spec Target</p>
                            <p className="metric-value text-sm font-bold text-dark w-full">
                                {investmentProgress.hasBudgetTarget
                                    ? formatCurrencyString(investmentProgress.target * investmentProgress.specPct, { inCurrency: investmentProgress.planCurrency })
                                    : '—'}
                            </p>
                            <p className="metric-value text-[10px] text-gray-500 w-full">{(investmentProgress.specPct * 100).toFixed(0)}%</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const priorityRank = (p?: Goal['priority']) => (p === 'High' ? 0 : p === 'Medium' ? 1 : p === 'Low' ? 2 : 3);

/** Surfaces savings & life goals from the Goals page (not only retirement) so progress is visible before drilling into tabs. */
const InvestmentGoalsStrip: React.FC<{ onOpenGoals?: () => void }> = ({ onOpenGoals }) => {
    const { data } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);
    const goalCurrentByIdSar = useMemo(() => {
        const map = new Map<string, number>();
        const addToGoal = (goalId: string, valueSar: number) => {
            if (!goalId) return;
            map.set(goalId, (map.get(goalId) ?? 0) + (Number.isFinite(valueSar) ? valueSar : 0));
        };

        const assets = (data as any)?.personalAssets ?? data?.assets ?? [];
        assets.forEach((a: { goalId?: string; value?: number }) => {
            if (!a.goalId) return;
            addToGoal(a.goalId, Number(a.value) || 0);
        });

        const investments = (data as any)?.personalInvestments ?? data?.investments ?? [];
        investments.forEach((p: { goalId?: string; currency?: string; holdings?: { goalId?: string; currentValue?: number }[] }) => {
            const pGoalId = p.goalId ?? '';
            let portfolioResidual = 0;
            (p.holdings ?? []).forEach((h: { goalId?: string; currentValue?: number }) => {
                const valueSar = toSAR(h.currentValue ?? 0, (p.currency ?? 'USD') as 'USD' | 'SAR', sarPerUsd);
                if (h.goalId) addToGoal(h.goalId, valueSar);
                else if (pGoalId) portfolioResidual += valueSar;
            });
            if (pGoalId && portfolioResidual > 0) addToGoal(pGoalId, portfolioResidual);
        });

        return map;
    }, [data?.assets, data?.investments, (data as any)?.personalAssets, (data as any)?.personalInvestments, sarPerUsd]);
    const sortedGoals = useMemo(() => {
        const normalized = (data?.goals ?? [])
            .map((g: any) => ({
                ...g,
                targetResolved: Math.max(0, Number(g?.targetAmount ?? g?.target_amount ?? 0) || 0),
                currentResolved: Math.max(0, Number(goalCurrentByIdSar.get(g.id) ?? 0) || 0),
                deadlineResolved: String(g?.deadline ?? g?.targetDate ?? g?.target_date ?? ''),
            }))
            .filter((g: any) => g.targetResolved > 0);
        return [...normalized].sort((a: any, b: any) => {
            const pr = priorityRank(a.priority) - priorityRank(b.priority);
            if (pr !== 0) return pr;
            const da = new Date(a.deadlineResolved).getTime();
            const db = new Date(b.deadlineResolved).getTime();
            if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
            return (Number(b.targetResolved) || 0) - (Number(a.targetResolved) || 0);
        });
    }, [data?.goals, goalCurrentByIdSar]);
    const displayGoals = sortedGoals.slice(0, 6);

    if (sortedGoals.length === 0) {
        return (
            <SectionCard
                title="Savings & life goals"
                className="mb-6 border-indigo-100 bg-gradient-to-br from-white to-indigo-50/40"
                icon={<ClipboardDocumentListIcon className="h-5 w-5 text-indigo-600" aria-hidden />}
            >
                <p className="text-sm text-slate-600 mb-3">
                    Link investments to what you are saving for. Add goals on the <strong>Goals</strong> page (e.g. retirement, home, education); they will show here with progress.
                </p>
                {onOpenGoals && (
                    <button
                        type="button"
                        onClick={onOpenGoals}
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
                    >
                        Open Goals
                    </button>
                )}
            </SectionCard>
        );
    }

    return (
        <div className="mb-6 rounded-2xl border border-indigo-100 bg-gradient-to-br from-white via-white to-indigo-50/50 shadow-sm overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-indigo-100/80 bg-white/80">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                            <ClipboardDocumentListIcon className="h-5 w-5" aria-hidden />
                        </span>
                        <div>
                            <h3 className="text-lg font-bold text-slate-900">Savings & life goals</h3>
                            <p className="text-sm text-slate-600 mt-0.5">
                                Pulled from your <strong>Goals</strong> page. Amounts are in SAR. Showing up to six goals, ordered by priority then nearest deadline.
                            </p>
                        </div>
                    </div>
                    {onOpenGoals && (
                        <button
                            type="button"
                            onClick={onOpenGoals}
                            className="shrink-0 text-sm font-semibold text-indigo-700 hover:text-indigo-900 hover:underline"
                        >
                            Manage in Goals →
                        </button>
                    )}
                </div>
            </div>
            <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {displayGoals.map((g) => {
                    const target = Math.max(0, Number((g as any).targetResolved) || 0);
                    const current = Math.max(0, Number((g as any).currentResolved) || 0);
                    const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                    const remaining = Math.max(0, target - current);
                    const isRetirement = /retirement|تقاعد|pension|معاش|retire/i.test(g.name || '');
                    const borderAccent = isRetirement ? 'border-l-amber-400' : 'border-l-indigo-400';
                    const badgeBg =
                        g.priority === 'High'
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : g.priority === 'Medium'
                              ? 'bg-amber-50 text-amber-900 border-amber-200'
                              : g.priority === 'Low'
                                ? 'bg-slate-100 text-slate-700 border-slate-200'
                                : 'bg-slate-50 text-slate-600 border-slate-200';
                    return (
                        <div
                            key={g.id}
                            className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm border-l-4 ${borderAccent} flex flex-col min-h-[140px]`}
                        >
                            <div className="flex items-start justify-between gap-2 mb-2">
                                <h4 className="font-semibold text-slate-900 text-sm leading-snug line-clamp-2">{g.name}</h4>
                                {g.priority && (
                                    <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${badgeBg}`}>
                                        {g.priority}
                                    </span>
                                )}
                            </div>
                            <div className="flex justify-between text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                <span>Progress</span>
                                <span className="tabular-nums text-indigo-700">{target > 0 ? `${pct.toFixed(1)}%` : '—'}</span>
                            </div>
                            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden mb-3">
                                <div
                                    className={`h-full rounded-full transition-all duration-700 ${pct >= 100 ? 'bg-emerald-500' : 'bg-indigo-600'}`}
                                    style={{ width: `${target > 0 ? pct : 0}%` }}
                                />
                            </div>
                            <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs mt-auto">
                                <div>
                                    <dt className="text-slate-500">Saved</dt>
                                    <dd className="font-semibold tabular-nums text-slate-900">{formatCurrencyString(current, { inCurrency: 'SAR', digits: 0 })}</dd>
                                </div>
                                <div className="text-right">
                                    <dt className="text-slate-500">Target</dt>
                                    <dd className="font-semibold tabular-nums text-slate-900">{formatCurrencyString(target, { inCurrency: 'SAR', digits: 0 })}</dd>
                                </div>
                                <div>
                                    <dt className="text-slate-500">Left to go</dt>
                                    <dd className="font-semibold tabular-nums text-amber-800">{target > 0 ? formatCurrencyString(remaining, { inCurrency: 'SAR', digits: 0 }) : '—'}</dd>
                                </div>
                                <div className="text-right">
                                    <dt className="text-slate-500">Deadline</dt>
                                    <dd className="font-semibold text-slate-800">{(g as any).deadlineResolved ? new Date((g as any).deadlineResolved).toLocaleDateString() : '—'}</dd>
                                </div>
                            </dl>
                        </div>
                    );
                })}
            </div>
            {sortedGoals.length > 6 && (
                <p className="px-6 pb-4 text-xs text-slate-500">
                    +{sortedGoals.length - 6} more goal{sortedGoals.length - 6 !== 1 ? 's' : ''} on the Goals page.
                </p>
            )}
        </div>
    );
};


const RecordTradeModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (trade: any, executedPlanId?: string) => void;
    investmentAccounts: Account[];
    portfolios: InvestmentPortfolio[];
    /** Simulated/live quote by symbol — used to suggest price when the field is empty. */
    simulatedPrices?: { [symbol: string]: { price: number; change: number; changePercent: number } };
    initialData?: Partial<{
        tradeType: 'buy' | 'sell';
        symbol: string;
        name: string;
        quantity: number;
        amount: number;
        price: number;
        tradeCurrency: TradeCurrency;
        executedPlanId: string;
        accountId: string;
        portfolioId: string;
        reason?: string;
    }> | null;
}> = ({ isOpen, onClose, onSave, investmentAccounts, portfolios, simulatedPrices = {}, initialData }) => {
    const { formatCurrencyString } = useFormatCurrency();
    const { getLearnedDefault, trackFormDefault } = useSelfLearning();
    const { currency: appCurrency, exchangeRate } = useCurrency();
    const [accountId, setAccountId] = useState('');
    const [portfolioId, setPortfolioId] = useState('');
    const [type, setType] = useState<'buy' | 'sell'>('buy');
    const [tradeCurrency, setTradeCurrency] = useState<TradeCurrency>(appCurrency);
    const [symbol, setSymbol] = useState('');
    const [quantity, setQuantity] = useState('');
    const [price, setPrice] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [goalId, setGoalId] = useState<string | undefined>(undefined);
    const [holdingName, setHoldingName] = useState('');
    const [holdingAssetClass, setHoldingAssetClass] = useState<HoldingAssetClass>('Stock');
    /** Mashora, retirement plans, etc. — no live quote; user enters current position value. */
    const [manualValuation, setManualValuation] = useState(false);
    const [manualCurrentValue, setManualCurrentValue] = useState('');
    const [executedPlanId, setExecutedPlanId] = useState<string | undefined>();
    const [amountToInvest, setAmountToInvest] = useState<number | null>(null);
    const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('LIMIT');
    const [tif, setTif] = useState<TIF>('GTC');
    const [t1ConfirmChecked, setT1ConfirmChecked] = useState(false);
    const [policyBuyOverrideAck, setPolicyBuyOverrideAck] = useState(false);
    const [largeSellAck, setLargeSellAck] = useState(false);
    /** Commissions/fees in portfolio base currency (same as quantity × price). Rolled into cash ledger total, not into per-share cost basis. */
    const [fees, setFees] = useState('');
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [companyNameLookupLoading, setCompanyNameLookupLoading] = useState(false);

    const { data, getAvailableCashForAccount } = useContext(DataContext)!;
    const efRunway = useEmergencyFund(data ?? null);
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data ?? null, exchangeRate), [data, exchangeRate]);
    /** Tradable cash on personal investment platforms only (SAR). */
    const liquidCashSARForBuyPolicy = useMemo(() => {
        if (!data) return 0;
        const { personalAccounts } = getPersonalWealthData(data);
        const investmentAccounts = personalAccounts.filter((a: Account) => a.type === 'Investment');
        return totalLiquidCashSARFromAccounts(investmentAccounts, getAvailableCashForAccount, sarPerUsd);
    }, [data, getAvailableCashForAccount, sarPerUsd]);
    const runwayMonthsForBuyPolicy = useMemo(() => {
        const exp = efRunway.monthlyCoreExpenses;
        if (exp > 0) return liquidCashSARForBuyPolicy / exp;
        return liquidCashSARForBuyPolicy > 0 ? 99 : 0;
    }, [liquidCashSARForBuyPolicy, efRunway.monthlyCoreExpenses]);
    const tradingPolicy = useMemo(() => loadTradingPolicy(), [isOpen]);
    const availableGoals = useMemo(() => data?.goals ?? [], [data?.goals]);
    const availableCashByCurrency = useMemo(() => (accountId ? getAvailableCashForAccount(accountId) : { SAR: 0, USD: 0 }), [accountId, getAvailableCashForAccount]);
    const selectedPortfolio = useMemo(
        () => (portfolioId ? portfolios.find(p => p.id === portfolioId) : null),
        [portfolioId, portfolios]
    );
    /** Same pooling as `recordTrade` (SAR+USD at configured SAR/USD). */
    const availableCashInLedgerCurrency = useMemo(
        () => availableTradableCashInLedgerCurrency(availableCashByCurrency, tradeCurrency, sarPerUsd),
        [availableCashByCurrency, tradeCurrency, sarPerUsd]
    );

    const portfoliosForAccount = useMemo(() => accountId ? portfolios.filter(p => p.accountId === accountId) : [], [accountId, portfolios]);
    
    const isNewHolding = useMemo(() => {
        if (type === 'buy' && portfolioId && symbol) {
            const portfolio = portfolios.find(p => p.id === portfolioId);
            return !portfolio?.holdings.some(h => h.symbol.toLowerCase() === symbol.toLowerCase().trim());
        }
        return false;
    }, [type, portfolioId, symbol, portfolios]);

    const existingHoldingForSymbol = useMemo(() => {
        if (!portfolioId || !symbol.trim()) return null;
        const portfolio = portfolios.find((p) => p.id === portfolioId);
        const norm = symbol.toUpperCase().trim();
        return portfolio?.holdings.find((h) => (h.symbol || '').toUpperCase().trim() === norm) ?? null;
    }, [portfolioId, symbol, portfolios]);

    const isManualExisting = existingHoldingForSymbol?.holdingType === 'manual_fund';
    const showManualCurrentValueField = type === 'buy' && ((isNewHolding && manualValuation) || isManualExisting);

    useEffect(() => {
        if (!isNewHolding) setManualValuation(false);
    }, [isNewHolding]);
    
    const resetForm = () => {
        setType('buy'); setSymbol(''); setQuantity(''); setPrice('');
        setDate(new Date().toISOString().split('T')[0]);
        setHoldingName('');
        setHoldingAssetClass('Stock');
        setManualValuation(false);
        setManualCurrentValue('');
        setTradeCurrency(appCurrency);
        setExecutedPlanId(undefined);
        setAmountToInvest(null);
        setFees('');
        setOrderType('LIMIT');
        setTif('GTC');
        setT1ConfirmChecked(false);
        setPolicyBuyOverrideAck(false);
        setLargeSellAck(false);
        setSubmitError(null);
        setIsSubmitting(false);
        setAccountId(investmentAccounts[0]?.id || '');
    };
    
    useEffect(() => {
        if (isOpen) {
            setSubmitError(null);
            setIsSubmitting(false);
            setT1ConfirmChecked(false);
            setPolicyBuyOverrideAck(false);
            setLargeSellAck(false);
            if (initialData) {
                setType(initialData.tradeType || 'buy');
                setSymbol(initialData.symbol || '');
                setHoldingName(initialData.name || '');
                const prefAmount = initialData.amount || null;
                const prefQuantity = initialData.quantity ?? null;
                const prefPrice = initialData.price ?? null;
                const resolvedPrice = prefPrice ?? (prefAmount && prefQuantity && prefQuantity > 0 ? prefAmount / prefQuantity : null);
                const resolvedQuantity = prefQuantity ?? (prefAmount && resolvedPrice && resolvedPrice > 0 ? prefAmount / resolvedPrice : null);
                setQuantity(typeof resolvedQuantity === 'number' && Number.isFinite(resolvedQuantity) ? String(Number(resolvedQuantity.toFixed(8))) : '');
                setPrice(typeof resolvedPrice === 'number' && Number.isFinite(resolvedPrice) ? String(Number(resolvedPrice.toFixed(8))) : '');
                setAmountToInvest(prefAmount);
                setExecutedPlanId(initialData.executedPlanId);
                if (initialData.tradeCurrency) setTradeCurrency(initialData.tradeCurrency);
                if (initialData.accountId) setAccountId(initialData.accountId);
                if (initialData.portfolioId) setPortfolioId(initialData.portfolioId);
                if (initialData.amount && !initialData.quantity && !initialData.price) {
                    setPrice('');
                    setQuantity('');
                }
            } else {
                resetForm();
                const learnedAccount = getLearnedDefault('record-trade', 'accountId') as string | undefined;
                const learnedPortfolio = getLearnedDefault('record-trade', 'portfolioId') as string | undefined;
                const learnedType = getLearnedDefault('record-trade', 'type') as 'buy' | 'sell' | undefined;
                const learnedCurrency = getLearnedDefault('record-trade', 'tradeCurrency') as TradeCurrency | undefined;
                if (learnedAccount && investmentAccounts.some((a) => a.id === learnedAccount)) setAccountId(learnedAccount);
                if (learnedType && ['buy', 'sell'].includes(learnedType)) setType(learnedType as 'buy' | 'sell');
                if (learnedCurrency && (learnedCurrency === 'SAR' || learnedCurrency === 'USD')) setTradeCurrency(learnedCurrency);
                if (learnedPortfolio && portfolios.some((p) => p.id === learnedPortfolio)) setPortfolioId(learnedPortfolio);
            }
        }
    }, [isOpen, initialData, investmentAccounts, portfolios, appCurrency, getLearnedDefault]);

    useEffect(() => {
        if (initialData?.portfolioId && portfoliosForAccount.some((p) => p.id === initialData.portfolioId)) {
            setPortfolioId(initialData.portfolioId);
            return;
        }
        if (portfoliosForAccount.length > 0) {
            const learned = getLearnedDefault('record-trade', 'portfolioId') as string | undefined;
            const validLearned = learned && portfoliosForAccount.some((p) => p.id === learned);
            setPortfolioId(validLearned ? learned : portfoliosForAccount[0].id);
        } else {
            setPortfolioId('');
        }
    }, [portfoliosForAccount, initialData?.portfolioId, getLearnedDefault]);

    useEffect(() => {
        if (portfolioId && portfolios.length > 0) {
            if (initialData?.tradeCurrency) {
                setTradeCurrency(initialData.tradeCurrency);
                return;
            }
            const portfolio = portfolios.find(p => p.id === portfolioId);
            setTradeCurrency((portfolio?.currency as TradeCurrency) || 'USD');
        }
    }, [portfolioId, portfolios, initialData]);

    /** Snapshot of `initialData` when this open started — used so we do not overwrite a plan/deeplink company name until the user changes symbol. */
    const initialDataWhenOpenedRef = useRef<typeof initialData>(null);
    useEffect(() => {
        if (isOpen) initialDataWhenOpenedRef.current = initialData;
        else initialDataWhenOpenedRef.current = null;
    }, [isOpen, initialData]);

    /** Finnhub/static map — same as Watchlist: fill company name after symbol (debounced). */
    useEffect(() => {
        if (!isOpen) return;
        if (type !== 'buy' || !isNewHolding || manualValuation) {
            setCompanyNameLookupLoading(false);
            return;
        }
        const sym = symbol.trim().toUpperCase();
        if (sym.length < 2) {
            setCompanyNameLookupLoading(false);
            return;
        }
        const snap = initialDataWhenOpenedRef.current;
        const snapSym = (snap?.symbol || '').toUpperCase().trim();
        if (snap?.name && snapSym && sym === snapSym) {
            setCompanyNameLookupLoading(false);
            return;
        }
        let cancelled = false;
        setCompanyNameLookupLoading(true);
        const t = setTimeout(() => {
            fetchCompanyNameForSymbol(sym)
                .then((apiName) => {
                    if (cancelled) return;
                    if (apiName) setHoldingName(apiName);
                    setCompanyNameLookupLoading(false);
                })
                .catch(() => {
                    if (!cancelled) setCompanyNameLookupLoading(false);
                });
        }, 450);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [symbol, isOpen, type, isNewHolding, manualValuation]);

    const brokerConstraints = data?.investmentPlan?.brokerConstraints;
    const fractionalOpts = useMemo(
        () => ({
            allowFractional: brokerConstraints?.allowFractionalShares ?? true,
            minimumOrderSize: brokerConstraints?.minimumOrderSize ?? 1,
            roundingRule: brokerConstraints?.roundingRule ?? 'round',
            decimalPlaces: 6,
        }),
        [brokerConstraints?.allowFractionalShares, brokerConstraints?.minimumOrderSize, brokerConstraints?.roundingRule]
    );

    /** Transfer amount ↔ qty/price: skip for manual funds (units are not share-like). */
    const amountDrivesTradeSizing = Boolean(
        amountToInvest && type === 'buy' && !manualValuation && !isManualExisting
    );

    const syncQuantityFromAmountAndPriceStr = useCallback(
        (priceStr: string) => {
            if (!amountDrivesTradeSizing || !amountToInvest) return;
            const numPrice = parseFloat(priceStr);
            if (!Number.isFinite(numPrice) || numPrice <= 0) return;
            const qty = dollarToShareQuantity(amountToInvest, numPrice, fractionalOpts);
            setQuantity(qty.toFixed(6).replace(/\.?0+$/, '') || '0');
        },
        [amountDrivesTradeSizing, amountToInvest, fractionalOpts]
    );

    const syncPriceFromAmountAndQuantityStr = useCallback(
        (quantityStr: string) => {
            if (!amountDrivesTradeSizing || !amountToInvest) return;
            const numQty = parseFloat(quantityStr);
            if (!Number.isFinite(numQty) || numQty <= 0) return;
            const p = amountToInvest / numQty;
            if (!Number.isFinite(p) || p <= 0) return;
            setPrice(p.toFixed(8).replace(/\.?0+$/, '') || '0');
        },
        [amountDrivesTradeSizing, amountToInvest]
    );

    const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setQuantity(v);
        syncPriceFromAmountAndQuantityStr(v);
    };

    const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setPrice(v);
        syncQuantityFromAmountAndPriceStr(v);
    };

    const tradeNotional = useMemo(() => {
        const q = parseFloat(quantity);
        const p = parseFloat(price);
        if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p <= 0) return null;
        return q * p;
    }, [quantity, price]);

    const feeAmount = useMemo(() => {
        const f = parseFloat(fees);
        return Number.isFinite(f) && f >= 0 ? f : 0;
    }, [fees]);

    const netCashImpact = useMemo(() => {
        if (tradeNotional == null) return null;
        if (type === 'buy') return tradeNotional + feeAmount;
        if (type === 'sell') return Math.max(0, tradeNotional - feeAmount);
        return tradeNotional;
    }, [tradeNotional, feeAmount, type]);

    // Suggest price from market when the field is empty — convert quote to portfolio ledger currency.
    useEffect(() => {
        if (!isOpen || manualValuation || isManualExisting) return;
        const sym = symbol.trim().toUpperCase();
        if (sym.length < 2) return;
        if (price.trim() !== '') return;
        const live = simulatedPrices[sym]?.price;
        if (live == null || !Number.isFinite(live) || live <= 0) return;
        const quoteCcy = inferInstrumentCurrencyFromSymbol(sym);
        const inLedger = convertBetweenTradeCurrencies(live, quoteCcy, tradeCurrency, sarPerUsd);
        if (!Number.isFinite(inLedger) || inLedger <= 0) return;
        const pStr = Number(inLedger.toFixed(8)).toString().replace(/\.?0+$/, '') || String(inLedger);
        setPrice(pStr);
        syncQuantityFromAmountAndPriceStr(pStr);
    }, [isOpen, symbol, manualValuation, isManualExisting, price, simulatedPrices, syncQuantityFromAmountAndPriceStr, tradeCurrency, sarPerUsd]);

    // Auto-fill company name when symbol is set (new holding): debounced lookup; refresh when ticker changes
    useEffect(() => {
        if (!isOpen || type !== 'buy' || !isNewHolding || manualValuation) return;
        const sym = symbol.trim().toUpperCase();
        if (sym.length < 2) return;
        let cancelled = false;
        const t = setTimeout(() => {
            fetchCompanyNameForSymbol(sym).then((name) => {
                if (cancelled || !name) return;
                setHoldingName(name);
            });
        }, 500);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [symbol, isOpen, type, isNewHolding, manualValuation]);

    const nbboStub = useMemo(() => {
        if (!symbol.trim()) return null;
        const numPrice = parseFloat(price);
        if (!Number.isFinite(numPrice) || numPrice <= 0) return null;
        return getNBBOStub(symbol.trim().toUpperCase(), numPrice);
    }, [symbol, price]);

    const { t1SettlementWarning } = useMemo(() => {
        const today = new Date().toISOString().slice(0, 10);
        if (type !== 'sell' || !symbol.trim() || !data?.investmentTransactions?.length) {
            return { t1SettlementWarning: null as string | null };
        }
        const normalized = symbol.toUpperCase().trim();
        const recentBuys = (data.investmentTransactions as InvestmentTransaction[])
            .filter(t => t.type === 'buy' && (t.symbol ?? '').toUpperCase().trim() === normalized);
        let pendingBuyAmount = 0;
        let latestSettleDate = '';
        for (const buy of recentBuys) {
            const buyDate = buy.date ? new Date(buy.date) : null;
            if (!buyDate || isNaN(buyDate.getTime())) continue;
            const settleDate = getSettlementDate(buyDate);
            if (settleDate > today) {
                pendingBuyAmount += buy.total ?? 0;
                if (settleDate > latestSettleDate) latestSettleDate = settleDate;
            }
        }
        const settlementState = pendingBuyAmount > 0 ? { pendingBuyAmount, pendingSettleDate: latestSettleDate } : null;
        const unsettled = settlementState && !isSettled(settlementState, today);
        const msg = unsettled
            ? `T+1 settlement: You bought ${normalized} recently. Funds settle ${settlementState!.pendingSettleDate}. Ensure you have other settled cash before selling.`
            : null;
        return { t1SettlementWarning: msg };
    }, [type, symbol, data?.investmentTransactions]);

    const monthlyNetLast30d = useMemo(() => {
        const txs = ((data as any)?.personalTransactions ?? data?.transactions ?? []) as Transaction[];
        const d0 = new Date();
        d0.setDate(d0.getDate() - 30);
        let net = 0;
        txs.forEach((t) => {
            if (new Date(t.date) < d0) return;
            if (countsAsIncomeForCashflowKpi(t)) net += Number(t.amount) || 0;
            if (countsAsExpenseForCashflowKpi(t)) net -= Math.abs(Number(t.amount) || 0);
        });
        return net;
    }, [data, isOpen]);

    const buyPolicyCheck = useMemo(() => {
        if (type !== 'buy' || !portfolioId) return { allowed: true as const };
        const p = portfolios.find((x) => x.id === portfolioId);
        if (!p) return { allowed: true as const };
        const q = parseFloat(quantity);
        const pr = parseFloat(price);
        if (!Number.isFinite(q) || !Number.isFinite(pr) || q <= 0 || pr <= 0) return { allowed: true as const };
        const notional = q * pr;
        const book = ((p.currency as TradeCurrency) || 'USD') as TradeCurrency;
        const effVal = (h: Holding) => {
            const s = (h.symbol || '').toUpperCase().trim();
            const qty = Number(h.quantity ?? 0);
            if (holdingUsesLiveQuote(h) && s) {
                const pi = simulatedPrices[s];
                if (pi && Number.isFinite(pi.price) && qty > 0) {
                    return quoteNotionalInBookCurrency(pi.price, qty, s, book, sarPerUsd);
                }
            }
            return Number.isFinite(h.currentValue) ? Number(h.currentValue) : 0;
        };
        const totalSec = (p.holdings ?? []).reduce((s, h) => s + effVal(h), 0);
        const norm = symbol.toUpperCase().trim();
        const h = p.holdings.find((x) => x.symbol.toUpperCase().trim() === norm);
        const curSym = h ? effVal(h) : 0;
        const afterSym = curSym + notional;
        const denom = totalSec + notional;
        const posPct = denom > 0 ? (afterSym / denom) * 100 : 0;
        return evaluateBuyAgainstPolicy({
            policy: tradingPolicy,
            runwayMonths: runwayMonthsForBuyPolicy,
            monthlyNetLast30d,
            positionWeightAfterBuyPct: posPct,
        });
    }, [type, portfolioId, quantity, price, symbol, portfolios, tradingPolicy, runwayMonthsForBuyPolicy, monthlyNetLast30d, simulatedPrices, sarPerUsd]);

    const sellRuleScore = useMemo(() => {
        if (type !== 'sell' || !portfolioId) return null;
        const p = portfolios.find((x) => x.id === portfolioId);
        if (!p || !symbol.trim()) return null;
        const norm = symbol.toUpperCase().trim();
        const h = p.holdings.find((x) => x.symbol.toUpperCase().trim() === norm);
        if (!h) return null;
        const book = ((p.currency as TradeCurrency) || 'USD') as TradeCurrency;
        const effVal = (x: Holding) => {
            const s = (x.symbol || '').toUpperCase().trim();
            const qty = Number(x.quantity ?? 0);
            if (holdingUsesLiveQuote(x) && s) {
                const pi = simulatedPrices[s];
                if (pi && Number.isFinite(pi.price) && qty > 0) {
                    return quoteNotionalInBookCurrency(pi.price, qty, s, book, sarPerUsd);
                }
            }
            return Number.isFinite(x.currentValue) ? Number(x.currentValue) : 0;
        };
        const totalSec = (p.holdings ?? []).reduce((s, x) => s + effVal(x), 0);
        if (totalSec <= 0) return null;
        const w = (effVal(h) / totalSec) * 100;
        const q = parseFloat(quantity);
        const pr = parseFloat(price);
        const notional = Number.isFinite(q) && Number.isFinite(pr) ? q * pr : 0;
        return {
            ...sellScore({ aboveTargetWeightPct: Math.max(0, w - 15), needCash: w > 20 }),
            notional,
        };
    }, [type, portfolioId, symbol, portfolios, quantity, price, simulatedPrices, sarPerUsd]);

    const largeSellNeedsAck = Boolean(
        type === 'sell' &&
            sellRuleScore &&
            sellRuleScore.notional >= tradingPolicy.requireAckLargeSellNotional
    );

    const sorStub = useMemo(() => {
        if (!symbol.trim()) return null;
        const q = parseFloat(quantity);
        const p = parseFloat(price);
        if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p <= 0) return null;
        const notional = q * p;
        if (notional < 10_000) return null;
        return getSORStub(symbol.trim().toUpperCase(), type === 'buy' ? 'BUY' : 'SELL', q, p);
    }, [symbol, quantity, price, type]);

    const vwapSlices = useMemo(() => {
        
        const q = parseFloat(quantity);
        const p = parseFloat(price);
        const notional = Number.isFinite(p) && p > 0 && Number.isFinite(q) ? q * p : 0;
        if (!Number.isFinite(q) || q <= 0) return null;
        const isLarge = q >= 50 || notional >= 10_000;
        if (!isLarge) return null;
        const n = Math.min(10, Math.max(3, Math.floor(q / 20)));
        return getVWAPSlices(q, n);
    }, [quantity, price]);

    const validationError = useMemo(() => {
        if (!portfolioId) return 'Please select a portfolio.';
        const parsedQuantity = parseFloat(quantity);
        const parsedPrice = parseFloat(price);
        if (!symbol.trim()) return 'Symbol is required.';
        if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) return 'Quantity must be greater than 0.';
        if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) return 'Price must be greater than 0.';
        if (type === 'buy' && isNewHolding && !holdingName.trim()) return 'Company name is required for a new holding.';
        if (type === 'buy' && isNewHolding && manualValuation) {
            const m = parseFloat(manualCurrentValue);
            if (!Number.isFinite(m) || m <= 0) return 'Enter the current position value (manual valuation), e.g. plan balance in ' + tradeCurrency + '.';
        }
        if (type === 'buy' && isManualExisting && manualCurrentValue.trim() !== '') {
            const m = parseFloat(manualCurrentValue);
            if (!Number.isFinite(m) || m <= 0) return 'Current value for this purchase must be a positive number, or leave blank to use the amount invested.';
        }
        if (type === 'sell' && portfolioId) {
            const portfolio = portfolios.find(p => p.id === portfolioId);
            const normalized = symbol.toUpperCase().trim();
            const holding = portfolio?.holdings.find(h => h.symbol.toUpperCase().trim() == normalized);
            if (!holding) return 'Cannot sell: holding not found in selected portfolio.';
            if (holding.quantity < parsedQuantity) return `Cannot sell ${parsedQuantity}. Available quantity is ${holding.quantity}.`;
        }
        const gross = parsedQuantity * parsedPrice;
        if (fees.trim() !== '' && !Number.isFinite(parseFloat(fees))) return 'Fees must be a valid number (or leave blank for zero).';
        if (!Number.isFinite(feeAmount) || feeAmount < 0) return 'Fees must be zero or a positive number.';
        if (type === 'sell' && feeAmount > gross + 1e-9) {
            return `Fees cannot exceed gross proceeds (${formatCurrencyString(gross, { inCurrency: tradeCurrency, digits: 2 })}).`;
        }
        if (type === 'buy') {
            const cashNeeded = gross + feeAmount;
            if (cashNeeded > availableCashInLedgerCurrency + 1e-9) {
                return `Insufficient platform cash in ${tradeCurrency}. Needed ${formatCurrencyString(cashNeeded, { inCurrency: tradeCurrency, digits: 0 })} (gross ${formatCurrencyString(gross, { inCurrency: tradeCurrency, digits: 0 })} + fees), available ${formatCurrencyString(availableCashInLedgerCurrency, { inCurrency: tradeCurrency, digits: 0 })} (SAR ${formatCurrencyString(availableCashByCurrency.SAR, { inCurrency: 'SAR', digits: 0 })} + USD ${formatCurrencyString(availableCashByCurrency.USD, { inCurrency: 'USD', digits: 0 })} pooled at ${sarPerUsd.toFixed(4)} SAR/USD). Transfer funds from Checking/Savings first.`;
            }
        }
        return null;
    }, [portfolioId, quantity, price, symbol, type, isNewHolding, holdingName, manualValuation, manualCurrentValue, isManualExisting, tradeCurrency, portfolios, availableCashInLedgerCurrency, availableCashByCurrency.SAR, availableCashByCurrency.USD, sarPerUsd, formatCurrencyString, feeAmount]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setSubmitError(null);
        if (validationError) {
            setSubmitError(validationError);
            return;
        }
        if (t1SettlementWarning && !t1ConfirmChecked) {
            setSubmitError('Please confirm you have other settled cash (or understand T+1) before selling.');
            return;
        }
        if (type === 'buy' && !buyPolicyCheck.allowed && !policyBuyOverrideAck) {
            setSubmitError(buyPolicyCheck.reason ?? 'Buy blocked by your trading policy. Acknowledge override or adjust the trade.');
            return;
        }
        if (largeSellNeedsAck && !largeSellAck) {
            setSubmitError(`Large sell (≥ ${tradingPolicy.requireAckLargeSellNotional.toLocaleString()}): confirm below.`);
            return;
        }
        if ((type === 'buy' || type === 'sell') && orderType === 'MARKET') {
            const now = new Date();
            const hourET = (now.getUTCHours() - 5 + 24) % 24;
            const minuteET = now.getUTCMinutes();
            const guard = checkExtendedHoursGuardrail({ orderType: 'MARKET', hourET, minuteET });
            if (!guard.allowed) {
                setSubmitError(guard.reason ?? 'Market orders only during 9:30 AM–4:00 PM ET. Switch to Limit or record during regular hours.');
                return;
            }
        }
        try {
            setIsSubmitting(true);
            let manualCvPayload: number | undefined;
            if (type === 'buy' && showManualCurrentValueField) {
                if (isNewHolding && manualValuation) {
                    manualCvPayload = parseFloat(manualCurrentValue);
                } else if (isManualExisting) {
                    const t = manualCurrentValue.trim();
                    if (t !== '') {
                        const p = parseFloat(t);
                        if (Number.isFinite(p) && p > 0) manualCvPayload = p;
                    }
                }
            }
            const useManualFund = type === 'buy' && ((isNewHolding && manualValuation) || isManualExisting);
            await onSave({
                accountId, portfolioId, type,
                symbol: symbol.toUpperCase().trim(),
                name: isNewHolding ? holdingName : undefined,
                quantity: parseFloat(quantity) || 0,
                price: parseFloat(price) || 0,
                date,
                currency: tradeCurrency,
                ...(feeAmount > 0 ? { fees: feeAmount } : {}),
                ...(goalId && { goalId }),
                ...(type === 'buy' && isNewHolding ? { assetClass: holdingAssetClass } : {}),
                ...(useManualFund ? { holdingType: 'manual_fund' } : {}),
                ...(manualCvPayload != null ? { manualCurrentValue: manualCvPayload } : {}),
            }, executedPlanId);
            trackFormDefault('record-trade', 'accountId', accountId);
            trackFormDefault('record-trade', 'portfolioId', portfolioId);
            trackFormDefault('record-trade', 'type', type);
            trackFormDefault('record-trade', 'tradeCurrency', tradeCurrency);
            onClose();
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : String(error));
        } finally {
            setIsSubmitting(false);
        }
    };

    const hasNoAccounts = !investmentAccounts.length;
    const hasNoPortfolios = accountId ? portfoliosForAccount.length === 0 : true;
    const buyPolicyBlocked = type === 'buy' && !buyPolicyCheck.allowed && !policyBuyOverrideAck;
    const sellAckBlocked = type === 'sell' && largeSellNeedsAck && !largeSellAck;
    const submitDisabled = !!validationError || isSubmitting || hasNoPortfolios || buyPolicyBlocked || sellAckBlocked;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Record a Trade">
            {initialData?.reason && (
                <div className="mb-4 p-2 rounded-lg bg-violet-50 border border-violet-200 text-violet-800 text-xs font-medium">From plan execution: {initialData.reason}</div>
            )}
            {hasNoAccounts ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
                    <p className="font-medium">No investment account yet</p>
                    <p className="mt-1">Add an <strong>Investment</strong> account in Accounts, then create a portfolio under Investments. After that you can record trades here.</p>
                </div>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
                 {accountId && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 space-y-1">
                        <p>Available cash in this platform (by currency):</p>
                        <p className="font-medium">SAR: <span className="font-semibold">{formatCurrencyString(availableCashByCurrency.SAR, { inCurrency: 'SAR', digits: 0 })}</span> · USD: <span className="font-semibold">{formatCurrencyString(availableCashByCurrency.USD, { inCurrency: 'USD', digits: 0 })}</span></p>
                        <p className="text-xs text-slate-700 mt-1">
                            Available for trades in <strong>{tradeCurrency}</strong> (ledger):{' '}
                            <span className="font-semibold tabular-nums">{formatCurrencyString(availableCashInLedgerCurrency, { inCurrency: tradeCurrency, digits: 2 })}</span>
                            <span className="text-slate-500"> — uses {sarPerUsd.toFixed(4)} SAR/USD when pooling buckets (same rule as save).</span>
                        </p>
                        {selectedPortfolio && (
                            <p className="text-xs text-slate-600">Quantity and price are in <strong>{selectedPortfolio.currency || 'USD'}</strong> (portfolio base). Buys debit and sells credit the platform cash ledger; SAR and USD balances are pooled at the rate above for limit checks.</p>
                        )}
                    </div>
                 )}
                 {amountToInvest && <div className="p-2 bg-blue-50 text-blue-800 text-sm rounded-md text-center">Funds available from transfer: <span className="font-bold">{amountToInvest.toLocaleString()} {tradeCurrency}</span></div>}
                 {hasNoPortfolios && accountId && (
                    <div className="p-2 bg-amber-50 text-amber-800 text-sm rounded-md">No portfolio in this account. Create a portfolio first from the Investments page.</div>
                 )}
                 {type === 'buy' && !buyPolicyCheck.allowed && buyPolicyCheck.reason && (
                    <div className="p-3 bg-rose-50 border border-rose-200 text-rose-900 text-sm rounded-lg space-y-2">
                        <p className="font-medium">Trading policy</p>
                        <p>{buyPolicyCheck.reason}</p>
                        <label className="flex items-center gap-2 cursor-pointer text-xs">
                            <input type="checkbox" checked={policyBuyOverrideAck} onChange={(e) => setPolicyBuyOverrideAck(e.target.checked)} className="rounded border-rose-300" />
                            I understand and want to record this buy anyway
                        </label>
                    </div>
                 )}
                 {type === 'sell' && sellRuleScore && (
                    <div className="p-3 bg-slate-50 border border-slate-200 text-sm rounded-lg">
                        <span className="font-medium text-slate-800">Sell-score (rules): </span>
                        <span className="font-bold text-violet-700">{sellRuleScore.score}</span>
                        <span className="text-slate-600 text-xs ml-2">({sellRuleScore.reasons.join(', ')})</span>
                    </div>
                 )}
                 {largeSellNeedsAck && (
                    <label className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-sm cursor-pointer">
                        <input type="checkbox" checked={largeSellAck} onChange={(e) => setLargeSellAck(e.target.checked)} />
                        Confirm large sell (notional ≥ policy threshold)
                    </label>
                 )}
                 {t1SettlementWarning && (
                    <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg flex flex-col gap-2">
                        <div className="flex items-start gap-2">
                            <ClockIcon className="h-5 w-5 flex-shrink-0 mt-0.5" aria-hidden />
                            <span>{t1SettlementWarning}</span>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={t1ConfirmChecked} onChange={e => setT1ConfirmChecked(e.target.checked)} className="rounded border-amber-300 text-amber-600 focus:ring-amber-500" />
                            <span className="text-xs">I have other settled cash or understand T+1 settlement</span>
                        </label>
                    </div>
                 )}
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="account-id" className="block text-sm font-medium text-gray-700">Platform</label>
                        <select id="account-id" value={accountId} onChange={e => setAccountId(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
                            <option value="" disabled>Select Platform</option>
                            {investmentAccounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="portfolio-id" className="block text-sm font-medium text-gray-700">Portfolio</label>
                        <select id="portfolio-id" value={portfolioId} onChange={e => setPortfolioId(e.target.value)} required disabled={portfoliosForAccount.length === 0} className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary disabled:bg-gray-100">
                             <option value="" disabled>Select Portfolio</option>
                            {portfoliosForAccount.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <label className="flex items-center"><input type="radio" value="buy" checked={type === 'buy'} onChange={() => setType('buy')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Buy</span></label>
                        <label className="flex items-center"><input type="radio" value="sell" checked={type === 'sell'} onChange={() => setType('sell')} className="form-radio h-4 w-4 text-primary"/> <span className="ml-2">Sell</span></label>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Currency</span>
                        <select
                            value={tradeCurrency}
                            onChange={e => setTradeCurrency(e.target.value as TradeCurrency)}
                            disabled={!!portfolioId}
                            title={portfolioId ? 'Matches the selected portfolio base currency' : 'Select a portfolio to set trade currency'}
                            className="text-sm font-semibold border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-800 focus:ring-2 focus:ring-primary focus:border-primary disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed"
                        >
                            <option value="USD">USD</option>
                            <option value="SAR">SAR</option>
                        </select>
                    </div>
                    {(type === 'buy' || type === 'sell') && (
                        <>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Order type</span>
                                <select value={orderType} onChange={e => setOrderType(e.target.value as 'MARKET' | 'LIMIT')} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-800">
                                    <option value="LIMIT">Limit</option>
                                    <option value="MARKET">Market</option>
                                </select>
                                <InfoHint text="Market orders are only valid 9:30 AM–4:00 PM ET. Limit can be recorded any time." hintId="record-trade-market-order" hintPage="Investments" />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Time-in-Force</span>
                                <select value={tif} onChange={e => setTif(e.target.value as TIF)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-800" title={getTIFLabel(tif)}>
                                    <option value="DAY">Day</option>
                                    <option value="GTC">GTC</option>
                                    <option value="IOC">IOC</option>
                                </select>
                                <InfoHint text={getTIFLabel(tif)} hintId="record-trade-tif" hintPage="Investments" />
                            </div>
                        </>
                    )}
                </div>
                
                <>
                 <div>
                    <label htmlFor="symbol" className="block text-sm font-medium text-gray-700">Symbol</label>
                    <input type="text" id="symbol" value={symbol} onChange={e => setSymbol(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md" placeholder={manualValuation ? 'e.g. MASHORA1 (your unique code for this plan)' : undefined} />
                    {manualValuation && (
                        <p className="mt-1 text-xs text-slate-500">Pick a short unique code you will reuse for buys/sells to this plan (not a stock ticker).</p>
                    )}
                </div>
                {isNewHolding && (
                    <div>
                        <label htmlFor="holdingName" className="flex items-center gap-2 text-sm font-medium text-gray-700">
                            Company Name
                            {companyNameLookupLoading && (
                                <span className="inline-flex h-4 w-4 border-2 border-slate-300 border-t-primary rounded-full animate-spin shrink-0" aria-hidden />
                            )}
                        </label>
                        <input
                            type="text"
                            id="holdingName"
                            value={holdingName}
                            onChange={(e) => setHoldingName(e.target.value)}
                            required
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md"
                            placeholder={companyNameLookupLoading ? 'Looking up…' : 'e.g., Saudi Aramco'}
                        />
                        {!manualValuation && (
                            <p className="mt-1 text-xs text-slate-500">Filled automatically from the symbol when possible (Finnhub or built-in map). You can edit it.</p>
                        )}
                    </div>
                )}
                {type === 'buy' && isNewHolding && (
                    <div>
                        <label htmlFor="trade-asset-class" className="block text-sm font-medium text-gray-700">Asset class</label>
                        <select
                            id="trade-asset-class"
                            value={holdingAssetClass}
                            onChange={(e) => setHoldingAssetClass(e.target.value as HoldingAssetClass)}
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md"
                        >
                            {HOLDING_ASSET_CLASS_OPTIONS.map((ac) => (
                                <option key={ac} value={ac}>
                                    {ac === 'Sukuk' ? 'Sukuk (Islamic fixed income)' : ac}
                                </option>
                            ))}
                        </select>
                        <p className="mt-1 text-xs text-slate-500">Use <strong>Sukuk</strong> for Shariah-compliant fixed-income securities so allocation, AI rebalancer, and benchmarks classify them correctly (not as stocks).</p>
                    </div>
                )}
                {type === 'buy' && isNewHolding && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/90 p-3">
                        <label className="flex items-start gap-2 cursor-pointer text-sm">
                            <input
                                type="checkbox"
                                checked={manualValuation}
                                onChange={(e) => {
                                    setManualValuation(e.target.checked);
                                    if (e.target.checked) setHoldingAssetClass('Other');
                                }}
                                className="mt-0.5 rounded border-slate-300"
                            />
                            <span>
                                <span className="font-medium text-slate-800">Manual valuation (no live market price)</span>
                                <span className="block text-xs text-slate-600 mt-0.5">
                                    Use for Mashora, retirement accounts, and other balances without a listed quote. Enter the current value below; scheduled price updates will not overwrite it.
                                </span>
                            </span>
                        </label>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label htmlFor="quantity" className="block text-sm font-medium text-gray-700">
                            {(isNewHolding && manualValuation) || isManualExisting ? 'Units (use 1 for a single plan/account)' : 'Quantity'}
                        </label>
                        <input type="number" id="quantity" value={quantity} onChange={handleQuantityChange} required min="0" step="any" className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                    </div>
                     <div>
                        <label htmlFor="price" className="block text-sm font-medium text-gray-700">
                            {(isNewHolding && manualValuation) || isManualExisting ? 'Cost per unit' : 'Price per Share'}
                        </label>
                        <input type="number" id="price" value={price} onChange={handlePriceChange} required min="0" step="any" className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                    </div>
                </div>
                <div>
                    <label htmlFor="trade-fees" className="block text-sm font-medium text-gray-700">
                        Fees / commission (optional)
                    </label>
                    <input
                        type="number"
                        id="trade-fees"
                        min="0"
                        step="any"
                        value={fees}
                        onChange={(e) => setFees(e.target.value)}
                        className="mt-1 w-full p-2 border border-gray-300 rounded-md"
                        placeholder="0"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                        In <strong>{tradeCurrency}</strong> (portfolio base). Buys: cash out = gross + fees. Sells: cash in = gross − fees. Per-share cost basis still uses price × quantity only.
                    </p>
                </div>
                {tradeNotional != null && netCashImpact != null && (
                    <div className="text-sm text-slate-600 -mt-1 space-y-1 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
                        <p className="flex flex-wrap items-center gap-1">
                            <span>Gross notional (qty × price):</span>
                            <span className="font-semibold tabular-nums">{formatCurrencyString(tradeNotional, { inCurrency: tradeCurrency, digits: 2 })}</span>
                            <InfoHint
                                text="This is the value of the shares before fees. It is not the same as cash out: on a buy you also pay fees."
                                hintId="record-trade-gross-notional"
                                hintPage="Investments"
                            />
                            {amountDrivesTradeSizing && amountToInvest != null && (
                                <span className="text-slate-500"> (transfer target: {amountToInvest.toLocaleString()} {tradeCurrency})</span>
                            )}
                        </p>
                        {feeAmount > 0 && (
                            <p>
                                Fees: <span className="font-medium tabular-nums">{formatCurrencyString(feeAmount, { inCurrency: tradeCurrency, digits: 2 })}</span>
                            </p>
                        )}
                        <p className="flex flex-wrap items-center gap-1">
                            <span className="font-medium text-slate-800">
                                {type === 'buy' ? 'Net cash out of platform' : 'Net cash into platform'}:
                            </span>
                            <span className="font-semibold tabular-nums">{formatCurrencyString(netCashImpact, { inCurrency: tradeCurrency, digits: 2 })}</span>
                            <InfoHint
                                text={
                                    type === 'buy'
                                        ? 'Buy: you pay the share cost plus fees, so this is what leaves your broker cash balance.'
                                        : 'Sell: you receive share proceeds minus fees, so this is what adds to your broker cash balance.'
                                }
                                hintId="record-trade-net-cash"
                                hintPage="Investments"
                            />
                        </p>
                        <p className="text-xs text-slate-500 tabular-nums">
                            Same amount in the other currency (FX {sarPerUsd.toFixed(4)} SAR/USD):{' '}
                            {tradeCurrency === 'USD'
                                ? formatCurrencyString(convertBetweenTradeCurrencies(netCashImpact, 'USD', 'SAR', sarPerUsd), {
                                      inCurrency: 'SAR',
                                      digits: 2,
                                  })
                                : formatCurrencyString(convertBetweenTradeCurrencies(netCashImpact, 'SAR', 'USD', sarPerUsd), {
                                      inCurrency: 'USD',
                                      digits: 2,
                                  })}
                        </p>
                    </div>
                )}
                {showManualCurrentValueField && (
                    <div>
                        <label htmlFor="manual-current-value" className="block text-sm font-medium text-gray-700">
                            {isManualExisting && !isNewHolding ? 'Current value for this purchase (optional)' : 'Current position value'}
                        </label>
                        <input
                            id="manual-current-value"
                            type="number"
                            min="0"
                            step="any"
                            value={manualCurrentValue}
                            onChange={(e) => setManualCurrentValue(e.target.value)}
                            required={Boolean(isNewHolding && manualValuation)}
                            placeholder={isManualExisting ? 'Leave blank to use amount invested (qty × price)' : ''}
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md"
                        />
                        <p className="mt-1 text-xs text-slate-500">
                            Total value in <strong>{tradeCurrency}</strong> (portfolio base). Quantity × price still records cost basis and platform cash.
                        </p>
                    </div>
                )}
                {nbboStub && (
                    <p className="text-xs text-slate-500">
                        NBBO (sim): bid ${nbboStub.bid.toFixed(2)} / ask ${nbboStub.ask.toFixed(2)} USD
                    </p>
                )}
                {sorStub && (
                    <p className="text-xs text-slate-500">
                        SOR (sim): {sorStub.recommendedVenue ?? '—'} · ~{sorStub.estimatedSlippageBps} bps slippage{sorStub.useLimitOrder ? ' · use limit for large order' : ''}
                    </p>
                )}
                {vwapSlices && vwapSlices.length > 0 && (
                    <p className="text-xs text-slate-500">
                        VWAP (sim): {vwapSlices.length} slices for large order
                    </p>
                )}
                <div>
                    <label htmlFor="trade-goal" className="block text-sm font-medium text-gray-700">Link to Goal (Optional)</label>
                    <select id="trade-goal" value={goalId || ''} onChange={e => setGoalId(e.target.value || undefined)} className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
                        <option value="">None</option>
                        {availableGoals.map(goal => (
                            <option key={goal.id} value={goal.id}>{goal.name}</option>
                        ))}
                    </select>
                </div>
                </>
                <div>
                    <label htmlFor="date" className="block text-sm font-medium text-gray-700">Transaction Date</label>
                    <input type="date" id="date" value={date} onChange={e => setDate(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md" />
                </div>
                {(submitError || validationError) && <p className="text-sm text-danger bg-red-50 border border-red-200 rounded p-2">{submitError || validationError}</p>}
                <button type="submit" disabled={submitDisabled} className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400">{isSubmitting ? 'Recording...' : 'Record Trade'}</button>
            </form>
            )}
        </Modal>
    );
};

// ... other modals ...

// #region Portfolio View Components
const STOCK_ANALYST_LANG_KEY = 'finova_default_ai_lang_v1';

const HoldingDetailModal: React.FC<{ isOpen: boolean; onClose: () => void; holding: (Holding & { gainLoss: number; gainLossPercent: number; priceChangePercent?: number }) | null; portfolio: InvestmentPortfolio | null }> = ({ isOpen, onClose, holding, portfolio }) => {
    const { data } = useContext(DataContext)!;
    const { isAiAvailable, aiHealthChecked, aiActionsEnabled } = useAI();
    const { formatCurrency, formatCurrencyString } = useFormatCurrency();
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [analystAr, setAnalystAr] = useState<string | null>(null);
    const [analystDisplayLang, setAnalystDisplayLang] = useState<'en' | 'ar'>(() => {
        try {
            return typeof localStorage !== 'undefined' && localStorage.getItem(STOCK_ANALYST_LANG_KEY) === 'ar' ? 'ar' : 'en';
        } catch {
            return 'en';
        }
    });
    const [isTranslatingAnalyst, setIsTranslatingAnalyst] = useState(false);
    const [analystTranslateError, setAnalystTranslateError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [aiAnalysisError, setAiAnalysisError] = useState<string | null>(null);
    const [groundingChunks, setGroundingChunks] = useState<any[]>([]);
    const [analystGeneratedAt, setAnalystGeneratedAt] = useState<number | null>(null);
    const [analystSource, setAnalystSource] = useState<'live' | 'fallback' | null>(null);
    const [fundamentals, setFundamentals] = useState<HoldingFundamentals | null>(null);
    const [isFundamentalsLoading, setIsFundamentalsLoading] = useState(false);
    const [fundamentalsError, setFundamentalsError] = useState<string | null>(null);
    const [fundamentalsFetchedAt, setFundamentalsFetchedAt] = useState<number | null>(null);

    const handleGetAIAnalysis = useCallback(async (forceRefresh = false) => {
        if (!holding) return;
        setIsLoading(true);
        setAiAnalysisError(null);
        setAnalystTranslateError(null);
        setAnalystAr(null);
        setGroundingChunks([]);
        try {
            const { content, groundingChunks: chunks } = await getAIStockAnalysis(holding, { forceRefresh });
            const resolvedContent = content || buildFallbackAnalystReport(holding);
            const isFallbackContent = /coverage status|analyst engine note|ai analyst engine was unavailable/i.test(resolvedContent);
            setAiAnalysis(resolvedContent);
            setGroundingChunks(chunks ?? []);
            setAnalystGeneratedAt(Date.now());
            setAnalystSource(isFallbackContent ? 'fallback' : 'live');
        } catch (e) {
            setAiAnalysisError(formatAiError(e));
            setAiAnalysis(buildFallbackAnalystReport(holding));
            setAnalystGeneratedAt(Date.now());
            setAnalystSource('fallback');
        } finally {
            setIsLoading(false);
        }
    }, [holding, analystDisplayLang]);

    useEffect(() => {
        if (analystDisplayLang !== 'ar' || !aiAnalysis.trim() || analystAr != null || !aiActionsEnabled) return;
        let cancelled = false;
        (async () => {
            setIsTranslatingAnalyst(true);
            setAnalystTranslateError(null);
            try {
                const ar = await translateFinancialInsightToArabic(aiAnalysis);
                if (!cancelled) setAnalystAr(ar);
            } catch (e) {
                if (!cancelled) setAnalystTranslateError(formatAiError(e));
            } finally {
                if (!cancelled) setIsTranslatingAnalyst(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [analystDisplayLang, aiAnalysis, analystAr, aiActionsEnabled]);

    useEffect(() => {
        if (holding && isOpen && !aiAnalysis && !isLoading) {
            setAiAnalysis(buildFallbackAnalystReport(holding));
            setAnalystGeneratedAt(Date.now());
            setAnalystSource('fallback');
        }
    }, [holding, isOpen, aiAnalysis, isLoading]);

    const lastAnalystRequestRef = React.useRef<string | null>(null);


    useEffect(() => {
        if (!isOpen) {
            lastAnalystRequestRef.current = null;
            setAnalystGeneratedAt(null);
            setAnalystSource(null);
            setFundamentalsFetchedAt(null);
        }
    }, [isOpen]);

    // When holding identity changes (or is cleared), clear analyst/fundamentals so we don't show previous holding's data
    const holdingKey = holding ? `${holding.id ?? holding.symbol}-${holding.symbol}` : '';
    useEffect(() => {
        setAiAnalysis('');
        setAnalystAr(null);
        setAnalystTranslateError(null);
        setAiAnalysisError(null);
        setGroundingChunks([]);
        setAnalystGeneratedAt(null);
        setAnalystSource(null);
        setFundamentals(null);
        setFundamentalsError(null);
        setFundamentalsFetchedAt(null);
    }, [holdingKey]);

    useEffect(() => {
        if (!holdingKey || !holding || !isOpen) return;
        let cancelled = false;
        setIsFundamentalsLoading(true);
        setFundamentalsError(null);
        getHoldingFundamentals(holding.symbol)
            .then((data) => {
                if (!cancelled) {
                    setFundamentals(data);
                    setFundamentalsFetchedAt(Date.now());
                }
            })
            .catch((e) => {
                if (!cancelled) {
                    setFundamentalsError(e instanceof Error ? e.message : 'Unable to load upcoming events.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsFundamentalsLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [holdingKey, isOpen]);

    if (!holding) return null;

    const portfolioCurrency: TradeCurrency = (portfolio?.currency as TradeCurrency) || 'USD';
    const inferredHoldingCurrency = inferInstrumentCurrencyFromSymbol((holding.symbol || '').trim().toUpperCase());
    const holdingCurrency: TradeCurrency = inferredHoldingCurrency ?? portfolioCurrency;
    const fundamentalsCurrencyRaw = (fundamentals?.currency || '').toUpperCase();
    const fundamentalsCurrency: TradeCurrency =
        fundamentalsCurrencyRaw === 'SAR' ? 'SAR' : 'USD';

    const convertFromPortfolioToHolding = (value: number) =>
        convertBetweenTradeCurrencies(Number(value) || 0, portfolioCurrency, holdingCurrency, sarPerUsd);
    const fmt = (val: number, opts?: { digits?: number }) => formatCurrencyString(val, { inCurrency: holdingCurrency, ...opts });
    const fmtPerUnit = (val: number) => fmt(val, { digits: HOLDING_PER_UNIT_DECIMALS });
    const fmtColor = (val: number, opts?: { digits?: number }) => formatCurrency(val, { inCurrency: holdingCurrency, colorize: false, ...opts });
    const fmtFundamentals = (val: number, opts?: { digits?: number }) =>
        formatCurrencyString(val, { inCurrency: fundamentalsCurrency, ...opts });

    const displayName = holding.name || (holding as any).name || holding.symbol;
    const priceTrendPercent = holding.priceChangePercent ?? holding.gainLossPercent;
    const currentPrice = holding.quantity > 0 ? holding.currentValue / holding.quantity : holding.avgCost ?? 0;
    const currentPriceDisplay = convertFromPortfolioToHolding(currentPrice);
    const marketValueDisplay = convertFromPortfolioToHolding(holding.currentValue);
    const avgCostDisplay = convertFromPortfolioToHolding(holding.avgCost ?? 0);
    const totalCost = (holding.avgCost ?? 0) * holding.quantity;
    const totalCostDisplay = convertFromPortfolioToHolding(totalCost);
    const gainLossDisplay = convertFromPortfolioToHolding(holding.gainLoss);
    const toCurrency = (value: number, to: TradeCurrency) => convertBetweenTradeCurrencies(value, holdingCurrency, to, sarPerUsd);
    const formatSAR = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'SAR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    const formatUSD = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);


    const convertBetweenCurrencies = (value: number, from: TradeCurrency, to: TradeCurrency) => {
        if (!Number.isFinite(value)) return 0;
        if (from === to) return value;
        if (from === 'USD' && to === 'SAR') return value * sarPerUsd;
        if (from === 'SAR' && to === 'USD') return value / sarPerUsd;
        return value;
    };

    const analystGeneratedAgo = (() => {
        if (!analystGeneratedAt) return '';
        const diffMinutes = Math.max(0, Math.round((Date.now() - analystGeneratedAt) / 60000));
        if (diffMinutes < 1) return 'Updated just now';
        if (diffMinutes < 60) return `Updated ${diffMinutes}m ago`;
        const hours = Math.round(diffMinutes / 60);
        return `Updated ${hours}h ago`;
    })();

    const dividendYieldPct = typeof fundamentals?.dividend?.dividendYieldPct === 'number' ? fundamentals.dividend.dividendYieldPct : null;
    const dividendPerShareAnnual = typeof fundamentals?.dividend?.dividendPerShareAnnual === 'number' ? fundamentals.dividend.dividendPerShareAnnual : null;
    const projectedDividendFromPerShare = dividendPerShareAnnual && holding.quantity > 0
        ? convertBetweenCurrencies(dividendPerShareAnnual * holding.quantity, fundamentalsCurrency, holdingCurrency)
        : null;
    const projectedDividendFromYield = dividendYieldPct && dividendYieldPct > 0 && marketValueDisplay > 0
        ? marketValueDisplay * (dividendYieldPct / 100)
        : null;
    const projectedAnnualDividend = (projectedDividendFromPerShare && projectedDividendFromPerShare > 0)
        ? projectedDividendFromPerShare
        : projectedDividendFromYield;
    const hasReliableDividendEstimate = Boolean(projectedAnnualDividend && projectedAnnualDividend > 0 && projectedAnnualDividend < marketValueDisplay * 0.25);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`${holding.symbol} — Share details`} maxWidthClass="max-w-[min(96vw,96rem)]">
            <div className="space-y-6 min-w-0">
                {/* Hero: symbol, name, price, change — centered with stronger hierarchy */}
                <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100/70 px-5 py-6 sm:px-6 sm:py-7 min-w-0 shadow-sm">
                    <div className="flex flex-col items-center justify-center gap-1 text-center min-w-0">
                        <p className="metric-label text-[11px] font-semibold tracking-[0.18em] text-slate-500 uppercase">Share details</p>
                        <p className="metric-label text-2xl font-bold text-slate-900 break-words" title={holding.symbol}>{holding.symbol}</p>
                        <p className="metric-label text-sm sm:text-base text-slate-600 font-medium min-w-0 break-words" title={displayName}>{displayName}</p>
                        {portfolio && <p className="text-xs text-slate-500 mt-1">Portfolio: {portfolio.name ?? '—'}</p>}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
                        <span className="metric-value text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums max-w-full" title={fmtPerUnit(currentPriceDisplay)}>{fmtPerUnit(currentPriceDisplay)}</span>
                        <span className={`metric-value text-lg font-semibold tabular-nums shrink-0 ${priceTrendPercent >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {priceTrendPercent >= 0 ? '+' : ''}{priceTrendPercent.toFixed(2)}%
                        </span>
                        <span className="text-sm text-slate-500 shrink-0">today · per share · {holdingCurrency}</span>
                    </div>
                </div>

                {/* Key metrics grid — in portfolio currency */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 min-w-0">
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 min-w-0 flex flex-col items-start justify-start text-left min-h-[126px]">
                        <p className="share-detail-metric-label w-full text-xs font-semibold text-slate-500 uppercase tracking-wide">Market value</p>
                        <p className="share-detail-metric-value w-full mt-1 text-base sm:text-lg font-bold text-slate-900 tabular-nums !whitespace-normal !overflow-visible !text-clip break-words leading-tight" title={fmt(marketValueDisplay)}>{fmt(marketValueDisplay)}</p>
                        <p className="w-full mt-1 text-[11px] font-medium text-slate-500 tabular-nums leading-tight" title="Total purchased cost (cost basis)">
                            Purchased cost {fmt(totalCostDisplay)}
                        </p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 min-w-0 flex flex-col items-start justify-start text-left min-h-[126px]">
                        <p className="share-detail-metric-label w-full text-xs font-semibold text-slate-500 uppercase tracking-wide">Quantity</p>
                        <p className="metric-value w-full mt-1 text-base sm:text-lg font-bold text-slate-900 tabular-nums break-words leading-tight">{holding.quantity.toLocaleString()}</p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 min-w-0 flex flex-col items-start justify-start text-left min-h-[126px]">
                        <p className="share-detail-metric-label w-full text-xs font-semibold text-slate-500 uppercase tracking-wide">Avg. Cost</p>
                        <p className="share-detail-metric-value w-full mt-1 text-base sm:text-lg font-bold text-slate-900 tabular-nums !whitespace-normal !overflow-visible !text-clip break-words leading-tight" title={fmtPerUnit(avgCostDisplay)}>{fmtPerUnit(avgCostDisplay)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 min-w-0 flex flex-col items-start justify-start text-left min-h-[126px]">
                        <p className="share-detail-metric-label w-full text-xs font-semibold text-slate-500 uppercase tracking-wide">Unrealized G/L</p>
                        <p className={`share-detail-metric-value w-full mt-1 text-base sm:text-lg font-bold tabular-nums !whitespace-normal !overflow-visible !text-clip break-words leading-tight ${holding.gainLoss >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} title={fmt(gainLossDisplay)}>{fmtColor(gainLossDisplay)}</p>
                        <p className="share-detail-metric-value w-full text-xs text-slate-500 mt-0.5 !whitespace-normal !overflow-visible !text-clip break-words leading-tight" title={fmt(totalCostDisplay)}>on cost {fmt(totalCostDisplay)}</p>
                    </div>
                </div>

                {/* Converted value — SAR when portfolio is USD, USD when portfolio is SAR (hint/side) */}
                {holdingCurrency === 'USD' ? (
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 min-w-0 overflow-hidden">
                        <p className="share-detail-metric-label text-xs font-semibold text-emerald-800 uppercase tracking-wide mb-2">≈ In Saudi Riyal (SAR)</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm min-w-0">
                            <div className="min-w-0 overflow-hidden rounded-lg bg-white/60 p-2 flex flex-col items-center text-center">
                                <p className="share-detail-metric-label w-full text-slate-600 text-xs">Market value</p>
                                <p className="share-detail-metric-value w-full font-bold text-slate-900 tabular-nums" title={formatSAR(toCurrency(marketValueDisplay, 'SAR'))}>{formatSAR(toCurrency(marketValueDisplay, 'SAR'))}</p>
                            </div>
                            <div className="min-w-0 overflow-hidden rounded-lg bg-white/60 p-2 flex flex-col items-center text-center">
                                <p className="share-detail-metric-label w-full text-slate-600 text-xs">Cost basis</p>
                                <p className="share-detail-metric-value w-full font-bold text-slate-900 tabular-nums" title={formatSAR(toCurrency(totalCostDisplay, 'SAR'))}>{formatSAR(toCurrency(totalCostDisplay, 'SAR'))}</p>
                            </div>
                            <div className="min-w-0 overflow-hidden rounded-lg bg-white/60 p-2 flex flex-col items-center text-center">
                                <p className="share-detail-metric-label w-full text-slate-600 text-xs">Unrealized G/L</p>
                                <p className={`share-detail-metric-value w-full font-bold tabular-nums ${holding.gainLoss >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} title={formatSAR(toCurrency(gainLossDisplay, 'SAR'))}>{formatSAR(toCurrency(gainLossDisplay, 'SAR'))}</p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 min-w-0 overflow-hidden">
                        <p className="share-detail-metric-label text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">≈ In USD</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm min-w-0">
                            <div className="min-w-0 overflow-hidden rounded-lg bg-white/80 p-2 flex flex-col items-center text-center">
                                <p className="share-detail-metric-label w-full text-slate-600 text-xs">Market value</p>
                                <p className="share-detail-metric-value w-full font-bold text-slate-900 tabular-nums" title={formatUSD(toCurrency(marketValueDisplay, 'USD'))}>{formatUSD(toCurrency(marketValueDisplay, 'USD'))}</p>
                            </div>
                            <div className="min-w-0 overflow-hidden rounded-lg bg-white/80 p-2 flex flex-col items-center text-center">
                                <p className="share-detail-metric-label w-full text-slate-600 text-xs">Cost basis</p>
                                <p className="share-detail-metric-value w-full font-bold text-slate-900 tabular-nums" title={formatUSD(toCurrency(totalCostDisplay, 'USD'))}>{formatUSD(toCurrency(totalCostDisplay, 'USD'))}</p>
                            </div>
                            <div className="min-w-0 overflow-hidden rounded-lg bg-white/80 p-2 flex flex-col items-center text-center">
                                <p className="share-detail-metric-label w-full text-slate-600 text-xs">Unrealized G/L</p>
                                <p className={`share-detail-metric-value w-full font-bold tabular-nums ${holding.gainLoss >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} title={formatUSD(toCurrency(gainLossDisplay, 'USD'))}>{formatUSD(toCurrency(gainLossDisplay, 'USD'))}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Upcoming financials & income */}
                <div className="rounded-xl border border-slate-100 bg-white p-4 min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <p className="text-sm font-semibold text-slate-700 break-words">Next earnings & dividends (market-data estimate)</p>
                        {isFundamentalsLoading && <p className="text-xs text-slate-400">Loading...</p>}
                    </div>
                    {fundamentalsError && (
                        <p className="text-xs text-rose-600 mb-2">Could not load event details right now.</p>
                    )}
                    {!fundamentalsError && fundamentalsFetchedAt && (
                        <p className="text-xs text-slate-500 mb-2">Source: Finnhub market calendar & fundamentals · refreshed {new Date(fundamentalsFetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2 text-sm">
                        <div className="space-y-1">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Next earnings report (estimated)</p>
                            {fundamentals?.nextEarnings?.date ? (
                                <>
                                    <p className="text-slate-800">
                                        {new Date(fundamentals.nextEarnings.date).toLocaleDateString(undefined, {
                                            year: 'numeric',
                                            month: 'short',
                                            day: 'numeric',
                                        })}
                                        {fundamentals.nextEarnings.quarter != null && fundamentals.nextEarnings.year != null && (
                                            <span className="text-xs text-slate-500 ml-1">
                                                · Q{fundamentals.nextEarnings.quarter} {fundamentals.nextEarnings.year}
                                            </span>
                                        )}
                                    </p>
                                    {typeof fundamentals.nextEarnings.revenueEstimate === 'number' && fundamentals.nextEarnings.revenueEstimate > 0 && (
                                        <p className="text-xs text-slate-600">
                                            Revenue estimate ({fundamentalsCurrency}):{' '}
                                            {fmtFundamentals(fundamentals.nextEarnings.revenueEstimate, { digits: 0 })}
                                        </p>
                                    )}
                                </>
                            ) : (
                                <p className="text-xs text-slate-500">No confirmed upcoming earnings date from current market calendar feed.</p>
                            )}
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Dividend snapshot (estimated)</p>
                            {fundamentals?.dividend ? (
                                <>
                                    {typeof fundamentals.dividend.dividendYieldPct === 'number' && fundamentals.dividend.dividendYieldPct > 0 && (
                                        <p className="text-slate-800">
                                            Indicative yield (TTM/forward): {fundamentals.dividend.dividendYieldPct.toFixed(2)}%
                                        </p>
                                    )}
                                    {typeof fundamentals.dividend.dividendPerShareAnnual === 'number' &&
                                        fundamentals.dividend.dividendPerShareAnnual > 0 && (
                                            <p className="text-xs text-slate-600">
                                                Dividend per share (annualized, {fundamentalsCurrency}):{' '}
                                                {fmtFundamentals(fundamentals.dividend.dividendPerShareAnnual, { digits: HOLDING_PER_UNIT_DECIMALS })}
                                            </p>
                                        )}
                                    {hasReliableDividendEstimate && projectedAnnualDividend && (
                                            <p className="text-xs text-slate-600">
                                                Estimated annual dividends on your position ({holdingCurrency}):{' '}
                                                {formatCurrencyString(projectedAnnualDividend, {
                                                    inCurrency: holdingCurrency,
                                                    digits: 0,
                                                })}
                                            </p>
                                        )}
                                    {!hasReliableDividendEstimate && (
                                        <p className="text-xs text-amber-700">Dividend payout estimate is low-confidence right now, so we are not projecting a cash amount.</p>
                                    )}
                                    {!fundamentals.dividend.dividendYieldPct && !fundamentals.dividend.dividendPerShareAnnual && (
                                        <p className="text-xs text-slate-500">No dividend data available.</p>
                                    )}
                                </>
                            ) : (
                                <p className="text-xs text-slate-500">No dividend data available.</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Price trend chart */}
                <div className="rounded-xl border border-slate-100 bg-white p-4 min-w-0 overflow-hidden">
                    <p className="text-sm font-semibold text-slate-700 mb-1 break-words">Price trend (last ~1 month)</p>
                    <p className="text-xs text-slate-500 mb-3">Daily closes when available; otherwise an illustrative trend is shown.</p>
                    <MiniPriceChart
                        symbol={holding.symbol}
                        currentPrice={currentPrice}
                        changePercent={priceTrendPercent}
                        formatPrice={(p) => fmtPerUnit(p)}
                        showIllustrativeLabel
                    />
                </div>

                {/* AI Analyst */}
                <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-amber-50/50 to-white p-5 min-w-0 overflow-hidden">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3 min-w-0">
                        <div className="min-w-0">
                            <h4 className="font-semibold text-slate-800 break-words">Analyst Report</h4>
                            <p className="text-xs text-slate-500 mt-0.5">From your expert investment advisor</p>
                            <p className="text-xs mt-1 text-slate-500">
                                {analystSource === 'live' ? 'Live AI report' : analystSource === 'fallback' ? 'Fallback report' : 'Ready to generate'}{analystGeneratedAgo ? ` · ${analystGeneratedAgo}` : ''}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {aiAnalysis.trim() && !isLoading && (
                                <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAnalystDisplayLang('en');
                                            try {
                                                localStorage.setItem(STOCK_ANALYST_LANG_KEY, 'en');
                                            } catch {
                                                /* ignore */
                                            }
                                        }}
                                        className={`rounded-md px-2.5 py-1.5 ${analystDisplayLang === 'en' ? 'bg-slate-100 text-slate-900' : 'text-slate-600'}`}
                                    >
                                        English
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAnalystAr(null);
                                            setAnalystTranslateError(null);
                                            setAnalystDisplayLang('ar');
                                            try {
                                                localStorage.setItem(STOCK_ANALYST_LANG_KEY, 'ar');
                                            } catch {
                                                /* ignore */
                                            }
                                        }}
                                        className={`rounded-md px-2.5 py-1.5 ${analystDisplayLang === 'ar' ? 'bg-slate-100 text-slate-900' : 'text-slate-600'}`}
                                    >
                                        العربية
                                    </button>
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={() => handleGetAIAnalysis(true)}
                                disabled={isLoading}
                                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-xl hover:bg-secondary disabled:opacity-60 disabled:cursor-not-allowed transition-colors shrink-0"
                            >
                                <SparklesIcon className="h-4 w-4" />
                                {isLoading ? 'Generating...' : 'Refresh AI Report'}
                            </button>
                        </div>
                    </div>
                    {isLoading && <div className="text-center py-8 text-sm text-slate-500">Generating analysis...</div>}
                    {aiAnalysisError && !isLoading && (
                        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-2">AI analyst service is temporarily unavailable ({aiAnalysisError}). We loaded a resilient fallback report below. Use Refresh AI Report to retry live AI analysis.</p>
                    )}
                    {analystTranslateError && (
                        <p className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2 mt-2">{analystTranslateError}</p>
                    )}
                    {isTranslatingAnalyst && analystDisplayLang === 'ar' && (
                        <p className="text-sm text-center text-slate-500 py-2">Translating to Arabic…</p>
                    )}
                    {analystDisplayLang === 'ar' && aiHealthChecked && !isAiAvailable && !analystAr && aiAnalysis.trim() && !isLoading && (
                        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                            Arabic translation needs the AI service. Switch to English or enable AI.
                        </p>
                    )}
                    {aiAnalysis && !isLoading && (
                        <div
                            className="prose prose-sm max-w-none mt-3 text-slate-700 min-w-0 overflow-hidden break-words"
                            dir={analystDisplayLang === 'ar' ? 'rtl' : 'ltr'}
                            lang={analystDisplayLang === 'ar' ? 'ar' : 'en'}
                        >
                            <SafeMarkdownRenderer
                                content={analystDisplayLang === 'ar' ? (analystAr ?? aiAnalysis) : aiAnalysis}
                            />
                        </div>
                    )}
                    {groundingChunks.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-slate-200">
                            <p className="text-xs font-semibold text-slate-600 mb-2">Sources</p>
                            <ul className="text-xs text-slate-500 space-y-1">
                                {groundingChunks.map((chunk, index) => (
                                    chunk.web && (
                                        <li key={index}>
                                            <a href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                                {chunk.web.title || chunk.web.uri}
                                            </a>
                                        </li>
                                    )
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};

const HoldingEditModal: React.FC<{ isOpen: boolean, onClose: () => void, onSave: (holding: Holding) => void, holding: Holding | null }> = ({ isOpen, onClose, onSave, holding }) => {
    const { data } = useContext(DataContext)!;
    const [name, setName] = useState('');
    const [zakahClass, setZakahClass] = useState<'Zakatable' | 'Non-Zakatable'>('Zakatable');
    const [assetClass, setAssetClass] = useState<HoldingAssetClass>('Stock');
    const [goalId, setGoalId] = useState<string | undefined>();
    const [acquisitionDate, setAcquisitionDate] = useState('');
    
    useEffect(() => {
        if (holding) {
            const currentName = holding.name || (holding as any).name || '';
            setName(currentName);
            setZakahClass(holding.zakahClass);
            setAssetClass((holding.assetClass as HoldingAssetClass) || 'Stock');
            setGoalId(holding.goalId);
            setAcquisitionDate(holding.acquisitionDate ?? (holding as { acquisition_date?: string }).acquisition_date ?? '');
            if (!currentName.trim() && holding.symbol.trim().length >= 2) {
                fetchCompanyNameForSymbol(holding.symbol).then((apiName) => {
                    if (apiName) setName(apiName);
                });
            }
        }
    }, [holding, isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (holding) {
            const ad = acquisitionDate.trim();
            onSave({ ...holding, name, zakahClass, assetClass, goalId, acquisitionDate: ad ? ad.slice(0, 10) : undefined });
            onClose();
        }
    };
    if (!holding) return null;
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Edit ${holding.symbol}`}>
             <form onSubmit={handleSubmit} className="space-y-4">
                <div><label className="block text-sm font-medium text-gray-700">Holding Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md"/></div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Asset Class</label>
                    <select value={assetClass} onChange={e => setAssetClass(e.target.value as HoldingAssetClass)} className="mt-1 w-full p-2 border border-gray-300 rounded-md">
                        {HOLDING_ASSET_CLASS_OPTIONS.map((ac) => (
                            <option key={ac} value={ac}>
                                {ac === 'Sukuk' ? 'Sukuk (Islamic fixed income)' : ac}
                            </option>
                        ))}
                    </select>
                </div>
                <div><label className="block text-sm font-medium text-gray-700">Zakat Classification</label><select value={zakahClass} onChange={e => setZakahClass(e.target.value as any)} className="mt-1 w-full p-2 border border-gray-300 rounded-md"><option value="Zakatable">Zakatable</option><option value="Non-Zakatable">Non-Zakatable</option></select></div>
                <div>
                    <label htmlFor="goal-link" className="block text-sm font-medium text-gray-700">Link to Goal</label>
                    <select 
                        id="goal-link"
                        value={goalId || 'none'} 
                        onChange={e => setGoalId(e.target.value === 'none' ? undefined : e.target.value)} 
                        className="mt-1 w-full p-2 border border-gray-300 rounded-md"
                    >
                        <option value="none">-- Not Linked --</option>
                        {(data?.goals ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="holding-acq" className="block text-sm font-medium text-gray-700">Acquisition date (optional)</label>
                    <p className="text-xs text-slate-500 mt-0.5 mb-1">Zakat lunar hawl (~354 days) from this date. If empty, earliest buy in this portfolio is used when available.</p>
                    <input
                        id="holding-acq"
                        type="date"
                        value={acquisitionDate}
                        onChange={(e) => setAcquisitionDate(e.target.value)}
                        className="mt-1 w-full p-2 border border-gray-300 rounded-md"
                    />
                </div>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Changes</button>
            </form>
        </Modal>
    );
};


export const PortfolioModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (p: Omit<InvestmentPortfolio, 'id' | 'user_id' | 'holdings'> | InvestmentPortfolio) => void;
    portfolioToEdit: InvestmentPortfolio | null;
    accountId: string | null;
    investmentAccounts: Account[];
    goals: Goal[];
}> = ({ isOpen, onClose, onSave, portfolioToEdit, accountId, investmentAccounts, goals }) => {
    const [name, setName] = useState('');
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [goalId, setGoalId] = useState<string | undefined>();
    const [currency, setCurrency] = useState<TradeCurrency>('USD');
    const [owner, setOwner] = useState('');

    useEffect(() => {
        if (isOpen) {
            setName(portfolioToEdit?.name || '');
            const fallbackAccountId =
                investmentAccounts.length > 0
                    ? investmentAccounts[investmentAccounts.length - 1]?.id
                    : '';
            setSelectedAccountId(accountId || fallbackAccountId || investmentAccounts[0]?.id || '');
            setGoalId(portfolioToEdit?.goalId);
            setCurrency((portfolioToEdit?.currency as TradeCurrency) || 'USD');
            setOwner(portfolioToEdit?.owner ?? '');
        }
    }, [portfolioToEdit, isOpen, accountId, investmentAccounts]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const ownerVal = owner.trim() || undefined;
            if (portfolioToEdit) {
                await onSave({ ...portfolioToEdit, name, goalId, currency, owner: ownerVal });
            } else {
                if (!selectedAccountId) {
                    alert("Please select an account for the new portfolio.");
                    return;
                }
                await onSave({ name, accountId: selectedAccountId, goalId, currency, owner: ownerVal });
            }
            onClose();
        } catch (error) {
            // Error handled in DataContext
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={portfolioToEdit ? 'Edit Portfolio' : 'Add New Portfolio'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                {!portfolioToEdit && investmentAccounts.length > 0 && (
                    <div>
                        <label htmlFor="portfolio-account-id" className="block text-sm font-medium text-gray-700">Platform / Account</label>
                        <select 
                            id="portfolio-account-id" 
                            value={selectedAccountId} 
                            onChange={e => setSelectedAccountId(e.target.value)} 
                            required 
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary"
                        >
                            {investmentAccounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                        </select>
                    </div>
                )}
                {!portfolioToEdit && investmentAccounts.length === 0 && (
                    <p className="text-sm text-center text-red-600 bg-red-50 p-3 rounded-md">You must have at least one investment account to create a portfolio. Please add one from the 'Accounts' page.</p>
                )}
                <div>
                    <label htmlFor="portfolio-name" className="block text-sm font-medium text-gray-700">Portfolio Name</label>
                    <input type="text" id="portfolio-name" value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md"/>
                </div>
                <div>
                    <label htmlFor="portfolio-currency" className="block text-sm font-medium text-gray-700">Base currency</label>
                    <select id="portfolio-currency" value={currency} onChange={e => setCurrency(e.target.value as TradeCurrency)} className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary">
                        <option value="USD">USD (US market)</option>
                        <option value="SAR">SAR (Tadawul / Saudi)</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">All holdings in this portfolio are shown in this currency. Record trades in the same currency.</p>
                </div>
                <div>
                    <label htmlFor="portfolio-goal-link" className="block text-sm font-medium text-gray-700">Link to Goal</label>
                    <select 
                        id="portfolio-goal-link"
                        value={goalId || 'none'} 
                        onChange={e => setGoalId(e.target.value === 'none' ? undefined : e.target.value)} 
                        className="mt-1 w-full p-2 border border-gray-300 rounded-md"
                    >
                        <option value="none">-- Not Linked --</option>
                        {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    <p className="text-xs text-gray-500 mt-1 italic">Linking a portfolio will associate its total value with the selected goal.</p>
                </div>
                <div>
                    <label htmlFor="portfolio-owner" className="block text-sm font-medium text-gray-700">Owner (optional)</label>
                    <input type="text" id="portfolio-owner" value={owner} onChange={e => setOwner(e.target.value)} placeholder="e.g. Father, Spouse or leave blank for yours" className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-primary focus:border-primary" />
                    <p className="text-xs text-gray-500 mt-1">Leave blank for your own (counts in My net worth). Set for managed wealth (excluded).</p>
                </div>
                <button type="submit" disabled={!portfolioToEdit && investmentAccounts.length === 0} className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400">Save Portfolio</button>
            </form>
        </Modal>
    );
};

// #endregion

// #region Platform View Components

const TransactionHistoryModal: React.FC<{ isOpen: boolean, onClose: () => void, transactions: InvestmentTransaction[], platformName: string }> = ({ isOpen, onClose, transactions, platformName }) => {
    const { formatCurrencyString } = useFormatCurrency();
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Transaction History: ${platformName}`}>
            <div className="max-h-[60vh] overflow-y-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                        <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Amount</th>
                            <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Currency</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {transactions.map(t => {
                            const cur = (t.currency === 'SAR' || t.currency === 'USD' ? t.currency : 'USD') as TradeCurrency;
                            return (
                                <tr key={t.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                                    <td className={`px-4 py-2 whitespace-nowrap text-sm font-medium ${t.type === 'buy' || t.type === 'deposit' ? 'text-green-600' : t.type === 'sell' || t.type === 'withdrawal' ? 'text-red-600' : 'text-blue-600'}`}>{t.type.toUpperCase()}</td>
                                    <td className="px-4 py-2 whitespace-nowrap text-sm font-semibold text-dark">{t.symbol === 'CASH' ? '—' : t.symbol}</td>
                                    <td className="px-4 py-2 whitespace-nowrap text-sm text-center font-bold text-dark">{formatCurrencyString(t.total ?? 0, { inCurrency: cur })}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-center text-xs font-medium text-slate-600">{cur}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </Modal>
    )
}

const PlatformCard: React.FC<{ 
    platform: Account;
    portfolios: InvestmentPortfolio[];
    /** If set, card headline / ROI use only these portfolios (e.g. personal); `portfolios` still drives the holdings tables. */
    metricsPortfolios?: InvestmentPortfolio[];
    transactions: InvestmentTransaction[];
    goals: Goal[];
    sarPerUsd: number;
    availableCashByCurrency?: { SAR: number; USD: number };
    onEditPlatform: (platform: Account) => void;
    onDeletePlatform: (platform: Account) => void;
    onAddPortfolio: (platformId: string) => void;
    onEditPortfolio: (portfolio: InvestmentPortfolio) => void;
    onDeletePortfolio: (portfolio: InvestmentPortfolio) => void;
    onHoldingClick: (holding: Holding & { gainLoss: number; gainLossPercent: number; priceChangePercent?: number; }, portfolio: InvestmentPortfolio) => void;
    onEditHolding: (holding: Holding) => void;
    simulatedPrices: { [symbol: string]: { price: number; change: number; changePercent: number } };
    isExpanded: boolean;
    onToggleExpanded: () => void;
}> = (props) => {
    const { platform, portfolios, metricsPortfolios, transactions, goals, sarPerUsd, availableCashByCurrency = { SAR: 0, USD: 0 }, onEditPlatform, onDeletePlatform, onAddPortfolio, onEditPortfolio, onDeletePortfolio, onHoldingClick, onEditHolding, simulatedPrices, isExpanded, onToggleExpanded } = props;
    const portfoliosForMetrics = metricsPortfolios ?? portfolios;
    const showPersonalScopeNote = portfolios.length > portfoliosForMetrics.length;
    const { formatCurrencyString } = useFormatCurrency();
    const { data: dataCtx } = useContext(DataContext)!;
    const [isTxnModalOpen, setIsTxnModalOpen] = useState(false);
    const investmentsForInfer = useMemo(() => {
        if (!dataCtx) return [] as InvestmentPortfolio[];
        const pi = getPersonalInvestments(dataCtx);
        return pi.length > 0 ? pi : (dataCtx.investments ?? []);
    }, [dataCtx]);

    const platformCurrency = useMemo(() => {
        const currencies = [...new Set(portfoliosForMetrics.map(p => p.currency || 'USD'))];
        return currencies.length === 1 ? (currencies[0] as TradeCurrency) : undefined;
    }, [portfoliosForMetrics]);
    const hasMixedCurrencies = platformCurrency === undefined && portfoliosForMetrics.length > 1;

    const {
        totalValueInSAR,
        totalGainLossSAR,
        dailyPnLSAR,
        totalInvestedSAR,
        totalWithdrawnSAR,
        roi,
    } = useMemo(
        () =>
            computePlatformCardMetrics({
                portfolios: portfoliosForMetrics,
                transactions,
                accounts: dataCtx?.accounts ?? [],
                allInvestments: investmentsForInfer,
                sarPerUsd,
                availableCashByCurrency,
                simulatedPrices,
                platformCurrency,
            }),
        [portfoliosForMetrics, transactions, simulatedPrices, platformCurrency, sarPerUsd, availableCashByCurrency, dataCtx?.accounts, investmentsForInfer],
    );

    const holdingsWithGains = (holdings: Holding[], bookCurrency: TradeCurrency) =>
        holdings
            .map((h) => {
                const qty = Number(h.quantity ?? 0);
                const totalCost = (h.avgCost ?? 0) * qty;
                const sym = (h.symbol || '').trim().toUpperCase();
                let liveValue: number;
                if (holdingUsesLiveQuote(h)) {
                    const priceInfo = simulatedPrices[sym];
                    if (priceInfo && Number.isFinite(priceInfo.price) && qty > 0) {
                        liveValue = quoteNotionalInBookCurrency(priceInfo.price, qty, sym, bookCurrency, sarPerUsd);
                    } else {
                        const currentMktPrice =
                            qty > 0 ? (Number(h.currentValue) || 0) / qty : 0;
                        liveValue = currentMktPrice * qty;
                    }
                } else {
                    liveValue = Number.isFinite(h.currentValue) ? Number(h.currentValue) : 0;
                }
                if (liveValue <= 0 && totalCost > 0) liveValue = totalCost;
                const gainLoss = liveValue - totalCost;
                return { ...h, currentValue: liveValue, totalCost, gainLoss };
            })
            .sort((a, b) => b.currentValue - a.currentValue);
    
    const getGoalName = (goalId?: string) => goalId ? goals.find(g => g.id === goalId)?.name : undefined;

    const symbolsNeedingName = useMemo(() => {
        const set = new Set<string>();
        portfolios.forEach((p) =>
            (p.holdings || []).forEach((h) => {
                const s = (h.symbol || '').trim();
                if (s.length >= 2) set.add(s);
            }),
        );
        return Array.from(set);
    }, [portfolios]);
    const { names: symbolNames } = useCompanyNames(symbolsNeedingName);

    const [portfolioExpanded, setPortfolioExpanded] = useState<Record<string, boolean>>({});
    const sortedPortfolios = useMemo(
        () => [...portfolios].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })),
        [portfolios],
    );
    useEffect(() => {
        if (sortedPortfolios.length === 0) return;
        setPortfolioExpanded((prev) => {
            const next: Record<string, boolean> = {};
            sortedPortfolios.forEach((p, idx) => {
                if (typeof prev[p.id] === 'boolean') next[p.id] = prev[p.id];
                else next[p.id] = idx === 0;
            });
            return next;
        });
    }, [sortedPortfolios]);

    const totalHoldings = portfolios.reduce((sum, p) => sum + (p.holdings?.length ?? 0), 0);
    const metricsHoldingsCount = portfoliosForMetrics.reduce((sum, p) => sum + (p.holdings?.length ?? 0), 0);
    const availableCashSAR = tradableCashBucketToSAR(availableCashByCurrency, sarPerUsd);

    return (
        <article className="platform-card w-full max-w-full bg-white rounded-2xl shadow-md flex flex-col overflow-hidden border border-slate-200 hover:shadow-md transition-shadow duration-300 ease-in-out min-w-0">
            {/* Platform Header — compact, professional */}
            <header className="platform-card-header bg-gradient-to-br from-slate-50 via-white to-slate-50/50 border-b border-slate-200 min-w-0">
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:justify-between sm:items-start">
                    <div className="flex items-start gap-3 min-w-0 flex-1 overflow-hidden">
                        <button
                            type="button"
                            onClick={onToggleExpanded}
                            className="mt-1 shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary transition-colors"
                            aria-expanded={isExpanded}
                            title={isExpanded ? 'Collapse platform' : 'Expand platform'}
                        >
                            <ChevronRightIcon className={`h-5 w-5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </button>
                        <div className="w-1 h-12 rounded-full bg-primary shrink-0" aria-hidden />
                        <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                                <h3 className="text-xl sm:text-2xl font-bold text-slate-800 break-words min-w-0" title={platform.name}>{platform.name}</h3>
                                <span className="flex items-center gap-0.5 shrink-0">
                                    <button type="button" onClick={() => onEditPlatform(platform)} className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-colors" title="Edit platform" aria-label="Edit platform"><PencilIcon className="h-4 w-4" /></button>
                                    <button type="button" onClick={() => onDeletePlatform(platform)} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors" title="Remove platform" aria-label="Remove platform"><TrashIcon className="h-4 w-4" /></button>
                                </span>
                            </div>
                            <div className="text-2xl sm:text-3xl font-bold text-primary mt-1 tabular-nums min-w-0 max-w-full overflow-x-auto">
                                <CurrencyDualDisplay value={totalValueInSAR} inCurrency="SAR" digits={2} size="xl" className="text-primary" />
                            </div>
                            <p className="text-xs text-slate-500 mt-1 font-medium">
                                {hasMixedCurrencies ? 'Mixed SAR/USD portfolios · ' : ''}
                                Totals use each portfolio&apos;s base currency, then your app display currency above.{' '}
                                Contains {portfolios.length} portfolio{portfolios.length !== 1 ? 's' : ''} · {totalHoldings} holding
                                {totalHoldings !== 1 ? 's' : ''}
                                {showPersonalScopeNote ? ` · Headline uses your ${portfoliosForMetrics.length} portfolio${portfoliosForMetrics.length !== 1 ? 's' : ''} (${metricsHoldingsCount} holding${metricsHoldingsCount !== 1 ? 's' : ''})` : ''}
                            </p>
                            {showPersonalScopeNote ? (
                                <p className="text-[11px] text-amber-800 bg-amber-50/90 border border-amber-200/80 rounded-lg px-2 py-1.5 mt-2 leading-snug">
                                    Managed portfolios on this platform are listed below; totals above reflect <strong>your</strong> portfolios and this account&apos;s cash only.
                                </p>
                            ) : null}
                        </div>
                    </div>
                    <button type="button" onClick={() => setIsTxnModalOpen(true)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-primary rounded-xl border-2 border-primary/30 hover:bg-primary/5 shrink-0 w-full sm:w-auto transition-colors">
                        <ArrowsRightLeftIcon className="h-4 w-4" /> Transaction Log
                    </button>
                </div>
                {isExpanded && (
                <dl className="platform-metrics grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5" aria-label="Platform metrics">
                    <div className="rounded-2xl bg-gradient-to-b from-white to-slate-50 border border-slate-200/90 px-4 py-3.5 min-w-0 shadow-sm flex flex-col items-center justify-center text-center min-h-[118px]">
                        <dt
                            className="metric-label w-full text-[11px] font-semibold text-slate-500 uppercase tracking-[0.14em] leading-tight"
                            title="Money sitting on this broker ready to buy investments (SAR and USD buckets; pooled at your FX rate for buying power)."
                        >
                            Available Cash
                        </dt>
                        <dd className="metric-value w-full mt-1.5 flex flex-col items-center justify-center text-base sm:text-lg text-slate-900 tabular-nums leading-tight">
                            {availableCashByCurrency.SAR === 0 && availableCashByCurrency.USD === 0 ? (
                                <span className="text-slate-500">—</span>
                            ) : (
                                <>
                                    <div className="flex justify-center">
                                        <CurrencyDualDisplay value={availableCashSAR} inCurrency="SAR" digits={0} size="lg" weight="bold" />
                                    </div>
                                    <span className="relative mt-1 inline-flex items-center justify-center gap-1 text-[11px] font-medium text-slate-500 group/cash-buckets">
                                        <span>By bucket</span>
                                        <span
                                            role="tooltip"
                                            className="pointer-events-none absolute left-1/2 bottom-full z-30 mb-2 w-max max-w-[min(18rem,90vw)] -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-700 shadow-lg opacity-0 transition-opacity group-hover/cash-buckets:opacity-100"
                                        >
                                            <span className="font-semibold tabular-nums text-slate-900 block">
                                                {formatCurrencyString(availableCashByCurrency.SAR, { inCurrency: 'SAR', digits: 0 })}
                                            </span>
                                            <span className="font-semibold tabular-nums text-slate-900 block mt-1">
                                                {formatCurrencyString(availableCashByCurrency.USD, { inCurrency: 'USD', digits: 0 })}
                                            </span>
                                            <span className="text-[11px] text-slate-500 mt-1.5 block leading-snug">
                                                Actual ledger balances (not FX-converted). Hover the main amount for pooled buying power in SAR with USD equivalent.
                                            </span>
                                        </span>
                                    </span>
                                </>
                            )}
                        </dd>
                    </div>
                    <div className="rounded-2xl bg-gradient-to-b from-white to-slate-50 border border-slate-200/90 px-4 py-3.5 min-w-0 shadow-sm flex flex-col items-center justify-center text-center min-h-[118px]">
                        <dt
                            className="metric-label w-full text-[11px] font-semibold text-slate-500 uppercase tracking-[0.14em] leading-tight"
                            title="Paper profit or loss: current value minus deposits and withdrawals on this platform (not tax until you sell)."
                        >
                            Unrealized P/L
                        </dt>
                        <dd className="metric-value w-full mt-1.5 flex justify-center">
                            <CurrencyDualDisplay value={totalGainLossSAR} inCurrency="SAR" digits={0} size="lg" colorize weight="bold" />
                        </dd>
                    </div>
                    <div className="rounded-2xl bg-gradient-to-b from-white to-slate-50 border border-slate-200/90 px-4 py-3.5 min-w-0 shadow-sm flex flex-col items-center justify-center text-center min-h-[118px]">
                        <dt className="metric-label w-full text-[11px] font-semibold text-slate-500 uppercase tracking-[0.14em] leading-tight">Daily P/L</dt>
                        <dd className="metric-value w-full mt-1.5 flex justify-center">
                            <CurrencyDualDisplay value={dailyPnLSAR} inCurrency="SAR" digits={0} size="lg" colorize weight="bold" />
                        </dd>
                    </div>
                    <div className="rounded-2xl bg-gradient-to-b from-white to-slate-50 border border-slate-200/90 px-4 py-3.5 min-w-0 shadow-sm flex flex-col items-center justify-center text-center min-h-[118px]">
                        <dt
                            className="metric-label w-full text-[11px] font-semibold text-slate-500 uppercase tracking-[0.14em] leading-tight"
                            title="Return on net capital you moved in vs out of this platform, including today’s portfolio value."
                        >
                            ROI
                        </dt>
                        <dd className={`metric-value w-full mt-1.5 font-bold text-lg tabular-nums ${roi >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{roi.toFixed(1)}%</dd>
                    </div>
                    <div className="rounded-2xl bg-gradient-to-b from-white to-slate-50 border border-slate-200/90 px-4 py-3.5 min-w-0 shadow-sm flex flex-col items-center justify-center text-center min-h-[118px]">
                        <dt className="metric-label w-full text-[11px] font-semibold text-slate-500 uppercase tracking-[0.14em] leading-tight">Invested</dt>
                        <dd className="metric-value w-full mt-1.5 flex justify-center text-slate-800">
                            <CurrencyDualDisplay value={totalInvestedSAR} inCurrency="SAR" digits={0} size="lg" weight="bold" />
                        </dd>
                    </div>
                    <div className="rounded-2xl bg-gradient-to-b from-white to-slate-50 border border-slate-200/90 px-4 py-3.5 min-w-0 shadow-sm flex flex-col items-center justify-center text-center min-h-[118px]">
                        <dt className="metric-label w-full text-[11px] font-semibold text-slate-500 uppercase tracking-[0.14em] leading-tight">Withdrawn</dt>
                        <dd className="metric-value w-full mt-1.5 flex justify-center text-slate-800">
                            <CurrencyDualDisplay value={totalWithdrawnSAR} inCurrency="SAR" digits={0} size="lg" weight="bold" />
                        </dd>
                    </div>
                </dl>
                )}
            </header>

            {/* Portfolios & Holdings — compact hierarchy; spacing from design system */}
            {isExpanded && <div className="platform-card-body">
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
                        Portfolios · {portfolios.length}{' '}
                        <span className="text-slate-400 font-normal normal-case tracking-normal">(sorted A–Z)</span>
                    </h4>
                    <button
                        type="button"
                        onClick={() => onAddPortfolio(platform.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary bg-primary/10 rounded-lg hover:bg-primary/15 border border-primary/20 transition-colors"
                    >
                        <PlusIcon className="h-3.5 w-3.5" /> Add portfolio
                    </button>
                </div>
                {portfolios.length === 0 ? (
                    <div className="rounded-xl bg-slate-50/80 border-2 border-dashed border-slate-200 py-8 px-4 text-center">
                        <p className="text-sm text-slate-600">No portfolios in this platform yet.</p>
                        <button
                            type="button"
                            onClick={() => onAddPortfolio(platform.id)}
                            className="mt-3 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-xl hover:bg-primary/90"
                        >
                            <PlusIcon className="h-4 w-4" /> Add portfolio to this platform
                        </button>
                    </div>
                ) : null}
                {sortedPortfolios.map((portfolio) => {
                    const portfolioOpen = portfolioExpanded[portfolio.id] === true;
                    const portfolioCurrency = (portfolio.currency as TradeCurrency) || 'USD';
                    const portfolioHoldings = holdingsWithGains(portfolio.holdings || [], portfolioCurrency);
                    const portfolioValue = portfolioHoldings.reduce((sum, h) => sum + h.currentValue, 0);
                    return (
                        <section key={portfolio.id} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                            {/* Portfolio header: name, value, goal, actions — contained in box */}
                            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 px-4 sm:px-5 py-3 sm:py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 min-w-0">
                                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => setPortfolioExpanded((prev) => ({ ...prev, [portfolio.id]: !prev[portfolio.id] }))}
                                        className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary transition-colors"
                                        aria-expanded={portfolioOpen}
                                        title={portfolioOpen ? 'Hide holdings' : 'Show holdings'}
                                    >
                                        <ChevronRightIcon className={`h-5 w-5 transition-transform ${portfolioOpen ? 'rotate-90' : ''}`} />
                                    </button>
                                    <div className="w-1 h-8 rounded-full bg-primary shrink-0" />
                                    <div className="min-w-0 flex-1 overflow-hidden">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h4 className="font-bold text-slate-800 text-base break-words" title={portfolio.name}>{portfolio.name}</h4>
                                            {portfolio.owner && (
                                                <span className="inline-flex items-center text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5" title="Excluded from My net worth — managed">Managed: {portfolio.owner}</span>
                                            )}
                                        </div>
                                        <div className="text-sm font-semibold text-primary tabular-nums mt-0.5 min-w-0 max-w-full overflow-x-auto">
                                            <CurrencyDualDisplay value={portfolioValue} inCurrency={portfolioCurrency} size="base" className="text-primary" />
                                        </div>
                                        {(portfolio.holdings?.length ?? 0) > 0 && (
                                            <p className="text-xs text-slate-500 mt-0.5">{(portfolio.holdings?.length ?? 0)} holding{(portfolio.holdings?.length ?? 0) !== 1 ? 's' : ''}</p>
                                        )}
                                    </div>
                                    {portfolio.goalId && (
                                        <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100 shrink-0" title={`Linked to: ${getGoalName(portfolio.goalId)}`}>
                                            <LinkIcon className="h-3.5 w-3.5" />
                                            {getGoalName(portfolio.goalId)}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button type="button" onClick={() => onEditPortfolio(portfolio)} className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-colors" title="Edit portfolio" aria-label="Edit portfolio"><PencilIcon className="h-4 w-4"/></button>
                                    <button type="button" onClick={() => onDeletePortfolio(portfolio)} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors" title="Remove portfolio" aria-label="Remove portfolio"><TrashIcon className="h-4 w-4"/></button>
                                </div>
                            </div>
                            {/* Holdings — expand portfolio row to view */}
                            {portfolioOpen && (
                            <div className="overflow-x-auto max-h-96 overflow-y-auto">
                                {portfolioHoldings.length === 0 ? (
                                    <div className="px-5 py-8 text-center text-sm text-slate-500 rounded-b-2xl bg-slate-50/30">No holdings yet. Record a buy from <strong>Record Trade</strong> or the Transaction Log.</div>
                                ) : (
                                    <>
                                        <table className="w-full min-w-[640px] border-collapse table-auto" aria-label={`Holdings for ${portfolio.name}`}>
                                            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                                                <tr className="text-left">
                                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Share</th>
                                                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right w-20">Alloc.</th>
                                                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Qty</th>
                                                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center whitespace-nowrap">Avg cost</th>
                                                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">
                                                        <span className="block leading-tight">Current</span>
                                                        <span className="block text-[10px] font-normal normal-case text-slate-400 tracking-normal mt-0.5">Purchased cost</span>
                                                    </th>
                                                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">P/L</th>
                                                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Today</th>
                                                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center w-20">Zakat</th>
                                                    <th className="w-9" aria-label="Actions" />
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {portfolioHoldings.map(h => {
                                                    const hSym = (h.symbol || '').trim().toUpperCase();
                                                    const allocationPct = portfolioValue > 0 ? (h.currentValue / portfolioValue) * 100 : 0;
                                                    const inferredHoldingCurrency = inferInstrumentCurrencyFromSymbol(hSym || h.symbol || '');
                                                    const holdingDisplayCurrency: TradeCurrency = inferredHoldingCurrency ?? portfolioCurrency;
                                                    const toHoldingDisplayCurrency = (amountInPortfolioBook: number): number =>
                                                        convertBetweenTradeCurrencies(
                                                            Number(amountInPortfolioBook) || 0,
                                                            portfolioCurrency,
                                                            holdingDisplayCurrency,
                                                            sarPerUsd
                                                        );
                                                    const rowDailyPnL = holdingUsesLiveQuote(h)
                                                        ? quoteDailyPnLInBookCurrency(
                                                              simulatedPrices[hSym]?.change ?? 0,
                                                              h.quantity || 0,
                                                              hSym,
                                                              portfolioCurrency,
                                                              sarPerUsd,
                                                          )
                                                        : 0;
                                                    const gainLossPct = (h.totalCost && h.totalCost > 0) ? (h.gainLoss / h.totalCost) * 100 : 0;
                                                    const avgCostDisplay = toHoldingDisplayCurrency(h.avgCost ?? 0);
                                                    const currentValueDisplay = toHoldingDisplayCurrency(h.currentValue);
                                                    const purchasedCostDisplay = toHoldingDisplayCurrency((h.avgCost ?? 0) * (h.quantity || 0));
                                                    const gainLossDisplay = toHoldingDisplayCurrency(h.gainLoss);
                                                    const rowDailyPnLDisplay = toHoldingDisplayCurrency(rowDailyPnL);
                                                    return (
                                                        <tr key={h.id} className="group hover:bg-slate-50/80 transition-colors">
                                                            <td className="px-4 py-3 min-w-0 max-w-[200px]">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => onHoldingClick({ ...h, gainLossPercent: gainLossPct, priceChangePercent: holdingUsesLiveQuote(h) ? (simulatedPrices[hSym]?.changePercent ?? 0) : 0 }, portfolio)}
                                                                        className="text-left rounded-lg py-0.5 pr-1 -ml-1 hover:bg-slate-100/80 transition-colors min-w-0 flex-1 overflow-hidden"
                                                                    >
                                                                        <ResolvedSymbolLabel
                                                                            symbol={h.symbol}
                                                                            storedName={h.name}
                                                                            names={symbolNames}
                                                                            layout="stacked"
                                                                            symbolClassName="metric-value font-bold text-slate-900 block w-full"
                                                                            companyClassName="metric-value text-xs text-slate-500 block w-full"
                                                                        />
                                                                    </button>
                                                                    {h.goalId && <span title={getGoalName(h.goalId)}><LinkIcon className="h-3.5 w-3.5 text-emerald-500 shrink-0" aria-hidden /></span>}
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-3 text-right">
                                                                {portfolioValue > 0 && (
                                                                    <div className="flex items-center justify-end gap-1.5">
                                                                        <div className="w-10 h-1.5 bg-slate-200 rounded-full overflow-hidden" title={`${allocationPct.toFixed(1)}%`}>
                                                                            <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, allocationPct)}%` }} />
                                                                        </div>
                                                                        <span className="text-sm font-medium text-slate-700 tabular-nums w-10">{allocationPct.toFixed(1)}%</span>
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="px-3 py-3 text-center text-sm font-medium text-slate-800 tabular-nums">{h.quantity}</td>
                                                            <td className="px-3 py-3 text-center text-sm font-medium text-slate-700 tabular-nums">
                                                                {formatCurrencyString(avgCostDisplay, { inCurrency: holdingDisplayCurrency, digits: HOLDING_PER_UNIT_DECIMALS })}
                                                            </td>
                                                            <td className="px-3 py-3 text-right align-top">
                                                                <div className="inline-flex flex-col items-end gap-0.5 tabular-nums min-w-0">
                                                                    <span className="text-sm font-bold text-slate-900 leading-tight inline-flex justify-end">
                                                                        <CurrencyDualDisplay
                                                                            value={currentValueDisplay}
                                                                            inCurrency={holdingDisplayCurrency}
                                                                            digits={0}
                                                                            size="base"
                                                                            className="justify-end text-slate-900"
                                                                        />
                                                                    </span>
                                                                    <span
                                                                        className="text-[11px] font-medium text-slate-500 leading-tight"
                                                                        title="Total purchased cost (quantity × average cost)"
                                                                    >
                                                                        {formatCurrencyString(purchasedCostDisplay, { inCurrency: holdingDisplayCurrency, digits: 0 })}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-3 text-center whitespace-nowrap">
                                                                <div className="inline-flex flex-col items-center gap-0.5 tabular-nums">
                                                                    <CurrencyDualDisplay
                                                                        value={gainLossDisplay}
                                                                        inCurrency={holdingDisplayCurrency}
                                                                        digits={0}
                                                                        size="base"
                                                                        colorize
                                                                        weight="bold"
                                                                    />
                                                                    <span className="text-xs text-slate-600">
                                                                        ({gainLossPct >= 0 ? '+' : ''}
                                                                        {gainLossPct.toFixed(1)}%)
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-3 text-center">
                                                                <CurrencyDualDisplay
                                                                    value={rowDailyPnLDisplay}
                                                                    inCurrency={holdingDisplayCurrency}
                                                                    digits={0}
                                                                    size="base"
                                                                    colorize
                                                                    weight="bold"
                                                                />
                                                            </td>
                                                            <td className="px-3 py-3 text-center">
                                                                <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded-full ${h.zakahClass === 'Zakatable' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>{h.zakahClass === 'Zakatable' ? 'Zak.' : 'Non'}</span>
                                                            </td>
                                                            <td className="px-1 py-3">
                                                                <button type="button" onClick={() => onEditHolding(h)} className="p-1.5 rounded-md text-slate-300 group-hover:text-primary hover:bg-primary/5 transition-all" title="Edit holding" aria-label="Edit holding"><PencilIcon className="h-4 w-4" /></button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </>
                                )}
                            </div>
                            )}
                        </section>
                    );
                })}
            </div>}

            <TransactionHistoryModal isOpen={isTxnModalOpen} onClose={() => setIsTxnModalOpen(false)} transactions={transactions} platformName={platform.name} />
        </article>
    );
};


const PlatformView: React.FC<{
    onAddPlatform: () => void;
    onOpenAddPortfolio: (accountId?: string | null) => void;
    setActivePage?: (page: Page) => void;
    setActiveTab?: (tab: InvestmentSubPage) => void;
    onEditPlatform: (platform: Account) => void;
    onDeletePlatform: (platform: Account) => void;
    onEditPortfolio: (portfolio: InvestmentPortfolio) => void;
    onDeletePortfolio: (portfolio: InvestmentPortfolio) => void;
    onHoldingClick: (holding: Holding & { gainLoss: number; gainLossPercent: number; priceChangePercent?: number; }, portfolio: InvestmentPortfolio) => void;
    onEditHolding: (holding: Holding) => void;
    simulatedPrices: { [symbol: string]: { price: number; change: number; changePercent: number } };
}> = (props) => {
    const { data, getAvailableCashForAccount } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);
    const { setActivePage, setActiveTab, onOpenAddPortfolio } = props;

    const platformsData = useMemo(() => {
        const accounts = getPersonalAccounts(data);
        const accList = data?.accounts ?? [];
        const invList = data?.investments ?? [];
        const personalInv = getPersonalInvestments(data);
        const investmentTransactions = data?.investmentTransactions ?? [];
        const investmentAccounts = accounts.filter((acc) => acc.type === 'Investment').sort((a, b) => a.name.localeCompare(b.name));
        return investmentAccounts.map((account) => ({
            account,
            portfoliosAll: invList.filter((p) => portfolioBelongsToAccount(p, account, accList)),
            portfoliosPersonal: personalInv.filter((p) => portfolioBelongsToAccount(p, account, accList)),
            transactions: investmentTransactions
                .filter((t) => {
                    const raw = t.accountId ?? (t as { account_id?: string }).account_id ?? '';
                    const canon = resolveCanonicalAccountId(raw, accList);
                    return canon === account.id || raw === account.id;
                })
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
            availableCashByCurrency: getAvailableCashForAccount(account.id),
        }));
    }, [data, getAvailableCashForAccount]);

    const totalPlatforms = platformsData.length;
    const totalPortfolios = platformsData.reduce((sum, p) => sum + p.portfoliosAll.length, 0);
    const [platformExpanded, setPlatformExpanded] = useState<Record<string, boolean>>({});
    useEffect(() => {
        if (platformsData.length === 0) return;
        setPlatformExpanded((prev) => {
            const next: Record<string, boolean> = {};
            platformsData.forEach((p, idx) => {
                if (typeof prev[p.account.id] === 'boolean') next[p.account.id] = prev[p.account.id];
                else next[p.account.id] = idx === 0;
            });
            return next;
        });
    }, [platformsData]);
    const aggregateValue = useMemo(() => {
        if (!data) return 0;
        return computePersonalPlatformsRollupSAR(data, sarPerUsd, props.simulatedPrices, getAvailableCashForAccount).subtotalSAR;
    }, [data, sarPerUsd, props.simulatedPrices, getAvailableCashForAccount]);
    const hasAnyPlatforms = totalPlatforms > 0;
    const hasAnyPortfolios = platformsData.some((p) => p.portfoliosAll.length > 0);

    return (
        <div className="space-y-6 mt-2">
            <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 sm:p-6">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div>
                        <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-slate-800">Portfolios</h2><span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">Integrated with plan + execution</span></div>
                        <p className="text-sm text-slate-600 mt-0.5 max-w-2xl">
                            Manage platforms and portfolios. Each portfolio has a base currency (SAR or USD). Record trades in that currency. Click a share for full details. Integrated with Investment Plan, Recovery Plan, and Wealth Ultra.
                        </p>
                        {(setActiveTab || setActivePage) && (
                            <div className="flex flex-wrap items-center gap-2 pt-2">
                                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Related:</span>
                                {setActiveTab && (
                                    <>
                                        <button type="button" onClick={() => setActiveTab('Investment Plan')} className="text-sm font-medium text-primary hover:underline">Investment Plan</button>
                                        <span className="text-slate-300">·</span>
                                        <button type="button" onClick={() => setActiveTab('Recovery Plan')} className="text-sm font-medium text-primary hover:underline">Recovery Plan</button>
                                        <span className="text-slate-300">·</span>
                                        <button type="button" onClick={() => setActiveTab('Watchlist')} className="text-sm font-medium text-primary hover:underline">Watchlist</button>
                                    </>
                                )}
                                {setActivePage && <>{setActiveTab && <span className="text-slate-300">·</span>}<button type="button" onClick={() => setActivePage('Wealth Ultra')} className="text-sm font-medium text-primary hover:underline">Wealth Ultra</button></>}
                            </div>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {setActivePage && (
                            <button type="button" onClick={() => setActivePage('Accounts')} className="text-sm font-medium text-primary hover:underline py-2 px-1 inline-flex items-center gap-1.5">
                                <BuildingLibraryIcon className="h-4 w-4" />
                                Go to Accounts
                            </button>
                        )}
                        <button type="button" onClick={() => onOpenAddPortfolio(null)} className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 text-sm font-medium shadow-sm">
                            <PlusIcon className="h-4 w-4" /> Add Portfolio
                        </button>
                        <button type="button" onClick={props.onAddPlatform} className="inline-flex items-center gap-2 px-4 py-2.5 border border-slate-300 rounded-xl hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors">
                            Add platform
                        </button>
                    </div>
                </div>
                {hasAnyPlatforms && (
                    <div className="mt-5 pt-5 border-t border-slate-200">
                        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                            <div className="flex items-baseline gap-2">
                                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your platforms total (holdings + cash, SAR)</span>
                                <span className="text-xl sm:text-2xl text-primary tabular-nums tracking-tight inline-flex items-baseline">
                                    <CurrencyDualDisplay value={aggregateValue} inCurrency="SAR" digits={2} size="xl" weight="bold" className="text-primary" />
                                </span>
                            </div>
                            <div className="flex items-center gap-2 sm:gap-4">
                                <div className="flex items-center gap-1.5 rounded-lg bg-slate-100/80 px-3 py-1.5">
                                    <Squares2X2Icon className="h-4 w-4 text-slate-500 shrink-0" aria-hidden />
                                    <span className="text-sm font-semibold text-slate-700 tabular-nums">{totalPlatforms}</span>
                                    <span className="text-xs text-slate-500 hidden sm:inline">accounts</span>
                                </div>
                                <div className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5">
                                    <ChartPieIcon className="h-4 w-4 text-primary shrink-0" aria-hidden />
                                    <span className="text-sm font-semibold text-primary tabular-nums">{totalPortfolios}</span>
                                    <span className="text-xs text-primary/80 hidden sm:inline">portfolios</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </section>

            {!hasAnyPlatforms ? (
                <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-8 sm:p-12 text-center">
                    <Squares2X2Icon className="mx-auto h-12 w-12 text-slate-400" aria-hidden />
                    <h3 className="mt-4 text-lg font-semibold text-slate-800">No investment platforms yet</h3>
                    <p className="mt-2 text-sm text-slate-600 max-w-md mx-auto">Add an <strong>Investment</strong> account from Accounts, then create portfolios here and record trades.</p>
                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                        {setActivePage && (
                            <button type="button" onClick={() => setActivePage('Accounts')} className="px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 text-sm font-medium inline-flex items-center gap-2">
                                <BuildingLibraryIcon className="h-5 w-5" />
                                Go to Accounts
                            </button>
                        )}
                        <button type="button" onClick={props.onAddPlatform} className="px-4 py-2.5 border border-slate-300 rounded-xl hover:bg-slate-100 text-slate-700 text-sm font-medium">
                            Add platform
                        </button>
                    </div>
                </div>
            ) : !hasAnyPortfolios ? (
                <div className="rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50/50 p-8 sm:p-12 text-center">
                    <ClipboardDocumentListIcon className="mx-auto h-12 w-12 text-amber-500" aria-hidden />
                    <h3 className="mt-4 text-lg font-semibold text-slate-800">No portfolios yet</h3>
                    <p className="mt-2 text-sm text-slate-600 max-w-md mx-auto">Create a portfolio under one of your platforms below, then record buys and sells.</p>
                    <button type="button" onClick={() => onOpenAddPortfolio(null)} className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 text-sm font-medium">
                        <PlusIcon className="h-4 w-4" /> Add Portfolio
                    </button>
                </div>
            ) : null}

            <div className="platform-cards-grid flex flex-col gap-6 w-full min-w-0" data-platform-count={platformsData.length}>
                {platformsData.map(p => (
                    <PlatformCard
                        key={p.account.id}
                        platform={p.account}
                        portfolios={p.portfoliosAll}
                        metricsPortfolios={p.portfoliosPersonal}
                        transactions={p.transactions}
                        goals={data?.goals ?? []}
                        sarPerUsd={sarPerUsd}
                        availableCashByCurrency={p.availableCashByCurrency}
                        onEditPlatform={props.onEditPlatform}
                        onDeletePlatform={props.onDeletePlatform}
                        onAddPortfolio={(accountId) => onOpenAddPortfolio(accountId)}
                        onEditPortfolio={props.onEditPortfolio}
                        onDeletePortfolio={props.onDeletePortfolio}
                        onHoldingClick={props.onHoldingClick}
                        onEditHolding={props.onEditHolding}
                        simulatedPrices={props.simulatedPrices}
                        isExpanded={platformExpanded[p.account.id] ?? false}
                        onToggleExpanded={() => setPlatformExpanded((prev) => ({ ...prev, [p.account.id]: !prev[p.account.id] }))}
                    />
                ))}
            </div>
        </div>
    );
};

interface PlatformModalProps { isOpen: boolean; onClose: () => void; onSave: (platform: Account) => void; platformToEdit: Account | null; }
const PlatformModal: React.FC<PlatformModalProps> = ({ isOpen, onClose, onSave, platformToEdit }) => {
    const [name, setName] = useState('');
    useEffect(() => { if (platformToEdit) setName(platformToEdit.name); else setName(''); }, [platformToEdit, isOpen]);
    const handleSubmit = async (e: React.FormEvent) => { 
        e.preventDefault(); 
        try {
            await onSave({ ...(platformToEdit || { id: '', balance: 0 }), name, type: 'Investment' }); 
            onClose(); 
        } catch (error) {
            // Error handled in DataContext
        }
    };
    return ( <Modal isOpen={isOpen} onClose={onClose} title={platformToEdit ? 'Edit Platform' : 'Add New Platform'}><form onSubmit={handleSubmit} className="space-y-4"><div><label htmlFor="platform-name" className="block text-sm font-medium text-gray-700">Platform Name</label><input type="text" id="platform-name" value={name} onChange={e => setName(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded-md"/></div><button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary">Save Platform</button></form></Modal> );
};

const ANALYST_DEFAULTS = {
    minimumUpsidePercentage: 25,
    stale_days: 30,
    min_coverage_threshold: 3,
    redirect_policy: 'pro-rata' as const,
    target_provider: 'TipRanks',
};

const InvestmentPlan: React.FC<{ onNavigateToTab?: (tab: InvestmentSubPage) => void; onOpenWealthUltra?: () => void; onOpenRecordTrade?: (trade: { ticker: string; amount: number; reason?: string; price?: number; quantity?: number; tradeCurrency?: TradeCurrency }) => void }> = ({ onNavigateToTab, onOpenWealthUltra, onOpenRecordTrade }) => {
    const { data, saveInvestmentPlan, addUniverseTicker, updateUniverseTickerStatus, deleteUniverseTicker, saveExecutionLog } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const { isAiAvailable, aiHealthChecked } = useAI();
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);
    const { simulatedPrices } = useMarketData();

    const planFromData = data?.investmentPlan;
    const planWithAnalystDefaults: InvestmentPlanSettings = useMemo(() => ({
        ...planFromData,
        minimumUpsidePercentage: Number(planFromData.minimumUpsidePercentage) || ANALYST_DEFAULTS.minimumUpsidePercentage,
        stale_days: Number(planFromData.stale_days) || ANALYST_DEFAULTS.stale_days,
        min_coverage_threshold: Number(planFromData.min_coverage_threshold) || ANALYST_DEFAULTS.min_coverage_threshold,
        redirect_policy: planFromData.redirect_policy || ANALYST_DEFAULTS.redirect_policy,
        target_provider: String(planFromData.target_provider || ANALYST_DEFAULTS.target_provider).trim() || ANALYST_DEFAULTS.target_provider,
    }), [planFromData]);

    const [plan, setPlan] = useState<InvestmentPlanSettings>(planWithAnalystDefaults);
    const personalPortfolios = useMemo(() => getPersonalInvestments(data ?? null), [data]);
    const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
    const universePortfolioId = selectedPortfolioId ?? personalPortfolios[0]?.id ?? null;
    const [newTicker, setNewTicker] = useState({ ticker: '', name: '' });
    useEffect(() => {
        if (personalPortfolios.length > 0 && selectedPortfolioId === null) {
            setSelectedPortfolioId(personalPortfolios[0].id);
        }
    }, [personalPortfolios, selectedPortfolioId]);
    useEffect(() => {
        const sym = newTicker.ticker.trim().toUpperCase();
        if (!sym || sym.length < 2) return;
        const t = setTimeout(() => {
            fetchCompanyNameForSymbol(sym).then((apiName) => {
                if (apiName) setNewTicker((prev) => (prev.name.trim() ? prev : { ...prev, name: apiName }));
            });
        }, 700);
        return () => clearTimeout(t);
    }, [newTicker.ticker]);
    const [executionResult, setExecutionResult] = useState<InvestmentPlanExecutionResult | null>(null);
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [isExecuting, setIsExecuting] = useState(false);
    const [showFlowNote, setShowFlowNote] = useState(true);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [isSavingPlan, setIsSavingPlan] = useState(false);
    const [planAdvancedOpen, setPlanAdvancedOpen] = useState(false);
    const [isFillingAnalyst, setIsFillingAnalyst] = useState(false);
    const analystAutoFilledRef = React.useRef(false);
    const [universeFilter, setUniverseFilter] = useState<'all' | 'Core' | 'High-Upside' | 'Watchlist' | 'Needs mapping'>('all');
    const [universeSort, setUniverseSort] = useState<'ticker' | 'status' | 'weight'>('ticker');

    useEffect(() => {
        if (!planFromData || !universePortfolioId) return;
        setPlan(getEffectivePlanForPortfolio(planFromData, universePortfolioId, planWithAnalystDefaults));
    }, [planFromData, universePortfolioId, planWithAnalystDefaults]);

    const unifiedUniverse = useMemo(() => {
        const universeMap = new Map<string, UniverseTicker & { source?: string }>();
        const portfolioUniverse = (data?.portfolioUniverse ?? []).filter(
            (t) => !t.portfolioId || t.portfolioId === universePortfolioId,
        );
        const investments = universePortfolioId
            ? getPersonalInvestments(data ?? null).filter((p) => p.id === universePortfolioId)
            : [];
        const watchlist = data?.watchlist ?? [];
        const plannedTrades = data?.plannedTrades ?? [];

        // 1. Start with explicit universe
        portfolioUniverse.forEach(t => universeMap.set(t.ticker, { ...t, source: 'Universe' }));

        // 2. Add holdings
        investments.flatMap(p => p.holdings || []).forEach(h => {
            if (!universeMap.has(h.symbol)) {
                universeMap.set(h.symbol, {
                    id: `holding-${h.id}`,
                    ticker: h.symbol,
                    name: h.name || h.symbol,
                    status: 'Core',
                    source: 'Holding'
                });
            } else {
                const existing = universeMap.get(h.symbol)!;
                universeMap.set(h.symbol, { ...existing, source: existing.source === 'Universe' ? 'Universe + Holding' : 'Holding' });
            }
        });

        // 3. Add watchlist
        watchlist.forEach(w => {
            if (!universeMap.has(w.symbol)) {
                universeMap.set(w.symbol, {
                    id: `watchlist-${w.symbol}`,
                    ticker: w.symbol,
                    name: w.name,
                    status: 'Watchlist',
                    source: 'Watchlist'
                });
            } else {
                const existing = universeMap.get(w.symbol)!;
                if (!existing.source?.includes('Watchlist')) {
                    universeMap.set(w.symbol, { ...existing, source: `${existing.source} + Watchlist` });
                }
            }
        });

        // 4. Add planned trades
        plannedTrades.forEach(t => {
            if (!universeMap.has(t.symbol)) {
                universeMap.set(t.symbol, {
                    id: `planned-${t.id}`,
                    ticker: t.symbol,
                    name: t.name || t.symbol,
                    status: 'Watchlist',
                    source: 'Trade Request'
                });
            } else {
                const existing = universeMap.get(t.symbol)!;
                if (!existing.source?.includes('Trade Request')) {
                    universeMap.set(t.symbol, { ...existing, source: `${existing.source} + Trade Request` });
                }
            }
        });
        
        return Array.from(universeMap.values());
    }, [data, universePortfolioId]);

    const universeHealth = useMemo(() => {
        const actionable = unifiedUniverse.filter(t => t.status === 'Core' || t.status === 'High-Upside');
        const monthlyWeightTotal = actionable.reduce((sum, t) => sum + (t.monthly_weight || 0), 0);
        const overMaxCount = actionable.filter(t => (t.monthly_weight || 0) > (t.max_position_weight || 1)).length;
        const unmappedCount = unifiedUniverse.filter(t => !t.source?.includes('Universe')).length;
        return {
            totalCount: unifiedUniverse.length,
            actionableCount: actionable.length,
            monthlyWeightTotal,
            overMaxCount,
            unmappedCount,
        };
    }, [unifiedUniverse]);

    const filteredAndSortedUniverse = useMemo(() => {
        let list = unifiedUniverse;
        if (universeFilter === 'Core') list = list.filter(t => t.status === 'Core');
        else if (universeFilter === 'High-Upside') list = list.filter(t => t.status === 'High-Upside');
        else if (universeFilter === 'Watchlist') list = list.filter(t => t.status === 'Watchlist');
        else if (universeFilter === 'Needs mapping') list = list.filter(t => !t.source?.includes('Universe'));
        if (universeSort === 'ticker') list = [...list].sort((a, b) => (a.ticker || '').localeCompare(b.ticker || ''));
        else if (universeSort === 'status') list = [...list].sort((a, b) => (a.status || '').localeCompare(b.status || '') || (a.ticker || '').localeCompare(b.ticker || ''));
        else if (universeSort === 'weight') list = [...list].sort((a, b) => (b.monthly_weight ?? 0) - (a.monthly_weight ?? 0));
        return list;
    }, [unifiedUniverse, universeFilter, universeSort]);

    // Auto-derive suggested monthly budget from recent buy activity (last 6 months) with source label
    const { suggestedMonthlyBudget, suggestedBudgetSource } = useMemo(() => {
        const budgetCurrency = (plan?.budgetCurrency as TradeCurrency) || 'SAR';
        const convertAmount = (amount: number, fromCurrency: TradeCurrency, toCurrency: TradeCurrency) => {
            if (!Number.isFinite(amount) || amount <= 0) return 0;
            if (fromCurrency === toCurrency) return amount;
            return fromCurrency === 'USD' && toCurrency === 'SAR' ? amount * sarPerUsd : amount / sarPerUsd;
        };

        const buys = (data?.investmentTransactions ?? []).filter(t => t.type === 'buy');
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const recent = buys.filter(t => new Date(t.date) >= sixMonthsAgo);
        const byMonth = new Map<string, number>();
        recent.forEach(t => {
            const d = new Date(t.date);
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            const txnCurrency = (t.currency === 'SAR' || t.currency === 'USD' ? t.currency : 'USD') as TradeCurrency;
            const rawAmount = t.total ?? (t.quantity * (t.price ?? 0));
            const convertedAmount = convertAmount(rawAmount, txnCurrency, budgetCurrency);
            byMonth.set(key, (byMonth.get(key) ?? 0) + convertedAmount);
        });
        const historyAmounts = Array.from(byMonth.values()).filter(v => Number.isFinite(v) && v > 0);
        if (historyAmounts.length > 0) {
            const amount = Math.round(historyAmounts.reduce((a, b) => a + b, 0) / historyAmounts.length);
            return { suggestedMonthlyBudget: amount, suggestedBudgetSource: `Last ${historyAmounts.length} month(s) of buys` };
        }

        const portfoliosForBudget = (data as any)?.personalInvestments ?? data?.investments ?? [];
        const investedBase = portfoliosForBudget.reduce((sum: number, portfolio: InvestmentPortfolio) => {
            const portfolioCurrency = ((portfolio.currency as TradeCurrency) || 'USD');
            const portfolioTotal = (portfolio.holdings || []).reduce((inner: number, h: Holding) => inner + (h.currentValue || 0), 0);
            return sum + convertAmount(portfolioTotal, portfolioCurrency, budgetCurrency as TradeCurrency);
        }, 0);
        const derivedFromPortfolio = investedBase > 0 ? Math.round(Math.max(1000, Math.min(30000, investedBase * 0.025))) : 0;
        if (derivedFromPortfolio > 0) {
            return { suggestedMonthlyBudget: derivedFromPortfolio, suggestedBudgetSource: '~2.5% of portfolio value' };
        }
        return { suggestedMonthlyBudget: 2500, suggestedBudgetSource: 'Default starter amount' };
    }, [data?.investmentTransactions, data?.investments, (data as any)?.personalInvestments, sarPerUsd, plan?.budgetCurrency]);

    const addWatchlistAndHoldingsToUniverse = async () => {
        const toAdd = unifiedUniverse.filter(t => t.source !== 'Universe' && !t.source?.includes('Universe'));
        for (const t of toAdd) {
            try {
                await addUniverseTicker({
                    ticker: t.ticker,
                    name: t.name,
                    status: t.status,
                    portfolioId: universePortfolioId ?? undefined,
                });
            } catch (_) {
                // Skip duplicates or errors
            }
        }
    };
    const canAddWatchlistHoldings = unifiedUniverse.some(t => t.source !== 'Universe' && !t.source?.includes('Universe'));

    if (!plan || !plan.brokerConstraints) {
        return (
            <div className="flex flex-col items-center justify-center p-12 bg-white rounded-lg shadow">
                <LoadingSpinner message="Loading investment plan strategy..." size="md" className="py-8" />
            </div>
        );
    }

    const handlePlanChange = (field: keyof InvestmentPlanSettings, value: any) => {
        setPlan(prev => ({ ...prev, [field]: value }));
    };

    const toClampedFraction = (rawPercent: string, fallbackFraction: number) => {
        const parsed = Number.parseFloat(rawPercent);
        if (!Number.isFinite(parsed)) return fallbackFraction;
        const clampedPercent = Math.max(0, Math.min(100, parsed));
        return clampedPercent / 100;
    };

    const normalizeAllocationPair = (coreRaw: number, upsideRaw: number) => {
        const coreSafe = Number.isFinite(coreRaw) ? Math.max(0, Math.min(1, coreRaw)) : 0;
        const upsideSafe = Number.isFinite(upsideRaw) ? Math.max(0, Math.min(1, upsideRaw)) : 0;
        const total = coreSafe + upsideSafe;
        if (total <= 0) return { core: 0.7, upside: 0.3 };
        const normalizedCore = Number((coreSafe / total).toFixed(4));
        const normalizedUpside = Number((1 - normalizedCore).toFixed(4));
        return { core: normalizedCore, upside: normalizedUpside };
    };


    const handleCoreAllocationPercentChange = (rawPercent: string) => {
        setPlan(prev => {
            const core = toClampedFraction(rawPercent, prev.coreAllocation ?? 0.7);
            const normalized = normalizeAllocationPair(core, Math.max(0, 1 - core));
            return { ...prev, coreAllocation: normalized.core, upsideAllocation: normalized.upside };
        });
    };

    const handleUpsideAllocationPercentChange = (rawPercent: string) => {
        setPlan(prev => {
            const upside = toClampedFraction(rawPercent, prev.upsideAllocation ?? 0.3);
            const normalized = normalizeAllocationPair(Math.max(0, 1 - upside), upside);
            return { ...prev, upsideAllocation: normalized.upside, coreAllocation: normalized.core };
        });
    };

    const handleAutoFillAnalyst = useCallback(async () => {
        setIsFillingAnalyst(true);
        try {
            const suggested = await getSuggestedAnalystEligibility(unifiedUniverse, plan);
            setPlan(prev => ({
                ...prev,
                minimumUpsidePercentage: suggested.minimumUpsidePercentage,
                stale_days: suggested.stale_days,
                min_coverage_threshold: suggested.min_coverage_threshold,
                redirect_policy: suggested.redirect_policy,
                target_provider: suggested.target_provider,
            }));
            analystAutoFilledRef.current = true;
            setSaveMessage(
                suggested.source === 'ai'
                    ? 'AI analyst settings applied successfully.'
                    : 'AI was unavailable; resilient fallback analyst settings were applied.'
            );
            setTimeout(() => setSaveMessage(null), 5000);
        } catch (e) {
            alert(`Could not auto-fill analyst settings. ${formatAiError(e)}`);
        } finally {
            setIsFillingAnalyst(false);
        }
    }, [unifiedUniverse, plan]);

    const handleAddNewTicker = async () => {
        if (!newTicker.ticker || !newTicker.name) return;
        try {
            await addUniverseTicker({ ...newTicker, status: 'Watchlist', portfolioId: universePortfolioId ?? undefined });
            setNewTicker({ ticker: '', name: '' });
        } catch (error) {
            // Error already alerted in DataContext
        }
    };

    const allocationSum = (plan.coreAllocation + plan.upsideAllocation) * 100;
    const allocationWarning = Math.abs(allocationSum - 100) > 0.5 ? `Core + High-Upside = ${allocationSum.toFixed(1)}%; should equal 100%. Remaining is treated as Spec.` : null;
    const planCurrency = plan.budgetCurrency ?? 'SAR';
    const coreShareAmount = (plan.monthlyBudget ?? 0) * (plan.coreAllocation ?? 0);
    const upsideShareAmount = (plan.monthlyBudget ?? 0) * (plan.upsideAllocation ?? 0);

    const minOrder = plan.brokerConstraints?.minimumOrderSize ?? 0;
    const budget = plan.monthlyBudget ?? 0;
    const minOrderWarning = budget > 0 && minOrder > 0 && minOrder > budget * 0.5
        ? `Minimum order size (${formatCurrencyString(minOrder)}) is more than 50% of monthly budget. You may only place 1–2 orders per month. Consider lowering it or increasing budget.`
        : budget > 0 && minOrder > budget
        ? `Minimum order size is higher than your monthly budget; no single order can be placed.`
        : null;

    const selectedPortfolio = useMemo(
        () => personalPortfolios.find((p) => p.id === universePortfolioId) ?? null,
        [personalPortfolios, universePortfolioId],
    );
    const holdingsFallbackUniverse = useMemo<UniverseTicker[]>(() => (
        (selectedPortfolio?.holdings ?? [])
            .filter((h) => Boolean((h.symbol || '').trim()))
            .map((h, idx) => ({
                id: `fallback-holding-${h.id ?? idx}`,
                ticker: (h.symbol || '').trim().toUpperCase(),
                name: h.name || (h.symbol || '').trim().toUpperCase(),
                status: 'Core',
                monthly_weight: undefined,
                max_position_weight: undefined,
                min_upside_threshold_override: undefined,
                min_coverage_override: undefined,
            }))
    ), [selectedPortfolio]);

    // Live execution preview: estimated order counts from current budget and min order size
    const executionPreview = useMemo(() => {
        const minOrder = plan.brokerConstraints?.minimumOrderSize ?? 0;
        const coreShare = coreShareAmount;
        const upsideShare = upsideShareAmount;
        if (!Number.isFinite(minOrder) || minOrder <= 0) return { coreOrders: 0, upsideOrders: 0, totalOrders: 0 };
        const coreOrders = Math.floor(coreShare / minOrder);
        const upsideOrders = Math.floor(upsideShare / minOrder);
        return { coreOrders, upsideOrders, totalOrders: coreOrders + upsideOrders };
    }, [coreShareAmount, upsideShareAmount, plan.brokerConstraints?.minimumOrderSize]);

    const executionUniverse = useMemo<UniverseTicker[]>(() => (
        unifiedUniverse.map((t) => ({
            id: t.id,
            user_id: t.user_id,
            ticker: t.ticker,
            name: t.name,
            status: t.status,
            monthly_weight: t.monthly_weight,
            max_position_weight: t.max_position_weight,
            min_upside_threshold_override: t.min_upside_threshold_override,
            min_coverage_override: t.min_coverage_override,
        }))
    ), [unifiedUniverse]);
    const effectiveExecutionUniverse = useMemo<UniverseTicker[]>(() => {
        const actionable = executionUniverse.filter((t) => (t.status === 'Core' || t.status === 'High-Upside') && Boolean((t.ticker || '').trim()));
        if (actionable.length > 0) return executionUniverse;
        return holdingsFallbackUniverse;
    }, [executionUniverse, holdingsFallbackUniverse]);
    const actionableCount = effectiveExecutionUniverse.filter((t) => t.status === 'Core' || t.status === 'High-Upside').length;
    const noActionableWarning = actionableCount === 0
        ? 'Add at least one Core or High-Upside ticker in the universe below (or from Watchlist) before executing the plan.'
        : null;

    const planHealth = useMemo(() => {
        let score = 100;
        const reasons: string[] = [];
        const monthly = plan.monthlyBudget ?? 0;
        const corePct = (plan.coreAllocation ?? 0) * 100;
        const upsidePct = (plan.upsideAllocation ?? 0) * 100;

        if (monthly <= 0) {
            score -= 25;
            reasons.push('Monthly budget not set');
        }
        if (allocationWarning) {
            score -= 20;
            reasons.push('Core + High-Upside not equal to 100%');
        }
        if (universeHealth.actionableCount === 0) {
            score -= 30;
            reasons.push('No Core / High-Upside tickers in universe');
        }
        if (Math.abs(universeHealth.monthlyWeightTotal - 1) > 0.05 && universeHealth.actionableCount > 0) {
            score -= 10;
            reasons.push('Universe weights not close to 100%');
        }
        if (minOrderWarning) {
            score -= 10;
            reasons.push('Broker minimum order conflicts with budget');
        }
        score = Math.max(0, Math.min(100, score));

        let label: string;
        let summary: string;
        let nextStep: string | null = null;
        if (score >= 85) {
            label = 'Ready to execute';
            summary = 'Budget, allocations, and universe look solid. You can run Execute & View Results or Wealth Ultra.';
        } else if (score >= 65) {
            label = 'Minor tweaks';
            summary = (reasons[0] || 'Small configuration gaps.') + (reasons[1] ? ` · ${reasons[1]}` : '');
            nextStep = reasons[0] ?? null;
        } else {
            label = 'Action needed';
            summary = reasons.slice(0, 3).join(' · ') || 'Set budget, tickers, and weights before executing.';
            nextStep = reasons[0] ?? 'Set budget, tickers, and weights';
        }
        if (score < 100 && !nextStep && reasons.length > 0) nextStep = reasons[0];

        return {
            score,
            label,
            summary,
            nextStep,
            corePct,
            upsidePct,
        };
    }, [plan, allocationWarning, universeHealth, minOrderWarning, noActionableWarning]);

    const syncPlanFromUniverse = () => {
        const scoped = (data?.portfolioUniverse ?? []).filter(
            (t) => !t.portfolioId || t.portfolioId === universePortfolioId,
        );
        const core = scoped.filter(t => t.status === 'Core').map(t => ({ ticker: t.ticker, weight: t.monthly_weight ?? 0 }));
        const upside = scoped.filter(t => t.status === 'High-Upside').map(t => ({ ticker: t.ticker, weight: t.monthly_weight ?? 0 }));
        setPlan(prev => ({ ...prev, corePortfolio: core, upsideSleeve: upside }));
    };

    const applySmartPlan = () => {
        setSaveError(null);
        try {
            const planCurrency = ((plan.budgetCurrency as TradeCurrency) || 'SAR');
            const convertAmount = (amount: number, fromCurrency: TradeCurrency, toCurrency: TradeCurrency) => {
                if (!Number.isFinite(amount) || amount <= 0) return 0;
                if (fromCurrency === toCurrency) return amount;
                return fromCurrency === 'USD' && toCurrency === 'SAR' ? amount * sarPerUsd : amount / sarPerUsd;
            };

            const portfoliosForPlan = (data as any)?.personalInvestments ?? data?.investments ?? [];
            const investedBase = portfoliosForPlan.reduce((sum: number, portfolio: InvestmentPortfolio) => {
                const portfolioCurrency = ((portfolio.currency as TradeCurrency) || 'USD');
                const portfolioTotal = (portfolio.holdings || []).reduce((inner: number, h: Holding) => inner + (h.currentValue || 0), 0);
                return sum + convertAmount(portfolioTotal, portfolioCurrency, planCurrency);
            }, 0);

            const historyBudget = suggestedMonthlyBudget > 0 ? suggestedMonthlyBudget : 0;
            const derivedFromPortfolio = investedBase > 0 ? Math.round(Math.max(1000, Math.min(30000, investedBase * 0.025))) : 0;
            const fallbackBudget = 2500;
            const monthly = historyBudget || plan.monthlyBudget || derivedFromPortfolio || fallbackBudget;

            const actionableUniverse = unifiedUniverse.filter(t => t.status === 'Core' || t.status === 'High-Upside');
            const coreUniverse = actionableUniverse.filter(t => t.status === 'Core');
            const upsideUniverse = actionableUniverse.filter(t => t.status === 'High-Upside');

            const normalizeSleeve = (tickers: (UniverseTicker & { source?: string })[]) => {
                if (tickers.length === 0) return [] as { ticker: string; weight: number }[];
                const rawTotal = tickers.reduce((sum, t) => sum + ((t.monthly_weight && t.monthly_weight > 0) ? t.monthly_weight : 1), 0);
                return tickers.map(t => {
                    const rawWeight = (t.monthly_weight && t.monthly_weight > 0) ? t.monthly_weight : 1;
                    return {
                        ticker: t.ticker,
                        weight: Number((rawTotal > 0 ? rawWeight / rawTotal : 1 / tickers.length).toFixed(6)),
                    };
                });
            };

            const normalizedCore = normalizeSleeve(coreUniverse);
            const normalizedUpside = normalizeSleeve(upsideUniverse);

            let coreAlloc = plan.coreAllocation ?? 0.7;
            let upsideAlloc = plan.upsideAllocation ?? 0.3;

            const coreWt = coreUniverse.reduce((s, t) => s + (t.monthly_weight || 0), 0);
            const upWt = upsideUniverse.reduce((s, t) => s + (t.monthly_weight || 0), 0);
            const totalWt = coreWt + upWt;

            if (totalWt > 0) {
                coreAlloc = coreWt / totalWt;
                upsideAlloc = upWt / totalWt;
            } else if (actionableUniverse.length > 0) {
                coreAlloc = coreUniverse.length / actionableUniverse.length;
                upsideAlloc = upsideUniverse.length / actionableUniverse.length;
                if (coreAlloc === 0 || upsideAlloc === 0) {
                    coreAlloc = coreUniverse.length > 0 ? 0.8 : 0.2;
                    upsideAlloc = 1 - coreAlloc;
                }
            }

            const normalizedAlloc = normalizeAllocationPair(coreAlloc, upsideAlloc);

            const nextMinOrder = Math.max(100, Math.round((monthly * 0.1) / 100) * 100);

            setPlan(prev => ({
                ...prev,
                monthlyBudget: monthly,
                coreAllocation: normalizedAlloc.core,
                upsideAllocation: normalizedAlloc.upside,
                corePortfolio: normalizedCore,
                upsideSleeve: normalizedUpside,
                brokerConstraints: {
                    ...prev.brokerConstraints,
                    minimumOrderSize: nextMinOrder,
                },
            }));

            const budgetSource = historyBudget > 0
                ? `recent buy history (${planCurrency})`
                : (plan.monthlyBudget > 0 ? 'your existing plan value' : (derivedFromPortfolio > 0 ? 'current holdings size' : 'smart default'));
            setSaveMessage(`Smart-fill applied: budget ${formatCurrencyString(monthly, { inCurrency: planCurrency, digits: 0 })}, ${actionableUniverse.length} actionable tickers (${budgetSource}). Review and save below.`);
            setTimeout(() => setSaveMessage(null), 6000);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Smart-fill failed';
            setSaveError(msg);
            setTimeout(() => setSaveError(null), 6000);
        }
    };

    const handleSave = async () => {
        if (allocationWarning && !window.confirm(`${allocationWarning}

Save anyway?`)) return;
        setSaveMessage(null);
        setSaveError(null);
        setIsSavingPlan(true);
        try {
            await saveInvestmentPlan(plan, universePortfolioId ?? undefined);
            setSaveMessage('Plan saved. You can view allocation & orders in Wealth Ultra.');
            setTimeout(() => setSaveMessage(null), 6000);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to save plan';
            setSaveError(msg);
            setTimeout(() => setSaveError(null), 8000);
        } finally {
            setIsSavingPlan(false);
        }
    };

    const isUniverseTicker = (ticker: UniverseTicker & { source?: string }) => ticker.source === 'Universe' || ticker.source?.includes('Universe');
    const isActionableUniverseStatus = (status: TickerStatus) => status === 'Core' || status === 'High-Upside';

    const parsePercentInputToWeight = (raw: string): number | undefined => {
        const parsed = Number.parseFloat(raw);
        if (!Number.isFinite(parsed) || parsed < 0) return undefined;
        return parsed / 100;
    };

    const autoConfigureUniverseWeights = useCallback(async () => {
        const universe = [...(data?.portfolioUniverse ?? [])].filter(
            (t) => !t.portfolioId || t.portfolioId === universePortfolioId,
        );
        if (universe.length === 0) return;

        const actionable = universe.filter(t => isActionableUniverseStatus(t.status));
        const actionableCount = actionable.length;
        const rawWeightsById = new Map(actionable.map((t) => [t.id, (t.monthly_weight && t.monthly_weight > 0) ? t.monthly_weight : 1]));
        const rawTotal = Array.from(rawWeightsById.values()).reduce((sum, v) => sum + v, 0);
        const fallbackWeight = actionableCount > 0 ? 1 / actionableCount : 0;

        for (const ticker of universe) {
            if (!isActionableUniverseStatus(ticker.status)) {
                const shouldResetWeight = (ticker.monthly_weight ?? 0) !== 0;
                const shouldDefaultMax = !ticker.max_position_weight || ticker.max_position_weight <= 0;
                if (shouldResetWeight || shouldDefaultMax) {
                    await updateUniverseTickerStatus(ticker.id, ticker.status, {
                        monthly_weight: 0,
                        max_position_weight: shouldDefaultMax ? 0.25 : ticker.max_position_weight,
                    });
                }
                continue;
            }

            const sourceWeight = rawWeightsById.get(ticker.id) ?? 1;
            const normalizedWeight = rawTotal > 0 ? (sourceWeight / rawTotal) : fallbackWeight;
            const nextMax = (ticker.max_position_weight && ticker.max_position_weight > 0)
                ? ticker.max_position_weight
                : (ticker.status === 'Core' ? 0.25 : 0.2);

            await updateUniverseTickerStatus(ticker.id, ticker.status, {
                monthly_weight: Number(normalizedWeight.toFixed(6)),
                max_position_weight: nextMax,
            });
        }

        setSaveMessage('Universe weights auto-configured for actionable tickers.');
        setTimeout(() => setSaveMessage(null), 5000);
    }, [data?.portfolioUniverse, updateUniverseTickerStatus, universePortfolioId]);

    const handleStatusUpdate = async (ticker: UniverseTicker & { source?: string }, newStatus: TickerStatus) => {
        if (isUniverseTicker(ticker)) {
            const defaultMax = isActionableUniverseStatus(newStatus)
                ? (newStatus === 'Core' ? 0.25 : 0.2)
                : 0.25;
            await updateUniverseTickerStatus(ticker.id, newStatus, {
                monthly_weight: isActionableUniverseStatus(newStatus) ? (ticker.monthly_weight ?? 0) : 0,
                max_position_weight: ticker.max_position_weight && ticker.max_position_weight > 0 ? ticker.max_position_weight : defaultMax,
            });
            await autoConfigureUniverseWeights();
        } else {
            // Promote virtual ticker to universe
            await addUniverseTicker({
                ticker: ticker.ticker,
                name: ticker.name,
                status: newStatus,
                portfolioId: universePortfolioId ?? undefined,
            });
            setSaveMessage('Ticker added to universe. Click Auto-configure weights to distribute defaults.');
            setTimeout(() => setSaveMessage(null), 5000);
        }
    };

    const tickerCurrencyMap = useMemo<Record<string, TradeCurrency>>(() => {
        const map: Record<string, TradeCurrency> = {};
        const portfolios = (data as any)?.personalInvestments ?? data?.investments ?? [];
        portfolios.forEach((portfolio: { currency?: string; holdings?: { symbol?: string }[] }) => {
            const portfolioCurrency = (portfolio.currency === 'SAR' || portfolio.currency === 'USD') ? portfolio.currency : 'USD';
            (portfolio.holdings ?? []).forEach((holding: { symbol?: string }) => {
                const symbol = (holding.symbol || '').trim().toUpperCase();
                if (symbol) map[symbol] = portfolioCurrency as TradeCurrency;
            });
        });
        return map;
    }, [data?.investments, (data as any)?.personalInvestments]);

    const holdingPriceFallbackMap = useMemo<Record<string, number>>(() => {
        const map: Record<string, number> = {};
        const portfolios = (data as any)?.personalInvestments ?? data?.investments ?? [];
        portfolios.forEach((portfolio: { holdings?: { symbol?: string; quantity?: number; currentValue?: number; avgCost?: number; holdingType?: string; holding_type?: string }[] }) => {
            (portfolio.holdings ?? []).forEach((holding: { symbol?: string; quantity?: number; currentValue?: number; avgCost?: number; holdingType?: string; holding_type?: string }) => {
                if (!holdingUsesLiveQuote(holding as Holding)) return;
                const symbol = (holding.symbol || '').trim().toUpperCase();
                if (!symbol) return;
                const inferred = (holding.quantity ?? 0) > 0 ? ((holding.currentValue ?? 0) / (holding.quantity ?? 1)) : (holding.avgCost || 0);
                if (inferred > 0 && !Number.isNaN(inferred)) map[symbol] = inferred;
            });
        });
        return map;
    }, [data?.investments, (data as any)?.personalInvestments]);

    const getTradeExecutionSuggestion = useCallback((trade: InvestmentPlanExecutionResult['trades'][number]) => {
        const symbol = (trade.ticker || '').trim().toUpperCase();
        const tradeCurrency = trade.tradeCurrency || planCurrency;
        const amountInTradeCurrency = tradeCurrency === planCurrency
            ? trade.amount
            : (typeof trade.amountInTradeCurrency === 'number' ? trade.amountInTradeCurrency : trade.amount);
        const rawQuote = simulatedPrices[symbol]?.price;
        let suggestedPrice = 0;
        if (rawQuote != null && Number.isFinite(rawQuote) && rawQuote > 0) {
            suggestedPrice = convertBetweenTradeCurrencies(
                rawQuote,
                inferInstrumentCurrencyFromSymbol(symbol),
                tradeCurrency,
                sarPerUsd,
            );
        } else {
            const fb = holdingPriceFallbackMap[symbol];
            if (fb != null && Number.isFinite(fb) && fb > 0) suggestedPrice = fb;
        }
        const suggestedQuantity = suggestedPrice > 0 ? amountInTradeCurrency / suggestedPrice : undefined;
        return {
            tradeCurrency,
            amountInTradeCurrency,
            suggestedPrice: suggestedPrice > 0 ? suggestedPrice : undefined,
            suggestedQuantity,
        };
    }, [planCurrency, simulatedPrices, holdingPriceFallbackMap, sarPerUsd]);


    const addOnOpportunities = useMemo(() => {
        type AddOnCandidate = {
            symbol: string;
            name: string;
            status: TickerStatus;
            portfolioName: string;
            currentPrice: number;
            gainLossPct: number;
            portfolioWeight: number;
            maxWeight: number;
            capacityPlanAmount: number;
            tradeCurrency: TradeCurrency;
            pullbackPrice: number;
            deepPullbackPrice: number;
            confidence: 'High' | 'Medium';
            reason: string;
            score: number;
        };

        const actionableStatuses: TickerStatus[] = ['Core', 'High-Upside'];
        const mapBySymbol = new Map(
            (data?.portfolioUniverse ?? [])
                .filter((t) => !t.portfolioId || t.portfolioId === universePortfolioId)
                .map((t) => [(t.ticker || '').trim().toUpperCase(), t]),
        );
        const candidates: AddOnCandidate[] = [];

        const fx = sarPerUsd;
        const convertPlanToTrade = (amount: number, tradeCurrency: TradeCurrency): number => {
            const pair = `${planCurrency}-${tradeCurrency}`;
            if (pair === 'SAR-USD') return amount / fx;
            if (pair === 'USD-SAR') return amount * fx;
            return amount;
        };

        const monthlyBudget = Math.max(0, plan.monthlyBudget || 0);
        const addOnPoolBudget = monthlyBudget > 0 ? Math.round(monthlyBudget * 0.2) : 0;
        if (addOnPoolBudget <= 0) return [];

        getPersonalInvestments(data ?? null).forEach((portfolio) => {
            const book = ((portfolio.currency as TradeCurrency) || 'USD') as TradeCurrency;
            const holdings = portfolio.holdings || [];
            const liveHoldingValues = holdings.map((holding) => {
                const symbol = (holding.symbol || '').trim().toUpperCase();
                const useLive = holdingUsesLiveQuote(holding as Holding);
                const qty = holding.quantity || 0;
                let livePrice: number;
                let liveValue: number;
                if (useLive) {
                    const rawPx = simulatedPrices[symbol]?.price;
                    if (rawPx != null && Number.isFinite(rawPx) && rawPx > 0 && qty > 0) {
                        liveValue = quoteNotionalInBookCurrency(rawPx, qty, symbol, book, fx);
                        livePrice = convertBetweenTradeCurrencies(
                            rawPx,
                            inferInstrumentCurrencyFromSymbol(symbol),
                            book,
                            fx,
                        );
                    } else {
                        const fromStored = qty > 0 ? (holding.currentValue || 0) / qty : 0;
                        livePrice =
                            Number.isFinite(fromStored) && fromStored > 0
                                ? fromStored
                                : (holding.avgCost || 0);
                        if (!Number.isFinite(livePrice)) livePrice = 0;
                        liveValue =
                            livePrice > 0 ? livePrice * qty : (holding.currentValue || 0);
                    }
                } else {
                    liveValue = Number.isFinite(holding.currentValue) ? holding.currentValue : 0;
                    livePrice =
                        (holding.quantity ?? 0) > 0 ? liveValue / holding.quantity : (holding.avgCost || 0);
                }
                return { holding, symbol, livePrice, liveValue };
            });

            const portfolioValue = liveHoldingValues.reduce((sum, x) => sum + (x.liveValue || 0), 0);
            if (portfolioValue <= 0) return;

            liveHoldingValues.forEach(({ holding, symbol, livePrice, liveValue }) => {
                if (!symbol) return;
                const universeTicker = mapBySymbol.get(symbol);
                const status = universeTicker?.status ?? 'Core';
                if (!actionableStatuses.includes(status)) return;
                if (!Number.isFinite(livePrice) || livePrice <= 0) return;

                const costBasis = (holding.avgCost || 0) * (holding.quantity || 0);
                const gainLossPct = costBasis > 0 ? ((liveValue - costBasis) / costBasis) * 100 : 0;
                if (!Number.isFinite(gainLossPct) || gainLossPct < 4) return;

                const portfolioWeight = liveValue / portfolioValue;
                const maxWeight = universeTicker?.max_position_weight && universeTicker.max_position_weight > 0
                    ? universeTicker.max_position_weight
                    : (status === 'Core' ? 0.25 : 0.2);
                const headroom = Math.max(0, maxWeight - portfolioWeight);
                if (headroom <= 0.01) return;

                const capacityPlanAmount = Math.max(0, Math.round(monthlyBudget * Math.min(headroom, status === 'Core' ? 0.06 : 0.04)));
                if (capacityPlanAmount <= 0) return;

                const momentumScore = gainLossPct >= 12 ? 1 : gainLossPct >= 7 ? 0.75 : 0.45;
                const headroomScore = Math.min(1, headroom / 0.08);
                const score = (status === 'Core' ? 1 : 0.9) * (0.6 * momentumScore + 0.4 * headroomScore);

                const pullbackPct = status === 'Core' ? 0.02 : 0.03;
                const deepPullbackPct = status === 'Core' ? 0.05 : 0.07;
                const pullbackPrice = Number((livePrice * (1 - pullbackPct)).toFixed(2));
                const deepPullbackPrice = Number((livePrice * (1 - deepPullbackPct)).toFixed(2));
                const confidence: 'High' | 'Medium' = gainLossPct >= 10 && headroom >= 0.04 ? 'High' : 'Medium';

                candidates.push({
                    symbol,
                    name: holding.name || symbol,
                    status,
                    portfolioName: portfolio.name,
                    currentPrice: Number(livePrice.toFixed(2)),
                    gainLossPct: Number(gainLossPct.toFixed(2)),
                    portfolioWeight: Number((portfolioWeight * 100).toFixed(2)),
                    maxWeight: Number((maxWeight * 100).toFixed(1)),
                    capacityPlanAmount,
                    tradeCurrency: tickerCurrencyMap[symbol] || ((portfolio.currency as TradeCurrency) || 'USD'),
                    pullbackPrice,
                    deepPullbackPrice,
                    confidence,
                    score,
                    reason: `${status} winner with positive trend and position headroom (${(headroom * 100).toFixed(1)}% remaining to max weight).`,
                });
            });
        });

        if (candidates.length === 0) return [];

        const ranked = candidates.sort((a, b) => b.score - a.score).slice(0, 8);
        const scoreTotal = ranked.reduce((sum, c) => sum + c.score, 0) || 1;

        const allocated = ranked
            .map((c) => {
                const proportional = Math.round((addOnPoolBudget * c.score) / scoreTotal);
                const suggestedPlanAmount = Math.min(c.capacityPlanAmount, Math.max(0, proportional));
                const amountInTradeCurrency = Math.max(0, Number(convertPlanToTrade(suggestedPlanAmount, c.tradeCurrency).toFixed(2)));
                const suggestedQuantity = c.pullbackPrice > 0 ? Number((amountInTradeCurrency / c.pullbackPrice).toFixed(4)) : 0;
                return {
                    ...c,
                    suggestedPlanAmount,
                    amountInTradeCurrency,
                    suggestedQuantity,
                };
            })
            .filter((c) => c.suggestedPlanAmount > 0 && c.amountInTradeCurrency > 0)
            .sort((a, b) => b.gainLossPct - a.gainLossPct)
            .slice(0, 6);

        return allocated;
    }, [data, data?.portfolioUniverse, sarPerUsd, plan.monthlyBudget, planCurrency, simulatedPrices, tickerCurrencyMap, universePortfolioId]);

    const addOnSymbols = useMemo(() => addOnOpportunities.map((o) => o.symbol), [addOnOpportunities]);
    const { names: addOnCompanyNames } = useCompanyNames(addOnSymbols);

    const handleExecutePlan = async (forceRuleBased = false) => {
        setIsExecuting(true);
        setExecutionResult(null);
        setExecutionError(null);
        try {
            const result = await executeInvestmentPlanStrategy(plan, effectiveExecutionUniverse, {
                forceRuleBased,
                planCurrency: plan.budgetCurrency,
                tickerCurrencyMap,
                fxRate: sarPerUsd,
            });
            setExecutionResult(result);
            setExecutionError(null);

            const logEntry: InvestmentPlanExecutionLog = {
                ...result,
                id: `log-${Date.now()}`,
                user_id: '',
                created_at: new Date().toISOString(),
            };
            await saveExecutionLog(logEntry);
        } catch (error) {
            console.error("Error executing plan:", error);
            const details = formatAiError(error);

            if (!forceRuleBased) {
                try {
                    const fallbackResult = await executeInvestmentPlanStrategy(plan, effectiveExecutionUniverse, {
                        forceRuleBased: true,
                        planCurrency: plan.budgetCurrency,
                        tickerCurrencyMap,
                        fxRate: sarPerUsd,
                    });
                    setExecutionResult(fallbackResult);
                    setExecutionError(null);

                    const logEntry: InvestmentPlanExecutionLog = {
                        ...fallbackResult,
                        log_details: `${fallbackResult.log_details}

> AI execution failed. Automatically switched to rule-based mode.
> AI error: ${details}`,
                        id: `log-${Date.now()}`,
                        user_id: '',
                        created_at: new Date().toISOString(),
                    };
                    await saveExecutionLog(logEntry);
                    setSaveMessage('AI execution failed. Plan executed in rule-based mode successfully.');
                    setTimeout(() => setSaveMessage(null), 7000);
                } catch (fallbackError) {
                    setExecutionError(formatAiError(fallbackError));
                }
            } else {
                setExecutionError(details);
            }
        }
        setIsExecuting(false);
    };

    return (
        <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 sm:p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Focus here first</p>
                        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">Monthly allocation & execution</h1>
                        <p className="mt-2 text-sm text-slate-600 max-w-2xl leading-relaxed">
                            Set your monthly budget, then run <strong className="text-slate-800">Execute</strong> to generate orders. This page is separate from <strong>Trade plans</strong> (price/date rules) below.
                        </p>
                        <ol className="mt-4 flex flex-col sm:flex-row sm:flex-wrap gap-2 text-xs text-slate-700">
                            <li className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2"><span className="font-bold text-primary">1</span> Budget & Core / Upside split</li>
                            <li className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2"><span className="font-bold text-primary">2</span> Universe weights (per ticker)</li>
                            <li className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2"><span className="font-bold text-primary">3</span> Execute → record trades</li>
                        </ol>
                        <span className={`mt-3 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${!aiHealthChecked ? 'bg-slate-100 text-slate-600 border border-slate-200' : isAiAvailable ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                            Execution AI {!aiHealthChecked ? 'checking…' : isAiAvailable ? 'available' : 'off — rule-based only'}
                        </span>
                    </div>
                    <button type="button" onClick={handleSave} disabled={isSavingPlan} className="shrink-0 px-6 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors font-semibold disabled:opacity-60 disabled:cursor-not-allowed shadow-sm" aria-busy={isSavingPlan}>
                        {isSavingPlan ? 'Saving…' : 'Save plan'}
                    </button>
                </div>
            </section>
            {personalPortfolios.length > 0 && (
                <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-sm font-bold text-indigo-950 uppercase tracking-wide">Portfolio for this plan</h2>
                            <p className="text-sm text-indigo-900/90 mt-1">
                                Monthly budget, allocations, and universe weights below are saved <strong>per portfolio</strong>. Switch to configure another account.
                            </p>
                        </div>
                        <label className="flex flex-col gap-1 min-w-[12rem]">
                            <span className="text-xs font-semibold text-indigo-800">Investment portfolio</span>
                            <select
                                value={selectedPortfolioId ?? personalPortfolios[0]?.id ?? ''}
                                onChange={(e) => setSelectedPortfolioId(e.target.value || null)}
                                className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm"
                            >
                                {personalPortfolios.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                </section>
            )}
            {personalPortfolios.length === 0 && (
                <section className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950">
                    Create an <strong>investment portfolio</strong> under Portfolios first—then you can set a plan and universe for each one.
                </section>
            )}
            {saveError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center justify-between" role="alert" aria-live="polite">
                    <span>{saveError}</span>
                    <button type="button" onClick={() => setSaveError(null)} className="text-red-700 font-medium hover:underline shrink-0 ml-2">Dismiss</button>
                </div>
            )}
            {saveMessage && (
                <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm flex items-center justify-between" role="status" aria-live="polite">
                    <span>{saveMessage}</span>
                    {onOpenWealthUltra && <button type="button" onClick={onOpenWealthUltra} className="text-green-700 font-medium hover:underline whitespace-nowrap ml-2">Open Wealth Ultra</button>}
                </div>
            )}
            {(onNavigateToTab || onOpenWealthUltra) && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <span className="font-semibold text-slate-500 uppercase tracking-wider">Related:</span>
                    {onNavigateToTab && (
                        <>
                            <button type="button" onClick={() => onNavigateToTab('Portfolios')} className="text-primary font-medium hover:underline">Portfolios</button>
                            <span className="text-slate-300">·</span>
                            <button type="button" onClick={() => onNavigateToTab('Watchlist')} className="text-primary font-medium hover:underline">Watchlist</button>
                            <span className="text-slate-300">·</span>
                            <button type="button" onClick={() => onNavigateToTab('AI Rebalancer')} className="text-primary font-medium hover:underline">AI Rebalancer</button>
                            <span className="text-slate-300">·</span>
                            <button type="button" onClick={() => onNavigateToTab('Recovery Plan')} className="text-primary font-medium hover:underline">Recovery Plan</button>
                        </>
                    )}
                    {onOpenWealthUltra && <>{onNavigateToTab && <span className="text-slate-300">·</span>}<button type="button" onClick={onOpenWealthUltra} className="text-primary font-medium hover:underline">Wealth Ultra</button></>}
                </div>
            )}

            {/* How it works — Plan → Universe → Execute / Wealth Ultra */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
                <button type="button" onClick={() => setShowFlowNote(!showFlowNote)} className="w-full px-4 py-3 flex items-center justify-between text-left text-sm font-medium text-slate-800 hover:bg-slate-100">
                    <span>How this works: Plan → Universe → Execute / Wealth Ultra</span>
                    <span className="text-slate-500">{showFlowNote ? 'Hide' : 'Show'}</span>
                </button>
                {showFlowNote && (
                    <div className="px-4 pb-4 pt-3 border-t border-slate-200 bg-white/70">
                        <ol className="space-y-2.5 text-sm text-slate-700">
                            <li className="flex items-start gap-2">
                                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700 shrink-0">1</span>
                                <p><strong>Set budget & allocation</strong> (monthly amount, Core % vs High-Upside %).</p>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700 shrink-0">2</span>
                                <p><strong>Build your universe</strong> via Watchlist or the table below. Set status to <em>Core</em> / <em>High-Upside</em> and optional weights (target ~100% combined).</p>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700 shrink-0">3</span>
                                <p><strong>Sync (optional)</strong> using “Sync Core/Upside from Universe” so plan + execution + Wealth Ultra all use the same ticker set.</p>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700 shrink-0">4</span>
                                <p><strong>Execute or open Wealth Ultra</strong> to generate allocations/orders and then record actual trades directly from results.</p>
                            </li>
                        </ol>
                    </div>
                )}
            </div>

            {/* Plan health — smart readiness summary with gauge and next step */}
            <SectionCard title="Plan health" className="bg-gradient-to-r from-emerald-50/60 to-slate-50/80 border-emerald-100" collapsible collapsibleSummary="Readiness score" defaultExpanded>
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 lg:gap-6">
                    <div className="flex items-start gap-4">
                        <div className="relative shrink-0 w-14 h-14 rounded-full bg-white border-2 border-emerald-200 flex items-center justify-center">
                            <svg className="absolute inset-0 w-14 h-14 -rotate-90" viewBox="0 0 36 36">
                                <path d="M18 2.084 a 15.916 15.916 0 0 1 0 31.832 a 15.916 15.916 0 0 1 0 -31.832" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-100" strokeLinecap="round" />
                                <path d="M18 2.084 a 15.916 15.916 0 0 1 0 31.832 a 15.916 15.916 0 0 1 0 -31.832" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray={`${planHealth.score}, 100`} className={planHealth.score >= 85 ? 'text-emerald-500' : planHealth.score >= 65 ? 'text-amber-500' : 'text-rose-500'} strokeLinecap="round" />
                            </svg>
                            <span className="relative text-lg font-bold tabular-nums text-slate-800">{planHealth.score}</span>
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-slate-800">{planHealth.label}</p>
                            <p className="text-xs text-slate-600 mt-0.5">{planHealth.summary}</p>
                            {planHealth.nextStep && planHealth.score < 100 && (
                                <p className="mt-2 text-xs font-medium text-amber-800 bg-amber-100/80 rounded-md px-2 py-1 inline-block">
                                    Next: {planHealth.nextStep}
                                </p>
                            )}
                        </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 sm:gap-3 text-xs text-slate-600 w-full lg:w-auto lg:min-w-[360px]">
                        <div className="rounded-lg border border-emerald-100 bg-white/80 px-3 py-2">
                            <dt className="font-medium text-slate-700">Monthly budget</dt>
                            <dd className="text-slate-900 text-sm mt-0.5 whitespace-nowrap">
                                <CurrencyDualDisplay value={plan.monthlyBudget ?? 0} inCurrency={planCurrency} digits={0} size="base" weight="bold" />
                            </dd>
                        </div>
                        <div className="rounded-lg border border-emerald-100 bg-white/80 px-3 py-2">
                            <dt className="font-medium text-slate-700">Core / Upside mix</dt>
                            <dd className="font-mono tabular-nums text-slate-900 text-sm mt-0.5 whitespace-nowrap">{planHealth.corePct.toFixed(0)}% / {planHealth.upsidePct.toFixed(0)}%</dd>
                        </div>
                        <div className="rounded-lg border border-emerald-100 bg-white/80 px-3 py-2">
                            <dt className="font-medium text-slate-700">Actionable tickers</dt>
                            <dd className="font-mono tabular-nums text-slate-900 text-sm mt-0.5">{universeHealth.actionableCount}</dd>
                        </div>
                        <div className="rounded-lg border border-emerald-100 bg-white/80 px-3 py-2">
                            <dt className="font-medium text-slate-700">Weight coverage</dt>
                            <dd className="font-mono tabular-nums text-slate-900 text-sm mt-0.5">{(universeHealth.monthlyWeightTotal * 100).toFixed(1)}%</dd>
                        </div>
                    </dl>
                </div>
            </SectionCard>

            <div className="cards-grid grid grid-cols-1 xl:grid-cols-12 gap-6">
                <div className="xl:col-span-7 space-y-6 min-w-0">
                    {/* Allocation Settings — essential fields first */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <h2 className="text-xl font-semibold text-slate-800">Monthly Plan</h2>
                                <p className="text-sm text-slate-500 mt-1">Set how much to invest each month and how to split it between Core (stable) and High-Upside (growth) tickers.</p>
                            </div>
                            <button
                                type="button"
                                onClick={applySmartPlan}
                                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-primary text-white hover:bg-secondary shadow-sm"
                            >
                                <SparklesIcon className="h-4 w-4" />
                                Smart-fill plan
                            </button>
                        </div>
                        {saveMessage && (
                            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm" role="status" aria-live="polite">
                                {saveMessage}
                            </div>
                        )}
                        {suggestedMonthlyBudget > 0 && (plan.monthlyBudget ?? 0) !== suggestedMonthlyBudget && (
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold text-emerald-800">Suggested monthly budget</p>
                                    <p className="text-xs text-emerald-700 mt-0.5">{suggestedBudgetSource}</p>
                                    <div className="text-lg mt-1">
                                        <CurrencyDualDisplay value={suggestedMonthlyBudget} inCurrency={planCurrency} digits={0} size="xl" className="text-emerald-900" />
                                    </div>
                                </div>
                                <button type="button" onClick={() => handlePlanChange('monthlyBudget', suggestedMonthlyBudget)} className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700">Use this budget</button>
                            </div>
                        )}
                        {allocationWarning && (
                            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">{allocationWarning}</div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 flex items-center gap-1.5">Monthly Budget <InfoHint text="Amount you allocate to invest each month; split between Core and High-Upside by the percentages below. Suggested value is derived from your recent buys or portfolio size." hintId="plan-monthly-budget" hintPage="Investments" /></label>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <input type="number" value={plan.monthlyBudget} onChange={e => handlePlanChange('monthlyBudget', parseFloat(e.target.value) || 0)} className="flex-1 min-w-0 p-2.5 border border-slate-200 rounded-lg" />
                                    {suggestedMonthlyBudget > 0 && (
                                        <button type="button" onClick={() => handlePlanChange('monthlyBudget', suggestedMonthlyBudget)} className="text-sm text-primary font-medium hover:underline whitespace-nowrap">Use suggested</button>
                                    )}
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 flex items-center">Budget Currency <InfoHint text="Currency for plan amounts (e.g. SAR); read from app defaults." hintId="plan-budget-currency" hintPage="Investments" /></label>
                                <input type="text" value={plan.budgetCurrency} disabled className="mt-1 w-full p-2 border rounded-md bg-gray-100" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 flex items-center">Core Allocation (%) <InfoHint text="Share of monthly budget for stable Core assets (e.g. index funds); the rest goes to High-Upside." hintId="plan-core-allocation" hintPage="Investments" /></label>
                                <input type="number" step="0.01" value={Number(((plan.coreAllocation ?? 0) * 100).toFixed(2))} onChange={e => handleCoreAllocationPercentChange(e.target.value)} className="mt-1 w-full p-2 border rounded-md" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 flex items-center">High-Upside Allocation (%) <InfoHint text="Share for analyst-upside assets; only tickers meeting analyst targets get this allocation." hintId="plan-high-upside-allocation" hintPage="Investments" /></label>
                                <input type="number" step="0.01" value={Number(((plan.upsideAllocation ?? 0) * 100).toFixed(2))} onChange={e => handleUpsideAllocationPercentChange(e.target.value)} className="mt-1 w-full p-2 border rounded-md" />
                            </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Live execution split <InfoHint text="Updates as you change budget or allocation. Core and High-Upside amounts drive how much goes to each sleeve when you run Execute." hintId="plan-execution-split" hintPage="Investments" /></p>
                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-700">
                                <span className="tabular-nums inline-flex items-baseline gap-2">
                                    Core {planHealth.corePct.toFixed(0)}% →{' '}
                                    <CurrencyDualDisplay value={coreShareAmount} inCurrency={planCurrency} digits={0} size="base" weight="bold" className="text-slate-900" />
                                </span>
                                <span className="tabular-nums inline-flex items-baseline gap-2">
                                    High-Upside {planHealth.upsidePct.toFixed(0)}% →{' '}
                                    <CurrencyDualDisplay value={upsideShareAmount} inCurrency={planCurrency} digits={0} size="base" weight="bold" className="text-slate-900" />
                                </span>
                            </div>
                            {executionPreview.totalOrders >= 0 && (plan.monthlyBudget ?? 0) > 0 && (
                                <p className="text-xs text-slate-500 mt-2">If you execute now: ~<strong className="tabular-nums">{executionPreview.totalOrders}</strong> orders (Core ~{executionPreview.coreOrders}, Upside ~{executionPreview.upsideOrders})</p>
                            )}
                        </div>

                        {planAdvancedOpen && (
                            <>
                                <div className="mt-6 pt-4 border-t border-gray-100">
                                    <h3 className="text-sm font-semibold text-gray-700 mb-1">Analyst & eligibility</h3>
                                    <p className="text-xs text-slate-500 mb-3">Values are auto-filled from defaults or AI (not manually entered). Use &quot;Auto-fill with AI&quot; to refresh from your universe.</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="md:col-span-2">
                                            <label className="block text-sm font-medium text-gray-700 flex items-center">Minimum Analyst Upside (%) <InfoHint text="Minimum price upside from analyst targets to be eligible for High-Upside sleeve." hintId="plan-min-analyst-upside" hintPage="Investments" /></label>
                                            <div className="mt-1 w-full p-2 border rounded-md bg-slate-50 text-slate-800 tabular-nums">{plan.minimumUpsidePercentage}</div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">Stale Days (Analyst Target)</label>
                                            <div className="mt-1 w-full p-2 border rounded-md bg-slate-50 text-slate-800 tabular-nums">{plan.stale_days}</div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">Min Coverage (Analysts)</label>
                                            <div className="mt-1 w-full p-2 border rounded-md bg-slate-50 text-slate-800 tabular-nums">{plan.min_coverage_threshold}</div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">Redirect Policy</label>
                                            <div className="mt-1 w-full p-2 border rounded-md bg-slate-50 text-slate-800">{plan.redirect_policy === 'priority' ? 'Priority (Sequential)' : 'Pro-rata (Balanced)'}</div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">Target Provider</label>
                                            <div className="mt-1 w-full p-2 border rounded-md bg-slate-50 text-slate-800">{plan.target_provider || '—'}</div>
                                        </div>
                                    </div>
                                    <div className="mt-3">
                                        <button
                                            type="button"
                                            onClick={handleAutoFillAnalyst}
                                            disabled={isFillingAnalyst}
                                            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <SparklesIcon className="h-4 w-4" />
                                            {isFillingAnalyst ? 'Filling…' : 'Auto-fill with AI'}
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-6 pt-4 border-t border-gray-100">
                                    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1">
                                        Broker & execution
                                        <InfoHint text="These settings match your broker so Execute & View Results produces realistic orders. Minimum order size: trades below this are redirected to Core. Rounding and fractional shares affect how amounts are converted to share quantities. Leftover cash can be re-invested in Core or held." hintId="plan-broker-constraints" hintPage="Investments" />
                                    </h3>
                                    {minOrderWarning && (
                                        <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">{minOrderWarning}</div>
                                    )}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 flex items-center">Minimum Order Size ({plan.budgetCurrency})</label>
                                            <input type="number" value={plan.brokerConstraints.minimumOrderSize} onChange={e => handlePlanChange('brokerConstraints', {...plan.brokerConstraints, minimumOrderSize: parseFloat(e.target.value)})} className="mt-1 w-full p-2 border rounded-md" />
                                        </div>
                                        <div className="flex items-center">
                                            <input type="checkbox" checked={plan.brokerConstraints.allowFractionalShares} onChange={e => handlePlanChange('brokerConstraints', {...plan.brokerConstraints, allowFractionalShares: e.target.checked})} id="fractional-shares" className="h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" />
                                            <label htmlFor="fractional-shares" className="ml-2 block text-sm text-gray-900">Allow Fractional Shares</label>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">Rounding Rule</label>
                                            <select value={plan.brokerConstraints.roundingRule} onChange={e => handlePlanChange('brokerConstraints', {...plan.brokerConstraints, roundingRule: e.target.value as any})} className="mt-1 w-full p-2 border rounded-md">
                                                <option value="round">Round to nearest</option>
                                                <option value="floor">Floor (round down)</option>
                                                <option value="ceil">Ceiling (round up)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">Leftover Cash Rule</label>
                                            <select value={plan.brokerConstraints.leftoverCashRule} onChange={e => handlePlanChange('brokerConstraints', {...plan.brokerConstraints, leftoverCashRule: e.target.value as any})} className="mt-1 w-full p-2 border rounded-md">
                                                <option value="reinvest_core">Re-invest in Core</option>
                                                <option value="hold">Hold in account</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                        <button type="button" onClick={() => setPlanAdvancedOpen(!planAdvancedOpen)} className="mt-4 text-sm font-medium text-primary hover:underline">
                            {planAdvancedOpen ? 'Hide advanced options' : 'Show advanced options (analyst rules, broker)'}
                        </button>
                    </div>
                </div>

                {/* Execute & Results — right side of Monthly Plan */}
                <div className="xl:col-span-5 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden self-start min-w-0">
                    <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-indigo-50 via-violet-50 to-slate-50">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-xl font-bold text-slate-800 mb-1">Execute & Results</h2>
                                <p className="text-sm text-slate-600">Run AI-assisted execution and instantly review the allocation, trades, and audit log.</p>
                            </div>
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${!aiHealthChecked ? 'bg-slate-100 text-slate-600' : isAiAvailable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                {!aiHealthChecked ? 'Checking…' : isAiAvailable ? 'AI ready' : 'AI unavailable'}
                            </span>
                        </div>
                    </div>
                    <div className="p-6">
                        {aiHealthChecked && !isAiAvailable && (
                            <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                                AI provider is temporarily unavailable. Execute with AI will automatically switch to deterministic rule-based logic and still return results.
                            </div>
                        )}
                        {actionableCount > 0 && (plan.monthlyBudget ?? 0) > 0 && (
                            <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-900">
                                <span className="font-medium">Preview:</span> Running now would deploy{' '}
                                <CurrencyDualDisplay value={coreShareAmount + upsideShareAmount} inCurrency={planCurrency} digits={0} size="base" weight="bold" className="text-indigo-950 inline" />{' '}
                                across ~<strong>{executionPreview.totalOrders}</strong> orders (Core ~{executionPreview.coreOrders}, Upside ~{executionPreview.upsideOrders}).
                            </div>
                        )}
                        {executionUniverse.filter((t) => t.status === 'Core' || t.status === 'High-Upside').length === 0 && holdingsFallbackUniverse.length > 0 && (
                            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                                No actionable universe entries found for this portfolio. Execution will use current holdings as temporary Core candidates.
                            </div>
                        )}
                        {noActionableWarning && (
                            <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-start gap-2">{noActionableWarning}</div>
                        )}
                        {executionError && (
                            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex flex-col gap-2">
                                <span>{executionError}</span>
                                {onOpenWealthUltra && /quota|Wealth Ultra/i.test(executionError) && (
                                    <button type="button" onClick={onOpenWealthUltra} className="self-start px-3 py-1.5 rounded-md bg-primary text-white text-sm font-medium hover:bg-secondary">
                                        Open Wealth Ultra (rule-based, no AI)
                                    </button>
                                )}
                            </div>
                        )}
                        <div className="flex flex-col gap-2">
                            <button onClick={() => handleExecutePlan(false)} disabled={isExecuting || actionableCount === 0} className="w-full flex items-center justify-center px-4 py-2.5 bg-secondary text-white rounded-lg hover:bg-violet-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium" title={actionableCount === 0 ? 'Add Core or High-Upside tickers first' : 'Run with AI first, then fall back to rule-based if needed'}>
                                <SparklesIcon className="h-5 w-5 mr-2" />
                                {isExecuting ? 'Executing...' : 'Execute with AI'}
                            </button>
                            <button onClick={() => handleExecutePlan(true)} disabled={isExecuting || actionableCount === 0} className="w-full flex items-center justify-center px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:bg-gray-100 disabled:cursor-not-allowed font-medium" title="Skip AI and use rule-based allocation only">
                                Run rule-based only
                            </button>
                        </div>

                        {isExecuting && <div className="text-center p-4 text-sm text-slate-500 font-medium">Executing plan…</div>}

                        {executionResult && (
                            <div className="mt-6 space-y-5">
                                <p className="text-xs text-slate-500">Plan totals are in <strong>{planCurrency}</strong>. Trade rows also show each ticker's native currency (e.g., USD for US shares). Execution date: {executionResult.date ? new Date(executionResult.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}.</p>
                                <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
                                    <p className="font-semibold">Advisor quick brief</p>
                                    <p className="mt-1">{executionResult.status === 'success'
                                        ? `Execution completed with ${executionResult.trades.length} trade${executionResult.trades.length === 1 ? '' : 's'} and ${formatCurrencyString(executionResult.unusedUpsideFunds, { inCurrency: planCurrency, digits: 0 })} unallocated; prioritize deploying residual cash in next cycle only if eligibility remains valid.`
                                        : 'Execution did not produce a valid allocation. Update Core/High-Upside eligibility and rerun to recover plan coverage.'}</p>
                                </div>

                                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                                    <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
                                        <h3 className="font-semibold text-slate-800">Execution Summary</h3>
                                        <div className="flex items-center gap-2">
                                            {executionResult.log_details?.includes('Rule-based execution') && (
                                                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-200 text-slate-700" title="Computed without AI (rule-based fallback)">Rule-based</span>
                                            )}
                                            {!executionResult.log_details?.includes('Rule-based execution') && (
                                                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700" title="Computed with AI-assisted execution">AI-assisted</span>
                                            )}
                                            <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${executionResult.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                {executionResult.status.toUpperCase()}
                                            </span>
                                        </div>
                                    </div>
                                    {executionResult.status === 'failure' && (
                                        <p className="text-sm text-amber-800 mb-3">No allocation could be generated. Add Core or High-Upside tickers in Portfolio Universe and set weights, then run again.</p>
                                    )}
                                    <dl className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3 min-w-0 text-sm">
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 flex flex-col gap-1 min-w-0">
                                            <dt className="text-slate-600">Monthly budget</dt>
                                            <dd className="text-left min-w-0">
                                                <CurrencyDualDisplay value={plan.monthlyBudget ?? 0} inCurrency={planCurrency} digits={0} size="base" weight="bold" className="justify-end text-slate-800" />
                                            </dd>
                                        </div>
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 flex flex-col gap-1 min-w-0">
                                            <dt className="text-slate-600">Total deployed</dt>
                                            <dd className="text-left min-w-0">
                                                <CurrencyDualDisplay value={executionResult.totalInvestment} inCurrency={planCurrency} digits={0} size="base" weight="bold" className="justify-end text-slate-800" />
                                            </dd>
                                        </div>
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 flex flex-col gap-1 min-w-0">
                                            <dt className="text-slate-600">Core</dt>
                                            <dd className="text-left min-w-0">
                                                <CurrencyDualDisplay value={executionResult.coreInvestment} inCurrency={planCurrency} digits={0} size="base" className="justify-end text-slate-700" />
                                            </dd>
                                        </div>
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 flex flex-col gap-1 min-w-0">
                                            <dt className="text-slate-600">High-Upside</dt>
                                            <dd className="text-left min-w-0">
                                                <CurrencyDualDisplay value={executionResult.upsideInvestment} inCurrency={planCurrency} digits={0} size="base" className="justify-end text-slate-700" />
                                            </dd>
                                        </div>
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 flex flex-col gap-1 min-w-0">
                                            <dt className="text-slate-600">Unused</dt>
                                            <dd className="text-left min-w-0">
                                                <CurrencyDualDisplay value={executionResult.unusedUpsideFunds} inCurrency={planCurrency} digits={0} size="base" className="justify-end text-slate-700" />
                                            </dd>
                                        </div>
                                    </dl>
                                    <p className="text-xs text-slate-500 mt-2">Total deployed + unused should match monthly budget (within rounding).</p>
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-800 mb-2">Proposed Trades</h3>
                                    {executionResult.trades.length === 0 ? (
                                        <p className="text-sm text-slate-500 py-2">No trades proposed.</p>
                                    ) : (
                                        <div className="rounded-lg border border-slate-200 overflow-x-auto">
                                            <table className="w-full min-w-[760px] text-sm">
                                                <thead>
                                                    <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                                                        <th className="w-[22%] px-3 py-2 font-semibold">Ticker</th>
                                                        <th className="px-3 py-2 font-semibold">Sleeve / Reason</th>
                                                        <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">Amount</th>
                                                        {onOpenRecordTrade && <th className="px-3 py-2 w-28" />}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {executionResult.trades.map((trade, index) => {
                                                        const suggestion = getTradeExecutionSuggestion(trade);
                                                        return (
                                                            <tr key={index} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                                                                <td className="px-3 py-2 font-medium text-slate-800">{trade.ticker}</td>
                                                                <td className="px-3 py-2 text-slate-600">{trade.reason}</td>
                                                                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-primary whitespace-nowrap align-top">
                                                                    <CurrencyDualDisplay value={suggestion.amountInTradeCurrency} inCurrency={suggestion.tradeCurrency} digits={0} size="base" weight="bold" className="justify-end text-primary" />
                                                                </td>
                                                                {onOpenRecordTrade && (
                                                                    <td className="px-3 py-2 text-right">
                                                                        <button type="button" onClick={() => onOpenRecordTrade({ ticker: trade.ticker, amount: suggestion.amountInTradeCurrency, reason: trade.reason, price: suggestion.suggestedPrice, quantity: suggestion.suggestedQuantity, tradeCurrency: suggestion.tradeCurrency })} className="text-xs px-2.5 py-1.5 rounded-md border border-primary text-primary hover:bg-primary hover:text-white transition-colors whitespace-nowrap">Record trade</button>
                                                                    </td>
                                                                )}
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                    {onOpenWealthUltra && <p className="text-xs text-slate-500 mt-3">Use <button type="button" onClick={onOpenWealthUltra} className="text-primary font-medium hover:underline">Wealth Ultra</button> to see live allocation and export orders.</p>}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Portfolio Universe — full width row */}
                <div className="xl:col-span-12">
                    <div className="bg-white p-6 rounded-lg shadow">
                        <div className="mb-4">
                            <h2 className="text-xl font-semibold text-dark flex items-center gap-2 min-w-0">
                                <span>Portfolio Universe & Weights</span>
                                <span className="inline-flex items-center flex-shrink-0">
                                    <InfoHint text="Scoped to the portfolio selected above. Tickers and their status (Core, High-Upside, Speculative, etc.) with optional monthly weights. Core and High-Upside drive allocation; weights define how this portfolio’s monthly budget is split. Sync from Watchlist or add manually." hintId="plan-universe-tickers" hintPage="Investments" />
                                </span>
                            </h2>
                            <p className="text-sm text-gray-500 mt-1">Define your assets and weights. Status drives automation: Core and High-Upside receive the monthly budget split; other statuses are handled as shown in Plan role.</p>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4 text-xs">
                            <div className="p-2 rounded border bg-slate-50"><p className="text-gray-500">Tickers</p><p className="font-semibold text-dark">{universeHealth.totalCount}</p></div>
                            <div className="p-2 rounded border bg-slate-50"><p className="text-gray-500">Actionable</p><p className="font-semibold text-dark">{universeHealth.actionableCount}</p></div>
                            <div className="p-2 rounded border bg-slate-50"><p className="text-gray-500">Weight total</p><p className={`font-semibold ${Math.abs(universeHealth.monthlyWeightTotal - 1) <= 0.01 ? 'text-green-700' : 'text-amber-700'}`}>{(universeHealth.monthlyWeightTotal * 100).toFixed(1)}%</p></div>
                            <div className="p-2 rounded border bg-slate-50"><p className="text-gray-500">Over max</p><p className={`font-semibold ${universeHealth.overMaxCount === 0 ? 'text-green-700' : 'text-rose-700'}`}>{universeHealth.overMaxCount}</p></div>
                            <div className="p-2 rounded border bg-slate-50"><p className="text-gray-500">Needs mapping</p><p className={`font-semibold ${universeHealth.unmappedCount === 0 ? 'text-green-700' : 'text-amber-700'}`}>{universeHealth.unmappedCount}</p></div>
                        </div>
                        {Math.abs(universeHealth.monthlyWeightTotal - 1) > 0.01 && (
                            <p className="text-xs mb-4 text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">Actionable monthly weights should usually sum close to 100% for predictable allocation behavior.</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                            <label className="text-xs font-medium text-slate-600">Filter:</label>
                            <select value={universeFilter} onChange={e => setUniverseFilter(e.target.value as any)} className="p-2 border border-slate-200 rounded-lg text-sm bg-white">
                                <option value="all">All ({universeHealth.totalCount})</option>
                                <option value="Core">Core</option>
                                <option value="High-Upside">High-Upside</option>
                                <option value="Watchlist">Watchlist</option>
                                <option value="Needs mapping">Needs mapping</option>
                            </select>
                            <label className="text-xs font-medium text-slate-600 ml-2">Sort:</label>
                            <select value={universeSort} onChange={e => setUniverseSort(e.target.value as any)} className="p-2 border border-slate-200 rounded-lg text-sm bg-white">
                                <option value="ticker">Ticker A–Z</option>
                                <option value="status">Status</option>
                                <option value="weight">Weight (high first)</option>
                            </select>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-4">
                            {canAddWatchlistHoldings && (
                                <button type="button" onClick={addWatchlistAndHoldingsToUniverse} className="px-3 py-2 text-sm border border-primary/40 text-primary rounded-lg hover:bg-primary/5 font-medium">Add Watchlist & Holdings to Universe</button>
                            )}
                            <button type="button" onClick={syncPlanFromUniverse} className="px-3 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700">Sync Core/Upside from Universe</button>
                            <button type="button" onClick={autoConfigureUniverseWeights} className="px-3 py-2 text-sm border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 font-medium">Auto-configure weights</button>
                            <input type="text" placeholder="Ticker (e.g., AAPL)" value={newTicker.ticker} onChange={e => setNewTicker(p => ({...p, ticker: e.target.value.toUpperCase()}))} className="p-2 border border-slate-200 rounded-lg min-w-[100px]" />
                            <input type="text" placeholder="Company Name" value={newTicker.name} onChange={e => setNewTicker(p => ({...p, name: e.target.value}))} className="flex-grow min-w-[120px] p-2 border border-slate-200 rounded-lg" />
                            <button onClick={handleAddNewTicker} className="p-2 bg-primary text-white rounded-lg hover:bg-secondary"><PlusIcon className="h-5 w-5" /></button>
                        </div>
                        <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-100">
                            <table className="min-w-[1100px] w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-gray-50 sticky top-0"><tr>
                                    <th className="px-3 py-2 text-left font-medium text-gray-500 align-middle">Ticker</th>
                                    <th className="px-3 py-2 text-left font-medium text-gray-500 align-middle">Name</th>
                                    <th className="px-3 py-2 text-left font-medium text-gray-500 align-middle">
                                        <span className="inline-flex items-center gap-1 whitespace-nowrap">Status <InfoHint text="Core and High-Upside get allocation; Speculative gets a small share; Quarantine/Excluded get none." hintId="plan-universe-status" hintPage="Investments" /></span>
                                    </th>
                                    <th className="px-3 py-2 text-left font-medium text-gray-500 align-middle min-w-[12rem] max-w-[16rem]">
                                        <span className="inline-flex items-center gap-1">Plan role <InfoHint text="Derived from status: shows how the system treats this ticker in monthly execution (no manual entry)." hintId="plan-universe-role" hintPage="Investments" /></span>
                                    </th>
                                    <th className="px-3 py-2 text-center font-medium text-gray-500 align-middle">
                                        <span className="inline-flex items-center justify-center gap-1 whitespace-nowrap">Monthly Wt <InfoHint text="Share of this sleeve's budget (e.g. 50% = half of Core budget goes here). Weights should sum to ~100% per sleeve." hintId="plan-monthly-wt" hintPage="Investments" /></span>
                                    </th>
                                    <th className="px-3 py-2 text-center font-medium text-gray-500 align-middle">
                                        <span className="inline-flex items-center justify-center gap-1 whitespace-nowrap">Max Pos Wt <InfoHint text="Cap on a single ticker's share of the sleeve (e.g. 0.25 = max 25%)." hintId="plan-max-pos-wt" hintPage="Investments" /></span>
                                    </th>
                                    <th className="px-3 py-2 text-right font-medium text-gray-500 align-middle">Actions</th>
                                </tr></thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {filteredAndSortedUniverse.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                                                {unifiedUniverse.length === 0 ? (
                                                    <>
                                                        <p className="font-medium text-slate-700">No tickers in universe yet</p>
                                                        <p className="text-sm mt-1 max-w-md mx-auto">Add tickers using the fields above, or use &quot;Add Watchlist &amp; Holdings to Universe&quot; to pull from your watchlist and current holdings. Set status to Core or High-Upside for allocation.</p>
                                                        {onNavigateToTab && (
                                                            <button type="button" onClick={() => onNavigateToTab('Watchlist')} className="mt-3 text-sm font-medium text-primary hover:underline">Go to Watchlist</button>
                                                        )}
                                                    </>
                                                ) : (
                                                    <p className="font-medium text-slate-700">No tickers match the current filter. Try &quot;All&quot; or another filter.</p>
                                                )}
                                            </td>
                                        </tr>
                                    ) : filteredAndSortedUniverse.map(ticker => (
                                        <tr key={ticker.id} className="hover:bg-gray-50">
                                            <td className="px-4 py-2 font-bold text-dark">
                                                {ticker.ticker}
                                                <div className="text-[10px] text-gray-400 font-normal">{ticker.source}</div>
                                            </td>
                                            <td className="px-4 py-2 text-gray-600">{ticker.name}</td>
                                            <td className="px-4 py-2">
                                                <select value={ticker.status} onChange={e => handleStatusUpdate(ticker, e.target.value as TickerStatus)} className="p-1 border rounded-md text-xs">
                                                    <option>Core</option>
                                                    <option>High-Upside</option>
                                                    <option>Watchlist</option>
                                                    <option>Quarantine</option>
                                                    <option>Speculative</option>
                                                    <option>Excluded</option>
                                                </select>
                                            </td>
                                            <td className="px-4 py-2 text-xs text-slate-700 align-top">
                                                {getUniverseRowPlanRole(ticker)}
                                            </td>
                                            <td className="px-4 py-2 text-center">
                                                {isUniverseTicker(ticker) ? (
                                                    isActionableUniverseStatus(ticker.status) ? (
                                                        <>
                                                            <input 
                                                                type="number" 
                                                                value={ticker.monthly_weight != null ? ticker.monthly_weight * 100 : ''} 
                                                                onChange={e => { const nextWeight = parsePercentInputToWeight(e.target.value); if (nextWeight == null) return; updateUniverseTickerStatus(ticker.id, ticker.status, { monthly_weight: nextWeight }); }}
                                                                onBlur={autoConfigureUniverseWeights}
                                                                className="w-16 p-1 border rounded text-right text-xs"
                                                                placeholder="auto"
                                                            />
                                                            <span className="text-[10px] ml-1 text-gray-400">%</span>
                                                        </>
                                                    ) : (
                                                        <span className="text-[10px] text-gray-400" title="Auto-managed: non-actionable statuses do not receive allocation">Auto</span>
                                                    )
                                                ) : (
                                                    <span className="text-[10px] text-gray-400" title="Add to universe above to set weights">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2 text-center">
                                                {isUniverseTicker(ticker) ? (
                                                    isActionableUniverseStatus(ticker.status) ? (
                                                        <>
                                                            <input 
                                                                type="number" 
                                                                value={ticker.max_position_weight != null ? ticker.max_position_weight * 100 : ''} 
                                                                onChange={e => { const nextWeight = parsePercentInputToWeight(e.target.value); if (nextWeight == null) return; updateUniverseTickerStatus(ticker.id, ticker.status, { max_position_weight: nextWeight }); }}
                                                                onBlur={autoConfigureUniverseWeights}
                                                                className="w-16 p-1 border rounded text-right text-xs"
                                                                placeholder="auto"
                                                            />
                                                            <span className="text-[10px] ml-1 text-gray-400">%</span>
                                                        </>
                                                    ) : (
                                                        <span className="text-[10px] text-gray-400" title="Auto-managed: non-actionable statuses use defaults">Auto</span>
                                                    )
                                                ) : (
                                                    <span className="text-[10px] text-gray-400" title="Add to universe above to set weights">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                                {isUniverseTicker(ticker) && (
                                                    <button onClick={() => deleteUniverseTicker(ticker.id)} className="p-1 text-gray-400 hover:text-danger"><TrashIcon className="h-4 w-4" /></button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div className="xl:col-span-12 w-full min-w-0">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden w-full">
                    <div className="p-6 border-b border-slate-100 bg-emerald-50/40">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <h2 className="text-xl sm:text-2xl font-bold text-slate-800 mb-1 flex flex-wrap items-center gap-2">
                                    <ArrowTrendingUpIcon className="h-7 w-7 text-emerald-600 shrink-0" aria-hidden />
                                    Smart Add-On Opportunities (Existing Winners)
                                </h2>
                                <p className="text-sm text-slate-600 max-w-4xl">Automated suggestions for buying more of profitable shares you already own, with pullback entry zones and capped sizing. Full width for easier review—scroll horizontally on small screens.</p>
                            </div>
                            <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-semibold shrink-0 self-start">AUTO</span>
                        </div>
                    </div>
                    <div className="p-6">
                        {addOnOpportunities.length === 0 ? (
                            <p className="text-sm text-slate-500">No add-on opportunities right now. Suggestions appear when a holding is profitable, actionable (Core/High-Upside), and below max position weight.</p>
                        ) : (
                            <div className="rounded-lg border border-slate-200 overflow-x-auto">
                                <table className="w-full min-w-[720px] text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                                            <th className="w-[18%] px-3 py-2 font-semibold">Share</th>
                                            <th className="w-[16%] px-3 py-2 font-semibold">Signal</th>
                                            <th className="w-[24%] px-3 py-2 font-semibold">Buy zone</th>
                                            <th className="w-[24%] px-3 py-2 font-semibold text-right">Suggested size</th>
                                            {onOpenRecordTrade && <th className="w-[132px] px-3 py-2" />}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {addOnOpportunities.map((o) => (
                                            <tr key={`${o.symbol}-${o.portfolioName}`} className="border-b border-slate-100 last:border-0 align-top hover:bg-slate-50/40">
                                                <td className="px-3 py-2 min-w-0">
                                                    <ResolvedSymbolLabel
                                                        symbol={o.symbol}
                                                        storedName={o.name}
                                                        names={addOnCompanyNames}
                                                        layout="stacked"
                                                        symbolClassName="font-semibold text-slate-800"
                                                        companyClassName="text-xs text-slate-600"
                                                    />
                                                    <div className="text-[11px] text-slate-500 truncate">{o.portfolioName} · {o.status}</div>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <div className="text-xs text-slate-700 font-medium">P/L {o.gainLossPct >= 0 ? '+' : ''}{o.gainLossPct.toFixed(1)}%</div>
                                                    <div className="text-[11px] text-slate-500">Wt {o.portfolioWeight.toFixed(1)}% / max {o.maxWeight.toFixed(1)}%</div>
                                                    <div className={`mt-1 inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${o.confidence === 'High' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{o.confidence}</div>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <div className="text-xs text-slate-700 flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                                                        <span>Pullback:</span>
                                                        <CurrencyDualDisplay value={o.pullbackPrice} inCurrency={o.tradeCurrency} digits={HOLDING_PER_UNIT_DECIMALS} size="base" weight="bold" className="inline-flex text-slate-900" />
                                                    </div>
                                                    <div className="text-xs text-slate-500 flex flex-wrap items-baseline gap-x-1 mt-0.5">
                                                        <span>Deep pullback:</span>
                                                        <CurrencyDualDisplay value={o.deepPullbackPrice} inCurrency={o.tradeCurrency} digits={HOLDING_PER_UNIT_DECIMALS} size="base" className="inline-flex" />
                                                    </div>
                                                    <div className="text-[11px] text-slate-500 mt-1 leading-snug">{o.reason}</div>
                                                </td>
                                                <td className="px-3 py-2 text-right align-top">
                                                    <CurrencyDualDisplay value={o.suggestedPlanAmount} inCurrency={planCurrency} digits={0} size="base" weight="bold" className="justify-end text-primary" />
                                                    <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                                                        {o.suggestedQuantity.toFixed(4)} sh @{' '}
                                                        <CurrencyDualDisplay value={o.pullbackPrice} inCurrency={o.tradeCurrency} digits={HOLDING_PER_UNIT_DECIMALS} size="base" className="inline-flex justify-end" />
                                                    </div>
                                                </td>
                                                {onOpenRecordTrade && (
                                                    <td className="px-3 py-2 text-right">
                                                        <button
                                                            type="button"
                                                            onClick={() => onOpenRecordTrade({
                                                                ticker: o.symbol,
                                                                amount: o.amountInTradeCurrency,
                                                                reason: `Smart add-on: ${o.reason}`,
                                                                price: o.pullbackPrice,
                                                                quantity: o.suggestedQuantity,
                                                                tradeCurrency: o.tradeCurrency,
                                                            })}
                                                            className="text-xs px-2.5 py-1.5 rounded-md border border-primary text-primary hover:bg-primary hover:text-white transition-colors whitespace-nowrap"
                                                        >
                                                            Record add-on
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
                </div>

            </div>
        </div>
    );
};
// #endregion

interface InvestmentsProps {
  pageAction?: string | null;
  clearPageAction?: () => void;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}

const Investments: React.FC<InvestmentsProps> = ({ pageAction, clearPageAction, setActivePage, triggerPageAction }) => {
  const { data, loading, addPlatform, updatePlatform, deletePlatform, recordTrade, addPortfolio, updatePortfolio, deletePortfolio, updateHolding, getAvailableCashForAccount } = useContext(DataContext)!;
  const { isAiAvailable, aiHealthChecked } = useAI();
  const { simulatedPrices } = useMarketData();
  const { formatCurrencyString } = useFormatCurrency();
  const { trackAction } = useSelfLearning();
  const [activeTab, setActiveTabState] = useState<InvestmentSubPage>('Overview');
  const setActiveTab = useCallback((tab: InvestmentSubPage) => {
    trackAction(`tab-${tab.replace(/\s+/g, '-')}`, 'Investments');
    setActiveTabState(tab);
  }, [trackAction]);
  
  const [isHoldingModalOpen, setIsHoldingModalOpen] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState<(Holding & { gainLoss: number; gainLossPercent: number; priceChangePercent?: number; }) | null>(null);
  const [selectedPortfolio, setSelectedPortfolio] = useState<InvestmentPortfolio | null>(null);
  
  const [isHoldingEditModalOpen, setIsHoldingEditModalOpen] = useState(false);
  const [holdingToEdit, setHoldingToEdit] = useState<Holding | null>(null);
  
  const [isPlatformModalOpen, setIsPlatformModalOpen] = useState(false);
  const [platformToEdit, setPlatformToEdit] = useState<Account | null>(null);
  
  const [itemToDelete, setItemToDelete] = useState<Account | InvestmentPortfolio | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [tradeInitialData, setTradeInitialData] = useState<any>(null);

  const [isPortfolioModalOpen, setIsPortfolioModalOpen] = useState(false);
  const [portfolioToEdit, setPortfolioToEdit] = useState<InvestmentPortfolio|null>(null);
  const [currentAccountId, setCurrentAccountId] = useState<string|null>(null);

  const { exchangeRate, currency: appDisplayCurrency } = useCurrency();
  const { totalValue, totalGainLoss, roi, totalDailyPnL, trendPercentage, platformsRollupSAR, commoditiesValueSAR } = useMemo(() => {
    if (!data) {
      return {
        totalValue: 0,
        totalGainLoss: 0,
        roi: 0,
        totalDailyPnL: 0,
        trendPercentage: 0,
        platformsRollupSAR: 0,
        commoditiesValueSAR: 0,
      };
    }
    const portfolios = getPersonalInvestments(data);
    const allCommodities = getPersonalCommodityHoldings(data);
    const accountsFull = data?.accounts ?? [];
    const personalAccountIds = new Set(getPersonalAccounts(data).map((a) => a.id));
    const txHitsPersonalInvestment = (t: InvestmentTransaction) => {
      const raw = (t.accountId ?? (t as { account_id?: string }).account_id ?? '').trim();
      if (!raw) return false;
      const canon = resolveCanonicalAccountId(raw, accountsFull);
      return personalAccountIds.has(canon) || personalAccountIds.has(raw);
    };
    const rate = resolveSarPerUsd(data, exchangeRate);
    const { subtotalSAR: platformsRollupSAR, dailyPnLSAR: platformsDailyPnL } = computePersonalPlatformsRollupSAR(
      data,
      rate,
      simulatedPrices,
      getAvailableCashForAccount,
    );
    const { valueSAR: commoditiesValueSAR, dailyDeltaSAR: commoditiesDailySAR } = computePersonalCommoditiesContributionSAR(
      data,
      rate,
      simulatedPrices,
    );
    const totalValue = platformsRollupSAR + commoditiesValueSAR;
    const totalDailyPnL = platformsDailyPnL + commoditiesDailySAR;

    // Capital flows: deposit/withdrawal on personal investment platforms (canonical account id)
    const invTxs = (data?.investmentTransactions ?? []).filter((t: InvestmentTransaction) => txHitsPersonalInvestment(t) && t.type === 'deposit');
    const wdrTxs = (data?.investmentTransactions ?? []).filter((t: InvestmentTransaction) => txHitsPersonalInvestment(t) && t.type === 'withdrawal');
    const accList = data?.accounts ?? [];
    const invPortfolios = portfolios;
    let invSAR = 0, invUSD = 0, wdrSAR = 0, wdrUSD = 0;
    invTxs.forEach((t: InvestmentTransaction) => {
        const c = inferInvestmentTransactionCurrency(t, accList, invPortfolios);
        if (c === 'SAR') invSAR += t.total ?? 0;
        else invUSD += t.total ?? 0;
    });
    wdrTxs.forEach((t: InvestmentTransaction) => {
        const c = inferInvestmentTransactionCurrency(t, accList, invPortfolios);
        if (c === 'SAR') wdrSAR += t.total ?? 0;
        else wdrUSD += t.total ?? 0;
    });
    const totalInvestedSAR = invSAR + invUSD * rate;
    const totalWithdrawnSAR = wdrSAR + wdrUSD * rate;
    const commodityCost = allCommodities.reduce((sum: number, ch: { purchaseValue?: number }) => sum + toSAR(ch.purchaseValue ?? 0, 'USD', rate), 0);
    const holdingsCostBasisSAR = portfolios.reduce((sum: number, p: any) => {
      const book: 'USD' | 'SAR' = p?.currency === 'USD' ? 'USD' : 'SAR';
      const cost = (p?.holdings ?? []).reduce(
        (s: number, h: any) => s + Math.max(0, (Number(h?.avgCost) || 0) * (Number(h?.quantity) || 0)),
        0,
      );
      return sum + toSAR(cost, book, rate);
    }, 0);
    const computedNetCapital = totalInvestedSAR - totalWithdrawnSAR + commodityCost;
    const netCapital = computedNetCapital > 0 ? computedNetCapital : holdingsCostBasisSAR + commodityCost;
    const totalGainLoss = totalValue - netCapital;
    const roiRaw = netCapital > 0 ? (totalGainLoss / netCapital) * 100 : 0;
    const roi = Number.isFinite(roiRaw) ? roiRaw : 0;

    const previousTotalValue = totalValue - totalDailyPnL;
    const trendPercentage = previousTotalValue > 0 ? (totalDailyPnL / previousTotalValue) * 100 : 0;

    return {
      totalValue,
      totalGainLoss,
      roi,
      totalDailyPnL,
      trendPercentage,
      platformsRollupSAR,
      commoditiesValueSAR,
    };
  }, [data, simulatedPrices, exchangeRate, getAvailableCashForAccount]);

  const investmentsHubAiContext = useMemo(() => {
    if (!data) return undefined;
    const portfolios = getPersonalInvestments(data);
    const holdings = portfolios.flatMap((p) => p.holdings ?? []);
    const wl = data.watchlist ?? [];
    const logsRaw = data.executionLogs;
    const executionLogCount = Array.isArray(logsRaw) ? logsRaw.length : 0;
    return {
      activeTab,
      portfolioCount: portfolios.length,
      holdingCount: holdings.length,
      watchlistCount: wl.length,
      totalValueSAR: totalValue,
      unrealizedGainLossSAR: totalGainLoss,
      roiPct: roi,
      dailyPnLSAR: totalDailyPnL,
      commoditiesValueSAR,
      appDisplayCurrency,
      executionLogCount,
    };
  }, [data, activeTab, totalValue, totalGainLoss, roi, totalDailyPnL, commoditiesValueSAR, appDisplayCurrency]);

  const getTrendString = (trend: number) => {
    return `${trend >= 0 ? '+' : ''}${trend.toFixed(2)}%`;
  }

  useEffect(() => {
    if (pageAction?.startsWith('open-trade-modal')) {
        if (pageAction === 'open-trade-modal:from-plan') {
            try {
                const raw = sessionStorage.getItem(EXECUTE_PLAN_STORAGE_KEY);
                if (raw) {
                    const plan = JSON.parse(raw);
                    sessionStorage.removeItem(EXECUTE_PLAN_STORAGE_KEY);
                    const inv = data?.investments ?? [];
                    const accounts = (data?.accounts ?? []).filter((a: Account) => a.type === 'Investment');
                    const normalizedSymbol = (plan.symbol || '').trim().toUpperCase();
                    const targetPortfolio = inv.find((p: InvestmentPortfolio) =>
                        (p.holdings || []).some((h: Holding) => (h.symbol || '').trim().toUpperCase() === normalizedSymbol)
                    ) || inv.find((p: InvestmentPortfolio) => ((p.currency as TradeCurrency) || 'USD') === (plan.tradeCurrency || 'USD')) || inv[0];
                    setTradeInitialData({
                        symbol: plan.symbol,
                        name: plan.name,
                        tradeType: plan.tradeType || 'buy',
                        amount: plan.amount,
                        quantity: plan.quantity,
                        price: plan.price,
                        executedPlanId: plan.executedPlanId,
                        reason: plan.reason,
                        accountId: targetPortfolio?.accountId ?? accounts[0]?.id,
                        portfolioId: targetPortfolio?.id,
                        tradeCurrency: (targetPortfolio?.currency as TradeCurrency) || 'USD',
                    });
                } else {
                    setTradeInitialData(null);
                }
            } catch {
                setTradeInitialData(null);
            }
        } else if (pageAction.includes(':with-amount:')) {
            const amount = pageAction.split(':with-amount:')[1];
            setTradeInitialData({ amount: parseFloat(amount) });
        } else {
            setTradeInitialData(null);
        }
        setIsTradeModalOpen(true);
        clearPageAction?.();
    }
    if (pageAction === 'focus-investment-plan') {
        setActiveTab('Investment Plan');
        clearPageAction?.();
    }
    if (pageAction?.startsWith('investment-tab:')) {
        const raw = pageAction.slice('investment-tab:'.length);
        const allowed = new Set<InvestmentSubPage>([
            'Investment Plan',
            'Recovery Plan',
            'Dividend Tracker',
            'AI Rebalancer',
            'Watchlist',
        ]);
        if (allowed.has(raw as InvestmentSubPage)) {
            setActiveTab(raw as InvestmentSubPage);
        }
        clearPageAction?.();
    }
    if (pageAction === 'openRiskTradingHub') {
        triggerPageAction?.('Engines & Tools', 'openRiskTradingHub');
    }
  }, [pageAction, clearPageAction, data?.investments, setActiveTab, triggerPageAction]);

  const investmentAccounts = useMemo(
    () => getPersonalAccounts(data).filter((acc) => acc.type === 'Investment'),
    [data],
  );
  const portfoliosForTrade = useMemo(() => getPersonalInvestments(data ?? null), [data]);

  const handleHoldingClick = (holding: (Holding & { gainLoss: number; gainLossPercent: number; priceChangePercent?: number; }), portfolio: InvestmentPortfolio) => { setSelectedHolding(holding); setSelectedPortfolio(portfolio); setIsHoldingModalOpen(true); };
  const handleOpenHoldingEditModal = (holding: Holding) => {
    trackAction('edit-holding', 'Investments');
    setHoldingToEdit(holding);
    setIsHoldingEditModalOpen(true);
  };
    const handleSaveHolding = async (holding: Holding) => { 
        try {
            await updateHolding(holding); 
        } catch (error) {
            // Error already alerted in DataContext
        }
    };
  
  const handleOpenPlatformModal = (platform: Account | null = null) => {
    if (!platform) trackAction('add-platform', 'Investments');
    setPlatformToEdit(platform);
    setIsPlatformModalOpen(true);
  };

  const handleOpenPortfolioModal = (portfolio: InvestmentPortfolio | null, accountId: string | null) => {
      if (!portfolio) trackAction('add-portfolio', 'Investments');
      setPortfolioToEdit(portfolio);
      setCurrentAccountId(accountId);
      setIsPortfolioModalOpen(true);
  };

  const handleSavePlatform = async (platform: Account) => {
      try {
          if (platform.id) {
              await updatePlatform(platform);
          } else {
              const { id, balance, ...newPlatformData } = platform;
              const newId = await addPlatform(newPlatformData);
              if (newId) {
                  handleOpenPortfolioModal(null, newId);
              }
          }
      } catch (error) {
          // Error already alerted in DataContext
      }
  };

  const handleOpenDeleteModal = (item: Account | InvestmentPortfolio) => { setItemToDelete(item); setIsDeleteModalOpen(true); };
  const handleConfirmDelete = () => {
    if (!itemToDelete) return;
    if ('accountId' in itemToDelete) { // It's a portfolio
        deletePortfolio(itemToDelete.id);
    } else { // It's a platform
        deletePlatform(itemToDelete.id);
    }
    setItemToDelete(null);
    setIsDeleteModalOpen(false);
  };

  const handleSavePortfolio = async (portfolio: Omit<InvestmentPortfolio, 'id' | 'user_id' | 'holdings'> | InvestmentPortfolio) => {
      try {
          if ('id' in portfolio && portfolio.id) {
              const { holdings, ...portfolioToUpdate } = portfolio as InvestmentPortfolio;
              await updatePortfolio(portfolioToUpdate);
          } else {
              await addPortfolio(portfolio as Omit<InvestmentPortfolio, 'id' | 'user_id' | 'holdings'>);
          }
      } catch (error) {
          // Error already alerted in DataContext
      }
  };
  


  const handleCloseTradeModal = () => {
      setIsTradeModalOpen(false);
      setTradeInitialData(null);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'Overview': return <InvestmentOverview setActiveTab={setActiveTab} />;
      case 'Portfolios':
        return <PlatformView 
            simulatedPrices={simulatedPrices}
            onAddPlatform={() => handleOpenPlatformModal()}
            onOpenAddPortfolio={(accountId) => handleOpenPortfolioModal(null, accountId ?? null)}
            setActivePage={setActivePage}
            setActiveTab={setActiveTab}
            onEditPlatform={handleOpenPlatformModal} 
            onDeletePlatform={(p) => handleOpenDeleteModal(p)}
            onEditPortfolio={(p) => handleOpenPortfolioModal(p, p.accountId)}
            onDeletePortfolio={(p) => handleOpenDeleteModal(p)}
            onHoldingClick={handleHoldingClick}
            onEditHolding={handleOpenHoldingEditModal}
        />;
      case 'Investment Plan': return (
                <div className="flex flex-col gap-16 sm:gap-20">
                    <InvestmentPlanView
                        embedded
                        onExecutePlan={() => {}}
                        setActivePage={setActivePage}
                        triggerPageAction={triggerPageAction}
                    />
                    <section className="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50/80 to-white p-4 sm:p-6 shadow-sm scroll-mt-6" aria-labelledby="monthly-allocation-heading">
                        <div className="mb-4 border-b border-slate-200 pb-3">
                            <h2 id="monthly-allocation-heading" className="text-base font-semibold text-slate-900">Monthly budget and sleeve strategy</h2>
                            <p className="mt-1 text-sm text-slate-600">Set how much you invest each month and how it splits between stable vs growth names. This works together with the trade plans above.</p>
                        </div>
                        <InvestmentPlan
                            onNavigateToTab={(tab) => setActiveTab(tab)}
                            onOpenWealthUltra={setActivePage ? () => setActivePage('Wealth Ultra') : undefined}
                            onOpenRecordTrade={(trade) => {
                                trackAction('record-trade-from-plan', 'Investments');
                                const normalizedSymbol = trade.ticker.trim().toUpperCase();
                                const inv = data?.investments ?? [];
                                const targetPortfolio = inv.find((portfolio) =>
                                    (portfolio.holdings || []).some((holding) => (holding.symbol || '').trim().toUpperCase() === normalizedSymbol)
                                ) || inv.find((portfolio) => ((portfolio.currency as TradeCurrency) || 'USD') === (trade.tradeCurrency || 'USD')) || inv[0];
                                setTradeInitialData({
                                    symbol: trade.ticker,
                                    amount: trade.amount,
                                    tradeType: 'buy' as const,
                                    reason: trade.reason,
                                    price: trade.price,
                                    quantity: trade.quantity,
                                    tradeCurrency: trade.tradeCurrency,
                                    accountId: targetPortfolio?.accountId,
                                    portfolioId: targetPortfolio?.id,
                                    name: targetPortfolio?.holdings?.find((holding) => (holding.symbol || '').trim().toUpperCase() === normalizedSymbol)?.name,
                                });
                                setIsTradeModalOpen(true);
                            }}
                        />
                    </section>
                </div>
            );
      case 'Dividend Tracker': return <DividendTrackerView setActivePage={setActivePage} />;
      case 'Recovery Plan': return <RecoveryPlanView onNavigateToTab={(tab) => setActiveTab(tab as InvestmentSubPage)} onOpenWealthUltra={setActivePage ? () => setActivePage('Wealth Ultra') : undefined} />;
      case 'AI Rebalancer': return <AIRebalancerView onNavigateToTab={(tab) => setActiveTab(tab as InvestmentSubPage)} onOpenWealthUltra={setActivePage ? () => setActivePage('Wealth Ultra') : undefined} />;
      case 'Watchlist': return <WatchlistView onNavigateToTab={(tab) => setActiveTab(tab as InvestmentSubPage)} />;
      case 'Execution History': return <ExecutionHistoryView />;
      default: return null;
    }
  };

  if (loading || !data) {
    return (
      <div className="flex justify-center items-center min-h-[24rem] bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 rounded-2xl border border-slate-200" aria-busy="true">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent" aria-label="Loading investments" />
      </div>
    );
  }

  return (
    <div className="space-y-8 sm:space-y-10">
        <header className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-indigo-50 px-5 py-6 sm:px-6 shadow-sm">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Investments</h1>
                        <span className="inline-flex items-center rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-800">Unified portfolio workspace</span>
                    </div>
                    <p className="mt-2 max-w-2xl text-sm text-slate-600">Track every portfolio, evaluate share-level insights, and run AI workflows from one professional command center.</p>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <LivePricesStatus variant="inline" className="flex-shrink-0 text-slate-700" />
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${!aiHealthChecked ? 'bg-slate-100 text-slate-600' : isAiAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                            {!aiHealthChecked ? 'Checking…' : <>{isAiAvailable ? <CheckCircleIcon className="h-4 w-4" /> : <ExclamationTriangleIcon className="h-4 w-4" />} AI {isAiAvailable ? 'Enabled' : 'Unavailable'}</>}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setActiveTab('Investment Plan')} className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-800 transition hover:bg-indigo-100">
                        <SparklesIcon className="h-4 w-4" /> Smart Plan
                    </button>
                    <button onClick={() => setIsTradeModalOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50">
                        <ArrowsRightLeftIcon className="h-4 w-4" /> Record Trade
                    </button>
                </div>
            </div>
        </header>

        <section className="cards-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4" aria-label="Investment summary">
            <Card
                title="Total Value"
                value={<CurrencyDualDisplay value={totalValue} inCurrency="SAR" digits={2} size="2xl" />}
                density="compact"
                indicatorColor="green"
                valueColor="text-emerald-700"
                icon={<ChartPieIcon className="h-5 w-5 text-emerald-600" aria-hidden />}
                tooltip="Everything you have invested right now: stocks and funds at today's prices, idle cash sitting on your broker accounts, and commodities. US-listed prices are converted into riyals using your FX rate so the number matches your net worth view. Hover the amount to see the USD equivalent."
            />
            <Card
                title="Unrealized P/L"
                value={<CurrencyDualDisplay value={totalGainLoss} inCurrency="SAR" digits={2} colorize size="2xl" />}
                density="compact"
                indicatorColor={totalGainLoss >= 0 ? 'green' : 'red'}
                valueColor={totalGainLoss >= 0 ? 'text-emerald-700' : 'text-rose-700'}
                icon={<ArrowsRightLeftIcon className={`h-5 w-5 ${totalGainLoss >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} aria-hidden />}
                tooltip="Paper profit or loss: current value minus money you moved in (deposits) and out (withdrawals) of investment platforms, including commodities cost. It updates when prices refresh; it is not tax or realized gain until you sell. Hover the amount to see USD equivalent."
            />
            <Card
                title="Portfolio ROI"
                value={`${roi.toFixed(2)}%`}
                valueColor={roi >= 0 ? 'text-emerald-700' : 'text-rose-700'}
                density="compact"
                indicatorColor={roi >= 0 ? 'green' : 'red'}
                icon={<ArrowTrendingUpIcon className={`h-5 w-5 ${roi >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} aria-hidden />}
                tooltip="Simple return: unrealized profit or loss divided by net capital you put in (deposits minus withdrawals, plus commodity purchase cost). Positive means your portfolio is worth more than that net input."
            />
            <Card
                title="Daily P/L"
                value={<CurrencyDualDisplay value={totalDailyPnL} inCurrency="SAR" digits={2} colorize size="2xl" />}
                trend={getTrendString(trendPercentage)}
                tooltip="Estimated change today from price moves on your holdings (live or simulated quotes). Converted the same way as total value so it lines up with your portfolio currency and FX settings. Hover the amount to see USD equivalent."
                density="compact"
                indicatorColor={totalDailyPnL >= 0 ? 'green' : 'red'}
                valueColor={totalDailyPnL >= 0 ? 'text-emerald-700' : 'text-rose-700'}
                icon={<ArrowsRightLeftIcon className={`h-5 w-5 ${totalDailyPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} aria-hidden />}
            />
        </section>
        {(platformsRollupSAR > 0 || commoditiesValueSAR > 0) && (
            <p className="text-xs text-slate-500 -mt-2 px-0.5 leading-relaxed" role="note">
                KPIs aggregate personal portfolios in <strong>each portfolio&apos;s base currency</strong> (USD or SAR), convert to SAR using your FX settings, then show amounts in your app currency ({appDisplayCurrency}). Commodities are valued in USD and converted consistently.
                <span className="tabular-nums block mt-1">
                    SAR breakdown: {formatCurrencyString(platformsRollupSAR, { inCurrency: 'SAR', digits: 0 })} platforms + tradable cash;{' '}
                    {formatCurrencyString(commoditiesValueSAR, { inCurrency: 'SAR', digits: 0 })} commodities.
                </span>
            </p>
        )}

        <PlanSummary onEditPlan={() => setActiveTab('Investment Plan')} />
        <InvestmentGoalsStrip onOpenGoals={setActivePage ? () => setActivePage('Goals') : undefined} />

        <nav className="rounded-2xl border border-slate-200 bg-white p-2" aria-label="Investment sections">
            <div className="flex gap-1 overflow-x-auto scrollbar-thin">
              {INVESTMENT_SUB_PAGES.map(tab => (
                <button
                  key={tab.name}
                  onClick={() => setActiveTab(tab.name)}
                  className={`inline-flex items-center gap-2 whitespace-nowrap py-2.5 px-4 rounded-xl font-medium text-sm transition-colors ${
                    activeTab === tab.name
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100 border border-transparent'
                  }`}
                >
                  <tab.icon className="h-4 w-4 shrink-0" aria-hidden />
                  {tab.name}
                </button>
              ))}
            </div>
        </nav>
      
      <InvestmentTabErrorBoundary activeTab={activeTab} onReset={() => setActiveTab('Overview')}>
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50/80 via-white to-indigo-50/50 min-h-[28rem] overflow-hidden p-4 sm:p-6">
          <Suspense fallback={<LoadingSpinner message="Loading..." className="min-h-[12rem] bg-transparent" />}>
            {renderContent()}
          </Suspense>
        </div>
      </InvestmentTabErrorBoundary>

      {activeTab === 'Overview' && (
        <AIAdvisor
          pageContext="investments"
          contextData={investmentsHubAiContext}
          title="Investments workspace coach"
          subtitle="Holdings & watchlist-aware · English / العربية"
          buttonLabel="Insights for this workspace"
        />
      )}

      <HoldingDetailModal isOpen={isHoldingModalOpen} onClose={() => { setIsHoldingModalOpen(false); setSelectedHolding(null); setSelectedPortfolio(null); }} holding={selectedHolding} portfolio={selectedPortfolio} />
      <HoldingEditModal isOpen={isHoldingEditModalOpen} onClose={() => setIsHoldingEditModalOpen(false)} onSave={handleSaveHolding} holding={holdingToEdit} />
      <PlatformModal isOpen={isPlatformModalOpen} onClose={() => setIsPlatformModalOpen(false)} onSave={handleSavePlatform} platformToEdit={platformToEdit} />
      <PortfolioModal 
        isOpen={isPortfolioModalOpen} 
        onClose={() => setIsPortfolioModalOpen(false)} 
        onSave={handleSavePortfolio} 
        portfolioToEdit={portfolioToEdit} 
        accountId={currentAccountId}
        investmentAccounts={investmentAccounts}
        goals={data?.goals ?? []}
      />
      <DeleteConfirmationModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={handleConfirmDelete} itemName={itemToDelete?.name || ''} />
      <RecordTradeModal 
        isOpen={isTradeModalOpen} 
        onClose={handleCloseTradeModal} 
        onSave={recordTrade} 
        investmentAccounts={investmentAccounts} 
        portfolios={portfoliosForTrade}
        simulatedPrices={simulatedPrices}
        initialData={tradeInitialData}
      />
    </div>
  );
};

export default Investments;
