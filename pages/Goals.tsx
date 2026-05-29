import React, { useState, useCallback, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { getGoalAIPlan } from '../services/geminiService';
import { FinancialData, Goal, Liability, Page, InvestmentPortfolio } from '../types';
import { RocketLaunchIcon } from '../components/icons/RocketLaunchIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { XCircleIcon } from '../components/icons/XCircleIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import PageActionsDropdown from '../components/PageActionsDropdown';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import Modal from '../components/Modal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { PlusCircleIcon } from '../components/icons/PlusCircleIcon';
import AIAdvisor from '../components/AIAdvisor';
import { LinkIcon } from '../components/icons/LinkIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import InfoHint from '../components/InfoHint';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import CollapsibleSection from '../components/CollapsibleSection';
import { useCurrency } from '../context/CurrencyContext';
import { useEmergencyFund, EMERGENCY_FUND_TARGET_MONTHS } from '../hooks/useEmergencyFund';
import { toSAR } from '../utils/currencyMath';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { useCanonicalFinancialMetrics } from '../hooks/useCanonicalFinancialMetrics';
import { getPersonalAccounts } from '../utils/wealthScope';
import { usePageDeferredData } from '../context/PageDeferredDataContext';
import { financialMonthNetCashflowSar } from '../services/dashboardKpiSnapshot';
import { personalMonthlyNetByMonthKeySar } from '../services/financeMetrics';
import { computeGoalFundingPlan, GOAL_NO_DEADLINE_AMORTIZATION_MONTHS } from '../services/goalFundingRouter';
import { computeWindfallAllocationPct } from '../services/windfallAllocation';
import { monteCarloGoalSuccess } from '../services/portfolioConstruction';
import { projectedGoalCompletionDate, goalFundingGap as goalGapShared, computeGoalTimelineStatus } from '../services/goalMetrics';
import { detectGoalConflict, goalFeasibilityCheck, type GoalConflict } from '../services/goalConflictEngine';
import { useSelfLearning } from '../context/SelfLearningContext';
import { useCompanyNames } from '../hooks/useSymbolCompanyName';
import { formatSymbolWithCompany } from '../components/SymbolWithCompanyName';
import { receivableContributionForGoal } from '../services/goalReceivableContribution';
import {
    averageRollingMonthlyNetSurplus,
    computeGoalResolvedAmountsSar,
    GOAL_NET_CASHFLOW_LOOKBACK_MONTHS,
} from '../services/goalResolvedTotals';
import {
    computeGoalMonthlyFundingEnvelopeSar,
    monthlySurplusForEmergencyFund,
    sumAllGoalMonthlyFundingEnvelopesSar,
} from '../services/goalProjectionFunding';
import GoalsFundingEnvelopeBanner from '../components/goals/GoalsFundingEnvelopeBanner';
import { toast } from '../context/ToastContext';
import { useAI } from '../context/AiContext';
import AiProxyUnavailableHint from '../components/AiProxyUnavailableHint';

// A more visual progress bar specific for goals
const GoalProgressBar: React.FC<{ progress: number; colorClass: string }> = ({ progress, colorClass }) => {
    const [width, setWidth] = useState(0);
    const clampedProgress = Math.min(100, Math.max(0, Number(progress) || 0));

    useEffect(() => {
        // Animate the bar on load
        const timer = setTimeout(() => setWidth(clampedProgress), 100);
        return () => clearTimeout(timer);
    }, [clampedProgress]);

    return (
        <div className="relative h-5 bg-gray-200 rounded-full overflow-hidden">
            <div 
                className={`absolute top-0 left-0 h-full rounded-full ${colorClass} transition-all duration-1000 ease-out`}
                style={{ width: `${Math.min(Math.max(Number(width) || 0, 0), 100)}%` }}
            ></div>
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold text-white" style={{ textShadow: '0 1px 1px rgba(0,0,0,0.5)' }}>
                    {clampedProgress.toFixed(1)}% Complete
                </span>
            </div>
        </div>
    );
};


interface GoalModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (goal: Goal) => void;
    goalToEdit: Goal | null;
}

const GoalModal: React.FC<GoalModalProps> = ({ isOpen, onClose, onSave, goalToEdit }) => {
    const [name, setName] = useState('');
    const [targetAmount, setTargetAmount] = useState('');
    const [deadline, setDeadline] = useState('');
    const [priority, setPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');

    useEffect(() => {
        if (goalToEdit) {
            setName(goalToEdit.name);
            setTargetAmount(String(goalToEdit.targetAmount));
            setDeadline(new Date(goalToEdit.deadline).toISOString().split('T')[0]);
            setPriority(goalToEdit.priority || 'Medium');
        } else {
            setName('');
            setTargetAmount('');
            setDeadline('');
            setPriority('Medium');
        }
    }, [goalToEdit, isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const parsedTarget = parseFloat(targetAmount) || 0;
        const deadlineDate = new Date(deadline);
        if (!name.trim()) {
            toast('Goal name is required.', 'error');
            return;
        }
        if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) {
            toast('Target amount must be a positive number.', 'error');
            return;
        }
        if (!deadline || Number.isNaN(deadlineDate.getTime())) {
            toast('Please provide a valid deadline date.', 'error');
            return;
        }
        const goalData = {
            name: name.trim(),
            targetAmount: parsedTarget,
            deadline,
            priority,
        };

        try {
            if (goalToEdit) {
                await onSave({ ...goalToEdit, ...goalData });
            } else {
                await onSave({
                    id: `goal${Date.now()}`,
                    ...goalData,
                    currentAmount: 0, // New goals start with 0, progress is from linked assets.
                    savingsAllocationPercent: 0,
                });
            }
            onClose();
        } catch (error) {
            // Error handled in DataContext
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={goalToEdit ? 'Edit Goal' : 'Add New Goal'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Goal Name <InfoHint text="A clear name (e.g. Emergency Fund, World Trip) helps track progress and link assets." /></label>
                    <input type="text" placeholder="Goal Name" value={name} onChange={e => setName(e.target.value)} required className="input-base"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Target Amount <InfoHint text="The total amount you want to reach. Progress is calculated from linked assets and savings." /></label>
                    <input type="number" placeholder="Target Amount" value={targetAmount} onChange={e => setTargetAmount(e.target.value)} required className="input-base"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Deadline <InfoHint text="Target date to reach this goal. Used to compute required monthly savings and status (On Track / At Risk)." /></label>
                    <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} required className="input-base"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Priority <InfoHint text="High/Medium/Low affects how the system suggests allocating savings across multiple goals." /></label>
                    <select value={priority} onChange={e => setPriority(e.target.value as 'High' | 'Medium' | 'Low')} className="select-base">
                        <option value="High">High Priority</option>
                        <option value="Medium">Medium Priority</option>
                        <option value="Low">Low Priority</option>
                    </select>
                </div>
                <button type="submit" className="w-full btn-primary">Save Goal</button>
            </form>
        </Modal>
    );
};


const GoalStatus: React.FC<{ status: 'On Track' | 'Needs Attention' | 'At Risk' }> = ({ status }) => {
    const statusInfo = { 'On Track': { icon: <CheckCircleIcon className="h-5 w-5 text-green-700" />, bg: 'bg-green-100', text: 'text-green-800' }, 'Needs Attention': { icon: <ExclamationTriangleIcon className="h-5 w-5 text-yellow-700" />, bg: 'bg-yellow-100', text: 'text-yellow-800' }, 'At Risk': { icon: <XCircleIcon className="h-5 w-5 text-red-700" />, bg: 'bg-red-100', text: 'text-red-800' } };
    const { icon, bg, text } = statusInfo[status];
    return (<div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full text-sm font-medium ${bg} ${text}`}>{icon}<span>{status}</span></div>);
}

const GoalConflictAndFeasibilitySection: React.FC<{
  goals: (Goal & { currentAmount?: number })[];
  monthlySurplusForEmergencyFund: number;
  formatCurrencyString: (n: number, opts?: { digits?: number }) => string;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  onEditGoalById?: (goalId: string) => void;
  resolvedCurrentByGoalId: Map<string, number>;
  goalEngineData: FinancialData;
  sarPerUsdForGoals: number;
}> = ({
  goals,
  monthlySurplusForEmergencyFund,
  formatCurrencyString,
  setActivePage,
  triggerPageAction,
  onEditGoalById,
  resolvedCurrentByGoalId,
  goalEngineData,
  sarPerUsdForGoals,
}) => {
  const conflicts = useMemo(
    () =>
      detectGoalConflict({
        goals,
        monthlySurplusForGoals: monthlySurplusForEmergencyFund,
        resolvedCurrentByGoalId,
        data: goalEngineData,
        sarPerUsdUi: sarPerUsdForGoals,
      }),
    [goals, monthlySurplusForEmergencyFund, resolvedCurrentByGoalId, goalEngineData, sarPerUsdForGoals],
  );
  const activeGoals = useMemo(() => goals.filter(g => (g.targetAmount ?? 0) > (g.currentAmount ?? 0)), [goals]);
  const [expandedConflictIdx, setExpandedConflictIdx] = useState<number | null>(null);
  const scrollToId = useCallback((id: string) => {
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }, []);
  const focusGoalCard = useCallback(
    (goalId: string) => {
      if (!goalId) return;
      if (triggerPageAction) triggerPageAction('Goals', `focus-goal:${encodeURIComponent(goalId)}`);
      else scrollToId(`goal-card-${goalId}`);
    },
    [triggerPageAction, scrollToId],
  );

  return (
    <CollapsibleSection title="Goal conflict & feasibility" summary={conflicts.length > 0 ? `${conflicts.length} conflict(s) detected` : 'No conflicts'} className="border border-amber-200 bg-amber-50/40">
      <p className="text-xs text-slate-600 mb-3">
        Detects when the same cash is funding too many goals or target dates are not achievable with current surplus.
      </p>
      {conflicts.length > 0 ? (
        <ul className="space-y-3 mb-4">
          {conflicts.map((c: GoalConflict, i: number) => {
            const req = c.requiredMonthlyTotal;
            const sur = c.surplusMonthly;
            const shortfallOverall =
              typeof req === 'number' && typeof sur === 'number'
                ? Math.max(0, Math.round(req) - Math.round(sur))
                : null;
            const expanded = expandedConflictIdx === i;
            return (
              <li key={i} className="rounded-xl border border-amber-300/70 bg-white/95 shadow-sm overflow-hidden">
                <div className="flex items-start gap-2 px-3 py-2.5">
                  <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0 mt-0.5 text-amber-700" aria-hidden />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm font-medium text-amber-950 leading-snug">{c.message}</p>
                    {(shortfallOverall != null && shortfallOverall > 0 && c.reason === 'same_cash_source') ||
                    (c.reason === 'impossible_date' &&
                      typeof c.neededPerMonth === 'number' &&
                      typeof c.surplusMonthly === 'number') ? (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums bg-slate-50/90 rounded-lg px-2 py-1.5 border border-slate-100">
                        {c.reason === 'same_cash_source' && shortfallOverall != null && (
                          <span title="Rough gap between total required savings (all goals) and your monthly surplus">
                            <strong className="text-slate-800">Gap:</strong> {formatCurrencyString(shortfallOverall, { digits: 0 })}/mo
                          </span>
                        )}
                        {c.reason === 'impossible_date' &&
                          typeof c.neededPerMonth === 'number' &&
                          typeof c.surplusMonthly === 'number' && (
                          <>
                            <span>
                              <strong className="text-slate-800">Need:</strong> {formatCurrencyString(c.neededPerMonth, { digits: 0 })}/mo
                            </span>
                            <span>
                              <strong className="text-slate-800">Have:</strong> {formatCurrencyString(c.surplusMonthly, { digits: 0 })}/mo
                            </span>
                            <span className="text-amber-800 font-medium">
                              Short{' '}
                              {formatCurrencyString(
                                Math.max(0, Math.round(c.neededPerMonth) - Math.round(c.surplusMonthly)),
                                { digits: 0 },
                              )}
                              /mo
                            </span>
                          </>
                        )}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      {c.reason === 'same_cash_source' && (
                        <>
                          <button
                            type="button"
                            className="btn-primary text-xs py-1.5 px-2.5"
                            onClick={() => scrollToId('goals-savings-allocation')}
                          >
                            Adjust allocation %
                          </button>
                          <button type="button" className="btn-outline text-xs py-1.5 px-2.5" onClick={() => scrollToId('goals-cards-grid')}>
                            Review goals
                          </button>
                          {setActivePage && (
                            <button type="button" className="btn-outline text-xs py-1.5 px-2.5" onClick={() => setActivePage('Plan')}>
                              Open Plan
                            </button>
                          )}
                        </>
                      )}
                      {c.reason === 'impossible_date' && c.goalIds[0] && (
                        <>
                          {onEditGoalById && (
                            <button
                              type="button"
                              className="btn-primary text-xs py-1.5 px-2.5"
                              onClick={() => onEditGoalById(c.goalIds[0])}
                            >
                              Edit goal / deadline
                            </button>
                          )}
                          <button type="button" className="btn-outline text-xs py-1.5 px-2.5" onClick={() => focusGoalCard(c.goalIds[0])}>
                            Jump to goal card
                          </button>
                          {setActivePage && (
                            <button type="button" className="btn-outline text-xs py-1.5 px-2.5" onClick={() => setActivePage('Plan')}>
                              Open Plan
                            </button>
                          )}
                        </>
                      )}
                      <button
                        type="button"
                        className="text-xs font-medium text-slate-600 hover:text-primary underline underline-offset-2"
                        onClick={() => setExpandedConflictIdx(expanded ? null : i)}
                      >
                        {expanded ? 'Hide' : 'Why & how to fix'}
                      </button>
                    </div>
                    {expanded && (
                      <div className="text-xs text-slate-600 leading-relaxed border-t border-amber-100 pt-2 mt-1 space-y-2">
                        {c.reason === 'same_cash_source' && (
                          <>
                            <p>
                              We use the <strong>same schedule as Goal funding cockpit</strong>: saved toward each goal (linked assets, investments, receivables) in SAR, and{' '}
                              <strong>months to deadline</strong> from the same formula as required monthly there. If the sum of those run-rates is much higher than your <strong>mapped</strong> monthly funding (linked budget per goal, or investment plan when no budget), goals compete for the same explicit envelopes.
                            </p>
                            <p className="text-slate-700">
                              <strong>Try:</strong> tag budgets to goals on Budgets, link portfolios or holdings on Investments, extend deadlines, or narrow targets. Unallocated surplus after goal budgets funds your emergency buffer, not goals.
                            </p>
                          </>
                        )}
                        {c.reason === 'impossible_date' && (
                          <p>
                            For <strong>{c.goalName ?? 'this goal'}</strong>, closing the gap by the deadline needs more per month than this goal&apos;s mapped envelope. Link a budget or investment, extend the deadline, reduce the target, or deprioritize other goals.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-slate-700 mb-4">No conflicts detected. Required monthly fits within mapped goal funding.</p>
      )}
      {activeGoals.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Feasibility at mapped funding</h4>
          <ul className="space-y-1.5 text-sm">
            {activeGoals.map(goal => {
              const monthlyContribution = computeGoalMonthlyFundingEnvelopeSar({
                goal,
                data: goalEngineData,
                sarPerUsd: sarPerUsdForGoals,
              }).envelopeMonthly;
              const result = goalFeasibilityCheck({
                goal: { ...goal, currentAmount: goal.currentAmount ?? 0 },
                monthlyContribution,
                resolvedCurrentAmount: resolvedCurrentByGoalId.get(goal.id) ?? goal.currentAmount ?? 0,
              });
              const feasibilityText = result.feasible
                ? 'Feasible'
                : result.reason === 'no_deadline'
                  ? 'No deadline set'
                  : result.reason === 'no_contribution'
                    ? 'No monthly allocation'
                    : `Need ${result.monthsNeeded ?? 0} mo, have ${result.monthsAvailable ?? 0} mo`;
              return (
                <li key={goal.id} className="flex justify-between items-center">
                  <span className="text-slate-700">{goal.name}</span>
                  <span className={result.feasible ? 'text-green-700 font-medium' : 'text-amber-700 font-medium'}>
                    {feasibilityText}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </CollapsibleSection>
  );
};

const GoalCard: React.FC<{
  goal: Goal;
  /** Canonical SAR saved (from `computeGoalResolvedAmountsSar`) — must match funding cockpit & Plan. */
  resolvedCurrentAmountSar: number;
  /** Headline FX (same as Dashboard / Summary). */
  sarPerUsd: number;
  onEdit: () => void;
  onDelete: () => void;
  onSeeInPlan?: () => void;
}> = ({ goal, resolvedCurrentAmountSar, sarPerUsd, onEdit, onDelete, onSeeInPlan }) => {
    const { aiActionsEnabled } = useAI();
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [aiPlan, setAiPlan] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);

    const goalLinkSymbols = useMemo(() => {
        const investments = (data as any)?.personalInvestments ?? data?.investments ?? [];
        const syms: string[] = [];
        investments.forEach((p: { goalId?: string; holdings?: { goalId?: string; symbol?: string }[] }) => {
            (p.holdings ?? []).forEach((h: { goalId?: string; symbol?: string }) => {
                const resolvedGoalId = h.goalId || p.goalId;
                if (resolvedGoalId === goal.id && h.goalId && h.symbol) syms.push((h.symbol || '').trim());
            });
        });
        return Array.from(new Set(syms.filter((s) => s.length >= 2)));
    }, [data?.investments, goal.id]);
    const { names: goalHoldingNames } = useCompanyNames(goalLinkSymbols);
        const personalLiabilities = useMemo(
            () => ((data as any)?.personalLiabilities ?? data?.liabilities ?? []) as Liability[],
            [data?.liabilities, (data as any)?.personalLiabilities],
        );
        const linkedLiabilities = useMemo(
            () => personalLiabilities.filter((l) => l.goalId === goal.id),
            [personalLiabilities, goal.id],
        );

        const { linkedAssets } = useMemo(() => {
            const linkedItems: { name: string; value: number }[] = [];
            const assets = (data as any)?.personalAssets ?? data?.assets ?? [];
            const investments = (data as any)?.personalInvestments ?? data?.investments ?? [];

            assets.filter((a: { goalId?: string }) => a.goalId === goal.id).forEach((a: { name?: string; value?: number }) => {
                linkedItems.push({ name: a.name ?? '—', value: a.value ?? 0 });
            });

            investments.forEach((p: { goalId?: string; name?: string; currency?: string; holdings?: { goalId?: string; symbol?: string; currentValue?: number; name?: string }[] }) => {
                const holdings = p.holdings ?? [];
                const book = resolveInvestmentPortfolioCurrency(p as InvestmentPortfolio);
                let portfolioResidualForGoal = 0;
                holdings.forEach((h: { goalId?: string; symbol?: string; name?: string; currentValue?: number }) => {
                    const resolvedGoalId = h.goalId || p.goalId;
                    if (resolvedGoalId !== goal.id) return;
                    const valueSar = toSAR(h.currentValue ?? 0, book, sarPerUsd);
                    // Holding goal link has priority; otherwise the platform goal applies.
                    if (h.goalId) {
                        linkedItems.push({
                            name: `${p.name}: ${formatSymbolWithCompany(h.symbol ?? '', h.name, goalHoldingNames)}`,
                            value: valueSar,
                        });
                    } else portfolioResidualForGoal += valueSar;
                });
                if (portfolioResidualForGoal > 0) {
                    linkedItems.push({ name: `Portfolio: ${p.name}`, value: portfolioResidualForGoal });
                }
            });

            personalLiabilities.forEach((l) => {
                const v = receivableContributionForGoal(l, goal.id);
                if (v <= 0) return;
                linkedItems.push({ name: `${l.name || 'Receivable'} (owed to you)`, value: v });
            });

            return { linkedAssets: linkedItems };
        }, [data?.assets, data?.investments, goal.id, sarPerUsd, goalHoldingNames, personalLiabilities]);

    const fundingEnvelope = useMemo(
        () => computeGoalMonthlyFundingEnvelopeSar({ goal, data: data ?? null, sarPerUsd }),
        [goal, data, sarPerUsd],
    );

    const handleGetAIPlan = useCallback(async () => {
        if (!aiActionsEnabled) {
            toast('AI is not available. Configure provider keys (Netlify or local .env) and retry.', 'warning');
            return;
        }
        setIsLoading(true);
        const rollingAfter = monthlySurplusForEmergencyFund(data ?? null, sarPerUsd);
        const plan = await getGoalAIPlan(goal, rollingAfter, resolvedCurrentAmountSar, {
            projectedMonthlyOverride: fundingEnvelope.envelopeMonthly,
        });
        setAiPlan(plan);
        setIsLoading(false);
    }, [aiActionsEnabled, goal, resolvedCurrentAmountSar, data, fundingEnvelope.envelopeMonthly, sarPerUsd]);

    const { monthsLeft, progressPercent, status, color, requiredMonthlyContribution, projectedMonthlyContribution, borderColor } = useMemo(() => {
        const tl = computeGoalTimelineStatus({
            goal,
            resolvedCurrentAmountSar,
            projectedMonthlyContribution: fundingEnvelope.envelopeMonthly,
        });
        const colorTone =
            tl.progressPercent < 33 ? 'bg-danger' : tl.progressPercent < 66 ? 'bg-warning' : 'bg-success';
        const borderTone =
            tl.status === 'At Risk'
                ? 'border-danger'
                : tl.status === 'Needs Attention'
                  ? 'border-warning'
                  : 'border-success';
        return {
            monthsLeft: tl.monthsLeft,
            progressPercent: tl.progressPercent,
            status: tl.status,
            color: colorTone,
            requiredMonthlyContribution: tl.requiredMonthlyContribution,
            projectedMonthlyContribution: tl.projectedMonthlyContribution,
            borderColor: borderTone,
        };
    }, [goal, resolvedCurrentAmountSar, fundingEnvelope.envelopeMonthly]);

    const completionAtRequired = useMemo(() => {
        const g = { ...goal, currentAmount: resolvedCurrentAmountSar } as Goal;
        const gap = goalGapShared(g);
        if (gap <= 0) return null;
        const m = Math.max(requiredMonthlyContribution, projectedMonthlyContribution, 1);
        return projectedGoalCompletionDate(g, m);
    }, [goal, resolvedCurrentAmountSar, requiredMonthlyContribution, projectedMonthlyContribution]);

    const monteCarloResult = useMemo(() => {
        const targetAmt = goal.targetAmount ?? 0;
        if (targetAmt <= 0 || monthsLeft <= 0 || resolvedCurrentAmountSar >= targetAmt) return null;
        const monthlyContrib = Math.max(0, projectedMonthlyContribution || requiredMonthlyContribution * 0.5);
        return monteCarloGoalSuccess({
            currentAmount: resolvedCurrentAmountSar,
            targetAmount: targetAmt,
            monthlyContribution: monthlyContrib,
            monthsRemaining: monthsLeft,
            expectedAnnualReturn: 0.07,
            annualVolatility: 0.15,
            numSimulations: 2000,
        });
    }, [goal.targetAmount, monthsLeft, resolvedCurrentAmountSar, projectedMonthlyContribution, requiredMonthlyContribution]);

    return (
        <div className={`bg-gradient-to-br from-white via-slate-50 to-primary/5 p-6 rounded-lg shadow space-y-4 flex flex-col justify-between hover:shadow-xl transition-shadow duration-300 border-t-4 ${borderColor}`}>
            {/* Header */}
            <div>
                <div className="flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-2"><h3 className="text-xl font-semibold text-dark">{goal.name}</h3><span className={`text-xs px-2 py-0.5 rounded-full ${goal.priority === 'High' ? 'bg-red-100 text-red-700' : goal.priority === 'Low' ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-700'}`}>{goal.priority || 'Medium'}</span></div>
                        <p className="text-sm text-gray-500">
                            Target: <span className="font-medium text-dark">{formatCurrencyString(goal.targetAmount ?? 0)}</span> by {goal.deadline ? new Date(goal.deadline).toLocaleDateString() : '—'}
                        </p>
                    </div>
                     <div className="flex-shrink-0 flex items-center -mt-2 -mr-2">
                        <button type="button" onClick={onEdit} className="p-2 text-gray-400 hover:text-primary" aria-label="Edit goal"><PencilIcon className="h-4 w-4"/></button>
                        <button type="button" onClick={onDelete} className="p-2 text-gray-400 hover:text-danger" aria-label="Delete goal"><TrashIcon className="h-4 w-4"/></button>
                    </div>
                </div>
            </div>

            {/* Progress Section */}
            <div className="space-y-2">
                <GoalProgressBar progress={progressPercent} colorClass={color} />
                 <div className="flex justify-between items-baseline text-sm">
                    <div>
                        <span className="text-gray-500">Saved: </span>
                        <span className="font-semibold text-dark">{formatCurrencyString(resolvedCurrentAmountSar)}</span>
                    </div>
                    <div>
                        <span className="text-gray-500">Remaining: </span>
                        <span className="font-semibold text-dark">{formatCurrencyString(Math.max(0, (goal.targetAmount ?? 0) - resolvedCurrentAmountSar))}</span>
                    </div>
                </div>
            </div>

            {/* Status and Contributions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center bg-gray-50 p-4 rounded-lg">
                <div className="text-center md:text-left space-y-1">
                    <p className="text-sm text-gray-600 mb-2">Status ({monthsLeft} months left)</p>
                    <GoalStatus status={status} />
                    {projectedMonthlyContribution > 0 && ((goal.targetAmount ?? 0) - resolvedCurrentAmountSar) > 0 && (
                        <p className="text-xs text-slate-600 mt-2">
                            At current rate: <span className="font-semibold text-dark">~{Math.ceil(((goal.targetAmount ?? 0) - resolvedCurrentAmountSar) / projectedMonthlyContribution)} months</span> to goal
                        </p>
                    )}
                    {monteCarloResult != null && (
                        <p className="text-xs text-indigo-700 mt-2 font-medium">
                            Probability of success: <span className="font-bold">{monteCarloResult.probabilityOfSuccess.toFixed(0)}%</span>
                            <span className="text-slate-500 font-normal ml-1">(Monte Carlo, 2k scenarios)</span>
                        </p>
                    )}
                    {completionAtRequired && (goal.targetAmount ?? 0) > resolvedCurrentAmountSar && (
                        <p className="text-xs text-slate-600 mt-2">
                            At required/current pace: reach target by{' '}
                            <span className="font-semibold text-dark">{completionAtRequired.toLocaleDateString()}</span>
                        </p>
                    )}
                </div>
                <div className="space-y-2">
                    {(fundingEnvelope.assignedBudgetMonthly > 0 || fundingEnvelope.assignedInvestmentMonthly > 0) && (
                        <p className="text-[11px] text-slate-500 leading-snug">
                            {fundingEnvelope.assignedBudgetMonthly > 0 && (
                                <span>
                                    Linked budget: {formatCurrencyString(fundingEnvelope.assignedBudgetMonthly, { digits: 0 })}/mo
                                </span>
                            )}
                            {fundingEnvelope.assignedBudgetMonthly > 0 && fundingEnvelope.assignedInvestmentMonthly > 0 && ' · '}
                            {fundingEnvelope.assignedInvestmentMonthly > 0 && (
                                <span>
                                    {fundingEnvelope.assignedBudgetMonthly > 0
                                        ? 'Also linked (not in envelope): '
                                        : ''}
                                    investment {fundingEnvelope.assignedInvestmentSource === 'plan' ? 'plan budget' : 'deposits'}:{' '}
                                    {formatCurrencyString(fundingEnvelope.assignedInvestmentMonthly, { digits: 0 })}/mo
                                </span>
                            )}
                        </p>
                    )}
                    {fundingEnvelope.envelopeMonthly <= 0 && (goal.targetAmount ?? 0) > resolvedCurrentAmountSar && (
                        <p className="text-[11px] text-amber-800 leading-snug">
                            No mapped monthly funding — link a budget on Budgets or an investment on Investments.
                        </p>
                    )}
                    <div>
                        <div className="flex justify-between items-center text-xs mb-0.5">
                            <span className="font-medium text-gray-600">Projected monthly (envelope)</span>
                            <span className="font-bold">{formatCurrencyString(projectedMonthlyContribution, { digits: 0 })}</span>
                        </div>
                        <div className="h-2 w-full bg-gray-200 rounded-full">
                            <div className="bg-blue-400 h-2 rounded-full" style={{ width: `${Math.min((projectedMonthlyContribution / Math.max(requiredMonthlyContribution, 1)) * 100, 100)}%` }}></div>
                        </div>
                    </div>
                     <div>
                        <div className="flex justify-between items-center text-xs mb-0.5">
                            <span className="font-medium text-gray-600">Required Monthly</span>
                            <span className="font-bold">{formatCurrencyString(requiredMonthlyContribution, { digits: 0 })}</span>
                        </div>
                         <div className="h-2 w-full bg-gray-200 rounded-full">
                            <div className="bg-primary h-2 rounded-full" style={{ width: '100%' }}></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Linked Contributions */}
            <div className="border-t pt-4">
                <h4 className="font-semibold text-sm text-gray-700 mb-2 flex items-center">
                    <LinkIcon className="h-4 w-4 mr-2 text-gray-400" />
                    Linked Contributions
                </h4>
                {linkedAssets.length > 0 ? (
                    <ul className="space-y-1 max-h-24 overflow-y-auto text-sm pr-2">
                        {linkedAssets.map((asset, index) => (
                            <li key={`${asset.name}-${index}`} className="flex justify-between items-center">
                                <span className="text-gray-600 break-words" title={asset.name}>{asset.name}</span>
                                <span className="font-medium text-dark flex-shrink-0 ml-2">{formatCurrencyString(asset.value, { digits: 0 })}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-gray-500 text-center italic mt-2">No assets linked. Link them from the Assets or Investments pages.</p>
                )}
                {linkedLiabilities.length > 0 && (
                    <div className="mt-3 border-t pt-3">
                        <p className="text-xs font-semibold text-gray-700 mb-1">Linked liabilities & receivables</p>
                        <ul className="space-y-1 text-sm">
                            {linkedLiabilities.slice(0, 4).map((liab: Liability) => {
                                const isRecv = liab.type === 'Receivable' && (liab.amount ?? 0) > 0;
                                const amtStr = `${formatCurrencyString(Math.abs(liab.amount ?? 0), { digits: 0 })}${(liab.status ?? 'Active') === 'Paid' ? ' (Paid)' : ''}`;
                                return (
                                    <li key={liab.id} className="flex justify-between items-center gap-2">
                                        <span className="text-gray-600 break-words" title={liab.name ?? ''}>
                                            {liab.name ?? 'Entry'}
                                            {isRecv ? <span className="text-emerald-700 font-normal ml-1">(owed to you)</span> : null}
                                        </span>
                                        <span className={`font-medium ml-2 shrink-0 ${isRecv ? 'text-emerald-700' : 'text-danger'}`}>{amtStr}</span>
                                    </li>
                                );
                            })}
                            {linkedLiabilities.length > 4 && (
                                <li className="text-xs text-gray-500">+{linkedLiabilities.length - 4} more linked items</li>
                            )}
                        </ul>
                    </div>
                )}
            </div>
            
            {onSeeInPlan && (
                <div className="pt-2 border-t border-gray-200">
                    <button type="button" onClick={onSeeInPlan} className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-primary hover:bg-primary/5 rounded-lg transition-colors">
                        <LinkIcon className="h-4 w-4" /> See impact in Plan
                    </button>
                </div>
            )}
            <div className="bg-indigo-50 p-4 rounded-lg">
                <div className="flex items-center justify-between"><div><h4 className="font-semibold text-indigo-800">Savings Plan</h4><p className="text-xs text-indigo-700/80">From your expert advisor</p></div><button type="button" onClick={handleGetAIPlan} disabled={isLoading || !aiActionsEnabled} title={!aiActionsEnabled ? 'AI unavailable — configure provider keys' : undefined} className="flex items-center px-3 py-1 text-sm bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors"><RocketLaunchIcon className="h-4 w-4 mr-2"/>{isLoading ? 'Generating...' : 'Get AI Plan'}</button></div>
                {isLoading && <div className="text-center p-4 text-sm text-gray-500">Generating your plan...</div>}
                {aiPlan && !isLoading && <div className="mt-2"><SafeMarkdownRenderer content={aiPlan} /></div>}
            </div>
        </div>
    );
};

const Goals: React.FC<{
  setActivePage?: (page: Page) => void;
  pageAction?: string | null;
  clearPageAction?: () => void;
  triggerPageAction?: (page: Page, action: string) => void;
}> = ({ setActivePage, pageAction, clearPageAction, triggerPageAction }) => {
    const { data, addGoal, updateGoal, deleteGoal } = useContext(DataContext)!;
    const { computeData } = usePageDeferredData();
    const engineData = computeData ?? data;
    const { aiHealthChecked, isAiAvailable } = useAI();
    const { trackAction } = useSelfLearning();
    const { currency: displayCurrency } = useCurrency();
    const { kpiSnapshot, sarPerUsd, liquidCashSar } = useCanonicalFinancialMetrics();
    const { formatCurrencyString, formatSecondaryEquivalent } = useFormatCurrency();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [goalToEdit, setGoalToEdit] = useState<Goal | null>(null);
    const [goalToDelete, setGoalToDelete] = useState<Goal | null>(null);
    const [focusedGoalId, setFocusedGoalId] = useState<string | null>(null);
    useEffect(() => {
        if (!pageAction) return;
        if (pageAction.startsWith('focus-goal:')) {
            const encoded = pageAction.slice('focus-goal:'.length);
            const id = decodeURIComponent(encoded || '').trim();
            if (id) {
                setFocusedGoalId(id);
                window.setTimeout(() => {
                    const el = document.getElementById(`goal-card-${id}`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 60);
                window.setTimeout(() => {
                    setFocusedGoalId((prev) => (prev === id ? null : prev));
                }, 3500);
            }
            clearPageAction?.();
        }
    }, [pageAction, clearPageAction]);

    const { exchangeRate } = useCurrency();

    /** Rolling average net cash flow in SAR — headline FX path (`sarPerUsd`). */
    const averageMonthlySavings = useMemo(
        () => averageRollingMonthlyNetSurplus(data ?? null, GOAL_NET_CASHFLOW_LOOKBACK_MONTHS, sarPerUsd),
        [data, sarPerUsd],
    );

    /** Sum of last 12 calendar months of net flow in SAR — feeds annual funding suggestions. */
    const rollingAnnualNetSar = useMemo(() => {
        if (!data) return 0;
        const { values } = personalMonthlyNetByMonthKeySar(data, sarPerUsd, 12);
        return values.reduce((sum, v) => sum + v, 0);
    }, [data, sarPerUsd]);

    const emergencyFundMonthlyCapacity = useMemo(
        () => monthlySurplusForEmergencyFund(data ?? null, sarPerUsd),
        [data, sarPerUsd],
    );

    const totalMappedGoalEnvelopesMonthly = useMemo(
        () => sumAllGoalMonthlyFundingEnvelopesSar(data ?? null, sarPerUsd),
        [data, sarPerUsd],
    );

    const financialMonthPeriodLabel = useMemo(() => {
        if (!data) return '';
        const { currentRange } = financialMonthNetCashflowSar(data, exchangeRate);
        const fmt = (d: Date) =>
            d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        return `${fmt(currentRange.start)} – ${fmt(currentRange.end)}`;
    }, [data, exchangeRate]);

    const resolvedGoalTotalsMap = useMemo(() => computeGoalResolvedAmountsSar(engineData ?? null, sarPerUsd), [engineData, sarPerUsd]);

    const { totalTargetAmount, totalCurrentAmount, goalCurrentAmountByGoalId } = useMemo(() => {
        let totalTarget = 0;
        let totalCurrent = 0;
        const goals = data?.goals ?? [];
        const goalCurrentAmountByGoalId: Record<string, number> = {};

        goals.forEach((goal) => {
            totalTarget += goal.targetAmount ?? 0;
            const cur = resolvedGoalTotalsMap.get(goal.id) ?? 0;
            goalCurrentAmountByGoalId[goal.id] = cur;
            totalCurrent += cur;
        });

        return { totalTargetAmount: totalTarget, totalCurrentAmount: totalCurrent, goalCurrentAmountByGoalId };
    }, [data?.goals, resolvedGoalTotalsMap]);
    
    const overallProgress = totalTargetAmount > 0 ? (totalCurrentAmount / totalTargetAmount) * 100 : 0;

    const fundingPlan = useMemo(
        () => computeGoalFundingPlan(engineData, rollingAnnualNetSar, sarPerUsd),
        [engineData, rollingAnnualNetSar, sarPerUsd],
    );

    /** One status per goal for cards + funding list — `computeGoalTimelineStatus` (envelope vs required pace). */
    const goalTimelineByGoalId = useMemo(() => {
        const m = new Map<string, ReturnType<typeof computeGoalTimelineStatus>>();
        (engineData?.goals ?? []).forEach((g) => {
            const env = computeGoalMonthlyFundingEnvelopeSar({ goal: g, data: engineData ?? null, sarPerUsd });
            m.set(
                g.id,
                computeGoalTimelineStatus({
                    goal: g,
                    resolvedCurrentAmountSar: goalCurrentAmountByGoalId[g.id] ?? 0,
                    projectedMonthlyContribution: env.envelopeMonthly,
                }),
            );
        });
        return m;
    }, [engineData?.goals, engineData, sarPerUsd, goalCurrentAmountByGoalId]);

    const goalsByPriority = useMemo(() => {
        const rank = { High: 0, Medium: 1, Low: 2 } as const;
        return [...(data?.goals ?? [])].sort((a, b) => (rank[a.priority || 'Medium'] - rank[b.priority || 'Medium']) || (a.name ?? '').localeCompare(b.name ?? ''));
    }, [data?.goals]);

    const fundingWaterfallOrder = useMemo(() => {
        const rank = { High: 0, Medium: 1, Low: 2 } as const;
        const active = (data?.goals ?? []).filter((g) => (g.targetAmount ?? 0) > (goalCurrentAmountByGoalId[g.id] ?? 0));
        return [...active].sort((a, b) => {
            const pa = rank[a.priority || 'Medium'];
            const pb = rank[b.priority || 'Medium'];
            if (pa !== pb) return pa - pb;
            return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        });
    }, [data?.goals, goalCurrentAmountByGoalId]);
    
    const handleOpenModal = (goal: Goal | null = null) => { if (!goal) trackAction('add-goal', 'Goals'); setGoalToEdit(goal); setIsModalOpen(true); };
    const openGoalEditorById = useCallback(
        (goalId: string) => {
            const g = (data?.goals ?? []).find((x) => x.id === goalId);
            if (g) {
                setGoalToEdit(g);
                setIsModalOpen(true);
            }
        },
        [data?.goals],
    );
    const handleOpenDeleteModal = (goal: Goal) => { setGoalToDelete(goal); setIsDeleteModalOpen(true); };
    
    const handleSaveGoal = async (goal: Goal) => {
        try {
            if ((data?.goals ?? []).some(g => g.id === goal.id)) await updateGoal(goal);
            else await addGoal(goal);
        } catch (error) {
            // Error already alerted in DataContext
        }
    };

    const handleConfirmDelete = () => {
        if (goalToDelete) {
            deleteGoal(goalToDelete.id);
            setIsDeleteModalOpen(false);
            setGoalToDelete(null);
        }
    };
    
    const efGoals = useEmergencyFund(data ?? null);
    const dynamicWindfallPlan = useMemo(() => {
        const goals = (data?.goals ?? [])
            .map((g) => {
                const current = goalCurrentAmountByGoalId[g.id] ?? 0;
                const gap = Math.max(0, (g.targetAmount ?? 0) - current);
                const priorityFactor = g.priority === 'High' ? 1 : g.priority === 'Medium' ? 0.7 : 0.4;
                return { id: g.id, name: g.name, gap, weightedGap: gap * priorityFactor };
            })
            .filter((g) => g.gap > 0);
        const totalWeightedGap = goals.reduce((s, g) => s + g.weightedGap, 0);
        const allocation = computeWindfallAllocationPct({
            emergencyRunwayMonths: efGoals.monthsCovered,
            weightedGoalGapSum: totalWeightedGap,
            annualSurplusAnchorSar: rollingAnnualNetSar,
        });
        const topGoals = goals
            .sort((a, b) => b.weightedGap - a.weightedGap)
            .slice(0, 3)
            .map((g) => ({
                ...g,
                pctOfGoalBucket: totalWeightedGap > 0 ? (g.weightedGap / totalWeightedGap) * 100 : 0,
            }));
        return {
            goalFundingPct: allocation.goalsPct,
            emergencyBufferPct: allocation.emergencyPct,
            investPct: allocation.investPct,
            derivationLines: allocation.derivationLines,
            topGoals,
        };
    }, [data?.goals, goalCurrentAmountByGoalId, efGoals.monthsCovered, rollingAnnualNetSar]);
    const goalValidationWarnings = useMemo(() => {
        const warnings: string[] = [];
        const goals = data?.goals ?? [];
        const now = new Date();
        const overdueUnfunded = goals.filter((g) => new Date(g.deadline) < now && (goalCurrentAmountByGoalId[g.id] ?? 0) < (g.targetAmount ?? 0)).length;
        if (overdueUnfunded > 0) warnings.push(`${overdueUnfunded} goal(s) are past deadline and still under target.`);
        const invalidTargets = goals.filter((g) => !Number.isFinite(Number(g.targetAmount)) || Number(g.targetAmount) <= 0).length;
        if (invalidTargets > 0) warnings.push(`${invalidTargets} goal(s) have invalid target amounts.`);
        const noMappedFunding = goals.filter((g) => {
            const env = computeGoalMonthlyFundingEnvelopeSar({ goal: g, data: data ?? null, sarPerUsd });
            return env.envelopeMonthly <= 0 && (g.targetAmount ?? 0) > (goalCurrentAmountByGoalId[g.id] ?? 0);
        }).length;
        if (noMappedFunding > 0) warnings.push(`${noMappedFunding} active goal(s) have no linked budget or investment monthly envelope.`);
        if (!Number.isFinite(averageMonthlySavings)) warnings.push('Average monthly savings calculation is invalid.');
        if (!Number.isFinite(sarPerUsd) || sarPerUsd <= 0) warnings.push('Exchange rate is invalid — USD-linked balances may mis-state goal progress.');
        const hasUsd = getPersonalAccounts(data).some((a) => a.currency === 'USD');
        if (hasUsd && (!Number.isFinite(sarPerUsd) || sarPerUsd <= 0)) {
            warnings.push('USD accounts detected — set SAR per USD in the header or Wealth Ultra for accurate goal totals.');
        }
        return warnings;
    }, [data?.goals, data, goalCurrentAmountByGoalId, averageMonthlySavings, sarPerUsd]);

    const goalsWithDualFundingNames = useMemo(
        () =>
            (data?.goals ?? [])
                .filter((g) => {
                    const env = computeGoalMonthlyFundingEnvelopeSar({ goal: g, data: data ?? null, sarPerUsd });
                    return env.assignedBudgetMonthly > 0 && env.assignedInvestmentMonthly > 0;
                })
                .map((g) => g.name),
        [data, sarPerUsd],
    );

  return (
    <PageLayout
      title="Goal Command Center"
      description="Saved toward each goal uses the same SAR totals as Summary and Dashboard. Funding math uses your rolling surplus and Dashboard KPIs where noted."
      action={
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {setActivePage && (
            <PageActionsDropdown
              ariaLabel="Goals quick links"
              actions={[
                { value: 'plan', label: 'Annual Plan', onClick: () => setActivePage('Plan') },
                { value: 'budgets', label: 'Budgets', onClick: () => setActivePage('Budgets') },
                { value: 'transactions', label: 'Transactions', onClick: () => setActivePage('Transactions') },
                { value: 'forecast', label: 'Forecast', onClick: () => setActivePage('Forecast') },
                { value: 'summary', label: 'Financial Summary', onClick: () => setActivePage('Summary') },
                { value: 'investments', label: 'Investments', onClick: () => setActivePage('Investments') },
              ]}
            />
          )}
          {setActivePage && (
            <button type="button" onClick={() => setActivePage('Plan')} className="btn-outline flex items-center gap-1.5">
              <LinkIcon className="h-4 w-4" /> See impact in Plan
            </button>
          )}
          <button type="button" onClick={() => handleOpenModal()} className="btn-primary flex items-center gap-2"><PlusCircleIcon className="h-5 w-5"/>Add New Goal</button>
        </div>
      }
    >
      <GoalsFundingEnvelopeBanner goalNames={goalsWithDualFundingNames} />
      <div className="rounded-2xl border border-teal-100 bg-gradient-to-r from-teal-50/90 to-white px-4 py-3 text-sm text-slate-700 shadow-sm mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-800">FX (headline)</p>
            <p className="font-bold text-slate-900">1 USD = {sarPerUsd.toFixed(2)} SAR</p>
          </div>
          {kpiSnapshot && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-800">Monthly P&amp;L (Dashboard KPI)</p>
              <p className="font-bold text-slate-900">{formatCurrencyString(kpiSnapshot.monthlyPnL, { digits: 0 })}</p>
              <p className="text-[11px] text-slate-500">{financialMonthPeriodLabel}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-800">Liquid cash (Dashboard KPI)</p>
            <p className="font-bold text-slate-900">{formatCurrencyString(liquidCashSar, { digits: 0 })}</p>
            <p className="text-[11px] text-slate-500">Runway ~{efGoals.monthsCovered.toFixed(1)} mo</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-800">Rolling surplus ({GOAL_NET_CASHFLOW_LOOKBACK_MONTHS} mo)</p>
            <p className="font-bold text-slate-900">{formatCurrencyString(averageMonthlySavings, { digits: 0 })}/mo</p>
            <p className="text-[11px] text-slate-500">Emergency capacity: {formatCurrencyString(emergencyFundMonthlyCapacity, { digits: 0 })}/mo</p>
          </div>
        </div>
        {displayCurrency === 'USD' && (
          <p className="text-xs text-slate-500 mt-2 border-t border-teal-200/70 pt-2">Display is USD — SAR figures convert for viewing only (e.g. 10,000 SAR ≈ {formatSecondaryEquivalent(10000)}).</p>
        )}
        {efGoals.monthsCovered < 2 && (
          <p className="text-xs text-amber-900 mt-2 border-t border-amber-200/80 pt-2">
            Runway is under ~2 months — consider pausing Low-priority goal funding until your buffer improves.
          </p>
        )}
      </div>

      <SectionCard title="Overall Goal Progress" className="bg-gradient-to-br from-white via-slate-50 to-primary/5 border-slate-100" collapsible collapsibleSummary="Progress bar" defaultExpanded>
        <GoalProgressBar progress={overallProgress} colorClass="bg-primary" />
        <div className="flex justify-between items-baseline text-sm mt-2">
            <div>
                <span className="text-gray-500">Total Saved: </span>
                <span className="font-semibold text-dark">{formatCurrencyString(totalCurrentAmount)}</span>
            </div>
            <div>
                <span className="text-gray-500">Total Target: </span>
                <span className="font-semibold text-dark">{formatCurrencyString(totalTargetAmount)}</span>
            </div>
        </div>
      </SectionCard>

      {goalValidationWarnings.length > 0 && (
        <CollapsibleSection title="Data checks" summary={`${goalValidationWarnings.length} note(s)`} defaultExpanded={false} className="border border-amber-100 bg-amber-50/40 mb-6">
          <ul className="text-xs text-amber-950 space-y-1 list-disc pl-4">
            {goalValidationWarnings.slice(0, 8).map((w, i) => (
              <li key={`gw-${i}`}>{w}</li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {aiHealthChecked && !isAiAvailable && <AiProxyUnavailableHint variant="banner" title="Goal AI plans & advisor need a configured proxy" />}

      <SectionCard
        id="goals-emergency-funding"
        title="Emergency fund from surplus"
        className="bg-gradient-to-br from-white via-slate-50 to-teal-50/40 border-slate-100"
        collapsible
        collapsibleSummary="Surplus routing"
        defaultExpanded
      >
        <p className="text-sm text-gray-600 mb-3">
          Goal monthly funding uses <strong>only</strong> budgets and investments explicitly linked to each goal (
          <span className="font-bold text-dark">{formatCurrencyString(totalMappedGoalEnvelopesMonthly, { digits: 0 })}</span>/mo combined).
          Rolling surplus after all goal-linked budget reservations (
          <span className="font-bold text-dark">{formatCurrencyString(emergencyFundMonthlyCapacity, { digits: 0 })}</span>/mo) is for your emergency buffer — not split across goals by percentage.
        </p>
        <p className="text-xs text-slate-500">
          Runway ~{efGoals.monthsCovered.toFixed(1)} mo · target {EMERGENCY_FUND_TARGET_MONTHS} mo.
          {efGoals.shortfall > 0 && (
            <> Shortfall: <span className="font-semibold text-amber-900">{formatCurrencyString(efGoals.shortfall, { digits: 0 })}</span>.</>
          )}
        </p>
        {setActivePage && (
          <button type="button" onClick={() => setActivePage('Budgets')} className="btn-outline text-sm mt-3">
            Tag budgets to goals →
          </button>
        )}
      </SectionCard>

      <SectionCard
        title="Goal funding cockpit"
        className="border-slate-200 bg-gradient-to-br from-white via-slate-50 to-violet-50/30"
        collapsible
        collapsibleSummary="Suggested funding + waterfall"
        defaultExpanded
      >
        <p className="text-xs text-slate-600 mb-3">
          Baseline uses your <strong>last 12 calendar months</strong> of personal-scope net cashflow in SAR (income − expenses, dated FX), summed to{' '}
          <span className="font-semibold">{formatCurrencyString(rollingAnnualNetSar, { digits: 0 })}</span>, then ÷ 12 →{' '}
          <span className="font-semibold">{formatCurrencyString(fundingPlan?.totalMonthlySurplus ?? 0, { digits: 0 })}</span>/mo for funding math.
          Goals <strong>past deadline</strong> show a catch-up gap (not divided by months). Goals <strong>without a deadline</strong> amortize over{' '}
          {GOAL_NO_DEADLINE_AMORTIZATION_MONTHS} months.
        </p>

        <div className="flex flex-col lg:flex-row gap-3">
          <div className="lg:flex-1 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">Suggested monthly funding (per goal)</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Badge matches each goal card (mapped envelope vs required monthly pace). Suggested amounts cap at each goal&apos;s linked budget envelope, or investment plan/deposits when no budget is linked.
                        </p>
                    </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                  On track
                </span>
                <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                  Needs attention
                    </span>
                <span className="inline-flex items-center rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10px] font-semibold text-rose-900">
                  At risk
                    </span>
                </div>
        </div>

            {(fundingPlan?.suggestions ?? []).length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
                Add goals with future deadlines to see suggested monthly funding.
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {(fundingPlan?.suggestions ?? [])
                  .slice()
                  .sort((a, b) => {
                    const sa = a.status === 'on_track' ? 0 : 1;
                    const sb = b.status === 'on_track' ? 0 : 1;
                    if (sa !== sb) return sb - sa; // show "Need more" first
                    return (b.requiredPerMonth - b.suggestedPerMonth) - (a.requiredPerMonth - a.suggestedPerMonth);
                  })
                  .map((s) => {
                    const goal = (data?.goals ?? []).find((g) => g.id === s.goalId);
                    const name = goal?.name ?? s.name;
                    const catchUp = Number(s.overdueCatchUpSar) || 0;
                    const isCatchUp = catchUp > 0;
                    const required = Number(s.requiredPerMonth) || 0;
                    const suggested = Number(s.suggestedPerMonth) || 0;
                    const short = isCatchUp
                        ? catchUp
                        : Math.max(0, Math.round(required) - Math.round(suggested));
                    const tl = goalTimelineByGoalId.get(s.goalId);
                    const ok = !isCatchUp && tl?.status === 'On Track';
                    const pct = !isCatchUp && required > 0 ? Math.min(100, (suggested / required) * 100) : 0;
                    const priority = goal?.priority || 'Medium';
                    const deadline = goal?.deadline ? String(goal.deadline).slice(0, 10) : '';

                    return (
                      <div
                        key={`fund-${s.goalId}`}
                        className={`rounded-xl border px-3 py-2.5 shadow-sm ${
                          ok
                            ? 'border-emerald-200 bg-emerald-50/40'
                            : isCatchUp || tl?.status === 'At Risk'
                              ? 'border-rose-200 bg-rose-50/30'
                              : 'border-amber-200 bg-amber-50/40'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => {
                                const el = document.getElementById(`goal-card-${s.goalId}`);
                                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }}
                              className="text-left font-semibold text-slate-900 hover:underline underline-offset-2"
                              title="Jump to goal"
                            >
                              {name}
                            </button>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                              <span className="inline-flex items-center rounded-full bg-white/70 border border-slate-200 px-2 py-0.5 font-semibold">
                                {priority}
                              </span>
                              {deadline && <span>Deadline: {deadline}</span>}
                              {!isCatchUp && (s.monthsToDeadline ?? 0) > 0 && (
                                <span className="text-slate-500">· ~{s.monthsToDeadline} mo left</span>
                              )}
                            </div>
                          </div>

                          <span
                            className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              ok
                                ? 'bg-emerald-100 text-emerald-800'
                                : tl?.status === 'At Risk'
                                  ? 'bg-rose-100 text-rose-900'
                                  : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {isCatchUp
                              ? 'Catch-up'
                              : !tl
                                ? '—'
                                : tl.status === 'On Track'
                                  ? 'On track'
                                  : tl.status === 'Needs Attention'
                                    ? 'Needs attention'
                                    : 'At risk'}
                          </span>
                        </div>

                        {isCatchUp ? (
                          <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50/60 px-2.5 py-2 text-xs text-rose-950">
                            <p className="font-semibold">Deadline passed — remaining gap</p>
                            <p className="tabular-nums font-bold mt-0.5">{formatCurrencyString(catchUp, { digits: 0 })} SAR</p>
                            <p className="text-[11px] text-rose-900/90 mt-1 leading-snug">
                              Not annualized into a monthly run-rate; fund from surplus or windfall as you can.
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs tabular-nums">
                              <div className="rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Required</p>
                                <p className="font-bold text-slate-900">{formatCurrencyString(required, { digits: 0 })}/mo</p>
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Suggested</p>
                                <p className="font-bold text-slate-900">{formatCurrencyString(suggested, { digits: 0 })}/mo</p>
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shortfall</p>
                                <p className={`font-bold ${short > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
                                  {short > 0 ? formatCurrencyString(short, { digits: 0 }) : '0'}
                                  {short > 0 ? '/mo' : ''}
                                </p>
                              </div>
                            </div>

                            <div className="mt-2">
                              <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden" aria-hidden>
                                <div
                                  className={`h-full rounded-full ${
                                    ok ? 'bg-emerald-500' : tl?.status === 'At Risk' ? 'bg-rose-500' : 'bg-amber-500'
                                  }`}
                                  style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                                />
                              </div>
                              <p className="mt-1 text-[11px] text-slate-600">
                                Coverage: <span className="font-semibold">{pct.toFixed(0)}%</span> of required monthly
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <div className="lg:w-[360px] rounded-2xl border border-violet-200 bg-violet-50/40 p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">Funding waterfall (suggested order)</p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Order = <strong>priority</strong> (High → Low) then <strong>earliest deadline</strong>.
                </p>
              </div>
            </div>

          {fundingWaterfallOrder.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-violet-200 bg-white/60 px-3 py-6 text-center text-sm text-slate-500">
                Add goals to see suggested order.
              </div>
            ) : (
              <ol className="mt-3 space-y-2">
                {fundingWaterfallOrder.map((g, idx) => {
                  const p = g.priority || 'Medium';
                  const pClass =
                    p === 'High'
                      ? 'bg-rose-100 text-rose-800 border-rose-200'
                      : p === 'Low'
                      ? 'bg-slate-100 text-slate-700 border-slate-200'
                      : 'bg-amber-100 text-amber-800 border-amber-200';
                  return (
                    <li key={g.id} className="rounded-xl border border-violet-200 bg-white/80 px-3 py-2 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => {
                              const el = document.getElementById(`goal-card-${g.id}`);
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }}
                            className="text-left font-semibold text-slate-900 hover:underline underline-offset-2"
                            title="Jump to goal"
                          >
                            {idx + 1}. {g.name}
                          </button>
                          <p className="text-[11px] text-slate-600 mt-0.5">Deadline: {String(g.deadline).slice(0, 10)}</p>
                        </div>
                        <span className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${pClass}`}>
                          {p}
                        </span>
                      </div>
              </li>
                  );
                })}
        </ol>
            )}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-violet-200/80">
          <p className="text-sm font-semibold text-slate-900 mb-2">Windfall split (deterministic)</p>
          <p className="text-xs text-slate-600 mb-2">
            Uses runway + weighted goal gaps vs rolling 12‑mo net ({formatCurrencyString(rollingAnnualNetSar, { digits: 0 })} SAR/yr).
          </p>
          <ul className="text-sm text-slate-700 space-y-1">
            <li><strong>{dynamicWindfallPlan.emergencyBufferPct}%</strong> emergency · runway ~{efGoals.monthsCovered.toFixed(1)} mo</li>
            <li><strong>{dynamicWindfallPlan.goalFundingPct}%</strong> goal gaps (priority-weighted)</li>
            <li><strong>{dynamicWindfallPlan.investPct}%</strong> long-term investing</li>
            {dynamicWindfallPlan.topGoals.length > 0 && (
              <li className="text-xs text-slate-600">
                Top goal slice: {dynamicWindfallPlan.topGoals.map((g) => `${g.name} (${g.pctOfGoalBucket.toFixed(0)}%)`).join(' · ')}
              </li>
            )}
          </ul>
        </div>
      </SectionCard>

      <GoalConflictAndFeasibilitySection
        goals={(data?.goals ?? []).map(g => ({ ...g, currentAmount: goalCurrentAmountByGoalId[g.id] ?? 0 }))}
        monthlySurplusForEmergencyFund={emergencyFundMonthlyCapacity}
        formatCurrencyString={formatCurrencyString}
        setActivePage={setActivePage}
        triggerPageAction={triggerPageAction}
        onEditGoalById={openGoalEditorById}
        resolvedCurrentByGoalId={resolvedGoalTotalsMap}
        goalEngineData={data}
        sarPerUsdForGoals={sarPerUsd}
      />

       <div id="goals-cards-grid" className="cards-grid grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 mb-8">
        {goalsByPriority.map(goal => (
            <div
                key={goal.id}
                id={`goal-card-${goal.id}`}
                className={focusedGoalId === goal.id ? 'rounded-xl ring-2 ring-primary/40 ring-offset-2 transition-all' : ''}
            >
                <GoalCard
                    goal={goal}
                    resolvedCurrentAmountSar={goalCurrentAmountByGoalId[goal.id] ?? 0}
                    sarPerUsd={sarPerUsd}
                    onEdit={() => handleOpenModal(goal)}
                    onDelete={() => handleOpenDeleteModal(goal)}
                    onSeeInPlan={setActivePage ? () => setActivePage('Plan') : undefined}
                />
            </div>
        ))}
      </div>

      <AIAdvisor
        pageContext="goals"
        contextData={{
          goals: data?.goals ?? [],
          monthlySavings: averageMonthlySavings,
          rollingAnnualNetSar,
          surplusAfterReservedBudgets: emergencyFundMonthlyCapacity,
          totalMappedGoalEnvelopesMonthly,
          dashboardMonthlyPnLSar: kpiSnapshot?.monthlyPnL,
          liquidCashSar,
        }}
      />
      
      <GoalModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveGoal} goalToEdit={goalToEdit} />
      <DeleteConfirmationModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={handleConfirmDelete} itemName={goalToDelete?.name || ''} />
    </PageLayout>
  );
};

export default Goals;
