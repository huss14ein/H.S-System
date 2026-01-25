
import React, { useState, useMemo, useCallback, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import Card from '../components/Card';
import { InformationCircleIcon } from '../components/icons/InformationCircleIcon';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';
import AIAdvisor from '../components/AIAdvisor';
import SinkingFunds from './SinkingFunds';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface PlanRow {
    type: 'income' | 'expense';
    category: string;
    subcategory?: string;
    monthly_planned: number[];
    monthly_actual: number[];
}

const AnnualFinancialPlan: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [year, setYear] = useState(new Date().getFullYear());
    
    // Scenario States
    const [incomeShock, setIncomeShock] = useState({ percent: 0, startMonth: 1, duration: 1 });
    const [expenseStress, setExpenseStress] = useState({ category: 'All', percent: 0 });

    const [planData, setPlanData] = useState<PlanRow[]>([]);
    const [isEditing, setIsEditing] = useState<{ row: number; col: number } | null>(null);

    React.useEffect(() => {
        // Initialize plan data
        const incomeRow: PlanRow = {
            type: 'income',
            category: 'Salary & Bonuses',
            monthly_planned: Array(12).fill(30000), // Base salary
            monthly_actual: Array(12).fill(0),
        };
        // Add known bonuses/allowances to planned
        incomeRow.monthly_planned[0] += 12000; // Jan tickets
        incomeRow.monthly_planned[3] += 90000; // Apr bonus

        const expenseRows: PlanRow[] = data.budgets.map(b => ({
            type: 'expense',
            category: b.category,
            monthly_planned: Array(12).fill(b.limit),
            monthly_actual: Array(12).fill(0),
        }));

        // Populate actuals
        data.transactions.forEach(t => {
            const date = new Date(t.date);
            if (date.getFullYear() === year) {
                const monthIndex = date.getMonth();
                if (t.type === 'income') {
                    incomeRow.monthly_actual[monthIndex] += t.amount;
                } else {
                    const row = expenseRows.find(r => r.category === t.budgetCategory);
                    if (row) {
                        row.monthly_actual[monthIndex] += Math.abs(t.amount);
                    }
                }
            }
        });

        setPlanData([incomeRow, ...expenseRows]);
    }, [data.budgets, data.transactions, year]);
    
    const processedPlanData = useMemo(() => {
        return planData.map(row => {
            const newRow = JSON.parse(JSON.stringify(row));
            if (row.type === 'income') {
                for (let i = 0; i < incomeShock.duration; i++) {
                    const monthIndex = (incomeShock.startMonth - 1 + i);
                    if (monthIndex < 12) {
                       newRow.monthly_planned[monthIndex] *= (1 + incomeShock.percent / 100);
                    }
                }
            } else if (row.type === 'expense' && (expenseStress.category === 'All' || row.category === expenseStress.category)) {
                 newRow.monthly_planned = newRow.monthly_planned.map((p: number) => p * (1 + expenseStress.percent / 100));
            }
            return newRow;
        });
    }, [planData, incomeShock, expenseStress]);
    
    const totals = useMemo(() => {
        const income = processedPlanData.find(r => r.type === 'income');
        const totalPlannedIncome = income?.monthly_planned.reduce((a, b) => a + b, 0) || 0;
        const totalActualIncome = income?.monthly_actual.reduce((a, b) => a + b, 0) || 0;
        
        const totalPlannedExpenses = processedPlanData.filter(r => r.type === 'expense').reduce((sum, row) => sum + row.monthly_planned.reduce((a,b) => a + b, 0), 0);
        const totalActualExpenses = processedPlanData.filter(r => r.type === 'expense').reduce((sum, row) => sum + row.monthly_actual.reduce((a,b) => a + b, 0), 0);

        const projectedNet = totalPlannedIncome - totalPlannedExpenses;
        const actualNet = totalActualIncome - totalActualExpenses;

        return { totalPlannedIncome, totalPlannedExpenses, projectedNet, actualNet };
    }, [processedPlanData]);
    
    const handlePlanEdit = (rowIndex: number, monthIndex: number, newValue: number) => {
        const newData = [...planData];
        newData[rowIndex].monthly_planned[monthIndex] = newValue;
        setPlanData(newData);
        setIsEditing(null);
    }
    
    const renderCell = (value: number, limit: number) => {
        const percentage = limit > 0 ? (value / limit) * 100 : 0;
        let statusColor = 'bg-green-500';
        if (percentage > 100) statusColor = 'bg-red-500';
        else if (percentage > 90) statusColor = 'bg-yellow-500';

        return (
             <div className="flex items-center space-x-2">
                <span className={`w-2.5 h-2.5 rounded-full ${statusColor}`} title={`Status: ${percentage.toFixed(0)}% of plan`}></span>
                <span>{formatCurrencyString(value, { digits: 0 })}</span>
             </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="text-center">
                <h1 className="text-3xl font-bold text-dark">Annual Financial Plan</h1>
                <p className="text-gray-500 mt-1">A detailed grid for planning and tracking your finances throughout the year.</p>
                <div className="mt-2 flex items-center justify-center gap-2">
                    <button onClick={() => setYear(y => y - 1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronLeftIcon className="h-5 w-5"/></button>
                    <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="p-1 border rounded-md w-24 text-center font-semibold" />
                    <button onClick={() => setYear(y => y + 1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronRightIcon className="h-5 w-5"/></button>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                 <Card title="Total Planned Income" value={formatCurrencyString(totals.totalPlannedIncome, {digits: 0})} />
                 <Card title="Total Planned Expenses" value={formatCurrencyString(totals.totalPlannedExpenses, {digits: 0})} />
                 <Card title="Projected Annual Savings" value={formatCurrencyString(totals.projectedNet, {digits: 0})} />
                 <Card title="Actual Net Savings (YTD)" value={formatCurrencyString(totals.actualNet, {digits: 0})} />
            </div>

            {/* Scenario Controls */}
            <div className="bg-white p-4 rounded-lg shadow">
                 <h3 className="text-lg font-semibold text-dark mb-2">What-If Scenarios</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                     {/* Income Shock */}
                     <div className="space-y-2 p-3 bg-gray-50 rounded-lg">
                        <label className="font-medium text-sm flex items-center">
                            Income Shock
                             <div className="relative group ml-2">
                                <InformationCircleIcon className="h-4 w-4 text-gray-400" />
                                <div className="absolute bottom-full mb-2 w-64 bg-gray-800 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none left-1/2 -translate-x-1/2 z-10">
                                    Simulate a sudden change in your income (e.g., a bonus or a pay cut). Use a positive percentage for an increase and a negative percentage for a decrease. This helps you understand your financial resilience.
                                </div>
                            </div>
                        </label>
                        <div className="flex items-center space-x-2">
                           <input type="number" value={incomeShock.percent} onChange={e => setIncomeShock(s => ({...s, percent: parseInt(e.target.value) || 0}))} className="w-20 p-1 border rounded-md" />
                           <span className="text-sm">% for</span>
                            <input type="number" value={incomeShock.duration} onChange={e => setIncomeShock(s => ({...s, duration: parseInt(e.target.value) || 1}))} min="1" className="w-16 p-1 border rounded-md" />
                           <span className="text-sm">months, starting month</span>
                           <input type="number" value={incomeShock.startMonth} onChange={e => setIncomeShock(s => ({...s, startMonth: parseInt(e.target.value) || 1}))} min="1" max="12" className="w-16 p-1 border rounded-md" />
                        </div>
                     </div>
                      {/* Expense Stress */}
                     <div className="space-y-2 p-3 bg-gray-50 rounded-lg">
                        <label className="font-medium text-sm flex items-center">
                            Expense Stress Test
                            <div className="relative group ml-2">
                                <InformationCircleIcon className="h-4 w-4 text-gray-400" />
                                <div className="absolute bottom-full mb-2 w-64 bg-gray-800 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none left-1/2 -translate-x-1/2 z-10">
                                    Model an increase in spending for a category or across the board (e.g., due to inflation). This helps identify budget vulnerabilities and its impact on your savings goals.
                                </div>
                            </div>
                        </label>
                        <div className="flex items-center space-x-2">
                           <span className="text-sm">Increase</span>
                           <select value={expenseStress.category} onChange={e => setExpenseStress(s => ({...s, category: e.target.value}))} className="p-1 border rounded-md text-sm">
                               <option>All</option>
                               {data.budgets.map(b => <option key={b.category}>{b.category}</option>)}
                           </select>
                           <span className="text-sm">by</span>
                           <input type="number" value={expenseStress.percent} onChange={e => setExpenseStress(s => ({...s, percent: parseInt(e.target.value) || 0}))} className="w-20 p-1 border rounded-md" />
                           <span className="text-sm">%</span>
                        </div>
                     </div>
                 </div>
            </div>

             <AIAdvisor pageContext="plan" contextData={{ totals, scenarios: { incomeShock, expenseStress } }} />

             <SinkingFunds />
            
            {/* Plan Grid */}
            <div className="bg-white shadow rounded-lg overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-100 text-dark">
                        <tr>
                            <th className="sticky left-0 bg-gray-100 p-2 text-left font-semibold">Category</th>
                            {MONTHS.map(m => <th key={m} className="p-2 min-w-[150px] font-semibold">{m}</th>)}
                            <th className="p-2 min-w-[150px] font-semibold">Total</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {/* Income */}
                        <tr className="bg-green-50"><td colSpan={14} className="p-2 font-bold text-green-800">Income</td></tr>
                        {processedPlanData.filter(r => r.type === 'income').map((row, rowIndex) => {
                             const totalPlanned = row.monthly_planned.reduce((a, b) => a + b, 0);
                             const totalActual = row.monthly_actual.reduce((a, b) => a + b, 0);
                             return (
                                <tr key={row.category}>
                                    <td className="sticky left-0 bg-white p-2 font-medium">{row.category}</td>
                                    {row.monthly_planned.map((plan, monthIndex) => {
                                        const isAffected = incomeShock.percent !== 0 && monthIndex >= incomeShock.startMonth - 1 && monthIndex < incomeShock.startMonth - 1 + incomeShock.duration;
                                        return (
                                            <td key={monthIndex} className="p-2 align-top">
                                                <div className="text-gray-500">{formatCurrencyString(row.monthly_actual[monthIndex], { digits: 0 })}</div>
                                                <div className={`font-semibold cursor-pointer p-1 rounded ${isAffected ? 'bg-blue-100' : ''}`} onClick={() => setIsEditing({row: rowIndex, col: monthIndex})}>
                                                    {formatCurrencyString(plan, { digits: 0 })}
                                                </div>
                                            </td>
                                        )
                                    })}
                                    <td className="p-2 align-top font-bold"><div className="text-gray-500">{formatCurrencyString(totalActual, { digits: 0 })}</div><div>{formatCurrencyString(totalPlanned, { digits: 0 })}</div></td>
                                </tr>
                             )
                        })}
                        {/* Expenses */}
                        <tr className="bg-red-50"><td colSpan={14} className="p-2 font-bold text-red-800">Expenses</td></tr>
                        {processedPlanData.filter(r => r.type === 'expense').map((row, rowIndex) => {
                             const originalIndex = planData.findIndex(item => item.category === row.category && item.type === 'expense');
                             const totalPlanned = row.monthly_planned.reduce((a, b) => a + b, 0);
                             const totalActual = row.monthly_actual.reduce((a, b) => a + b, 0);
                             const isAffected = expenseStress.percent !== 0 && (expenseStress.category === 'All' || expenseStress.category === row.category);
                             return (
                                <tr key={row.category}>
                                    <td className="sticky left-0 bg-white p-2 font-medium">{row.category}</td>
                                    {row.monthly_planned.map((plan, monthIndex) => (
                                        <td key={monthIndex} className="p-2 align-top">
                                            <div className="text-gray-500">{renderCell(row.monthly_actual[monthIndex], plan)}</div>
                                            <div className={`font-semibold cursor-pointer p-1 rounded ${isAffected ? 'bg-orange-100' : ''}`} onClick={() => setIsEditing({row: originalIndex + 1, col: monthIndex})}>
                                                {formatCurrencyString(plan, { digits: 0 })}
                                            </div>
                                        </td>
                                    ))}
                                     <td className="p-2 align-top font-bold"><div className="text-gray-500">{renderCell(totalActual, totalPlanned)}</div><div>{formatCurrencyString(totalPlanned, { digits: 0 })}</div></td>
                                </tr>
                             )
                        })}
                    </tbody>
                </table>
            </div>
            
            {isEditing && (
                <div className="fixed inset-0 bg-black bg-opacity-25 flex items-center justify-center z-50" onClick={() => setIsEditing(null)}>
                    <div className="bg-white p-4 rounded-lg shadow-lg" onClick={e => e.stopPropagation()}>
                         <h4 className="font-bold mb-2">Edit Planned Amount</h4>
                         <p className="text-sm mb-2">{planData[isEditing.row].category} - {MONTHS[isEditing.col]}</p>
                         <form onSubmit={(e) => {
                             e.preventDefault();
                             const input = e.currentTarget.elements.namedItem('newValue') as HTMLInputElement;
                             handlePlanEdit(isEditing.row, isEditing.col, parseFloat(input.value));
                         }}>
                            <input name="newValue" type="number" defaultValue={planData[isEditing.row].monthly_planned[isEditing.col]} className="p-2 border rounded-md w-full" autoFocus/>
                            <div className="flex justify-end space-x-2 mt-4">
                               <button type="button" onClick={() => setIsEditing(null)} className="px-4 py-2 bg-gray-200 rounded-md">Cancel</button>
                               <button type="submit" className="px-4 py-2 bg-primary text-white rounded-md">Save</button>
                            </div>
                         </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AnnualFinancialPlan;
