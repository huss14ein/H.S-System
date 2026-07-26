import React, { useMemo, useContext, useState } from 'react';
import { DataContext } from '../context/DataContext';
import { countsAsExpenseForCashflowKpi } from '../services/transactionFilters';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { detectRecurringBillPatterns } from '../services/hybridBudgetCategorization';
import { getPersonalTransactions } from '../utils/wealthScope';
import { useCanonicalFinancialMetrics } from '../hooks/useCanonicalFinancialMetrics';
import { sumGoalReservesSar } from '../services/availableLiquidity';
import { isRestrictedRole } from '../utils/role';
import { useAuth } from '../context/AuthContext';
import type { Goal } from '../types';

const SinkingFunds: React.FC = () => {
    const { data, updateGoal } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const auth = useAuth();
    const canMutate = !isRestrictedRole(auth?.userRole);
    const { availableLiquiditySar, reservedLiquiditySar } = useCanonicalFinancialMetrics();
    const [busyGoalId, setBusyGoalId] = useState<string | null>(null);

    /** Goals flagged as sinking funds or that already hold virtual escrow. */
    const escrowGoals = useMemo(
        () => (data?.goals ?? []).filter((g) => g.isSinkingFund || (Number(g.reservedAmount) || 0) > 0),
        [data?.goals],
    );
    const totalReserved = reservedLiquiditySar || sumGoalReservesSar(data);

    const adjustReserve = async (goal: Goal, deltaSar: number) => {
        if (!canMutate) return;
        const next = Math.max(0, Math.round(((Number(goal.reservedAmount) || 0) + deltaSar) * 100) / 100);
        setBusyGoalId(goal.id);
        try {
            await updateGoal({ ...goal, reservedAmount: next, isSinkingFund: true });
        } finally {
            setBusyGoalId(null);
        }
    };

    const suggestedFunds = useMemo(() => {
        const txs = getPersonalTransactions(data).filter(t => countsAsExpenseForCashflowKpi(t));
        const patterns = detectRecurringBillPatterns(txs, 2);
        const MIN_AMOUNT = 2000;
        const funds: Array<{ name: string; target: number; nextDueDate: Date; recurrence: string; saved: number }> = [];

        for (const p of patterns) {
            if (p.typicalAmount < MIN_AMOUNT) continue;
            const monthDiff = p.avgIntervalDays != null && p.avgIntervalDays > 0
                ? Math.max(1, Math.round(p.avgIntervalDays / 30))
                : p.frequency === 'annual' ? 12 : p.frequency === 'quarterly' ? 3 : p.frequency === 'monthly' ? 1 : 0;
            if (monthDiff < 2) continue;

            const nextDueDate = new Date(p.nextExpectedDate);
            const now = new Date();
            const monthsUntilDue = Math.max(0, (nextDueDate.getFullYear() - now.getFullYear()) * 12 + nextDueDate.getMonth() - now.getMonth());
            const savedMonths = monthDiff - monthsUntilDue;
            const saved = Math.max(0, (savedMonths / monthDiff) * p.typicalAmount);

            const recurrenceLabel = monthDiff === 12 ? 'Annual' : monthDiff === 6 ? 'Semi-annual' : monthDiff === 3 ? 'Quarterly' : monthDiff === 1 ? 'Monthly' : `${monthDiff} months`;

            funds.push({
                name: p.merchant,
                target: p.typicalAmount,
                nextDueDate,
                recurrence: recurrenceLabel,
                saved,
            });
        }
        return funds.sort((a, b) => a.nextDueDate.getTime() - b.nextDueDate.getTime());
    }, [data?.transactions, data]);

    return (
        <div className="bg-white p-6 rounded-lg shadow space-y-6">
            <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                    <h3 className="text-lg font-semibold text-dark">Sinking Fund Escrow</h3>
                    <div className="text-sm text-gray-500">
                        Reserved <span className="font-semibold text-dark">{formatCurrencyString(totalReserved, { digits: 0 })}</span>
                        {' · '}Available <span className="font-semibold text-secondary">{formatCurrencyString(availableLiquiditySar, { digits: 0 })}</span>
                    </div>
                </div>
                <p className="text-sm text-gray-500 mb-4">
                    Virtual escrow earmarked toward a goal — subtracted from Available Liquidity, not a separate bank account.
                </p>
                <div className="space-y-3">
                    {escrowGoals.length > 0 ? escrowGoals.map((goal) => {
                        const reserved = Number(goal.reservedAmount) || 0;
                        const target = Number(goal.targetAmount) || 0;
                        const pct = target > 0 ? Math.min(100, (reserved / target) * 100) : 0;
                        return (
                            <div key={goal.id} className="border border-gray-100 rounded-lg p-3">
                                <div className="flex justify-between items-baseline text-sm mb-1">
                                    <span className="font-medium">{goal.name}</span>
                                    <span>{formatCurrencyString(reserved, { digits: 0 })} / {formatCurrencyString(target, { digits: 0 })}</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2.5">
                                    <div className="bg-secondary h-2.5 rounded-full" style={{ width: `${pct}%` }}></div>
                                </div>
                                {canMutate && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {[100, 500, 1000].map((amt) => (
                                            <button
                                                key={`fund-${amt}`}
                                                type="button"
                                                disabled={busyGoalId === goal.id}
                                                className="text-xs rounded border border-secondary text-secondary px-2 py-1 disabled:opacity-50"
                                                onClick={() => adjustReserve(goal, amt)}
                                            >
                                                + {amt}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            disabled={busyGoalId === goal.id || reserved <= 0}
                                            className="text-xs rounded border px-2 py-1 disabled:opacity-50"
                                            onClick={() => adjustReserve(goal, -Math.min(reserved, 500))}
                                        >
                                            Release 500
                                        </button>
                                        <button
                                            type="button"
                                            disabled={busyGoalId === goal.id || reserved <= 0}
                                            className="text-xs rounded border px-2 py-1 text-red-600 disabled:opacity-50"
                                            onClick={() => adjustReserve(goal, -reserved)}
                                        >
                                            Release all
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    }) : (
                        <p className="text-sm text-center text-gray-500 py-4">
                            No goals are earmarked as sinking funds yet. Mark a goal as a sinking fund on the Goals page to reserve escrow.
                        </p>
                    )}
                </div>
            </div>

            <div className="border-t border-gray-100 pt-5">
                <h3 className="text-lg font-semibold text-dark mb-2">Proactive Sinking Funds</h3>
                <p className="text-sm text-gray-500 mb-4">The system has identified large, predictable future expenses. We suggest setting aside money for them monthly.</p>
                <div className="space-y-4">
                    {suggestedFunds.length > 0 ? suggestedFunds.map(fund => (
                        <div key={fund.name}>
                            <div className="flex justify-between items-baseline text-sm mb-1">
                                <span className="font-medium">{fund.name} <span className="text-xs text-gray-500">({fund.recurrence})</span></span>
                                <span>{formatCurrencyString(fund.saved, {digits: 0})} / {formatCurrencyString(fund.target, {digits: 0})}</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2.5">
                                <div className="bg-secondary h-2.5 rounded-full" style={{ width: `${(fund.saved / fund.target) * 100}%`}}></div>
                            </div>
                            <p className="text-xs text-gray-500 mt-1 text-right">Next due: {fund.nextDueDate.toLocaleDateString()}</p>
                        </div>
                    )) : (
                        <p className="text-sm text-center text-gray-500 py-4">No recurring large expenses detected in your history.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SinkingFunds;
