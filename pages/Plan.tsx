import React, { useState, useMemo, useContext, useEffect, useRef } from 'react';
import { Page, Account } from '../types';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../services/supabaseClient';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { ChevronLeftIcon } from '../components/icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../components/icons/ChevronRightIcon';
import AIAdvisor from '../components/AIAdvisor';
import SalaryPlanningExperts from '../components/SalaryPlanningExperts';
import SinkingFunds from './SinkingFunds';
import InfoHint from '../components/InfoHint';
import PageLayout from '../components/PageLayout';
import PageActionsDropdown from '../components/PageActionsDropdown';
import SectionCard from '../components/SectionCard';
import { useCurrency } from '../context/CurrencyContext';
import { resolveSarPerUsd, toSAR } from '../utils/currencyMath';
import { hydrateSarPerUsdDailySeries } from '../services/fxDailySeries';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { CHART_MARGIN, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, formatAxisNumber, CHART_COLORS } from '../components/charts/chartTheme';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import { PresentationChartLineIcon } from '../components/icons/PresentationChartLineIcon';
import { ScaleIcon } from '../components/icons/ScaleIcon';
import { TrophyIcon } from '../components/icons/TrophyIcon';
import { PiggyBankIcon } from '../components/icons/PiggyBankIcon';
import { BuildingLibraryIcon } from '../components/icons/BuildingLibraryIcon';
import { CreditCardIcon } from '../components/icons/CreditCardIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import {
    buildHouseholdBudgetPlan,
    buildHouseholdEngineInputFromPlanData,
    type HouseholdEngineProfile,
    type HouseholdMonthlyOverride,
} from '../services/householdBudgetEngine';
import { calculateDynamicBaselines, generatePredictiveSpend } from '../services/enhancedBudgetEngine';
import { useFinancialEnginesIntegration } from '../hooks/useFinancialEnginesIntegration';
import { countsAsIncomeForCashflowKpi } from '../services/transactionFilters';
import { getPersonalTransactions, getPersonalAccounts } from '../utils/wealthScope';
import { resolveInvestmentTransactionAccountId } from '../utils/investmentLedgerCurrency';
import { buildAnnualPlanRows, formatAnnualPlanIncomeHint, type AnnualPlanRow } from '../services/annualPlanFromData';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type PlanRow = AnnualPlanRow;

const SCENARIO_PRESETS = [
    { name: 'None', income: 0, expense: 0, duration: 1, startMonth: 1, label: 'None' },
    { name: 'Recession', income: -10, expense: 5, startMonth: 1, duration: 3, label: 'Recession (income −10%, 3 mo; expenses +5%)' },
    { name: 'Bonus year', income: 15, expense: 0, startMonth: 4, duration: 1, label: 'Q2 bonus +15%' },
    { name: 'Expense spike', income: 0, expense: 20, startMonth: 1, duration: 1, label: 'All expenses +20%' },
];

const AnnualFinancialPlan: React.FC<{ setActivePage?: (page: Page) => void }> = ({ setActivePage }) => {
    const { data, loading } = useContext(DataContext)!;
    const auth = useContext(AuthContext);
    const { formatCurrencyString } = useFormatCurrency();
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => {
        if (data) hydrateSarPerUsdDailySeries(data, exchangeRate);
        return resolveSarPerUsd(data, exchangeRate);
    }, [data, exchangeRate]);
    const [year, setYear] = useState(new Date().getFullYear());
    const [householdAdults, setHouseholdAdults] = useState(2);
    const [householdKids, setHouseholdKids] = useState(0);
    const [householdOverrides, setHouseholdOverrides] = useState<HouseholdMonthlyOverride[]>([]);
    const [engineProfile, setEngineProfile] = useState<HouseholdEngineProfile>('Moderate');
    const [expectedMonthlySalary, setExpectedMonthlySalary] = useState<number | ''>('');
    const [householdProfileCloudLoadedUserId, setHouseholdProfileCloudLoadedUserId] = useState<string | null>(null);
    const [householdProfileSaveStatus, setHouseholdProfileSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [householdProfileSaveMessage, setHouseholdProfileSaveMessage] = useState<string | null>(null);
    const householdProfileResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Scenario States
    const [incomeShock, setIncomeShock] = useState({ percent: 0, startMonth: 1, duration: 1 });
    const [expenseStress, setExpenseStress] = useState({ category: 'All', percent: 0 });

    const [planSubPage, setPlanSubPage] = useState<'overview' | 'experts'>('overview');

    const budgets = data?.budgets ?? [];
    const transactions = getPersonalTransactions(data);
    const accounts = getPersonalAccounts(data);
    const goals = data?.goals ?? [];
    const liabilities = (data as any)?.personalLiabilities ?? data?.liabilities ?? [];
    const investmentPlan = data?.investmentPlan;
    const personalAccountIds = new Set(accounts.map((a: { id: string }) => a.id));
    const investmentTransactions = (data?.investmentTransactions ?? []).filter((t: { accountId?: string; account_id?: string; portfolioId?: string; portfolio_id?: string }) =>
        personalAccountIds.has(
            resolveInvestmentTransactionAccountId(t as any, accounts as any, ((data as any)?.personalInvestments ?? data?.investments ?? []) as any[]),
        ),
    );
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
            setHouseholdProfileSaveStatus('saving');
            setHouseholdProfileSaveMessage(null);
            try {
                await db
                    .from('household_budget_profiles')
                    .upsert({ user_id: userId, profile: payload }, { onConflict: 'user_id' });
                setHouseholdProfileSaveStatus('saved');
                setHouseholdProfileSaveMessage('Profile synced to cloud.');
                if (householdProfileResetTimeoutRef.current) window.clearTimeout(householdProfileResetTimeoutRef.current);
                householdProfileResetTimeoutRef.current = window.setTimeout(() => {
                    setHouseholdProfileSaveStatus('idle');
                    setHouseholdProfileSaveMessage(null);
                    householdProfileResetTimeoutRef.current = null;
                }, 3000) as unknown as ReturnType<typeof setTimeout>;
            } catch (e) {
                setHouseholdProfileSaveStatus('error');
                setHouseholdProfileSaveMessage(e instanceof Error ? e.message : 'Failed to sync profile to cloud.');
            }
        }, 700);
        return () => {
            window.clearTimeout(t);
            if (householdProfileResetTimeoutRef.current) {
                window.clearTimeout(householdProfileResetTimeoutRef.current);
                householdProfileResetTimeoutRef.current = null;
            }
        };
    }, [householdProfileCloudEnabled, auth?.user?.id, householdAdults, householdKids, householdOverrides, engineProfile, expectedMonthlySalary, householdProfileCloudLoadedUserId]);

    /** Annual plan rows: single source of truth in `services/annualPlanFromData.ts` (fed from Budgets, Transactions, recurring, Investment Plan, household profile). */
    const basePlanResult = useMemo(() => {
        if (!data) {
            return {
                rows: [] as PlanRow[],
                incomeMeta: {
                    recurringIncomeMonthlySum: 0,
                    budgetIncomeMax: 0,
                    incomeAvg: 0,
                    suggestedMonthlySalary: 0,
                },
            };
        }
        return buildAnnualPlanRows({
            year,
            budgets,
            transactions,
            recurringTransactions,
            investmentPlan,
            investmentTransactions,
            accounts: accounts as Account[],
            investments: data.investments ?? [],
            personalAccountIds,
            data,
            exchangeRate,
            sarPerUsd,
            expectedMonthlySalary: typeof expectedMonthlySalary === 'number' ? expectedMonthlySalary : undefined,
            householdOverrides,
        });
    }, [
        data,
        year,
        budgets,
        transactions,
        recurringTransactions,
        investmentPlan,
        investmentTransactions,
        accounts,
        exchangeRate,
        sarPerUsd,
        expectedMonthlySalary,
        householdOverrides,
        personalAccountIds,
    ]);

    const basePlanRows = basePlanResult.rows;
    const incomeMeta = basePlanResult.incomeMeta;

    const incomePlannedHint = useMemo(
        () => (basePlanRows.length > 0 ? formatAnnualPlanIncomeHint(incomeMeta, formatCurrencyString) : null),
        [basePlanRows.length, incomeMeta, formatCurrencyString],
    );
    
    const processedPlanData: PlanRow[] = useMemo(() => {
        const baseData: PlanRow[] = JSON.parse(JSON.stringify(basePlanRows));
        const incomeRow = baseData.find((r: PlanRow) => r.type === 'income');
        if (incomeRow) {
            for (let i = 0; i < incomeShock.duration; i++) {
                const monthIndex = incomeShock.startMonth - 1 + i;
                if (monthIndex < 12) {
                    incomeRow.monthly_planned[monthIndex] *= 1 + incomeShock.percent / 100;
                }
            }
        }
        baseData.forEach((row: PlanRow) => {
            if (row.type === 'expense' && (expenseStress.category === 'All' || row.category === expenseStress.category)) {
                row.monthly_planned = row.monthly_planned.map((p: number) => p * (1 + expenseStress.percent / 100));
            }
        });
        return baseData;
    }, [basePlanRows, incomeShock, expenseStress]);
    
    const totals = useMemo(() => {
        const income = processedPlanData.find((r: PlanRow) => r.type === 'income');
        const totalPlannedIncome = income?.monthly_planned.reduce((a: number, b: number) => a + b, 0) || 0;
        const totalActualIncome = income?.monthly_actual.reduce((a: number, b: number) => a + b, 0) || 0;

        const totalPlannedExpenses = processedPlanData.filter((r: PlanRow) => r.type === 'expense').reduce((sum: number, row: PlanRow) => sum + row.monthly_planned.reduce((a: number,b: number) => a + b, 0), 0);
        const totalActualExpenses = processedPlanData.filter((r: PlanRow) => r.type === 'expense').reduce((sum: number, row: PlanRow) => sum + row.monthly_actual.reduce((a: number,b: number) => a + b, 0), 0);

        const projectedNet = totalPlannedIncome - totalPlannedExpenses;
        const actualNetFullYear = totalActualIncome - totalActualExpenses;
        const variancePctFullYear = projectedNet !== 0 ? ((actualNetFullYear - projectedNet) / Math.abs(projectedNet)) * 100 : 0;

        const now = new Date();
        const curY = now.getFullYear();
        const curM = now.getMonth();
        let endIdx = 11;
        if (year > curY) endIdx = -1;
        else if (year === curY) endIdx = curM;
        else endIdx = 11;

        const sliceSum = (arr: number[] | undefined, end: number) => {
            if (!arr || end < 0) return 0;
            return arr.slice(0, end + 1).reduce((a: number, b: number) => a + b, 0);
        };

        const ytdPlannedIncome = sliceSum(income?.monthly_planned, endIdx);
        const ytdActualIncome = sliceSum(income?.monthly_actual, endIdx);
        let ytdPlannedExpenses = 0;
        let ytdActualExpenses = 0;
        processedPlanData.filter((r: PlanRow) => r.type === 'expense').forEach((row: PlanRow) => {
            ytdPlannedExpenses += sliceSum(row.monthly_planned, endIdx);
            ytdActualExpenses += sliceSum(row.monthly_actual, endIdx);
        });
        const ytdProjectedNet = ytdPlannedIncome - ytdPlannedExpenses;
        const ytdActualNet = ytdActualIncome - ytdActualExpenses;
        const ytdVariancePct = ytdProjectedNet !== 0 ? ((ytdActualNet - ytdProjectedNet) / Math.abs(ytdProjectedNet)) * 100 : 0;

        return {
            totalPlannedIncome,
            totalPlannedExpenses,
            totalActualIncome,
            totalActualExpenses,
            projectedNet,
            actualNet: actualNetFullYear,
            variancePct: variancePctFullYear,
            ytdPlannedIncome,
            ytdActualIncome,
            ytdPlannedExpenses,
            ytdActualExpenses,
            ytdProjectedNet,
            ytdActualNet,
            ytdVariancePct,
            planProgressEndIdx: endIdx,
        };
    }, [processedPlanData, year]);

    const insights = useMemo((): { monthsOverBudget: number; worst: { category: string; month: string; pct: number } | null; ytdPlannedIncome: number; ytdActualIncome: number } => {
        const income = processedPlanData.find((r: PlanRow) => r.type === 'income');
        let monthsOverBudget = 0;
        let worst: { category: string; month: string; pct: number } | null = null;
        processedPlanData.filter((r: PlanRow) => r.type === 'expense').forEach((row: PlanRow) => {
            const isInvestment = row.category === 'Monthly investment';
            row.monthly_planned.forEach((plan: number, mi: number) => {
                const actual = row.monthly_actual[mi];
                const over =
                    isInvestment
                        ? actual > plan + 1e-6
                        : plan > 0 && actual > plan + 1e-6;
                if (over) monthsOverBudget++;
                const pct = plan > 0 ? ((actual - plan) / plan) * 100 : actual > 0 ? 100 : 0;
                if (pct > 0 && (!worst || pct > worst.pct)) worst = { category: row.category, month: MONTHS[mi], pct };
            });
        });
        const currentMonth = new Date().getMonth();
        const ytdPlannedIncome = income?.monthly_planned.slice(0, currentMonth + 1).reduce((a, b) => a + b, 0) ?? 0;
        const ytdActualIncome = income?.monthly_actual.slice(0, currentMonth + 1).reduce((a, b) => a + b, 0) ?? 0;
        return { monthsOverBudget, worst, ytdPlannedIncome, ytdActualIncome };
    }, [processedPlanData]);

    /** Planned vs actual through end of selected period (YTD for current year, full year for past years). Hidden for future years. */
    const planProgressPeriod = useMemo(() => {
        const curY = new Date().getFullYear();
        const curM = new Date().getMonth();
        if (year > curY) return null;
        const endIdx = year < curY ? 11 : curM;
        const label = year < curY ? `Full year ${year}` : `Year-to-date through ${MONTHS[endIdx]}`;
        const sumSlice = (planned: number[], actual: number[]) => ({
            planned: planned.slice(0, endIdx + 1).reduce((a, b) => a + b, 0),
            actual: actual.slice(0, endIdx + 1).reduce((a, b) => a + b, 0),
        });
        const income = processedPlanData.find((r: PlanRow) => r.type === 'income');
        const inv = processedPlanData.find((r: PlanRow) => r.category === 'Monthly investment');
        const expenseRows = processedPlanData.filter(
            (r: PlanRow) => r.type === 'expense' && r.category !== 'Monthly investment'
        );
        const incomePair = income ? sumSlice(income.monthly_planned, income.monthly_actual) : null;
        let expensesPlanned = 0;
        let expensesActual = 0;
        expenseRows.forEach((row: PlanRow) => {
            expensesPlanned += row.monthly_planned.slice(0, endIdx + 1).reduce((a, b) => a + b, 0);
            expensesActual += row.monthly_actual.slice(0, endIdx + 1).reduce((a, b) => a + b, 0);
        });
        const investmentPair = inv ? sumSlice(inv.monthly_planned, inv.monthly_actual) : null;
        const hasInvestment =
            investmentPair && (investmentPair.planned > 0 || investmentPair.actual > 0);
        const hasAny =
            (incomePair && (incomePair.planned > 0 || incomePair.actual > 0)) ||
            expensesPlanned > 0 ||
            expensesActual > 0 ||
            hasInvestment;
        if (!hasAny) return null;
        return {
            label,
            endIdx,
            income: incomePair,
            expenses: { planned: expensesPlanned, actual: expensesActual },
            investment: hasInvestment ? investmentPair! : null,
        };
    }, [processedPlanData, year]);

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
        (transactions as Array<{ date: string; type?: string; amount?: number; category?: string }>).forEach((t) => {
            const d = new Date(t.date);
            if (d.getFullYear() !== year || !countsAsIncomeForCashflowKpi(t)) return;
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

    const { household: householdConstraints } = useFinancialEnginesIntegration();
    const dynamicBaselines = useMemo(() => calculateDynamicBaselines(transactions as any[], 6), [transactions]);
    const predictiveSpend = useMemo(() => {
        const currentMonth = new Date().getMonth() + 1;
        const recentTx = (transactions as any[]).filter((t: { date: string }) => {
            const d = new Date(t.date);
            const cutoff = new Date();
            cutoff.setMonth(cutoff.getMonth() - 3);
            return d >= cutoff;
        });
        return generatePredictiveSpend(dynamicBaselines, currentMonth, recentTx, []);
    }, [dynamicBaselines, transactions]);

    useEffect(() => {
        const riskProfile = String((data as any)?.settings?.riskProfile || '').toLowerCase();
        if (engineProfile === 'Moderate') {
            if (riskProfile.includes('conservative')) setEngineProfile('Conservative');
            if (riskProfile.includes('aggressive') || riskProfile.includes('growth')) setEngineProfile('Growth');
        }
    }, [(data as any)?.settings?.riskProfile]);

    const planChartData = useMemo(() => {
        return MONTHS.map((month, index) => {
            const incPlanned = Number(processedPlanData.find((r: PlanRow) => r.type === 'income')?.monthly_planned[index] ?? 0);
            const incActual = Number(processedPlanData.find((r: PlanRow) => r.type === 'income')?.monthly_actual[index] ?? 0);
            const expPlanned = processedPlanData
                .filter((r: PlanRow) => r.type === 'expense')
                .reduce((sum: number, r: PlanRow) => sum + Number(r.monthly_planned[index] ?? 0), 0);
            const expActual = processedPlanData
                .filter((r: PlanRow) => r.type === 'expense')
                .reduce((sum: number, r: PlanRow) => sum + Number(r.monthly_actual[index] ?? 0), 0);
            return {
                name: month,
                Income: incPlanned,
                Expenses: expPlanned,
                'Net Savings': incPlanned - expPlanned,
                IncomeActual: incActual,
                ExpensesActual: expActual,
                'Net actual': incActual - expActual,
            };
        });
    }, [processedPlanData]);

    const planChartHasPlannedSeries = useMemo(
        () => planChartData.some((d) => (d.Income ?? 0) !== 0 || (d.Expenses ?? 0) !== 0),
        [planChartData],
    );

    const planValidationWarnings = useMemo(() => {
        const warnings: string[] = [];
        if (!Number.isFinite(sarPerUsd) || sarPerUsd <= 0) warnings.push('FX rate is invalid; investment actuals in SAR may be off.');
        if (processedPlanData.length === 0) warnings.push('Plan grid is still loading or no data for this year.');
        const curY = new Date().getFullYear();
        if (year === curY && totals && totals.ytdActualIncome < 1 && totals.ytdPlannedIncome > 100) {
            warnings.push('No income transactions YTD in this year—actual income is SAR 0 while planned uses salary/baseline. Add income on Transactions or set expected salary.');
        }
        return warnings;
    }, [sarPerUsd, processedPlanData.length, year, totals]);
    
    const renderCell = (value: number, limit: number) => {
        const percentage = limit > 0 ? (value / limit) * 100 : 0;
        let statusColor = 'bg-green-500';
        if (percentage > 100) statusColor = 'bg-red-500';
        else if (percentage > 90) statusColor = 'bg-yellow-500';

        return (
             <div className="flex items-center gap-2 min-h-[1.25rem]">
                <span className={`w-2.5 h-2.5 shrink-0 rounded-full ${statusColor}`} title={`Status: ${percentage.toFixed(0)}% of plan`} />
                <span className="tabular-nums">{formatCurrencyString(value, { digits: 0 })}</span>
             </div>
        );
    }

    if (loading || !data) {
        return (
            <div className="flex justify-center items-center min-h-[24rem]" aria-busy="true">
                <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent" aria-label="Loading plan" />
            </div>
        );
    }

    return (
        <PageLayout
            title="Annual Financial Plan"
            description="Read-only annual view: every number is computed from Budgets, Transactions (actuals + recurring), Investment Plan, household profile (synced with Budgets), Accounts, Goals, and Liabilities. Edit those pages—not the grid here."
            action={
                <div className="w-full flex flex-col lg:flex-row lg:items-center lg:justify-end gap-3">
                    <div className="inline-flex items-center p-1 rounded-xl border border-slate-200 bg-slate-100/80 self-start lg:self-auto shadow-sm">
                        <button type="button" onClick={() => setPlanSubPage('overview')} className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${planSubPage === 'overview' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:text-slate-800 hover:bg-white/80'}`}>Plan Overview</button>
                        <button type="button" onClick={() => setPlanSubPage('experts')} className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${planSubPage === 'experts' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:text-slate-800 hover:bg-white/80'}`}>Salary & Planning Experts</button>
                    </div>
                    <div className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-2 py-1 self-start lg:self-auto">
                        <button type="button" onClick={() => setYear(y => y - 1)} className="p-2 rounded-full hover:bg-slate-100 text-slate-600"><ChevronLeftIcon className="h-5 w-5"/></button>
                        <label className="flex items-center gap-1.5"><span className="text-sm text-gray-600">Year</span><InfoHint text="Plan and track by calendar year; actuals are filled from your transactions for this year." /><input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="input-base w-24 text-center font-semibold" /></label>
                        <button type="button" onClick={() => setYear(y => y + 1)} className="p-2 rounded-full hover:bg-slate-100 text-slate-600"><ChevronRightIcon className="h-5 w-5"/></button>
                    </div>
                    {setActivePage && (
                        <PageActionsDropdown
                            ariaLabel="Plan quick links"
                            actions={[
                                { value: 'accounts', label: 'Accounts', onClick: () => setActivePage('Accounts') },
                                { value: 'budgets', label: 'Budgets', onClick: () => setActivePage('Budgets') },
                                { value: 'goals', label: 'Goals', onClick: () => setActivePage('Goals') },
                                { value: 'liabilities', label: 'Liabilities', onClick: () => setActivePage('Liabilities') },
                                { value: 'transactions', label: 'Transactions', onClick: () => setActivePage('Transactions') },
                                { value: 'investments', label: 'Investment Plan', onClick: () => setActivePage('Investment Plan') },
                                { value: 'forecast', label: 'Forecast (long-range)', onClick: () => setActivePage('Forecast') },
                            ]}
                        />
                    )}
                </div>
            }
        >
            {planSubPage === 'experts' ? (
                <div className="space-y-6">
                    <SalaryPlanningExperts />
                </div>
            ) : (
            <div className="space-y-6 sm:space-y-8">
            <div className="space-y-4 sm:space-y-5">
            {/* Data sources: Plan is fed from all these pages via DataContext */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-700">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="font-semibold text-slate-800">Plan fed from:</span>
                {setActivePage && (
                    <>
                        <button type="button" onClick={() => setActivePage('Accounts')} className="inline-flex items-center gap-1 text-primary hover:underline font-medium" title="Cash balances, scheduled transfers">
                            <BuildingLibraryIcon className="h-4 w-4" /> Accounts
                        </button>
                        <span className="text-slate-400">·</span>
                        <button type="button" onClick={() => setActivePage('Budgets')} className="inline-flex items-center gap-1 text-primary hover:underline font-medium" title="Planned limits">
                            <PiggyBankIcon className="h-4 w-4" /> Budgets
                        </button>
                        <span className="text-slate-400">·</span>
                        <button type="button" onClick={() => setActivePage('Transactions')} className="inline-flex items-center gap-1 text-primary hover:underline font-medium" title="Actuals & recurring">
                            <CreditCardIcon className="h-4 w-4" /> Transactions
                        </button>
                        <span className="text-slate-400">·</span>
                        <button type="button" onClick={() => setActivePage('Goals')} className="inline-flex items-center gap-1 text-primary hover:underline font-medium" title="Goals & when you'll reach them">
                            <TrophyIcon className="h-4 w-4" /> Goals
                        </button>
                        <span className="text-slate-400">·</span>
                        <button type="button" onClick={() => setActivePage('Liabilities')} className="inline-flex items-center gap-1 text-primary hover:underline font-medium" title="Debt & liabilities context">
                            <CreditCardIcon className="h-4 w-4" /> Liabilities
                        </button>
                        <span className="text-slate-400">·</span>
                        <button type="button" onClick={() => setActivePage('Investments')} className="inline-flex items-center gap-1 text-primary hover:underline font-medium" title="Monthly investment planned & actual">
                            <ArrowTrendingUpIcon className="h-4 w-4" /> Investment Plan
                        </button>
                        <span className="text-slate-400">·</span>
                        <button type="button" onClick={() => setActivePage('Forecast')} className="inline-flex items-center gap-1 text-primary hover:underline font-medium" title="Long-range net worth scenarios">
                            <PresentationChartLineIcon className="h-4 w-4" /> Forecast
                        </button>
                    </>
                )}
                <span className="text-xs text-slate-500 w-full pt-2 mt-1 border-t border-slate-200/80 leading-relaxed">
                    Actuals from Transactions. Expense planned from Budgets + recurring expense rules. Income planned uses a single priority (no double-counting): month override → expected monthly salary → income-type budgets (Salary/Income) → recurring income total → averages from transactions. Investment planned from Investment Plan; goals and liabilities for context.
                </span>
                {householdProfileCloudEnabled && householdProfileSaveStatus !== 'idle' && (
                    <p className={`text-xs w-full pt-2 mt-1 border-t border-slate-200/80 ${householdProfileSaveStatus === 'error' ? 'text-amber-700' : householdProfileSaveStatus === 'saved' ? 'text-emerald-600' : 'text-slate-500'}`} role="status" aria-live="polite">
                        {householdProfileSaveStatus === 'saving' && 'Syncing household profile…'}
                        {householdProfileSaveStatus === 'saved' && (householdProfileSaveMessage ?? 'Profile synced to cloud.')}
                        {householdProfileSaveStatus === 'error' && (householdProfileSaveMessage ?? 'Profile sync failed.')}
                    </p>
                )}
                </div>
            </div>

            {/* Dynamic baselines & predictive spend (household engine enhancement) */}
            {(dynamicBaselines.length > 0 || (householdConstraints?.cashflowStressSignals?.length ?? 0) > 0) && (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3 flex items-center gap-1">
                        Household intelligence
                        <InfoHint text="Signals from the household budget engine: dynamic category baselines, predictive spend for the current month, and optional cashflow stress notes. Data comes from your transactions and budgets." />
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {dynamicBaselines.length > 0 && (
                            <div>
                                <p className="text-sm font-medium text-slate-700 mb-1">Dynamic baselines (from spending)</p>
                                <ul className="text-xs text-slate-600 space-y-0.5">
                                    {dynamicBaselines.slice(0, 5).map((b, i) => (
                                        <li key={i}>{b.category}: {formatCurrencyString(b.baselineAmount, { digits: 0 })} · {b.trendDirection}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {predictiveSpend.length > 0 && (
                            <div>
                                <p className="text-sm font-medium text-slate-700 mb-1">Predictive spend (this month)</p>
                                <ul className="text-xs text-slate-600 space-y-0.5">
                                    {predictiveSpend.slice(0, 4).map((p, i) => (
                                        <li key={i}>{p.category}: ~{formatCurrencyString(p.predictedAmount, { digits: 0 })} (risk {p.riskOfOverrun}%)</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {householdConstraints?.cashflowStressSignals && householdConstraints.cashflowStressSignals.length > 0 && (
                            <div className="sm:col-span-2">
                                <p className="text-sm font-medium text-amber-800 mb-1">Cashflow signals</p>
                                <ul className="text-xs text-amber-900 space-y-0.5">
                                    {householdConstraints.cashflowStressSignals.slice(0, 3).map((s, i) => (
                                        <li key={i}>{s.message}{s.recommendedAction ? ` — ${s.recommendedAction}` : ''}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Liquid cash from Accounts; debt from Liabilities — equal-width columns when both show */}
            {((accounts.length > 0) || (liabilities.length > 0)) && (() => {
                const liquidCash =
                    accounts.length > 0
                        ? accounts
                    .filter((a: { type: string }) => a.type === 'Checking' || a.type === 'Savings')
                    .reduce((sum: number, a: Account) => {
                        const cur = a.currency === 'USD' ? 'USD' : 'SAR';
                        return sum + Math.max(0, toSAR(Number(a.balance) || 0, cur, sarPerUsd));
                              }, 0)
                        : 0;
                const totalDebt =
                    liabilities.length > 0
                        ? liabilities
                              .filter((l: { type?: string; amount?: number }) => (l.type ?? '') !== 'Receivable')
                              .reduce((sum: number, l: { amount?: number }) => sum + Math.abs(Number(l.amount) || 0), 0)
                        : 0;
                const showLiquid = liquidCash !== 0;
                const showDebt = totalDebt > 0;
                const cells: React.ReactNode[] = [];
                if (showLiquid) {
                    cells.push(
                        <div
                            key="liquid"
                            className={`p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50/50 min-w-0 overflow-hidden flex flex-col justify-between ${showDebt ? '' : 'sm:col-span-2 max-w-2xl'}`}
                        >
                        <p className="metric-label text-xs font-medium text-emerald-800 uppercase tracking-wide w-full">Liquid cash (Checking + Savings)</p>
                        <p className="metric-value text-xl font-bold text-emerald-800 tabular-nums mt-0.5 w-full">{formatCurrencyString(liquidCash, { inCurrency: 'SAR', digits: 0 })}</p>
                        <p className="text-xs text-slate-600 mt-0.5">From Accounts (SAR equivalent).</p>
                        {setActivePage && (
                            <button type="button" onClick={() => setActivePage('Accounts')} className="mt-2 text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">Accounts →</button>
                        )}
                        </div>,
                    );
                }
                if (showDebt) {
                    cells.push(
                        <div
                            key="debt"
                            className={`p-4 rounded-xl border-2 border-slate-200 bg-slate-50/50 min-w-0 overflow-hidden flex flex-col justify-between ${showLiquid ? '' : 'sm:col-span-2 max-w-2xl'}`}
                        >
                        <p className="metric-label text-xs font-medium text-slate-700 uppercase tracking-wide w-full flex items-center gap-1 flex-wrap">
                            Total debt (Liabilities)
                            <InfoHint text="Sum of absolute amounts on liability rows except type Receivable. Matches Liabilities page context for annual planning." />
                        </p>
                        <p className="metric-value text-xl font-bold text-slate-800 tabular-nums mt-0.5 w-full">{formatCurrencyString(totalDebt, { digits: 0 })}</p>
                        <p className="text-xs text-slate-600 mt-0.5">From Liabilities.</p>
                        {setActivePage && (
                            <button type="button" onClick={() => setActivePage('Liabilities')} className="mt-2 text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">Liabilities →</button>
                        )}
                        </div>,
                    );
                }
                if (cells.length === 0) return null;
                return (
                    <div className={`mt-4 grid grid-cols-1 gap-4 ${cells.length === 2 ? 'sm:grid-cols-2' : ''}`}>{cells}</div>
                );
            })()}

            {/* Executive summary */}
            {totals && (() => {
                const curY = new Date().getFullYear();
                const isFutureYear = year > curY;
                const isPastYear = year < curY;
                const summaryActualNet = isFutureYear ? null : isPastYear ? totals.actualNet : totals.ytdActualNet;
                const summaryVariancePct =
                    isFutureYear ? null : isPastYear ? totals.variancePct : totals.ytdVariancePct;
                const summaryCompareLabel =
                    isFutureYear ? 'Future year — no actuals yet' : isPastYear ? 'Full-year actual vs full-year plan' : 'YTD actual vs YTD plan';
                return (
                <div className="mt-4 cards-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className={`p-4 rounded-xl border-2 min-w-0 overflow-hidden flex flex-col ${totals.projectedNet >= 0 ? 'bg-emerald-50/80 border-emerald-200' : 'bg-rose-50/80 border-rose-200'}`}>
                        <p className="metric-label text-xs font-medium text-gray-500 uppercase tracking-wide w-full">Projected surplus</p>
                        <p className={`metric-value text-xl font-bold tabular-nums w-full ${totals.projectedNet >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {formatCurrencyString(totals.projectedNet, { inCurrency: 'SAR', digits: 0 })}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">Full year: planned income − planned expenses (incl. investment)</p>
                    </div>
                    <div className="p-4 rounded-xl border-2 border-slate-200 bg-slate-50/50 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-xs font-medium text-gray-500 uppercase tracking-wide w-full">
                            {isPastYear ? 'Actual net (year)' : 'Actual net (YTD)'}
                        </p>
                        <p className={`metric-value text-xl font-bold tabular-nums w-full ${summaryActualNet != null && summaryActualNet >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {summaryActualNet != null ? formatCurrencyString(summaryActualNet, { inCurrency: 'SAR', digits: 0 }) : '—'}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">From transactions &amp; investment buys (SAR eq.)</p>
                    </div>
                    <div className="p-4 rounded-xl border-2 border-blue-200 bg-blue-50/30 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-xs font-medium text-gray-500 uppercase tracking-wide w-full">Vs plan</p>
                        <p className={`metric-value text-xl font-bold tabular-nums w-full ${(summaryVariancePct ?? 0) >= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {summaryVariancePct != null && (isPastYear ? totals.projectedNet !== 0 : totals.ytdProjectedNet !== 0)
                                ? `${summaryVariancePct >= 0 ? '+' : ''}${summaryVariancePct.toFixed(0)}%`
                                : '—'}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">{summaryCompareLabel}</p>
                    </div>
                    <div className="p-4 rounded-xl border-2 border-amber-200 bg-amber-50/30 min-w-0 overflow-hidden flex flex-col">
                        <p className="metric-label text-xs font-medium text-gray-500 uppercase tracking-wide w-full">Months over budget</p>
                        <p className={`metric-value text-xl font-bold tabular-nums w-full ${insights.monthsOverBudget === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {insights.monthsOverBudget}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">Category-months above plan (investment counts if actual &gt; planned)</p>
                    </div>
                </div>
                );
            })()}

            {planValidationWarnings.length > 0 && (
                <SectionCard title="Plan validation checks" collapsible collapsibleSummary="Data quality and wiring" defaultExpanded className="mt-4">
                    <ul className="space-y-1 text-sm text-amber-800">
                        {planValidationWarnings.slice(0, 8).map((w, i) => (
                            <li key={`pv-${i}`}>- {w}</li>
                        ))}
                    </ul>
                </SectionCard>
            )}

            {/* Progress vs plan: same months as the grid; planned from budgets/recurring/plan, actual from transactions */}
            {planProgressPeriod && (
                <div className="mt-4 p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                    <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
                        <PresentationChartLineIcon className="h-5 w-5 text-primary shrink-0" />
                        Progress vs plan
                        <InfoHint text="Planned amounts use this page’s grid (budgets, recurring, investment plan). Actuals use transactions (and investment buys) for the same calendar months—year-to-date for the current year, or the full selected year for past years." />
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 mb-3">{planProgressPeriod.label}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-stretch">
                        {planProgressPeriod.income && (planProgressPeriod.income.planned > 0 || planProgressPeriod.income.actual > 0) && (
                            <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 min-w-0 flex flex-col justify-between min-h-[7.5rem]">
                                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Income</p>
                                <p className="text-sm text-slate-800 tabular-nums leading-snug">
                                    Planned <strong>{formatCurrencyString(planProgressPeriod.income.planned, { digits: 0 })}</strong>
                                    <span className="text-slate-400 mx-1">·</span>
                                    Actual <strong>{formatCurrencyString(planProgressPeriod.income.actual, { digits: 0 })}</strong>
                                </p>
                                {(() => {
                                    const d = planProgressPeriod.income!.actual - planProgressPeriod.income!.planned;
                                    if (Math.abs(d) < 1) return <p className="text-xs text-slate-500 mt-1">On plan</p>;
                                    return (
                                        <p className={`text-xs font-medium mt-1 ${d >= 0 ? 'text-emerald-700' : 'text-amber-800'}`}>
                                            {d >= 0 ? '+' : ''}
                                            {formatCurrencyString(d, { digits: 0 })} vs planned
                                        </p>
                                    );
                                })()}
                            </div>
                        )}
                        {(planProgressPeriod.expenses.planned > 0 || planProgressPeriod.expenses.actual > 0) && (
                            <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 min-w-0 flex flex-col justify-between min-h-[7.5rem]">
                                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Expenses</p>
                                <p className="text-sm text-slate-800 tabular-nums leading-snug">
                                    Planned <strong>{formatCurrencyString(planProgressPeriod.expenses.planned, { digits: 0 })}</strong>
                                    <span className="text-slate-400 mx-1">·</span>
                                    Actual <strong>{formatCurrencyString(planProgressPeriod.expenses.actual, { digits: 0 })}</strong>
                                </p>
                                {(() => {
                                    const d = planProgressPeriod.expenses.actual - planProgressPeriod.expenses.planned;
                                    if (Math.abs(d) < 1) return <p className="text-xs text-slate-500 mt-1">On plan</p>;
                                    return (
                                        <p className={`text-xs font-medium mt-1 ${d <= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                            {d >= 0 ? '+' : ''}
                                            {formatCurrencyString(d, { digits: 0 })} vs planned
                                        </p>
                                    );
                                })()}
                                <p className="text-[10px] text-slate-400 mt-1">Excludes monthly investment row</p>
                            </div>
                        )}
                        {planProgressPeriod.investment && (
                            <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-3 min-w-0 flex flex-col justify-between min-h-[7.5rem]">
                                <p className="text-xs font-medium text-violet-700 uppercase tracking-wide mb-1">Monthly investment</p>
                                <p className="text-sm text-slate-800 tabular-nums leading-snug">
                                    Planned <strong>{formatCurrencyString(planProgressPeriod.investment.planned, { digits: 0 })}</strong>
                                    <span className="text-slate-400 mx-1">·</span>
                                    Actual <strong>{formatCurrencyString(planProgressPeriod.investment.actual, { digits: 0 })}</strong>
                                </p>
                                {(() => {
                                    const d = planProgressPeriod.investment!.actual - planProgressPeriod.investment!.planned;
                                    if (Math.abs(d) < 1) return <p className="text-xs text-slate-500 mt-1">On plan</p>;
                                    return (
                                        <p className={`text-xs font-medium mt-1 ${d >= 0 ? 'text-emerald-700' : 'text-amber-800'}`}>
                                            {d >= 0 ? '+' : ''}
                                            {formatCurrencyString(d, { digits: 0 })} vs planned
                                        </p>
                                    );
                                })()}
                                {setActivePage && (
                                    <button
                                        type="button"
                                        onClick={() => setActivePage('Investments')}
                                        className="mt-2 text-[11px] font-medium text-primary hover:underline"
                                    >
                                        Investment Plan →
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Smart insights — show whenever the plan has expense rows so “no overages” is visible too */}
            {processedPlanData.some((r: PlanRow) => r.type === 'expense') && (
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
                            <button type="button" onClick={() => setActivePage('Goals')} className="mt-3 text-primary font-medium hover:underline inline-flex items-center gap-1.5"><TrophyIcon className="h-4 w-4" />Go to Goals →</button>
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
                        <button type="button" onClick={() => setActivePage('Goals')} className="mt-4 text-sm font-medium text-primary hover:underline flex items-center gap-1.5">
                            <TrophyIcon className="h-4 w-4" />
                            View & edit goals →
                        </button>
                    )}
                    </>
                )}
            </div>
            
             <div className="section-card flex flex-col min-h-[400px] h-[420px]">
                <h3 className="section-title mb-2">Annual Plan Overview</h3>
                <p className="text-xs text-slate-500 mb-2">Solid lines / bar = planned; dashed = actual from transactions (SAR basis).</p>
                {!planChartHasPlannedSeries && (
                    <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                        No planned income or expenses in the grid for this year—set budgets, recurring items, or expected salary so the chart can render.
                    </p>
                )}
                <div className="flex-1 min-h-[280px] rounded-lg overflow-hidden w-full">
                    <ResponsiveContainer width="100%" height="100%" minHeight={280}>
                        <ComposedChart data={planChartData} margin={{ ...CHART_MARGIN, right: 24, left: 12, bottom: 8 }}>
                            <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                            <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                            <YAxis
                                tickFormatter={(v) => formatAxisNumber(Number(v))}
                                stroke={CHART_AXIS_COLOR}
                                fontSize={12}
                                tickLine={false}
                                width={52}
                                domain={['auto', 'auto']}
                            />
                            <Tooltip
                                formatter={(val: number) => formatCurrencyString(Number(val), { inCurrency: 'SAR', digits: 0 })}
                                contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px' }}
                            />
                            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="Expenses" fill={CHART_COLORS.negative} name="Planned expenses" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="ExpensesActual" fill="#fca5a5" name="Actual expenses" radius={[4, 4, 0, 0]} />
                            <Line type="monotone" dataKey="Income" stroke={CHART_COLORS.positive} strokeWidth={2} name="Planned income" dot={false} />
                            <Line type="monotone" dataKey="IncomeActual" stroke={CHART_COLORS.positive} strokeWidth={2} strokeDasharray="6 4" name="Actual income" dot={false} />
                            <Line type="monotone" dataKey="Net Savings" stroke={CHART_COLORS.primary} strokeWidth={2} name="Planned net" dot={false} />
                            <Line type="monotone" dataKey="Net actual" stroke="#6366f1" strokeWidth={2} strokeDasharray="6 4" name="Actual net" dot={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>
            
            {/* Plan vs actual summary */}
            {totals && (() => {
                const curY = new Date().getFullYear();
                const isFuture = year > curY;
                const isPast = year < curY;
                const an = isFuture ? null : isPast ? totals.actualNet : totals.ytdActualNet;
                const pn = isFuture ? null : isPast ? totals.projectedNet : totals.ytdProjectedNet;
                const pct =
                    pn != null && pn != 0 && an != null
                        ? ((an - pn) / Math.abs(pn)) * 100
                        : null;
                return (
                <div className="flex flex-wrap gap-4 p-3 bg-white rounded-lg shadow border border-gray-100">
                    <span className="font-medium text-dark">Plan vs actual ({isPast ? 'full year' : isFuture ? 'future' : 'YTD'}):</span>
                    <span className={(an ?? 0) >= (pn ?? 0) ? 'text-green-700' : 'text-amber-700'}>
                        {isFuture ? (
                            <span className="text-slate-600">Select the current or a past year to compare actuals.</span>
                        ) : (
                            <>
                                Planned net: {formatCurrencyString(pn ?? 0, { inCurrency: 'SAR', digits: 0 })} · Actual net:{' '}
                                {formatCurrencyString(an ?? 0, { inCurrency: 'SAR', digits: 0 })}
                                {pct != null && Number.isFinite(pct) && ` (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% vs plan)`}
                            </>
                        )}
                    </span>
                </div>
                );
            })()}

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
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
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
                        </div>
                 <p className="text-xs text-slate-500 mt-2">One-time scenarios belong in <strong>Forecast</strong>; this grid stays tied to your saved data only.</p>
            </div>

             <AIAdvisor
                pageContext="plan"
                contextData={{ totals, scenarios: { incomeShock, expenseStress }, householdEngine: householdBudgetEngine }}
                title="Plan AI Advisor"
                subtitle="Annual plan, surplus, and scenario context. After insights load, use English / العربية for Arabic."
                buttonLabel="Get AI Plan Insights"
            />

             <SinkingFunds />
            
            {/* Plan Grid: actuals from Transactions, planned from Budgets + recurring; investment from Investment Plan */}
            <div className="space-y-2">
                {incomePlannedHint && (
                    <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 leading-relaxed">{incomePlannedHint}</p>
                )}
                <p className="text-xs text-slate-500">
                    Grid (each month): <span className="text-gray-600">top</span> = actual (transactions &amp; investment buys, SAR eq.) · <span className="font-medium text-slate-700">bottom</span> = planned from Budgets, recurring rules, Investment Plan, and household profile. <span className="text-slate-600">You cannot type amounts here—edit source pages so the plan stays consistent everywhere.</span>
                </p>
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
                        {processedPlanData.filter((r: PlanRow) => r.type === 'income').map((row: PlanRow) => {
                             const totalPlanned = row.monthly_planned.reduce((a: number, b: number) => a + b, 0);
                             const totalActual = row.monthly_actual.reduce((a: number, b: number) => a + b, 0);
                             return (
                                <tr key={row.category}>
                                    <td className="sticky left-0 bg-white p-2 font-medium">{row.category}</td>
                                    {row.monthly_planned.map((plan: number, monthIndex: number) => {
                                        const isAffected = incomeShock.percent !== 0 && monthIndex >= incomeShock.startMonth - 1 && monthIndex < incomeShock.startMonth - 1 + incomeShock.duration;
                                        return (
                                            <td key={monthIndex} className="p-2 align-top">
                                                <div className="text-xs text-gray-500 tabular-nums leading-snug mb-0.5">Actual {formatCurrencyString(row.monthly_actual[monthIndex], { digits: 0 })}</div>
                                                <div className={`text-sm font-semibold tabular-nums p-1 rounded -mx-1 ${isAffected ? 'bg-blue-100' : ''}`} title="Edit via Budgets, Transactions (recurring), or household salary">
                                                    Planned {formatCurrencyString(plan, { digits: 0 })}
                                                </div>
                                            </td>
                                        )
                                    })}
                                    <td className="p-2 align-top font-bold">
                                        <div className="text-xs text-gray-500 tabular-nums font-normal mb-0.5">Actual {formatCurrencyString(totalActual, { digits: 0 })}</div>
                                        <div className="tabular-nums">Planned {formatCurrencyString(totalPlanned, { digits: 0 })}</div>
                                    </td>
                                </tr>
                             )
                        })}
                        {/* Expenses */}
                        <tr className="bg-red-50"><td colSpan={14} className="p-2 font-bold text-red-800">Expenses</td></tr>
                        {processedPlanData.filter((r: PlanRow) => r.type === 'expense').map((row: PlanRow) => {
                             const totalPlanned = row.monthly_planned.reduce((a: number, b: number) => a + b, 0);
                             const totalActual = row.monthly_actual.reduce((a: number, b: number) => a + b, 0);
                             const isAffected = expenseStress.percent !== 0 && (expenseStress.category === 'All' || expenseStress.category === row.category);
                             return (
                                <tr key={row.category}>
                                    <td className="sticky left-0 bg-white p-2 font-medium">{row.category}</td>
                                    {row.monthly_planned.map((plan: number, monthIndex: number) => (
                                        <td key={monthIndex} className="p-2 align-top">
                                            <div className="text-gray-500">{renderCell(row.monthly_actual[monthIndex], plan)}</div>
                                            <div className={`font-semibold tabular-nums p-1 rounded ${isAffected ? 'bg-orange-100' : ''}`} title="Edit via Budgets or Transactions (recurring)">
                                                {formatCurrencyString(plan, { digits: 0 })}
                                            </div>
                                        </td>
                                    ))}
                                     <td className="p-2 align-top font-bold"><div className="text-gray-500">{renderCell(totalActual, totalPlanned)}</div><div className="tabular-nums">{formatCurrencyString(totalPlanned, { digits: 0 })}</div></td>
                                </tr>
                             )
                        })}
                    </tbody>
                </table>
                </div>
            </div>
                </div>
            </div>
            )}
        </PageLayout>
    );
};

export default AnnualFinancialPlan;
