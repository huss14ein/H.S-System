import React, { useState, useCallback, useMemo, useContext, useEffect } from 'react';
import { DataContext } from '../context/DataContext';
import { getGoalAIPlan } from '../services/geminiService';
import { Goal, Liability, Page } from '../types';
import { RocketLaunchIcon } from '../components/icons/RocketLaunchIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { XCircleIcon } from '../components/icons/XCircleIcon';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { PencilIcon } from '../components/icons/PencilIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import Modal from '../components/Modal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { PlusCircleIcon } from '../components/icons/PlusCircleIcon';
import AIAdvisor from '../components/AIAdvisor';
import { LinkIcon } from '../components/icons/LinkIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import ProgressBar from '../components/ProgressBar';
import InfoHint from '../components/InfoHint';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import CollapsibleSection from '../components/CollapsibleSection';
import { useCurrency } from '../context/CurrencyContext';
import { useEmergencyFund } from '../hooks/useEmergencyFund';
import { toSAR, resolveSarPerUsd } from '../utils/currencyMath';
import { computeGoalFundingPlan } from '../services/goalFundingRouter';
import { monteCarloGoalSuccess } from '../services/portfolioConstruction';
import { projectedGoalCompletionDate, goalFundingGap as goalGapShared } from '../services/goalMetrics';
import { detectGoalConflict, goalFeasibilityCheck, type GoalConflict } from '../services/goalConflictEngine';
import { useSelfLearning } from '../context/SelfLearningContext';
import { countsAsIncomeForCashflowKpi, countsAsExpenseForCashflowKpi } from '../services/transactionFilters';
import { useCompanyNames } from '../hooks/useSymbolCompanyName';
import { formatSymbolWithCompany } from '../components/SymbolWithCompanyName';
import { receivableContributionForGoal } from '../services/goalReceivableContribution';
import { computeGoalResolvedAmountsSar } from '../services/goalResolvedTotals';
import {
    computeGoalMonthlyFundingEnvelopeSar,
    rollingSurplusAfterAllGoalBudgetReservations,
} from '../services/goalProjectionFunding';

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
            alert('Goal name is required.');
            return;
        }
        if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) {
            alert('Target amount must be a positive number.');
            return;
        }
        if (!deadline || Number.isNaN(deadlineDate.getTime())) {
            alert('Please provide a valid deadline date.');
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
  monthlySurplusForGoals: number;
  allocations: Record<string, number>;
  formatCurrencyString: (n: number, opts?: { digits?: number }) => string;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  onEditGoalById?: (goalId: string) => void;
  resolvedCurrentByGoalId: Map<string, number>;
}> = ({ goals, monthlySurplusForGoals, allocations, formatCurrencyString, setActivePage, triggerPageAction, onEditGoalById, resolvedCurrentByGoalId }) => {
  const conflicts = useMemo(
    () => detectGoalConflict({ goals, monthlySurplusForGoals, resolvedCurrentByGoalId }),
    [goals, monthlySurplusForGoals, resolvedCurrentByGoalId]
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
              typeof req === 'number' && typeof sur === 'number' ? Math.max(0, req - sur) : null;
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
                              Short {formatCurrencyString(Math.max(0, c.neededPerMonth - c.surplusMonthly), { digits: 0 })}/mo
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
                              We sum <strong>(target − saved) ÷ months left</strong> for each goal with a deadline. If that total is much higher than your average monthly surplus, the same pool of cash cannot fund every goal on time.
                            </p>
                            <p className="text-slate-700">
                              <strong>Try:</strong> lower individual % allocations, extend deadlines for lower-priority goals, increase surplus (expenses/budget), or narrow targets.
                            </p>
                          </>
                        )}
                        {c.reason === 'impossible_date' && (
                          <p>
                            For <strong>{c.goalName ?? 'this goal'}</strong>, closing the gap by the deadline needs more per month than your current surplus allows. Extend the deadline, reduce the target, raise savings capacity, or deprioritize other goals.
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
        <p className="text-sm text-slate-700 mb-4">No conflicts detected. Total required monthly fits within your surplus.</p>
      )}
      {activeGoals.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Feasibility at current allocation</h4>
          <ul className="space-y-1.5 text-sm">
            {activeGoals.map(goal => {
              const pct = allocations[goal.id] ?? 0;
              const monthlyContribution = monthlySurplusForGoals * (pct / 100);
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

const GoalCard: React.FC<{ goal: Goal; onEdit: () => void; onDelete: () => void; onSeeInPlan?: () => void }> = ({ goal, onEdit, onDelete, onSeeInPlan }) => {
    const { data } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);
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

        const { linkedAssets, calculatedCurrentAmount } = useMemo(() => {
            const linkedItems: { name: string; value: number }[] = [];
            const assets = (data as any)?.personalAssets ?? data?.assets ?? [];
            const investments = (data as any)?.personalInvestments ?? data?.investments ?? [];

            assets.filter((a: { goalId?: string }) => a.goalId === goal.id).forEach((a: { name?: string; value?: number }) => {
                linkedItems.push({ name: a.name ?? '—', value: a.value ?? 0 });
            });

            investments.forEach((p: { goalId?: string; name?: string; currency?: string; holdings?: { goalId?: string; symbol?: string; currentValue?: number; name?: string }[] }) => {
                const holdings = p.holdings ?? [];
                let portfolioResidualForGoal = 0;
                holdings.forEach((h: { goalId?: string; symbol?: string; name?: string; currentValue?: number }) => {
                    const resolvedGoalId = h.goalId || p.goalId;
                    if (resolvedGoalId !== goal.id) return;
                    const valueSar = toSAR(h.currentValue ?? 0, (p.currency ?? 'USD') as 'USD' | 'SAR', sarPerUsd);
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

            const totalValue = linkedItems.reduce((sum, item) => sum + (item.value ?? 0), 0);

            return { linkedAssets: linkedItems, calculatedCurrentAmount: totalValue };
        }, [data?.assets, data?.investments, goal.id, sarPerUsd, goalHoldingNames, personalLiabilities]);

    const fundingEnvelope = useMemo(
        () => computeGoalMonthlyFundingEnvelopeSar({ goal, data: data ?? null, sarPerUsd }),
        [goal, data, sarPerUsd],
    );

    const handleGetAIPlan = useCallback(async () => {
        setIsLoading(true);
        const rollingAfter = rollingSurplusAfterAllGoalBudgetReservations(data ?? null);
        const plan = await getGoalAIPlan(goal, rollingAfter, calculatedCurrentAmount, {
            projectedMonthlyOverride: fundingEnvelope.envelopeMonthly,
        });
        setAiPlan(plan);
        setIsLoading(false);
    }, [goal, calculatedCurrentAmount, data, fundingEnvelope.envelopeMonthly]);
    

    const { monthsLeft, progressPercent, status, color, requiredMonthlyContribution, projectedMonthlyContribution, borderColor } = useMemo(() => {
        const currentAmount = calculatedCurrentAmount;
        const now = new Date();
        const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;
        const deadline = goal.deadline ? new Date(goal.deadline) : null;
        const monthsLeft = (() => {
            if (!deadline || Number.isNaN(deadline.getTime())) return 0;
            const diffMs = deadline.getTime() - now.getTime();
            if (diffMs <= 0) return 0;
            return Math.ceil(diffMs / MONTH_MS);
        })();
        const targetAmt = goal.targetAmount ?? 0;
        const progressPercentRaw = targetAmt > 0 ? (currentAmount / targetAmt) * 100 : 0;
        const progressPercent = Math.min(100, Math.max(0, progressPercentRaw));
        const remainingAmount = Math.max(0, targetAmt - currentAmount);
        const requiredMonthlyContribution = monthsLeft > 0 ? remainingAmount / monthsLeft : remainingAmount;
        const projectedMonthlyContribution = fundingEnvelope.envelopeMonthly;

        let status: 'On Track' | 'Needs Attention' | 'At Risk' = 'On Track';
        if (progressPercent >= 100) {
            status = 'On Track';
        } else if (monthsLeft <= 0) {
            status = 'At Risk';
        } else if (projectedMonthlyContribution > 0 && projectedMonthlyContribution < requiredMonthlyContribution * 0.5) {
            status = 'At Risk';
        } else if (projectedMonthlyContribution > 0 && projectedMonthlyContribution < requiredMonthlyContribution * 0.8) {
            status = 'Needs Attention';
        }
        
        const color = progressPercent < 33 ? 'bg-danger' : progressPercent < 66 ? 'bg-warning' : 'bg-success';
        const borderColor = status === 'At Risk' ? 'border-danger' : status === 'Needs Attention' ? 'border-warning' : 'border-success';

        return { monthsLeft, progressPercent, status, color, requiredMonthlyContribution, projectedMonthlyContribution, borderColor };
    }, [goal, calculatedCurrentAmount, fundingEnvelope.envelopeMonthly]);

    const completionAtRequired = useMemo(() => {
        const g = { ...goal, currentAmount: calculatedCurrentAmount } as Goal;
        const gap = goalGapShared(g);
        if (gap <= 0) return null;
        const m = Math.max(requiredMonthlyContribution, projectedMonthlyContribution, 1);
        return projectedGoalCompletionDate(g, m);
    }, [goal, calculatedCurrentAmount, requiredMonthlyContribution, projectedMonthlyContribution]);

    const monteCarloResult = useMemo(() => {
        const targetAmt = goal.targetAmount ?? 0;
        if (targetAmt <= 0 || monthsLeft <= 0 || calculatedCurrentAmount >= targetAmt) return null;
        const monthlyContrib = Math.max(0, projectedMonthlyContribution || requiredMonthlyContribution * 0.5);
        return monteCarloGoalSuccess({
            currentAmount: calculatedCurrentAmount,
            targetAmount: targetAmt,
            monthlyContribution: monthlyContrib,
            monthsRemaining: monthsLeft,
            expectedAnnualReturn: 0.07,
            annualVolatility: 0.15,
            numSimulations: 2000,
        });
    }, [goal.targetAmount, monthsLeft, calculatedCurrentAmount, projectedMonthlyContribution, requiredMonthlyContribution]);

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
                        <span className="font-semibold text-dark">{formatCurrencyString(calculatedCurrentAmount)}</span>
                    </div>
                    <div>
                        <span className="text-gray-500">Remaining: </span>
                        <span className="font-semibold text-dark">{formatCurrencyString(Math.max(0, (goal.targetAmount ?? 0) - calculatedCurrentAmount))}</span>
                    </div>
                </div>
            </div>

            {/* Status and Contributions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center bg-gray-50 p-4 rounded-lg">
                <div className="text-center md:text-left space-y-1">
                    <p className="text-sm text-gray-600 mb-2">Status ({monthsLeft} months left)</p>
                    <GoalStatus status={status} />
                    {projectedMonthlyContribution > 0 && ((goal.targetAmount ?? 0) - calculatedCurrentAmount) > 0 && (
                        <p className="text-xs text-slate-600 mt-2">
                            At current rate: <span className="font-semibold text-dark">~{Math.ceil(((goal.targetAmount ?? 0) - calculatedCurrentAmount) / projectedMonthlyContribution)} months</span> to goal
                        </p>
                    )}
                    {monteCarloResult != null && (
                        <p className="text-xs text-indigo-700 mt-2 font-medium">
                            Probability of success: <span className="font-bold">{monteCarloResult.probabilityOfSuccess.toFixed(0)}%</span>
                            <span className="text-slate-500 font-normal ml-1">(Monte Carlo, 2k scenarios)</span>
                        </p>
                    )}
                    {completionAtRequired && (goal.targetAmount ?? 0) > calculatedCurrentAmount && (
                        <p className="text-xs text-slate-600 mt-2">
                            At required/current pace: reach target by{' '}
                            <span className="font-semibold text-dark">{completionAtRequired.toLocaleDateString()}</span>
                        </p>
                    )}
                </div>
                <div className="space-y-2">
                    {(fundingEnvelope.assignedBudgetMonthly > 0 || fundingEnvelope.assignedInvestmentMonthly > 0 || fundingEnvelope.allocationSliceMonthly > 0) && (
                        <p className="text-[11px] text-slate-500 leading-snug">
                            {fundingEnvelope.assignedBudgetMonthly > 0 && (
                                <span>
                                    Linked budget: {formatCurrencyString(fundingEnvelope.assignedBudgetMonthly, { digits: 0 })}/mo
                                </span>
                            )}
                            {fundingEnvelope.assignedBudgetMonthly > 0 && fundingEnvelope.assignedInvestmentMonthly > 0 && ' · '}
                            {fundingEnvelope.assignedInvestmentMonthly > 0 && (
                                <span>
                                    Linked investment {fundingEnvelope.assignedInvestmentSource === 'plan' ? 'plan budget' : 'deposits'}:{' '}
                                    {formatCurrencyString(fundingEnvelope.assignedInvestmentMonthly, { digits: 0 })}/mo
                                </span>
                            )}
                            {(fundingEnvelope.assignedBudgetMonthly > 0 || fundingEnvelope.assignedInvestmentMonthly > 0) && fundingEnvelope.allocationSliceMonthly > 0 && ' · '}
                            {fundingEnvelope.allocationSliceMonthly > 0 && (
                                <span>
                                    + savings % of remaining surplus: {formatCurrencyString(fundingEnvelope.allocationSliceMonthly, { digits: 0 })}/mo
                                </span>
                            )}
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
                <div className="flex items-center justify-between"><div><h4 className="font-semibold text-indigo-800">Savings Plan</h4><p className="text-xs text-indigo-700/80">From your expert advisor</p></div><button onClick={handleGetAIPlan} disabled={isLoading} className="flex items-center px-3 py-1 text-sm bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors"><RocketLaunchIcon className="h-4 w-4 mr-2"/>{isLoading ? 'Generating...' : 'Get AI Plan'}</button></div>
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
    const { data, loading, addGoal, updateGoal, deleteGoal, updateGoalAllocations } = useContext(DataContext)!;
    const { trackAction } = useSelfLearning();
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);
    const { formatCurrencyString } = useFormatCurrency();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [goalToEdit, setGoalToEdit] = useState<Goal | null>(null);
    const [goalToDelete, setGoalToDelete] = useState<Goal | null>(null);
    const [focusedGoalId, setFocusedGoalId] = useState<string | null>(null);
    const [allocations, setAllocations] = useState<Record<string, number>>({});

    const allocationSyncKey = useMemo(
        () =>
            JSON.stringify(
                [...(data?.goals ?? [])]
                    .map((g) => ({ id: g.id, pct: g.savingsAllocationPercent ?? 0 }))
                    .sort((a, b) => a.id.localeCompare(b.id)),
            ),
        [data?.goals],
    );

    useEffect(() => {
        const initialAllocations: Record<string, number> = {};
        (data?.goals ?? []).forEach((g) => {
            initialAllocations[g.id] = g.savingsAllocationPercent ?? 0;
        });
        setAllocations(initialAllocations);
    }, [allocationSyncKey]);

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

    const averageMonthlySavings = useMemo(() => {
        const monthlyNet = new Map<string, number>();
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        ((data as any)?.personalTransactions ?? data?.transactions ?? [])
            .filter((t: { date: string; type?: string; category?: string }) => new Date(t.date) > sixMonthsAgo && (countsAsIncomeForCashflowKpi(t) || countsAsExpenseForCashflowKpi(t)))
            .forEach((t: { date: string; type?: string; category?: string; amount?: number }) => {
                const monthKey = String(t.date).slice(0, 7); // YYYY-MM
                const currentNet = monthlyNet.get(monthKey) || 0;
                const absAmt = Math.abs(Number(t.amount) || 0);
                const delta = countsAsIncomeForCashflowKpi(t) ? absAmt : countsAsExpenseForCashflowKpi(t) ? -absAmt : 0;
                monthlyNet.set(monthKey, currentNet + delta);
            });
        
        if (monthlyNet.size === 0) return 0;
        
        const totalNet = Array.from(monthlyNet.values()).reduce((sum, net) => sum + net, 0);
        return Math.max(0, totalNet / monthlyNet.size);
    }, [data?.transactions, (data as any)?.personalTransactions]);

    const surplusForConflictEngine = useMemo(() => rollingSurplusAfterAllGoalBudgetReservations(data ?? null), [data?.budgets, data]);

    const resolvedGoalTotalsMap = useMemo(() => computeGoalResolvedAmountsSar(data ?? null, sarPerUsd), [data, sarPerUsd]);

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

    const projectedAnnualSurplus = useMemo(() => {
        const monthlyNet = new Map<string, number>();
        const year = new Date().getFullYear();
        ((data as any)?.personalTransactions ?? data?.transactions ?? []).forEach((t: { date: string; amount?: number; type?: string; category?: string }) => {
            if (!(countsAsIncomeForCashflowKpi(t) || countsAsExpenseForCashflowKpi(t))) return;
            const d = new Date(t.date);
            if (d.getFullYear() !== year) return;
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const absAmt = Math.abs(Number(t.amount) || 0);
            const delta = countsAsIncomeForCashflowKpi(t) ? absAmt : countsAsExpenseForCashflowKpi(t) ? -absAmt : 0;
            monthlyNet.set(key, (monthlyNet.get(key) ?? 0) + delta);
        });
        if (monthlyNet.size === 0) return averageMonthlySavings * 12;
        const totalNet = Array.from(monthlyNet.values()).reduce((sum, v) => sum + v, 0);
        return totalNet;
    }, [data?.transactions, averageMonthlySavings]);

    const fundingPlan = useMemo(
        () => computeGoalFundingPlan(data, projectedAnnualSurplus, exchangeRate),
        [data, projectedAnnualSurplus, exchangeRate]
    );

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
    
    const handleAllocationChange = (goalId: string, value: string) => {
        const percent = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
        setAllocations(prev => ({ ...prev, [goalId]: percent }));
    };

    const totalAllocation = useMemo(() => Object.values(allocations).reduce((sum: number, p: number) => sum + p, 0), [allocations]);
    
    const handleSaveAllocations = () => {
        trackAction('save-allocation', 'Goals');
        const allocationArray = Object.entries(allocations).map(([id, savingsAllocationPercent]) => ({ id, savingsAllocationPercent }));
        updateGoalAllocations(allocationArray);
        alert("Savings allocation strategy saved!");
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
        const emergencyBufferPct =
            efGoals.monthsCovered < 2 ? 35 :
            efGoals.monthsCovered < 4 ? 25 :
            efGoals.monthsCovered < 6 ? 15 : 10;
        const goalFundingPct = totalWeightedGap > 0
            ? Math.max(30, Math.min(75, Math.round((totalWeightedGap / (totalWeightedGap + 50000)) * 100)))
            : 40;
        const investPct = Math.max(0, 100 - goalFundingPct - emergencyBufferPct);
        const topGoals = goals
            .sort((a, b) => b.weightedGap - a.weightedGap)
            .slice(0, 3)
            .map((g) => ({
                ...g,
                pctOfGoalBucket: totalWeightedGap > 0 ? (g.weightedGap / totalWeightedGap) * 100 : 0,
            }));
        return { goalFundingPct, emergencyBufferPct, investPct, topGoals };
    }, [data?.goals, goalCurrentAmountByGoalId, efGoals.monthsCovered]);
    const goalValidationWarnings = useMemo(() => {
        const warnings: string[] = [];
        const goals = data?.goals ?? [];
        const now = new Date();
        const overdueUnfunded = goals.filter((g) => new Date(g.deadline) < now && (goalCurrentAmountByGoalId[g.id] ?? 0) < (g.targetAmount ?? 0)).length;
        if (overdueUnfunded > 0) warnings.push(`${overdueUnfunded} goal(s) are past deadline and still under target.`);
        const invalidTargets = goals.filter((g) => !Number.isFinite(Number(g.targetAmount)) || Number(g.targetAmount) <= 0).length;
        if (invalidTargets > 0) warnings.push(`${invalidTargets} goal(s) have invalid target amounts.`);
        if (totalAllocation > 100) warnings.push('Savings allocation exceeds 100%.');
        const unallocatedGoals = goals.filter((g) => (allocations[g.id] ?? 0) <= 0).length;
        if (goals.length > 0 && unallocatedGoals === goals.length) warnings.push('No goal currently receives a savings allocation.');
        if (!Number.isFinite(averageMonthlySavings)) warnings.push('Average monthly savings calculation is invalid.');
        return warnings;
    }, [data?.goals, goalCurrentAmountByGoalId, totalAllocation, allocations, averageMonthlySavings]);

    if (loading || !data) {
        return (
            <div className="flex justify-center items-center h-96" aria-busy="true">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" aria-label="Loading goals" />
            </div>
        );
    }

  return (
    <PageLayout
      title="Goal Command Center"
      description="Set goals (house, car, emergency fund) and track progress. We suggest how to split your savings across goals."
      action={
        <div className="flex items-center gap-2">
          {setActivePage && (
            <button type="button" onClick={() => setActivePage('Plan')} className="btn-outline flex items-center gap-1.5">
              <LinkIcon className="h-4 w-4" /> See impact in Plan
            </button>
          )}
          <button type="button" onClick={() => handleOpenModal()} className="btn-primary flex items-center gap-2"><PlusCircleIcon className="h-5 w-5"/>Add New Goal</button>
        </div>
      }
    >
      {efGoals.monthsCovered < 2 && (
        <SectionCard title="Weak cashflow — pause low-priority funding?" className="border-amber-200 bg-amber-50/60" collapsible collapsibleSummary="Runway alert">
          <p className="text-sm text-amber-900">
            Liquid runway is under ~2 months. Consider pausing <strong>discretionary</strong> or <strong>Low</strong>-priority goal contributions until your emergency buffer improves.
          </p>
        </SectionCard>
      )}

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
        <SectionCard title="Goal validation checks" collapsible collapsibleSummary="Data quality checks" defaultExpanded>
          <ul className="space-y-1 text-sm text-amber-800">
            {goalValidationWarnings.slice(0, 6).map((w, i) => (
              <li key={`gw-${i}`}>- {w}</li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard id="goals-savings-allocation" title="Savings Allocation Strategy" className="bg-gradient-to-br from-white via-slate-50 to-primary/5 border-slate-100" collapsible collapsibleSummary="Allocate %" defaultExpanded>
        <p className="text-sm text-gray-500 mb-4">
            Rolling surplus (6 mo avg): <span className="font-bold text-dark">{formatCurrencyString(averageMonthlySavings)}</span>
            {' · '}
            After reserved goal-linked budgets: <span className="font-bold text-dark">{formatCurrencyString(surplusForConflictEngine)}</span> — allocate % across goals below (budget envelopes linked on the Budgets page count first).
        </p>
        <div className="space-y-3">
            {goalsByPriority.map(goal => (
                 <div key={goal.id} className="grid grid-cols-5 items-center gap-4">
                     <label htmlFor={`alloc-${goal.id}`} className="col-span-2 font-medium text-sm">{goal.name}</label>
                     <div className="col-span-2"><ProgressBar value={allocations[goal.id] || 0} max={100} /></div>
                     <div className="flex items-center"><input type="number" id={`alloc-${goal.id}`} value={allocations[goal.id] || ''} onChange={(e) => handleAllocationChange(goal.id, e.target.value)} className="w-16 p-1 border rounded-md text-sm"/><span className="ml-1 text-sm">%</span></div>
                 </div>
            ))}
        </div>
        <div className="border-t mt-4 pt-4 flex justify-between items-center">
             <div><span className="font-semibold">Total Allocated: </span><span className={`font-bold ${totalAllocation > 100 ? 'text-danger' : 'text-success'}`}>{totalAllocation}%</span>{totalAllocation > 100 && <p className="text-xs text-danger">Total cannot exceed 100%.</p>}</div>
             <button type="button" onClick={handleSaveAllocations} disabled={totalAllocation > 100} className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed">Save Strategy</button>
        </div>
      </SectionCard>

      <CollapsibleSection title="System Funding Suggestions" summary="Suggested monthly funding per goal" className="bg-white border border-slate-200">
        <p className="text-xs text-slate-600 mb-3">
            Based on your projected annual surplus of <span className="font-semibold">{formatCurrencyString(fundingPlan?.totalMonthlySurplus ?? 0, { digits: 0 })}</span> per month.
        </p>
        {(fundingPlan.suggestions.length === 0) && (
            <p className="text-sm text-slate-500">Add goals with future deadlines to see suggested monthly funding per goal.</p>
        )}
        <div className="space-y-2">
            {(fundingPlan?.suggestions ?? []).map(s => (
                <div key={s.goalId} className="flex justify-between items-center text-xs border rounded-md px-3 py-2 bg-slate-50">
                    <div>
                        <p className="font-semibold text-slate-900">{(data?.goals ?? []).find(g => g.id === s.goalId)?.name ?? s.name}</p>
                        <p className="text-slate-500 mt-0.5">
                            Required: {formatCurrencyString(s.requiredPerMonth, { digits: 0 })} / mo · Suggested: {formatCurrencyString(s.suggestedPerMonth, { digits: 0 })} / mo
                        </p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        s.status === 'on_track' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                        {s.status === 'on_track' ? 'On track' : 'Need more'}
                    </span>
                </div>
            ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Funding waterfall (suggested order)" summary="Priority order for funding goals" className="border border-violet-100 bg-violet-50/30">
        <p className="text-xs text-slate-600 mb-3">
          After you fully fund a goal, shift focus to the next: <strong>priority</strong> (High → Low) then <strong>earliest deadline</strong>.
        </p>
        <ol className="list-decimal list-inside space-y-1 text-sm text-slate-800">
          {fundingWaterfallOrder.length === 0 ? (
            <li className="text-slate-500">Add goals to see order.</li>
          ) : (
            fundingWaterfallOrder.map((g) => (
              <li key={g.id}>
                {g.name} <span className="text-slate-500">({g.priority || 'Medium'})</span>
              </li>
            ))
          )}
        </ol>
      </CollapsibleSection>

      <GoalConflictAndFeasibilitySection
        goals={(data?.goals ?? []).map(g => ({ ...g, currentAmount: goalCurrentAmountByGoalId[g.id] ?? 0 }))}
        monthlySurplusForGoals={surplusForConflictEngine}
        allocations={allocations}
        formatCurrencyString={formatCurrencyString}
        setActivePage={setActivePage}
        triggerPageAction={triggerPageAction}
        onEditGoalById={openGoalEditorById}
        resolvedCurrentByGoalId={resolvedGoalTotalsMap}
      />

      <CollapsibleSection title="Bonus / windfall allocation ideas" summary="Dynamic split based on current goals" className="border border-slate-200">
        <p className="text-xs text-slate-600 mb-2">Auto-derived from your goal gaps, priorities, and emergency runway.</p>
        <ul className="text-sm text-slate-700 space-y-2">
          <li>
            <strong>{dynamicWindfallPlan.goalFundingPct}% to goals</strong>
            <span className="text-slate-600"> · prioritize by gap × priority weight</span>
          </li>
          <li>
            <strong>{dynamicWindfallPlan.investPct}% to investing</strong>
            <span className="text-slate-600"> · long-term growth bucket</span>
          </li>
          <li>
            <strong>{dynamicWindfallPlan.emergencyBufferPct}% to emergency buffer</strong>
            <span className="text-slate-600"> · runway currently {efGoals.monthsCovered.toFixed(1)} months</span>
          </li>
          {dynamicWindfallPlan.topGoals.length > 0 && (
            <li className="text-slate-600">
              Top goal recipients: {dynamicWindfallPlan.topGoals.map((g) => `${g.name} (${g.pctOfGoalBucket.toFixed(0)}%)`).join(' · ')}
            </li>
          )}
        </ul>
      </CollapsibleSection>

      <AIAdvisor pageContext="goals" contextData={{ goals: data?.goals ?? [], monthlySavings: averageMonthlySavings }}/>
      
       <div id="goals-cards-grid" className="cards-grid grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
        {goalsByPriority.map(goal => (
            <div
                key={goal.id}
                id={`goal-card-${goal.id}`}
                className={focusedGoalId === goal.id ? 'rounded-xl ring-2 ring-primary/40 ring-offset-2 transition-all' : ''}
            >
                <GoalCard
                    goal={goal}
                    onEdit={() => handleOpenModal(goal)}
                    onDelete={() => handleOpenDeleteModal(goal)}
                    onSeeInPlan={setActivePage ? () => setActivePage('Plan') : undefined}
                />
            </div>
        ))}
      </div>
      
      <GoalModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveGoal} goalToEdit={goalToEdit} />
      <DeleteConfirmationModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={handleConfirmDelete} itemName={goalToDelete?.name || ''} />
    </PageLayout>
  );
};

export default Goals;
