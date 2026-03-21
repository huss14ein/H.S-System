import React, { useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { countsAsExpenseForCashflowKpi } from '../services/transactionFilters';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { detectRecurringBillPatterns } from '../services/hybridBudgetCategorization';
import { getPersonalTransactions } from '../utils/wealthScope';

const SinkingFunds: React.FC = () => {
    const { data, loading } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();

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

    if (loading || !data) {
        return (
            <div className="bg-white p-6 rounded-lg shadow">
                <div className="flex items-center justify-center py-8 gap-2 text-slate-500 text-sm" aria-busy="true">
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-label="Loading sinking funds" />
                    <span>Loading…</span>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white p-6 rounded-lg shadow">
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
    );
};

export default SinkingFunds;
