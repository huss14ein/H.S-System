import React, { useState, useMemo, useContext, useEffect } from 'react';
import { Page } from '../types';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../services/supabaseClient';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';
import AIAdvisor from '../components/AIAdvisor';
import SinkingFunds from './SinkingFunds';
import { PlusIcon } from '../components/icons/PlusIcon';
import Modal from '../components/Modal';
import InfoHint from '../components/InfoHint';
import PageLayout from '../components/PageLayout';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { CHART_MARGIN, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, formatAxisNumber, CHART_COLORS } from '../components/charts/chartTheme';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import { ScaleIcon } from '../components/icons/ScaleIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import {
    buildHouseholdBudgetPlan,
    buildHouseholdEngineInputFromPlanData,
    type HouseholdEngineProfile,
    type HouseholdMonthlyOverride,
} from '../services/householdBudgetEngine';


const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface PlanRow {
    type: 'income' | 'expense';
    category: string;
    subcategory?: string;
    monthly_planned: number[];
    monthly_actual: number[];
}

interface LifeEvent {
    id: string;
    name: string;
    month: number;
    amount: number;
    type: 'income' | 'expense';
}

const EventModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (event: Omit<LifeEvent, 'id'>) => void;
}> = ({ isOpen, onClose, onSave }) => {
    const [name, setName] = useState('');
    const [month, setMonth] = useState(1);
    const [amount, setAmount] = useState('');
    const [type, setType] = useState<'income' | 'expense'>('expense');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ name, month, amount: parseFloat(amount), type });
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add Major Life Event">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Event Name <InfoHint text="One-time life event (e.g. Wedding, Bonus) for scenario planning." /></label>
                    <input type="text" placeholder="Event Name (e.g., Wedding)" value={name} onChange={e => setName(e.target.value)} required className="input-base" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Amount <InfoHint text="One-time amount (income or expense) in your plan currency." /></label>
                        <input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} required className="input-base" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Month <InfoHint text="Month when this event occurs in the plan year." /></label>
                        <select value={month} onChange={e => setMonth(Number(e.target.value))} className="select-base">
                            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                        </select>
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">Type <InfoHint text="One-time expense (e.g. wedding) or one-time income (e.g. bonus)." /></label>
                    <select value={type} onChange={e => setType(e.target.value as any)} className="select-base">
                        <option value="expense">One-time Expense</option>
                        <option value="income">One-time Income</option>
                    </select>
                </div>
                <button type="submit" className="w-full px-4 py-2 bg-primary text-white rounded-lg">Save Event</button>
            </form>
        </Modal>
    );
};


const SCENARIO_PRESETS = [
    { name: 'None', income: 0, expense: 0, duration: 1, startMonth: 1, label: 'None' },
    { name: 'Recession', income: -10, expense: 5, startMonth: 1, duration: 3, label: 'Recession (income −10%, 3 mo; expenses +5%)' },
    { name: 'Bonus year', income: 15, expense: 0, startMonth: 4, duration: 1, label: 'Q2 bonus +15%' },
    { name: 'Expense spike', income: 0, expense: 20, startMonth: 1, duration: 1, label: 'All expenses +20%' },
];

const AnnualFinancialPlan: React.FC<{ setActivePage?: (page: Page) => void }> = ({ setActivePage }) => {
    const { data } = useContext(DataContext)!;
    const auth = useContext(AuthContext);
    const { formatCurrencyString } = useFormatCurrency();
    const [year, setYear] = useState(new Date().getFullYear());
    const [householdAdults, setHouseholdAdults] = useState(2);
    const [householdKids, setHouseholdKids] = useState(0);
    const [householdOverrides, setHouseholdOverrides] = useState<HouseholdMonthlyOverride[]>([]);
    const [engineProfile, setEngineProfile] = useState<HouseholdEngineProfile>('Moderate');
    const [expectedMonthlySalary, setExpectedMonthlySalary] = useState<number | ''>('');
    const [householdProfileCloudLoadedUserId, setHouseholdProfileCloudLoadedUserId] = useState<string | null>(null);
    
    // Scenario States
    const [incomeShock, setIncomeShock] = useState({ percent: 0, startMonth: 1, duration: 1 });
    const [expenseStress, setExpenseStress] = useState({ category: 'All', percent: 0 });
    const [events, setEvents] = useState<LifeEvent[]>([]);
    const [isEventModalOpen, setIsEventModalOpen] = useState(false);

    const [planData, setPlanData] = useState<PlanRow[]>([]);
    const [isEditing, setIsEditing] = useState<{ row: number; col: number } | null>(null);

    const budgets = data?.budgets ?? [];
    const transactions = data?.transactions ?? [];
    const accounts = data?.accounts ?? [];
    const goals = data?.goals ?? [];
    const investmentPlan = data?.investmentPlan;
    const investmentTransactions = data?.investmentTransactions ?? [];
    const recurringTransactions = data?.recurringTransactions ?? [];

    const householdProfileStorageKey = useMemo(() => `household-profile:${auth?.user?.id ?? 'anon'}`, [auth?.user?.id]);
    const householdProfileCloudEnabled = Boolean(supabase && auth?.user?.id);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(householdProfileStorageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Number.isFinite(parsed?.adults)) setHouseholdAdults(Math.max(1, Math.round(parsed.adults)));
                if (Number.isFinite(parsed?.kids)) setHouseholdKids(Math.max(0, Math.round(parsed.kids)));
                if (Array.isArray(parsed?.overrides)) setHouseholdOverrides(parsed.overrides);
                if (parsed?.profile && ['Conservative', 'Moderate', 'Growth'].includes(parsed.profile)) {
                    setEngineProfile(parsed.profile as HouseholdEngineProfile);
                }
                if (typeof parsed?.expectedMonthlySalary === 'number' && parsed.expectedMonthlySalary > 0) {
                    setExpectedMonthlySalary(parsed.expectedMonthlySalary);
                }
            }
        } catch {}
    }, [householdProfileStorageKey]);

    useEffect(() => {
        const userId = auth?.user?.id;
        const db = supabase;
        if (!householdProfileCloudEnabled || !userId || !db) {
            setHouseholdProfileCloudLoadedUserId(null);
            return;
        }
        let isMounted = true;
        setHouseholdProfileCloudLoadedUserId(null);
        (async () => {
            try {
                const { data, error } = await db
                    .from('household_budget_profiles')
                    .select('profile')
.eq('user_id', userId)
                    .maybeSingle();
                if (error || !data || !isMounted) return;
                const profile = (data as { profile?: any })?.profile;
                if (!profile || typeof profile !== 'object') return;
                if (Number.isFinite(profile?.adults)) setHouseholdAdults(Math.max(1, Math.round(profile.adults)));
                if (Number.isFinite(profile?.kids)) setHouseholdKids(Math.max(0, Math.round(profile.kids)));
                if (Array.isArray(profile?.overrides)) setHouseholdOverrides(profile.overrides);
                if (profile?.profile && ['Conservative', 'Moderate', 'Growth'].includes(profile.profile)) {
                    setEngineProfile(profile.profile as HouseholdEngineProfile);
                }
                if (typeof profile?.expectedMonthlySalary === 'number' && profile.expectedMonthlySalary > 0) {
                    setExpectedMonthlySalary(profile.expectedMonthlySalary);
                }
            } catch {
                // Optional cloud sync path, safe to ignore when migration is not applied.
            } finally {
                if (isMounted) setHouseholdProfileCloudLoadedUserId(userId);
            }
        })();
        return () => {
            isMounted = false;
        };
    }, [householdProfileCloudEnabled, auth?.user?.id]);

    useEffect(() => {
        try {
            localStorage.setItem(householdProfileStorageKey, JSON.stringify({
                adults: householdAdults,
                kids: householdKids,
                overrides: householdOverrides,
                profile: engineProfile,
                expectedMonthlySalary: typeof expectedMonthlySalary === 'number' ? expectedMonthlySalary : undefined,
            }));
        } catch {}
    }, [householdAdults, householdKids, householdOverrides, engineProfile, expectedMonthlySalary, householdProfileStorageKey]);

    useEffect(() => {
        const userId = auth?.user?.id;
        const db = supabase;
        if (!householdProfileCloudEnabled || !userId || !db || householdProfileCloudLoadedUserId !== userId) return;
        const payload = {
            adults: householdAdults,
            kids: householdKids,
            overrides: householdOverrides,
            profile: engineProfile,
            expectedMonthlySalary: typeof expectedMonthlySalary === 'number' ? expectedMonthlySalary : undefined,
        };
        const t = window.setTimeout(async () => {
            try {
                await db
                    .from('household_budget_profiles')
                    .upsert({ user_id: userId, profile: payload }, { onConflict: 'user_id' });
            } catch {
                // Optional cloud sync path, safe to ignore when migration is not applied.
            }
        }, 700);
        return () => window.clearTimeout(t);
    }, [householdProfileCloudEnabled, auth?.user?.id, householdAdults, householdKids, householdOverrides, engineProfile, expectedMonthlySalary, householdProfileCloudLoadedUserId]);

    // Build plan from transactions, budgets, recurring, and investment data — fully integrated
    React.useEffect(() => {
        const yearTx = transactions.filter((t: { date: string }) => new Date(t.date).getFullYear() === year);

        // Income: planned and actual from Transactions (income type only); add expected recurring income to planned
        const incomeActuals = Array(12).fill(0);
        yearTx.forEach((t: { type?: string; amount: number; date: string }) => {
            if (t.type === 'income') {
                const monthIndex = new Date(t.date).getMonth();
                incomeActuals[monthIndex] += Number(t.amount) || 0;
            }
        });
        const incomeTotal = incomeActuals.reduce((a, b) => a + b, 0);
        const incomeMonthsWithData = incomeActuals.filter(x => x > 0).length;
        const incomeAvg = incomeMonthsWithData > 0 ? incomeTotal / incomeMonthsWithData : 0;
        const incomePlanned = incomeActuals.map((actual) => actual > 0 ? actual : incomeAvg);
        // Recurring income: include both auto and manual so plan reflects full expected recurring (actuals already in Transactions)
        const recurringIncome = recurringTransactions.filter((r: { enabled: boolean; type: string }) => r.enabled && r.type === 'income').reduce((s: number, r: { amount: number }) => s + (Number(r.amount) || 0), 0);
        for (let m = 0; m < 12; m++) incomePlanned[m] = (incomePlanned[m] || 0) + recurringIncome;
        const incomeRow: PlanRow = {
            type: 'income',
            category: 'Income',
            monthly_planned: incomePlanned,
            monthly_actual: incomeActuals,
        };

        // Expense categories: from Budgets (planned) + Transactions (actual); include every category that appears in either
        // Include budgets with no year (falsy: null, undefined, 0, '') or matching plan year to avoid excluding year 0
        const yearBudgets = budgets.filter((b: { year?: number }) => !(b as any).year || (b as any).year === year);
        const byCategory = new Map<string, { planned: number[]; actual: number[] }>();

        const budgetToMonthly = (limit: number, period?: string) =>
            period === 'yearly' ? limit / 12 : period === 'weekly' ? limit * (52 / 12) : period === 'daily' ? limit * (365 / 12) : limit;
        yearBudgets.forEach((b: { category: string; limit: number; month?: number; period?: string }) => {
            const limit = Number(b.limit) || 0;
            const period = (b as any).period;
            const monthly = budgetToMonthly(limit, period);
            const monthIndex = ((b as any).month ?? 1) - 1;
            if (!byCategory.has(b.category)) {
                byCategory.set(b.category, { planned: Array(12).fill(0), actual: Array(12).fill(0) });
            }
            const planned = byCategory.get(b.category)!.planned;
            // Yearly, weekly, and daily apply to the whole year; monthly applies only to its calendar month
            const appliesAllYear = period === 'yearly' || period === 'weekly' || period === 'daily';
            if (appliesAllYear) {
                for (let m = 0; m < 12; m++) planned[m] += monthly;
            } else {
                planned[monthIndex] += monthly;
            }
        });

        yearTx.forEach((t: { type?: string; amount: number; date: string; category?: string; budgetCategory?: string }) => {
            if (t.type !== 'expense') return;
            const monthIndex = new Date(t.date).getMonth();
            const category = (t.budgetCategory || t.category || 'Other').trim() || 'Other';
            if (!byCategory.has(category)) {
                byCategory.set(category, { planned: Array(12).fill(0), actual: Array(12).fill(0) });
            }
            byCategory.get(category)!.actual[monthIndex] += Math.abs(Number(t.amount)) || 0;
        });

        // Recurring expenses: add expected amount to planned for each category (every month); include both auto and manual so plan aligns with recurring from Transactions
        recurringTransactions.filter((r: { enabled: boolean; type: string }) => r.enabled && r.type === 'expense').forEach((r: { category: string; budgetCategory?: string; amount: number }) => {
            const cat = (r.budgetCategory || r.category || 'Other').trim() || 'Other';
            if (!byCategory.has(cat)) byCategory.set(cat, { planned: Array(12).fill(0), actual: Array(12).fill(0) });
            const row = byCategory.get(cat)!;
            const amt = Number(r.amount) || 0;
            for (let m = 0; m < 12; m++) row.planned[m] += amt;
        });

        // Only show expense categories that have a reference: planned (from budgets/recurring) or actual (from transactions)
        let expenseRows: PlanRow[] = Array.from(byCategory.entries())
            .filter(([, { planned, actual }]) => planned.some(x => x > 0) || actual.some(x => x > 0))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([category, { planned, actual }]) => ({
                type: 'expense' as const,
                category,
                monthly_planned: planned.some(x => x > 0) ? planned : Array(12).fill(0),
                monthly_actual: actual,
            }));

        // Monthly investment: from Investment Plan (planned) + Investment Transactions (actual buys)
        const monthlyInvestment = Number(investmentPlan?.monthlyBudget) || 0;
        const investmentActuals = Array(12).fill(0);
        investmentTransactions.forEach((tx: { date: string; type: string; total?: number }) => {
            const date = new Date(tx.date);
            if (date.getFullYear() === year && tx.type === 'buy') {
                investmentActuals[date.getMonth()] += Number(tx.total) || 0;
            }
        });
        const investmentRow: PlanRow = {
            type: 'expense',
            category: 'Monthly investment',
            monthly_planned: Array(12).fill(monthlyInvestment),
            monthly_actual: investmentActuals,
        };
        setPlanData([incomeRow, ...expenseRows, investmentRow]);
    }, [budgets, transactions, year, investmentPlan, investmentTransactions, recurringTransactions]);
    
    const processedPlanData: PlanRow[] = useMemo(() => {
        let baseData: PlanRow[] = JSON.parse(JSON.stringify(planData));

        // Apply scenarios
        let incomeRow = baseData.find((r: PlanRow) => r.type === 'income');
        if (incomeRow) {
            for (let i = 0; i < incomeShock.duration; i++) {
                const monthIndex = (incomeShock.startMonth - 1 + i);
                if (monthIndex < 12) {
                   incomeRow.monthly_planned[monthIndex] *= (1 + incomeShock.percent / 100);
                }
            }
        }
        baseData.forEach((row: PlanRow) => {
            if (row.type === 'expense' && (expenseStress.category === 'All' || row.category === expenseStress.category)) {
                row.monthly_planned = row.monthly_planned.map((p: number) => p * (1 + expenseStress.percent / 100));
            }
        });

        // Apply events
        let eventsRow = baseData.find((r: PlanRow) => r.category === 'Major Events');
        if (events.some(e => e.type === 'expense') && !eventsRow) {
            eventsRow = { type: 'expense', category: 'Major Events', monthly_planned: Array(12).fill(0), monthly_actual: Array(12).fill(0) };
            baseData.push(eventsRow);
        }

        events.forEach(event => {
            const monthIndex = event.month - 1;
            if (event.type === 'income' && incomeRow) {
                incomeRow.monthly_planned[monthIndex] += event.amount;
            } else if (event.type === 'expense' && eventsRow) {
                eventsRow.monthly_planned[monthIndex] += event.amount;
            }
        });
        
        return baseData;
    }, [planData, incomeShock, expenseStress, events]);
    
    const totals = useMemo(() => {
        const income = processedPlanData.find((r: PlanRow) => r.type === 'income');
        const totalPlannedIncome = income?.monthly_planned.reduce((a: number, b: number) => a + b, 0) || 0;
        const totalActualIncome = income?.monthly_actual.reduce((a: number, b: number) => a + b, 0) || 0;
        
        const totalPlannedExpenses = processedPlanData.filter((r: PlanRow) => r.type === 'expense').reduce((sum: number, row: PlanRow) => sum + row.monthly_planned.reduce((a: number,b: number) => a + b, 0), 0);
        const totalActualExpenses = processedPlanData.filter((r: PlanRow) => r.type === 'expense').reduce((sum: number, row: PlanRow) => sum + row.monthly_actual.reduce((a: number,b: number) => a + b, 0), 0);

        const projectedNet = totalPlannedIncome - totalPlannedExpenses;
        const actualNet = totalActualIncome - totalActualExpenses;
        const variancePct = projectedNet !== 0 ? ((actualNet - projectedNet) / Math.abs(projectedNet)) * 100 : 0;

        return { totalPlannedIncome, totalPlannedExpenses, totalActualIncome, totalActualExpenses, projectedNet, actualNet, variancePct };
    }, [processedPlanData]);

    const insights = useMemo((): { monthsOverBudget: number; worst: { category: string; month: string; pct: number } | null; ytdPlannedIncome: number; ytdActualIncome: number } => {
        const income = processedPlanData.find((r: PlanRow) => r.type === 'income');
        let monthsOverBudget = 0;
        let worst: { category: string; month: string; pct: number } | null = null;
        processedPlanData.filter((r: PlanRow) => r.type === 'expense').forEach((row: PlanRow) => {
            row.monthly_planned.forEach((plan: number, mi: number) => {
                const actual = row.monthly_actual[mi];
                if (plan > 0 && actual > plan) monthsOverBudget++;
                const pct = plan > 0 ? ((actual - plan) / plan) * 100 : 0;
                if (pct > 0 && (!worst || pct > worst.pct)) worst = { category: row.category, month: MONTHS[mi], pct };
            });
        });
        const currentMonth = new Date().getMonth();
        const ytdPlannedIncome = income?.monthly_planned.slice(0, currentMonth + 1).reduce((a, b) => a + b, 0) ?? 0;
        const ytdActualIncome = income?.monthly_actual.slice(0, currentMonth + 1).reduce((a, b) => a + b, 0) ?? 0;
        return { monthsOverBudget, worst, ytdPlannedIncome, ytdActualIncome };
    }, [processedPlanData]);

    // Goals: when will you reach them? Required per month vs projected surplus (after expenses + investment)
    const goalsAnalysis = useMemo(() => {
        const monthlySurplusAfterInvestment = (totals?.projectedNet ?? 0) / 12;

        return (goals as { id: string; name: string; targetAmount?: number; target_amount?: number; currentAmount?: number; current_amount?: number; deadline?: string; targetDate?: string }[]).map(g => {
            const target = Number(g.targetAmount ?? (g as any).target_amount ?? 0);
            const current = Number(g.currentAmount ?? (g as any).current_amount ?? 0);
            const shortfall = Math.max(0, target - current);
            const deadlineStr = g.deadline ?? (g as any).targetDate ?? '';
            const deadlineDate = deadlineStr ? new Date(deadlineStr) : null;
            const now = new Date();
            const monthsRemaining = deadlineDate && deadlineDate > now
                ? Math.ceil((deadlineDate.getTime() - now.getTime()) / (30.44 * 24 * 60 * 60 * 1000))
                : 0;
            const requiredPerMonth = monthsRemaining > 0 && shortfall > 0 ? shortfall / monthsRemaining : shortfall;
            let status: 'funded' | 'on_track' | 'need_more' = 'funded';
            if (shortfall > 0) {
                status = monthlySurplusAfterInvestment >= requiredPerMonth ? 'on_track' : 'need_more';
            }
            // At current surplus, how many months to reach this goal? (undefined if surplus <= 0 or funded)
            const monthsToReachAtCurrentSurplus = shortfall > 0 && monthlySurplusAfterInvestment > 0
                ? Math.ceil(shortfall / monthlySurplusAfterInvestment)
                : undefined;
            return {
                id: g.id,
                name: g.name,
                targetAmount: target,
                currentAmount: current,
                shortfall,
                deadline: deadlineDate,
                deadlineStr,
                monthsRemaining,
                requiredPerMonth,
                status,
                monthlySurplusAfterInvestment,
                monthsToReachAtCurrentSurplus,
            };
        });
    }, [goals, totals, processedPlanData]);

    const householdBudgetEngine = useMemo(() => {
        const monthlyIncomePlanned = MONTHS.map((_, i) => {
            const incomeRow = processedPlanData.find((r: PlanRow) => r.type === 'income');
            return Number(incomeRow?.monthly_planned?.[i] || 0);
        });
        const monthlyIncomeActual = MONTHS.map((_, i) => {
            const incomeRow = processedPlanData.find((r: PlanRow) => r.type === 'income');
            return Number(incomeRow?.monthly_actual?.[i] || 0);
        });
        const monthlyExpenseActual = MONTHS.map((_, i) => processedPlanData
            .filter((r: PlanRow) => r.type === 'expense')
            .reduce((sum: number, row: PlanRow) => sum + Number(row.monthly_actual?.[i] || 0), 0));

        const incomeByMonth = Array(12).fill(0);
        (transactions as Array<{ date: string; type?: string; amount?: number }>).forEach((t) => {
            const d = new Date(t.date);
            if (d.getFullYear() !== year || t.type !== 'income') return;
            incomeByMonth[d.getMonth()] += Math.max(0, Number(t.amount) || 0);
        });
        const withData = incomeByMonth.filter((v) => v > 0);
        const suggested = withData.length > 0 ? Math.round(withData.reduce((a, b) => a + b, 0) / withData.length) : 0;

        const input = buildHouseholdEngineInputFromPlanData(
            monthlyIncomePlanned,
            monthlyIncomeActual,
            monthlyExpenseActual,
            accounts as any[],
            goals as any[],
            {
                expectedMonthlySalary: typeof expectedMonthlySalary === 'number' ? expectedMonthlySalary : (suggested > 0 ? suggested : undefined),
                adults: householdAdults,
                kids: householdKids,
                profile: engineProfile,
                monthlyOverrides: householdOverrides,
            }
        );
        return buildHouseholdBudgetPlan(input);
    }, [processedPlanData, accounts, goals, transactions, year, householdAdults, householdKids, householdOverrides, engineProfile, expectedMonthlySalary]);

    useEffect(() => {
        const riskProfile = String((data as any)?.settings?.riskProfile || '').toLowerCase();
        if (engineProfile === 'Moderate') {
            if (riskProfile.includes('conservative')) setEngineProfile('Conservative');
            if (riskProfile.includes('aggressive') || riskProfile.includes('growth')) setEngineProfile('Growth');
        }
    }, [(data as any)?.settings?.riskProfile]);

     const planChartData = useMemo(() => {
        return MONTHS.map((month, index) => {
            const income = processedPlanData.find((r: PlanRow) => r.type === 'income')?.monthly_planned[index] || 0;
            const expenses = processedPlanData.filter((r: PlanRow) => r.type === 'expense').reduce((sum: number, r: PlanRow) => sum + r.monthly_planned[index], 0);
            return { name: month, Income: income, Expenses: expenses, "Net Savings": income - expenses };
        });
    }, [processedPlanData]);

    const handlePlanEdit = (rowIndex: number, monthIndex: number, newValue: number) => {
        const newData = [...planData];
        newData[rowIndex].monthly_planned[monthIndex] = newValue;
        setPlanData(newData);
        setIsEditing(null);
    }
    
    const handleSaveEvent = (event: Omit<LifeEvent, 'id'>) => {
        setEvents(prev => [...prev, { ...event, id: `evt-${Date.now()}` }]);
    };
    
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
        <PageLayout
            title="Annual Financial Plan"
            description="Income & expense actuals from Transactions; planned limits from Budgets; recurring from Transactions (auto or manual); investment from Investment Plan. Fully integrated with your data."
            action={
                <div className="w-full flex flex-col lg:flex-row lg:items-center lg:justify-end gap-3">
                    <div className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-2 py-1 self-start lg:self-auto">
                        <button type="button" onClick={() => setYear(y => y - 1)} className="p-2 rounded-full hover:bg-slate-100 text-slate-600"><ChevronLeftIcon className="h-5 w-5"/></button>
                        <label className="flex items-center gap-1.5"><span className="text-sm text-gray-600">Year</span><InfoHint text="Plan and track by calendar year; actuals are filled from your transactions for this year." /><input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="input-base w-24 text-center font-semibold" /></label>
                        <button type="button" onClick={() => setYear(y => y + 1)} className="p-2 rounded-full hover:bg-slate-100 text-slate-600"><ChevronRightIcon className="h-5 w-5"/></button>
                    </div>
                    {setActivePage && (
                        <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => setActivePage('Budgets')} className="btn-ghost py-1.5 text-sm"><BanknotesIcon className="h-4 w-4" /> Budgets</button>
                            <button type="button" onClick={() => setActivePage('Goals')} className="btn-ghost py-1.5 text-sm text-blue-600 hover:bg-blue-50"><ScaleIcon className="h-4 w-4" /> Goals</button>
                            <button type="button" onClick={() => setActivePage('Investments')} className="btn-ghost py-1.5 text-sm text-violet-600 hover:bg-violet-50"><ArrowTrendingUpIcon className="h-4 w-4" /> Investment Plan</button>
                        </div>
                    )}
                </div>
            }
        >
            <div className="space-y-6 sm:space-y-8">
            <div className="space-y-4 sm:space-y-5">
            {/* Data sources: aligned with Transactions, Budgets, Recurring, Investment Plan */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-700">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="font-semibold text-slate-800">Plan data aligned with:</span>
                {setActivePage && (
                    <>
                        <button type="button" onClick={() => setActivePage('Transactions')} className="inline-flex items-center gap-1 text-primary hover:underline font-medium" title="Actuals & recurring (auto or manual)">
                            <BanknotesIcon className="h-4 w-4" /> Transactions
                        </button>
                        <span className="text-slate-400">·</span>
                        <button type="button" onClick={() => setActivePage('Budgets')} className="inline-flex items-center gap-1 text-primary hover:underline font-medium" title="Planned limits">
                            Budgets
                        </button>
                        <span className="text-slate-400">·</span>
                        <button type="button" onClick={() => setActivePage('Investments')} className="inline-flex items-center gap-1 text-primary hover:underline font-medium" title="Monthly investment planned & actual buys">
                            <ArrowTrendingUpIcon className="h-4 w-4" /> Investment Plan
                        </button>
                        <span className="text-slate-400">·</span>
                        <button type="button" onClick={() => setActivePage('Accounts')} className="inline-flex items-center gap-1 text-primary hover:underline font-medium">
                            Accounts (cash)
                        </button>
                    </>
                )}
                <span className="text-xs text-slate-500 w-full pt-2 mt-1 border-t border-slate-200/80 leading-relaxed">
                    Actuals from Transactions; planned limits from Budgets; recurring (auto or manual) from Transactions; investment from Investment Plan.
                </span>
                </div>
            </div>

            {/* Liquid cash from Accounts (cash flow context) */}
            {accounts.length > 0 && (() => {
                const liquidCash = accounts
                    .filter((a: { type: string }) => a.type === 'Checking' || a.type === 'Savings')
                    .reduce((sum: number, a: { balance?: number }) => sum + (Number(a.balance) || 0), 0);
                return liquidCash !== 0 ? (
                    <div className="mt-4 p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50/50 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-xs font-medium text-emerald-800 uppercase tracking-wide w-full">Liquid cash (Checking + Savings)</p>
                        <p className="metric-value text-xl font-bold text-emerald-800 tabular-nums mt-0.5 w-full">{formatCurrencyString(liquidCash, { digits: 0 })}</p>
                        <p className="text-xs text-slate-600 mt-0.5">From Accounts. Use Transactions to track inflows and outflows.</p>
                    </div>
                ) : null;
            })()}

            {/* Executive summary */}
            {totals && (
                <div className="mt-4 cards-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className={`p-4 rounded-xl border-2 min-w-0 overflow-hidden flex flex-col ${totals.projectedNet >= 0 ? 'bg-emerald-50/80 border-emerald-200' : 'bg-rose-50/80 border-rose-200'}`}>
                        <p className="metric-label text-xs font-medium text-gray-500 uppercase tracking-wide w-full">Projected surplus</p>
                        <p className={`metric-value text-xl font-bold tabular-nums w-full ${totals.projectedNet >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {formatCurrencyString(totals.projectedNet, { digits: 0 })}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">Income − expenses (plan)</p>
                    </div>
                    <div className="p-4 rounded-xl border-2 border-slate-200 bg-slate-50/50 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-xs font-medium text-gray-500 uppercase tracking-wide w-full">Actual net (YTD)</p>
                        <p className={`metric-value text-xl font-bold tabular-nums w-full ${totals.actualNet >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {formatCurrencyString(totals.actualNet, { digits: 0 })}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">From transactions this year</p>
                    </div>
                    <div className="p-4 rounded-xl border-2 border-blue-200 bg-blue-50/30 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-xs font-medium text-gray-500 uppercase tracking-wide w-full">Vs plan</p>
                        <p className={`metric-value text-xl font-bold tabular-nums w-full ${totals.variancePct >= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {totals.projectedNet !== 0 ? `${totals.variancePct >= 0 ? '+' : ''}${totals.variancePct.toFixed(0)}%` : '—'}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">Actual vs projected</p>
                    </div>
                    <div className="p-4 rounded-xl border-2 border-amber-200 bg-amber-50/30 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-xs font-medium text-gray-500 uppercase tracking-wide w-full">Months over budget</p>
                        <p className={`metric-value text-xl font-bold tabular-nums w-full ${insights.monthsOverBudget === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {insights.monthsOverBudget}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">Category-months above plan</p>
                    </div>
                </div>
            )}

            {/* Smart insights */}
            {(insights.worst || insights.monthsOverBudget > 0) && (
                <div className="mt-4 flex flex-wrap gap-3 p-4 rounded-xl bg-slate-100/80 border border-slate-200">
                    {insights.monthsOverBudget > 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-sm text-amber-800">
                            <ExclamationTriangleIcon className="h-5 w-5 text-amber-500" />
                            {insights.monthsOverBudget} month{insights.monthsOverBudget !== 1 ? 's' : ''} over budget
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
                            <CheckCircleIcon className="h-5 w-5 text-emerald-500" />
                            No months over budget
                        </span>
                    )}
                    {insights.worst && insights.worst.pct > 0 && (
                        <span className="text-sm text-gray-700">
                            Largest variance: <strong>{insights.worst.category}</strong> in {insights.worst.month} (+{insights.worst.pct.toFixed(0)}%)
                        </span>
                    )}
                </div>
            )}

            {/* Investment in this plan */}
            {investmentPlan && (investmentPlan.monthlyBudget ?? 0) > 0 && (
                <div className="mt-3 p-4 rounded-xl border-2 border-violet-200 bg-violet-50/50">
                    <h3 className="text-sm font-semibold text-violet-800 mb-2 flex items-center gap-2">
                        <ArrowTrendingUpIcon className="h-5 w-5" /> Investment in this plan
                        <InfoHint text="Your monthly investment (from Investment Plan) is included as an outflow in the plan. Surplus below is after expenses and investment." />
                    </h3>
                    <p className="text-sm text-gray-700">
                        You plan to invest <strong>{formatCurrencyString(investmentPlan.monthlyBudget ?? 0, { digits: 0 })}/month</strong>
                        {' '}({formatCurrencyString((investmentPlan.monthlyBudget ?? 0) * 12, { digits: 0 })} this year).
                        {totals && (
                            <span className="block mt-1">
                                Projected surplus after expenses and investment: <strong className={totals.projectedNet >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                                    {formatCurrencyString(totals.projectedNet, { digits: 0 })}
                                </strong>
                            </span>
                        )}
                    </p>
                </div>
            )}

            {/* Goals & when you'll reach them */}
            <div className="bg-white p-6 rounded-xl shadow border border-slate-200">
                <h3 className="text-lg font-semibold text-dark mb-1 flex items-center gap-2">
                    <ScaleIcon className="h-5 w-5 text-primary" /> Goals & when you'll reach them
                    <InfoHint text="Each goal is compared to your projected monthly surplus (after expenses and investment). On track = you can save enough per month by the deadline; Need more = increase savings or extend the deadline." />
                </h3>
                <p className="text-sm text-gray-500 mb-4">Based on your plan surplus this year and each goal's deadline.</p>
                {goalsAnalysis.length === 0 ? (
                    <div className="py-6 text-center text-gray-500 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                        <p className="font-medium text-slate-600">No goals yet</p>
                        <p className="text-sm mt-1">Set goals to see when you'll reach them and whether your plan keeps you on track.</p>
                        {setActivePage && (
                            <button type="button" onClick={() => setActivePage('Goals')} className="mt-3 text-primary font-medium hover:underline">Go to Goals →</button>
                        )}
                    </div>
                ) : (
                    <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {goalsAnalysis.map(g => (
                            <div
                                key={g.id}
                                className={`p-4 rounded-xl border-2 ${
                                    g.status === 'funded' ? 'bg-emerald-50/80 border-emerald-200' :
                                    g.status === 'on_track' ? 'bg-blue-50/80 border-blue-200' :
                                    'bg-amber-50/80 border-amber-200'
                                }`}
                            >
                                <div className="flex justify-between items-start">
                                    <span className="font-semibold text-dark">{g.name}</span>
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                        g.status === 'funded' ? 'bg-emerald-200 text-emerald-800' :
                                        g.status === 'on_track' ? 'bg-blue-200 text-blue-800' :
                                        'bg-amber-200 text-amber-800'
                                    }`}>
                                        {g.status === 'funded' ? 'Funded' : g.status === 'on_track' ? 'On track' : 'Need more'}
                                    </span>
                                </div>
                                <div className="mt-2 text-sm text-gray-600 space-y-0.5">
                                    <p>Target: {formatCurrencyString(g.targetAmount)} · Current: {formatCurrencyString(g.currentAmount)}</p>
                                    {g.shortfall > 0 && (
                                        <>
                                            <p>Shortfall: {formatCurrencyString(g.shortfall)} by {g.deadline ? g.deadline.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—'}</p>
                                            <p>Required: <strong>{formatCurrencyString(g.requiredPerMonth, { digits: 0 })}/month</strong>
                                                {g.status === 'need_more' && g.monthlySurplusAfterInvestment >= 0 && (
                                                    <span className="text-amber-700"> (you have ~{formatCurrencyString(g.monthlySurplusAfterInvestment, { digits: 0 })}/month surplus)</span>
                                                )}
                                            </p>
                                            {g.monthsToReachAtCurrentSurplus != null && (
                                                <p className="text-slate-600">
                                                    At current surplus: <strong>~{g.monthsToReachAtCurrentSurplus} months</strong> to reach this goal
                                                    {g.status === 'need_more' && g.monthsRemaining > 0 && (
                                                        <span className="text-amber-700"> (deadline in {g.monthsRemaining} months)</span>
                                                    )}
                                                </p>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                    {setActivePage && (
                        <button type="button" onClick={() => setActivePage('Goals')} className="mt-4 text-sm font-medium text-primary hover:underline flex items-center gap-1">
                            View & edit goals →
                        </button>
                    )}
                    </>
                )}
            </div>
            
             <div className="section-card flex flex-col h-[400px]">
                <h3 className="section-title mb-4">Annual Plan Overview</h3>
                <div className="flex-1 min-h-0 rounded-lg overflow-hidden">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={planChartData} margin={{ ...CHART_MARGIN, right: 20, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                            <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                            <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} width={48} />
                            <Tooltip
                                formatter={(val: number) => formatCurrencyString(val, { digits: 0 })}
                                contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px' }}
                            />
                            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                            <Bar dataKey="Expenses" fill={CHART_COLORS.negative} name="Planned Expenses" radius={[4, 4, 0, 0]} />
                            <Line type="monotone" dataKey="Income" stroke={CHART_COLORS.positive} strokeWidth={2} name="Planned Income" dot={false} />
                            <Line type="monotone" dataKey="Net Savings" stroke={CHART_COLORS.primary} strokeWidth={2} name="Projected Net Savings" dot={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>
            
            {/* Plan vs actual summary */}
            {totals && (
                <div className="flex flex-wrap gap-4 p-3 bg-white rounded-lg shadow border border-gray-100">
                    <span className="font-medium text-dark">Plan vs actual (year):</span>
                    <span className={totals.actualNet >= totals.projectedNet ? 'text-green-700' : 'text-amber-700'}>
                        Projected net: {formatCurrencyString(totals.projectedNet, { digits: 0 })} · Actual net: {formatCurrencyString(totals.actualNet, { digits: 0 })}
                        {totals.projectedNet !== 0 && ` (${((totals.actualNet - totals.projectedNet) / Math.abs(totals.projectedNet) * 100).toFixed(0)}% vs plan)`}
                    </span>
                </div>
            )}

            {/* Scenario Controls */}
            <div className="section-card">
                 <h3 className="section-title mb-2 flex items-center gap-2">
                     <ScaleIcon className="h-5 w-5 text-primary" /> Scenario Planning Tools
                     <InfoHint text="Apply presets or custom shocks to see how your annual plan would change. Use the grid and chart to compare." />
                 </h3>
                 <div className="flex flex-wrap gap-2 mb-4">
                     {SCENARIO_PRESETS.map(preset => (
                         <button
                             key={preset.name}
                             type="button"
                             onClick={() => {
                                 if (preset.name === 'None') {
                                     setIncomeShock({ percent: 0, startMonth: 1, duration: 1 });
                                     setExpenseStress({ category: 'All', percent: 0 });
                                 } else {
                                     setIncomeShock({
                                         percent: preset.income ?? 0,
                                         startMonth: preset.startMonth ?? 1,
                                         duration: preset.duration ?? 3,
                                     });
                                     setExpenseStress({ category: 'All', percent: preset.expense ?? 0 });
                                 }
                             }}
                             className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                                 (preset.name === 'None' && incomeShock.percent === 0 && expenseStress.percent === 0) ||
                                 (preset.name !== 'None' && incomeShock.percent === (preset.income ?? 0) && expenseStress.percent === (preset.expense ?? 0))
                                     ? 'bg-primary text-white border-primary'
                                     : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                             }`}
                         >
                             {preset.label ?? preset.name}
                         </button>
                     ))}
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
                     {/* Income Shock */}
                     <div className="space-y-2 p-3 bg-gray-50 rounded-lg">
                        <label className="font-medium text-sm flex items-center">Income Shock <InfoHint text="Simulate a change in income: e.g. +10% for 3 months starting month 5. Planned income in that range is scaled for scenario view." /></label>
                        <div className="flex items-center space-x-2">
                           <input type="number" value={incomeShock.percent} onChange={e => setIncomeShock(s => ({...s, percent: parseInt(e.target.value) || 0}))} className="w-20 p-1 border rounded-md" />
                           <span className="text-sm">% for</span>
                            <input type="number" value={incomeShock.duration} onChange={e => setIncomeShock(s => ({...s, duration: parseInt(e.target.value) || 1}))} min="1" className="w-16 p-1 border rounded-md" />
                           <span className="text-sm">mo. starting</span>
                           <input type="number" value={incomeShock.startMonth} onChange={e => setIncomeShock(s => ({...s, startMonth: parseInt(e.target.value) || 1}))} min="1" max="12" className="w-16 p-1 border rounded-md" />
                        </div>
                     </div>
                      {/* Expense Stress */}
                     <div className="space-y-2 p-3 bg-gray-50 rounded-lg">
                        <label className="font-medium text-sm flex items-center">Expense Stress Test <InfoHint text="Stress-test expenses: increase one category or All by a percentage to see impact on the plan grid and net savings." /></label>
                        <div className="flex items-center space-x-2">
                           <span className="text-sm">Increase</span>
                           <select value={expenseStress.category} onChange={e => setExpenseStress(s => ({...s, category: e.target.value}))} className="p-1 border rounded-md text-sm">
                               <option>All</option>
                               {[...new Set(processedPlanData.filter((r: PlanRow) => r.type === 'expense').map((r: PlanRow) => r.category))].map(cat => <option key={cat}>{cat}</option>)}
                           </select>
                           <span className="text-sm">by</span>
                           <input type="number" value={expenseStress.percent} onChange={e => setExpenseStress(s => ({...s, percent: parseInt(e.target.value) || 0}))} className="w-20 p-1 border rounded-md" />
                           <span className="text-sm">%</span>
                        </div>
                     </div>
                      {/* Major Events */}
                     <div className="space-y-2 p-3 bg-gray-50 rounded-lg">
                        <label className="font-medium text-sm flex items-center">Major Life Events <InfoHint text="One-time income or expense events (e.g. bonus, wedding) that affect the plan; add via the button below." /></label>
                        <div className="text-xs space-y-1">
                            {events.map(e => <div key={e.id} className="flex justify-between"><span>{e.name} ({MONTHS[e.month-1]})</span><span>{formatCurrencyString(e.amount)}</span></div>)}
                        </div>
                        <button onClick={() => setIsEventModalOpen(true)} className="flex items-center text-sm text-primary hover:underline mt-1"><PlusIcon className="h-4 w-4 mr-1"/>Add Event</button>
                     </div>
                 </div>
            </div>

             <AIAdvisor pageContext="plan" contextData={{ totals, scenarios: { incomeShock, expenseStress }, householdEngine: householdBudgetEngine }} />

             <SinkingFunds />
            
            {/* Plan Grid: actuals from Transactions, planned from Budgets + recurring; investment from Investment Plan */}
            <div className="space-y-2">
                <p className="text-xs text-slate-500">Grid: <span className="text-gray-600">top</span> = actual (Transactions) · <span className="font-medium text-slate-700">bottom</span> = planned (Budgets + recurring). Investment row planned from Investment Plan, actual from buy trades.</p>
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
                        {processedPlanData.filter((r: PlanRow) => r.type === 'income').map((row: PlanRow, rowIndex: number) => {
                             const totalPlanned = row.monthly_planned.reduce((a: number, b: number) => a + b, 0);
                             const totalActual = row.monthly_actual.reduce((a: number, b: number) => a + b, 0);
                             return (
                                <tr key={row.category}>
                                    <td className="sticky left-0 bg-white p-2 font-medium">{row.category}</td>
                                    {row.monthly_planned.map((plan: number, monthIndex: number) => {
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
                        {processedPlanData.filter((r: PlanRow) => r.type === 'expense').map((row: PlanRow) => {
                             const originalIndex = planData.findIndex(item => item.category === row.category && item.type === 'expense');
                             const totalPlanned = row.monthly_planned.reduce((a: number, b: number) => a + b, 0);
                             const totalActual = row.monthly_actual.reduce((a: number, b: number) => a + b, 0);
                             const isAffected = expenseStress.percent !== 0 && (expenseStress.category === 'All' || expenseStress.category === row.category);
                             return (
                                <tr key={row.category}>
                                    <td className="sticky left-0 bg-white p-2 font-medium">{row.category}</td>
                                    {row.monthly_planned.map((plan: number, monthIndex: number) => (
                                        <td key={monthIndex} className="p-2 align-top">
                                            <div className="text-gray-500">{renderCell(row.monthly_actual[monthIndex], plan)}</div>
                                            <div className={`font-semibold cursor-pointer p-1 rounded ${isAffected ? 'bg-orange-100' : ''}`} onClick={() => originalIndex > -1 && setIsEditing({row: originalIndex, col: monthIndex})}>
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
            </div>
            
            <EventModal isOpen={isEventModalOpen} onClose={() => setIsEventModalOpen(false)} onSave={handleSaveEvent} />

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
            </div>
        </PageLayout>
    );
};

export default AnnualFinancialPlan;
