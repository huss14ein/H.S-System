
import React, { useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';

const SinkingFunds: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();

    const suggestedFunds = useMemo(() => {
        const recurringExpenses = new Map<string, { amount: number; dates: Date[] }>();
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

        // 1. Find large, fixed, recurring expenses from the last 2 years
        data.transactions
            .filter(t => 
                t.type === 'expense' && 
                t.transactionNature === 'Fixed' && 
                Math.abs(t.amount) > 2000 && // Significant amount
                new Date(t.date) > twoYearsAgo
            )
            .forEach(t => {
                const existing = recurringExpenses.get(t.description) || { amount: Math.abs(t.amount), dates: [] };
                existing.dates.push(new Date(t.date));
                recurringExpenses.set(t.description, existing);
            });

        const funds = [];
        for (const [name, { amount, dates }] of recurringExpenses.entries()) {
            if (dates.length > 1) { // It's recurring
                dates.sort((a, b) => b.getTime() - a.getTime());
                const lastDate = dates[0];
                const previousDate = dates[1];
                const monthDiff = (lastDate.getFullYear() - previousDate.getFullYear()) * 12 + lastDate.getMonth() - previousDate.getMonth();

                if (monthDiff > 1 && monthDiff <= 12) { // It's not monthly
                    const nextDueDate = new Date(lastDate);
                    nextDueDate.setMonth(nextDueDate.getMonth() + monthDiff);
                    const now = new Date();
                    const monthsUntilDue = Math.max(1, (nextDueDate.getFullYear() - now.getFullYear()) * 12 + nextDueDate.getMonth() - now.getMonth());
                    
                    const savedMonths = monthDiff - monthsUntilDue;
                    const savedAmount = (savedMonths / monthDiff) * amount;

                    funds.push({
                        name,
                        target: amount,
                        nextDueDate,
                        recurrence: monthDiff === 12 ? 'Annual' : `${monthDiff} months`,
                        saved: savedAmount > 0 ? savedAmount : 0,
                    });
                }
            }
        }
        return funds.sort((a,b) => a.nextDueDate.getTime() - b.nextDueDate.getTime());
    }, [data.transactions]);

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
