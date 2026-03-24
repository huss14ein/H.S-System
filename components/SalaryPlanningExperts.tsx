import React, { useState, useContext } from 'react';
import SectionCard from './SectionCard';
import SafeMarkdownRenderer from './SafeMarkdownRenderer';
import InfoHint from './InfoHint';
import { SparklesIcon } from './icons/SparklesIcon';
import { DataContext } from '../context/DataContext';
import {
    getSalaryAllocationExpert,
    getCashFlowAnalystExpert,
    getWealth5YearExpert,
    getDebtEliminationExpert,
    getInvestmentAutomationExpert,
    getFinancialIndependenceExpert,
    getLifestyleUpgradeExpert,
    formatAiError,
} from '../services/geminiService';
import { useAI } from '../context/AiContext';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { DocumentDuplicateIcon } from './icons/DocumentDuplicateIcon';
import { CheckIcon } from './icons/CheckIcon';
import { countsAsExpenseForCashflowKpi } from '../services/transactionFilters';
import { lookupHintForTitle } from '../content/sectionInfoHints';
import { useCurrency } from '../context/CurrencyContext';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { computePersonalNetWorthSAR } from '../services/personalNetWorth';
import { useFormatCurrency } from '../hooks/useFormatCurrency';

const DEFAULT_EXPERT_RESULT_HINT =
    'Markdown from the AI for this expert. Review numbers and assumptions; tables are illustrative. Not financial advice.';
const SALARY_ALLOCATION_RESULT_HINT =
    'Allocation percentages (e.g. Essentials %, Savings %, Investment %) show how to split your salary. Amounts are in SAR. Use as a guide; adjust to your situation. Not financial advice.';

type ExpertParamKey =
    | 'salary'
    | 'fixedExpenses'
    | 'currentSavings'
    | 'goal'
    | 'expenseBreakdown'
    | 'monthlyInvestment'
    | 'currentNetWorth'
    | 'debtList'
    | 'receivableList'
    | 'investmentAmountOrPct'
    | 'riskTolerance'
    | 'monthlyExpenses'
    | 'currentPortfolio'
    | 'currentExpenses';

const EXPERTS: { id: string; name: string; logic: string; run: (p: any) => Promise<string>; params: ExpertParamKey[] }[] = [
    { id: 'salary-allocation', name: 'Salary Allocation Expert', logic: 'Prioritize essentials → protect savings → enjoy responsibly → accelerate wealth', run: getSalaryAllocationExpert, params: ['salary', 'fixedExpenses', 'currentSavings', 'goal'] },
    { id: 'cash-flow', name: 'Cash Flow Analyst', logic: 'Track every riyal → find permanent structural improvements → raise savings rate without misery', run: getCashFlowAnalystExpert, params: ['salary', 'expenseBreakdown'] },
    { id: 'wealth-5y', name: '5-Year Wealth Growth Plan', logic: 'Realistic compounding → fixed monthly investment → milestone tracking → biggest lever identification', run: getWealth5YearExpert, params: ['salary', 'monthlyInvestment', 'currentNetWorth'] },
    { id: 'debt-elimination', name: 'Debt Elimination Strategy', logic: 'Minimize total interest + time → choose avalanche or snowball → exact payoff calendar', run: getDebtEliminationExpert, params: ['salary', 'debtList', 'receivableList'] },
    { id: 'investment-automation', name: 'Salary → Investment Automation', logic: 'Pay yourself first → match risk to personality → simple & boring long-term vehicles', run: getInvestmentAutomationExpert, params: ['salary', 'investmentAmountOrPct', 'riskTolerance'] },
    { id: 'financial-independence', name: 'Financial Freedom / Independence Timeline', logic: 'Portfolio = expenses × 25–28.6 → project contributions + growth → acceleration levers', run: getFinancialIndependenceExpert, params: ['monthlyExpenses', 'currentPortfolio', 'monthlyInvestment'] },
    { id: 'lifestyle-upgrade', name: 'Lifestyle Upgrade Without Slowing Wealth', logic: 'Swap low-joy for high-joy spending → small cost increase, big happiness gain → wealth velocity stays high', run: getLifestyleUpgradeExpert, params: ['salary', 'currentExpenses'] },
];

function initialExpertsExpanded(): Record<string, boolean> {
    return Object.fromEntries(EXPERTS.map((e) => [e.id, true]));
}

const SalaryPlanningExperts: React.FC = () => {
    const { data, getAvailableCashForAccount } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const { isAiAvailable } = useAI();
    const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>(initialExpertsExpanded);
    const [formValues, setFormValues] = useState<Record<string, string>>({} as Record<string, string>);
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [result, setResult] = useState<{ expertId: string; markdown: string } | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const suggestedSalary = React.useMemo(() => {
        const transactions = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const incomeByMonth = Array(12).fill(0);
        transactions.forEach((t: { date: string; type?: string; amount?: number }) => {
            const d = new Date(t.date);
            if (d.getFullYear() !== new Date().getFullYear() || (t as any).type !== 'income') return;
            incomeByMonth[d.getMonth()] += Math.max(0, Number((t as any).amount) || 0);
        });
        const withData = incomeByMonth.filter((v) => v > 0);
        return withData.length > 0 ? Math.round(withData.reduce((a, b) => a + b, 0) / withData.length) : 0;
    }, [data?.transactions]);

    const suggestedSavings = React.useMemo(() => {
        const accounts = (data as any)?.personalAccounts ?? data?.accounts ?? [];
        const cash = accounts.filter((a: { type?: string }) => a.type === 'Checking' || a.type === 'Savings').reduce((s: number, a: { balance?: number }) => s + Math.max(0, (a.balance ?? 0)), 0);
        return cash;
    }, [data?.accounts, (data as any)?.personalAccounts]);

    /** Same formula as Summary / Dashboard (investments, brokerage cash, commodities, assets, liabilities). */
    const liveNetWorthSAR = React.useMemo(() => {
        const fx = resolveSarPerUsd(data, exchangeRate);
        return computePersonalNetWorthSAR(data ?? null, fx, { getAvailableCashForAccount });
    }, [data, exchangeRate, getAvailableCashForAccount]);

    // Fixed expenses: from Budgets (sum limits current month) or Transactions (fixed expenses, last 3 months avg)
    const { suggestedFixedExpenses, suggestedFixedExpensesSource } = React.useMemo(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const budgets = (data?.budgets ?? []) as { category?: string; limit?: number; month?: number; year?: number }[];
        const budgetSum = budgets
            .filter((b) => (b.year == null || b.year === year) && (b.month == null || b.month === month))
            .reduce((s, b) => s + Math.max(0, Number(b.limit) ?? 0), 0);
        if (budgetSum > 0) return { suggestedFixedExpenses: Math.round(budgetSum), suggestedFixedExpensesSource: 'Budgets' };

        const transactions = ((data as any)?.personalTransactions ?? data?.transactions ?? []) as { date: string; type?: string; amount?: number; transactionNature?: string }[];
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const fixedExpenses = transactions.filter(
            (t) => countsAsExpenseForCashflowKpi(t) && (t as any).transactionNature === 'Fixed' && new Date(t.date) >= threeMonthsAgo
        );
        const total = fixedExpenses.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
        const monthsWithData = new Set(fixedExpenses.map((t) => `${new Date(t.date).getFullYear()}-${new Date(t.date).getMonth()}`)).size;
        const avg = monthsWithData > 0 ? total / monthsWithData : 0;
        if (avg > 0) return { suggestedFixedExpenses: Math.round(avg), suggestedFixedExpensesSource: 'Transactions (fixed)' };
        return { suggestedFixedExpenses: 0, suggestedFixedExpensesSource: '' };
    }, [data?.budgets, data?.transactions]);

    // Expense breakdown: from Budgets (category: limit) or Transactions grouped by category
    const { suggestedExpenseBreakdown, suggestedExpenseBreakdownSource } = React.useMemo(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const budgets = (data?.budgets ?? []) as { category?: string; limit?: number; month?: number; year?: number }[];
        const forMonth = budgets.filter((b) => (b.year == null || b.year === year) && (b.month == null || b.month === month));
        if (forMonth.length > 0) {
            const lines = forMonth.map((b) => `${b.category || 'Other'}: ${Math.round(Number(b.limit) || 0)}`).join(', ');
            return { suggestedExpenseBreakdown: lines, suggestedExpenseBreakdownSource: 'Budgets' };
        }
        const transactions = ((data as any)?.personalTransactions ?? data?.transactions ?? []) as { date: string; type?: string; amount?: number; category?: string; budgetCategory?: string }[];
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const expenses = transactions.filter((t) => countsAsExpenseForCashflowKpi(t) && new Date(t.date) >= sixMonthsAgo);
        const byCategory = new Map<string, number>();
        expenses.forEach((t) => {
            const cat = (t.budgetCategory || t.category || 'Other').trim() || 'Other';
            const amt = Math.abs(Number(t.amount) || 0);
            byCategory.set(cat, (byCategory.get(cat) ?? 0) + amt);
        });
        if (byCategory.size > 0) {
            const months = 6;
            const lines = Array.from(byCategory.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([cat, total]) => `${cat}: ${Math.round(total / months)}`)
                .join(', ');
            return { suggestedExpenseBreakdown: lines, suggestedExpenseBreakdownSource: 'Transactions (avg/month)' };
        }
        return { suggestedExpenseBreakdown: '', suggestedExpenseBreakdownSource: '' };
    }, [data?.budgets, data?.transactions, (data as any)?.personalTransactions]);

    // Monthly investment: from Investment Plan or from investment transactions (avg monthly buy, personal accounts only)
    const { suggestedMonthlyInvestment, suggestedMonthlyInvestmentSource } = React.useMemo(() => {
        const plan = data?.investmentPlan as { monthlyBudget?: number } | undefined;
        if (plan?.monthlyBudget != null && Number(plan.monthlyBudget) > 0)
            return { suggestedMonthlyInvestment: Math.round(Number(plan.monthlyBudget)), suggestedMonthlyInvestmentSource: 'Investment Plan' };

        const personalAccountIds = new Set(((data as any)?.personalAccounts ?? data?.accounts ?? []).map((a: { id: string }) => a.id));
        const allTxns = (data?.investmentTransactions ?? []) as { date: string; type?: string; accountId?: string; total?: number; quantity?: number; price?: number }[];
        const txns = allTxns.filter((t) => personalAccountIds.has(t.accountId ?? ''));
        const buys = txns.filter((t) => t.type === 'buy');
        if (buys.length === 0) return { suggestedMonthlyInvestment: 0, suggestedMonthlyInvestmentSource: '' };
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const recent = buys.filter((t) => new Date(t.date) >= sixMonthsAgo);
        const total = recent.reduce((s, t) => {
            const rawTotal = t.total;
            const n = (rawTotal != null && Number.isFinite(Number(rawTotal)))
                ? Number(rawTotal)
                : (Number(t.quantity) || 0) * (Number(t.price) || 0);
            return s + Math.max(0, Number.isFinite(n) ? n : 0);
        }, 0);
        const byMonth = new Set(recent.map((t) => `${new Date(t.date).getFullYear()}-${new Date(t.date).getMonth()}`)).size;
        const avg = byMonth > 0 ? total / byMonth : 0;
        if (avg > 0) return { suggestedMonthlyInvestment: Math.round(avg), suggestedMonthlyInvestmentSource: 'Investment transactions' };
        if (suggestedSalary > 0) {
            const v = Math.max(500, Math.round(suggestedSalary * 0.1));
            return { suggestedMonthlyInvestment: v, suggestedMonthlyInvestmentSource: '10% of salary (suggested)' };
        }
        return { suggestedMonthlyInvestment: 0, suggestedMonthlyInvestmentSource: '' };
    }, [data?.investmentPlan, data?.investmentTransactions, data?.accounts, (data as any)?.personalAccounts, suggestedSalary]);

    /** Finova: amount < 0 = debt you owe; amount > 0 = receivable (owed to you). */
    const { suggestedDebtList, suggestedDebtListSource, suggestedReceivableList, suggestedReceivableListSource } = React.useMemo(() => {
        const liabilities = ((data as any)?.personalLiabilities ?? data?.liabilities ?? []) as {
            name?: string;
            amount?: number;
            type?: string;
            status?: string;
        }[];
        const active = liabilities.filter((l) => (l.status || 'Active') === 'Active');
        const debts = active.filter((l) => Number(l.amount) < 0);
        const receivables = active.filter((l) => Number(l.amount) > 0);
        const debtLines =
            debts.length === 0
                ? ''
                : debts.map((l) => `${l.name || l.type || 'Debt'}: ${Math.round(Math.abs(Number(l.amount) || 0))} SAR`).join('; ');
        const recvLines =
            receivables.length === 0
                ? ''
                : receivables.map((l) => `${l.name || l.type || 'Receivable'}: ${Math.round(Number(l.amount) || 0)} SAR`).join('; ');
        return {
            suggestedDebtList: debtLines,
            suggestedDebtListSource: 'Liabilities (debts you owe)',
            suggestedReceivableList: recvLines,
            suggestedReceivableListSource: 'Liabilities (owed to you)',
        };
    }, [data?.liabilities, (data as any)?.personalLiabilities]);

    // Primary goal: from Goals (first or highest priority)
    const { suggestedGoal, suggestedGoalSource } = React.useMemo(() => {
        const goals = (data?.goals ?? []) as { name?: string; targetAmount?: number; target_amount?: number; deadline?: string; targetDate?: string; priority?: string }[];
        const sorted = [...goals].filter((g) => g.name && (Number(g.targetAmount ?? (g as any).target_amount) || 0) > 0);
        if (sorted.length === 0) return { suggestedGoal: '', suggestedGoalSource: '' };
        const prioOrder = { High: 0, Medium: 1, Low: 2 };
        sorted.sort((a, b) => (prioOrder[(a.priority as keyof typeof prioOrder) ?? 'Medium'] ?? 1) - (prioOrder[(b.priority as keyof typeof prioOrder) ?? 'Medium'] ?? 1));
        const g = sorted[0];
        const target = Math.round(Number(g.targetAmount ?? (g as any).target_amount) ?? 0);
        const deadline = g.deadline || (g as any).targetDate || '';
        const text = `${g.name}${target ? `, ${target} SAR` : ''}${deadline ? ` by ${deadline}` : ''}`;
        return { suggestedGoal: text.trim(), suggestedGoalSource: 'Goals' };
    }, [data?.goals]);

    // Monthly / current expenses: from Transactions (expense total, last 6 months avg)
    const { suggestedMonthlyExpenses, suggestedCurrentExpenses, suggestedCurrentExpensesSource } = React.useMemo(() => {
        const transactions = ((data as any)?.personalTransactions ?? data?.transactions ?? []) as { date: string; type?: string; amount?: number }[];
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const expenses = transactions.filter((t) => countsAsExpenseForCashflowKpi(t) && new Date(t.date) >= sixMonthsAgo);
        const total = expenses.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
        const months = new Set(expenses.map((t) => `${new Date(t.date).getFullYear()}-${new Date(t.date).getMonth()}`)).size;
        const avg = months > 0 ? Math.round(total / months) : 0;
        return {
            suggestedMonthlyExpenses: avg,
            suggestedCurrentExpenses: avg,
            suggestedCurrentExpensesSource: avg > 0 ? 'Transactions (avg/month)' : '',
        };
    }, [data?.transactions, (data as any)?.personalTransactions]);

    const suggestedCurrentPortfolioSource = 'Live (same as Summary / Dashboard)';

    // Investment amount or %: from Investment Plan monthly budget and salary
    const { suggestedInvestmentAmountOrPct, suggestedInvestmentAmountOrPctSource } = React.useMemo(() => {
        const plan = data?.investmentPlan as { monthlyBudget?: number } | undefined;
        const sal = suggestedSalary || 0;
        if (plan?.monthlyBudget != null && Number(plan.monthlyBudget) > 0) {
            const amt = Math.round(Number(plan.monthlyBudget));
            if (sal > 0) {
                const pct = Math.round((amt / sal) * 100);
                return { suggestedInvestmentAmountOrPct: `${amt} SAR (${pct}%)`, suggestedInvestmentAmountOrPctSource: 'Investment Plan' };
            }
            return { suggestedInvestmentAmountOrPct: `${amt} SAR`, suggestedInvestmentAmountOrPctSource: 'Investment Plan' };
        }
        return { suggestedInvestmentAmountOrPct: '', suggestedInvestmentAmountOrPctSource: '' };
    }, [data?.investmentPlan, suggestedSalary]);

    const suggestedFormValues = React.useMemo(() => {
        const f: Record<string, string> = {};
        if (suggestedSalary > 0) f.salary = String(suggestedSalary);
        if (suggestedSavings > 0) f.currentSavings = String(Math.round(suggestedSavings));
        if (suggestedFixedExpenses > 0) f.fixedExpenses = String(suggestedFixedExpenses);
        if (suggestedExpenseBreakdown) f.expenseBreakdown = suggestedExpenseBreakdown;
        if (suggestedMonthlyInvestment > 0) f.monthlyInvestment = String(suggestedMonthlyInvestment);
        if (suggestedDebtList) f.debtList = suggestedDebtList;
        if (suggestedReceivableList) f.receivableList = suggestedReceivableList;
        if (suggestedGoal) f.goal = suggestedGoal;
        if (suggestedMonthlyExpenses > 0) {
            f.monthlyExpenses = String(suggestedMonthlyExpenses);
            f.currentExpenses = String(suggestedCurrentExpenses);
        }
        if (suggestedInvestmentAmountOrPct) f.investmentAmountOrPct = suggestedInvestmentAmountOrPct;
        return f;
    }, [suggestedSalary, suggestedSavings, suggestedFixedExpenses, suggestedExpenseBreakdown, suggestedMonthlyInvestment, suggestedDebtList, suggestedReceivableList, suggestedGoal, suggestedMonthlyExpenses, suggestedCurrentExpenses, suggestedInvestmentAmountOrPct]);

    React.useEffect(() => {
        setFormValues((prev) => {
            const next = { ...prev };
            Object.keys(suggestedFormValues).forEach((k) => {
                const current = next[k];
                const suggested = suggestedFormValues[k];
                if (suggested != null && suggested !== '' && (current === undefined || current === '')) {
                    next[k] = suggested;
                }
            });
            return next;
        });
    }, [suggestedFormValues]);

    const updateForm = (updates: Record<string, string>): void => setFormValues((prev: Record<string, string>) => ({ ...prev, ...updates }));

    const sourceLabel = (key: string, value: string | undefined): string => {
        const v = (value ?? '').trim();
        if (!v) return '';
        if (key === 'salary' && v === String(suggestedSalary)) return 'From Transactions';
        if (key === 'currentSavings' && v === String(Math.round(suggestedSavings))) return 'From Accounts';
        if (key === 'fixedExpenses' && v === String(suggestedFixedExpenses)) return suggestedFixedExpensesSource ? `From ${suggestedFixedExpensesSource}` : '';
        if (key === 'expenseBreakdown' && suggestedExpenseBreakdown && v === suggestedExpenseBreakdown) return suggestedExpenseBreakdownSource ? `From ${suggestedExpenseBreakdownSource}` : '';
        if (key === 'monthlyInvestment' && v === String(suggestedMonthlyInvestment))
            return suggestedMonthlyInvestmentSource ? `From ${suggestedMonthlyInvestmentSource}` : '';
        if (key === 'debtList' && v === suggestedDebtList) return suggestedDebtListSource ? `From ${suggestedDebtListSource}` : '';
        if (key === 'receivableList' && v === suggestedReceivableList) return suggestedReceivableListSource ? `From ${suggestedReceivableListSource}` : '';
        if (key === 'goal' && v === suggestedGoal) return suggestedGoalSource ? `From ${suggestedGoalSource}` : '';
        if ((key === 'monthlyExpenses' || key === 'currentExpenses') && v === String(suggestedMonthlyExpenses)) return suggestedCurrentExpensesSource ? `From ${suggestedCurrentExpensesSource}` : '';
        if (key === 'investmentAmountOrPct' && v === suggestedInvestmentAmountOrPct) return suggestedInvestmentAmountOrPctSource ? `From ${suggestedInvestmentAmountOrPctSource}` : '';
        return '';
    };

    const buildPromptText = (expert: typeof EXPERTS[0]): string => {
        const s = (k: string, suggested: string | number = '') => String(formValues[k] ?? suggested ?? '').trim();
        const sal = () => String(formValues.salary || suggestedSalary || '');
        switch (expert.id) {
            case 'salary-allocation':
                return `Act as my personal finance expert.\nMy monthly salary is ${sal()} SAR.\nMy fixed monthly expenses are ${s('fixedExpenses', suggestedFixedExpenses) || '[YOUR FIXED EXPENSES]'} SAR.\nMy current savings / emergency fund is ${s('currentSavings', Math.round(suggestedSavings)) || '[CURRENT SAVINGS]'} SAR.\nMy main financial goal right now is ${s('goal', suggestedGoal) || '[YOUR GOAL e.g. buy apartment in 4 years, reach 1M SAR net worth]'}.\n\nCreate a smart monthly salary allocation plan that balances spending, saving, investing and debt payoff (if any). Show exact amounts and percentages for each category.`;
            case 'cash-flow':
                return `My monthly take-home salary is ${sal()} SAR.\nHere is my current monthly expense breakdown: ${s('expenseBreakdown', suggestedExpenseBreakdown) || '[PASTE YOUR EXPENSE LIST e.g. Rent 3500, groceries 1800, fuel 600, dining out 1200, subscriptions 400, etc.]'}.\n\nAnalyze my cash flow.\nCalculate my current savings rate.\nShow me exactly where my money is leaking.\nPropose a restructured spending plan that permanently increases my savings rate by at least 10–20% without making life feel worse.`;
            case 'wealth-5y':
                return `My current monthly salary is ${sal()} SAR.\nI can realistically invest ${s('monthlyInvestment', suggestedMonthlyInvestment) || '[MONTHLY INVESTMENT AMOUNT]'} SAR every month starting now.\nMy current total net worth (savings + investments – debts) is ${Math.round(liveNetWorthSAR)} SAR (from Finova live data).\n\nBuild me a realistic 5-year wealth growth plan.\nAssume conservative to moderate annual returns (6–10%).\nShow projected net worth at year 1, 3 and 5.\nHighlight the single change that would have the biggest impact on the final number.`;
            case 'debt-elimination':
                return `My monthly take-home salary is ${sal()} SAR.\n\nDEBTS I OWE (pay down only):\n${s('debtList', suggestedDebtList) || '[LIST EACH DEBT YOU OWE e.g. Credit card A: 24,000 SAR at 2.5% monthly; Personal loan: 48,000 SAR]'}\n\nAMOUNTS OWED TO ME (receivables — not debts; context only):\n${s('receivableList', suggestedReceivableList) || '[Optional — e.g. personal loan you gave to someone]'}\n\nCalculate the fastest and cheapest way to become debt-free for amounts I owe. Do not treat receivables as debt to pay off.\nShow month-by-month payoff timeline, total interest paid, and how much faster/cheaper it is compared to minimum payments only.\nRecommend avalanche vs snowball and why.`;
            case 'investment-automation':
                return `My monthly salary is ${sal()} SAR.\nI want to automatically invest ${s('investmentAmountOrPct', suggestedInvestmentAmountOrPct) || '[FIXED AMOUNT OR % e.g. 2000 SAR or 15%]'} every month.\nMy risk tolerance is ${s('riskTolerance', 'MEDIUM')}.\n\nDesign a simple, long-term investment system I can stick to for 10–30 years.\nSuggest asset allocation and specific investment types suitable for someone living in Saudi Arabia (Sukuk, local funds, global ETFs, etc.).\nExplain how to automate it and why this mix fits my risk level.`;
            case 'financial-independence':
                return `My current monthly expenses (lifestyle I want to maintain forever) are ${s('monthlyExpenses', suggestedMonthlyExpenses) || '[YOUR MONTHLY EXPENSES]'} SAR.\nMy current investable savings / portfolio is ${Math.round(liveNetWorthSAR)} SAR (from Finova live net worth).\nI can invest ${s('monthlyInvestment', suggestedMonthlyInvestment) || '[MONTHLY INVESTMENT]'} SAR every month going forward.\n\nUsing a 3.5–4% safe withdrawal rate, tell me:\n1. How big my portfolio needs to be to reach financial independence.\n2. Realistic years until I get there (assume 7–9% average annual return).\n3. 3–4 specific changes that would shorten the timeline the most.`;
            case 'lifestyle-upgrade':
                return `My current monthly take-home salary is ${sal()} SAR.\nMy current monthly expenses are roughly ${s('currentExpenses', suggestedCurrentExpenses) || '[CURRENT EXPENSES]'} SAR.\nI want to noticeably improve my daily quality of life but I refuse to slow down my wealth building speed.\n\nPropose specific upgrades and changes that:\n- Feel significantly better day-to-day\n- Keep my savings & investment rate the same or higher\n- Come mostly from cutting low-value spending and replacing it with high-value spending\nGive exact example swaps and new monthly budget if possible.`;
            default:
                return '';
        }
    };

    const handleCopyPrompt = (expert: typeof EXPERTS[0]) => {
        const text = buildPromptText(expert);
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            setCopiedId(expert.id);
            setTimeout(() => setCopiedId(null), 2000);
        }).catch(() => {});
    };

    const handleRun = async (expert: typeof EXPERTS[0]) => {
        if (!isAiAvailable) {
            setResult({ expertId: expert.id, markdown: formatAiError(new Error('AI is not available. Configure your API key in settings.')) });
            return;
        }
        setLoadingId(expert.id);
        setResult(null);
        try {
            let text = '';
            switch (expert.id) {
                case 'salary-allocation':
                    text = await getSalaryAllocationExpert({
                        salary: Number(formValues.salary) || suggestedSalary || 0,
                        fixedExpenses: Number(formValues.fixedExpenses) || suggestedFixedExpenses || 0,
                        currentSavings: Number(formValues.currentSavings) || suggestedSavings || 0,
                        goal: formValues.goal || suggestedGoal || 'Build wealth and security',
                    });
                    break;
                case 'cash-flow':
                    text = await getCashFlowAnalystExpert({
                        salary: Number(formValues.salary) || suggestedSalary || 0,
                        expenseBreakdown: formValues.expenseBreakdown || suggestedExpenseBreakdown || 'No breakdown provided yet. Add items like: Rent 3500, groceries 1800, fuel 600, dining 1200, subscriptions 400 (SAR).',
                    });
                    break;
                case 'wealth-5y':
                    text = await getWealth5YearExpert({
                        salary: Number(formValues.salary) || suggestedSalary || 0,
                        monthlyInvestment: Number(formValues.monthlyInvestment) || suggestedMonthlyInvestment || 0,
                        currentNetWorth: liveNetWorthSAR,
                    });
                    break;
                case 'debt-elimination':
                    text = await getDebtEliminationExpert({
                        salary: Number(formValues.salary) || suggestedSalary || 0,
                        debtList:
                            formValues.debtList ||
                            suggestedDebtList ||
                            'No debts listed (amounts you owe). Example: Credit card A: 24,000 SAR at 2.5% monthly; Personal loan: 48,000 SAR.',
                        receivablesContext: formValues.receivableList || suggestedReceivableList || '',
                    });
                    break;
                case 'investment-automation':
                    text = await getInvestmentAutomationExpert({
                        salary: Number(formValues.salary) || suggestedSalary || 0,
                        investmentAmountOrPct: formValues.investmentAmountOrPct || suggestedInvestmentAmountOrPct || '2000 SAR or 15%',
                        riskTolerance: formValues.riskTolerance || 'MEDIUM',
                    });
                    break;
                case 'financial-independence':
                    text = await getFinancialIndependenceExpert({
                        monthlyExpenses: Number(formValues.monthlyExpenses) || suggestedMonthlyExpenses || 0,
                        currentPortfolio: liveNetWorthSAR,
                        monthlyInvestment: Number(formValues.monthlyInvestment) || suggestedMonthlyInvestment || 0,
                    });
                    break;
                case 'lifestyle-upgrade':
                    text = await getLifestyleUpgradeExpert({
                        salary: Number(formValues.salary) || suggestedSalary || 0,
                        currentExpenses: Number(formValues.currentExpenses) || suggestedCurrentExpenses || 0,
                    });
                    break;
                default:
                    text = 'Unknown expert.';
            }
            setResult({ expertId: expert.id, markdown: text || 'No response from AI.' });
        } catch (err) {
            setResult({ expertId: expert.id, markdown: formatAiError(err) });
        }
        setLoadingId(null);
    };

    return (
        <SectionCard title="Salary & Planning Experts" className="overflow-visible">
            <p className="text-sm text-slate-600 mb-6 max-w-2xl">
                Choose an expert, fill in your numbers (SAR), and run AI-powered plans. Logic and prompts are aligned with essentials-first, savings protection, and long-term wealth.
            </p>
            {!isAiAvailable && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 mb-6">
                    AI is disabled. Configure your API key in Settings to use these experts.
                </div>
            )}
            <div className="space-y-3">
                {EXPERTS.map((expert) => {
                    const isExpanded = expandedIds[expert.id] !== false;
                    const expertTitleHint = lookupHintForTitle(expert.name);
                    return (
                        <div key={expert.id} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-visible hover:border-slate-300 transition-colors">
                            <div className="flex items-start justify-between gap-3 p-4 hover:bg-slate-50/80 transition-colors">
                                <button
                                    type="button"
                                    onClick={() => setExpandedIds((prev) => ({ ...prev, [expert.id]: !isExpanded }))}
                                    className="min-w-0 flex-1 text-left"
                                >
                                    <span className="font-semibold text-slate-800 block">{expert.name}</span>
                                    <p className="text-xs text-slate-500 mt-1">{expert.logic}</p>
                                </button>
                                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                                    {expertTitleHint ? <InfoHint text={expertTitleHint} popoverAlign="right" /> : null}
                                    <button
                                        type="button"
                                        onClick={() => setExpandedIds((prev) => ({ ...prev, [expert.id]: !isExpanded }))}
                                        className="p-1 rounded text-slate-400 hover:text-slate-600"
                                        aria-expanded={isExpanded}
                                        aria-label={isExpanded ? 'Collapse expert' : 'Expand expert'}
                                    >
                                        <ChevronDownIcon className={`h-5 w-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                </div>
                            </div>
                            {isExpanded && (
                                <div className="border-t border-slate-200 bg-slate-50/50 p-5 sm:p-6 space-y-5">
                                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex flex-wrap items-center gap-1">
                                        Your inputs
                                        <InfoHint text="Prefilled from Finova when possible (green “From …” tags). Edit any field before Run analysis; the AI uses exactly what you see here." />
                                    </p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {expert.params.includes('salary') && (
                                            <div className="space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Monthly salary (SAR)
                                                    <InfoHint text="Your take-home monthly salary in SAR. Pre-filled from Transactions (income) when available." />
                                                </label>
                                                <input type="number" min={0} value={formValues.salary ?? ''} onChange={(e) => updateForm({ salary: e.target.value })} placeholder={suggestedSalary ? `From Transactions: ${suggestedSalary}` : 'e.g. 15000'} className="input-base w-full rounded-lg border-slate-200" />
                                                {sourceLabel('salary', formValues.salary) && <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('salary', formValues.salary)}</p>}
                                            </div>
                                        )}
                                        {expert.params.includes('fixedExpenses') && (
                                            <div className="space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Fixed monthly expenses (SAR)
                                                    <InfoHint text="Rent, utilities, insurance, subscriptions. Pre-filled from Budgets or Transactions (fixed) when available." />
                                                </label>
                                                <input type="number" min={0} value={formValues.fixedExpenses ?? ''} onChange={(e) => updateForm({ fixedExpenses: e.target.value })} placeholder={suggestedFixedExpenses ? `From ${suggestedFixedExpensesSource}: ${suggestedFixedExpenses}` : 'e.g. 8000'} className="input-base w-full rounded-lg border-slate-200" />
                                                {sourceLabel('fixedExpenses', formValues.fixedExpenses) && <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('fixedExpenses', formValues.fixedExpenses)}</p>}
                                            </div>
                                        )}
                                        {expert.params.includes('currentSavings') && (
                                            <div className="space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Current savings / emergency fund (SAR)
                                                    <InfoHint text="Total liquid savings. Pre-filled from Accounts (Checking + Savings) when available." />
                                                </label>
                                                <input type="number" min={0} value={formValues.currentSavings ?? ''} onChange={(e) => updateForm({ currentSavings: e.target.value })} placeholder={suggestedSavings ? `From Accounts: ${Math.round(suggestedSavings)}` : 'e.g. 50000'} className="input-base w-full rounded-lg border-slate-200" />
                                                {sourceLabel('currentSavings', formValues.currentSavings) && <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('currentSavings', formValues.currentSavings)}</p>}
                                            </div>
                                        )}
                                        {expert.params.includes('goal') && (
                                            <div className="sm:col-span-2 space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Main financial goal
                                                    <InfoHint text="Primary goal. Pre-filled from Goals when available." />
                                                </label>
                                                <input type="text" value={formValues.goal ?? ''} onChange={(e) => updateForm({ goal: e.target.value })} placeholder={suggestedGoal || 'e.g. buy apartment in 4 years, reach 1M SAR net worth'} className="input-base w-full rounded-lg border-slate-200" />
                                                {sourceLabel('goal', formValues.goal) && <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('goal', formValues.goal)}</p>}
                                            </div>
                                        )}
                                        {expert.params.includes('expenseBreakdown') && (
                                            <div className="sm:col-span-2 space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Monthly expense breakdown (SAR)
                                                    <InfoHint text="Category: amount. Pre-filled from Budgets or Transactions by category when available." />
                                                </label>
                                                <textarea rows={3} value={formValues.expenseBreakdown ?? ''} onChange={(e) => updateForm({ expenseBreakdown: e.target.value })} placeholder={suggestedExpenseBreakdown || 'e.g. Rent 3500, groceries 1800, fuel 600, dining 1200'} className="input-base w-full rounded-lg border-slate-200" />
                                                {sourceLabel('expenseBreakdown', formValues.expenseBreakdown) && <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('expenseBreakdown', formValues.expenseBreakdown)}</p>}
                                            </div>
                                        )}
                                        {expert.params.includes('monthlyInvestment') && (
                                            <div className="space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Monthly investment (SAR)
                                                    <InfoHint text="Pre-filled from Investment Plan, recent buys, or ~10% of detected salary when no plan/history — edit anytime." />
                                                </label>
                                                <input type="number" min={0} value={formValues.monthlyInvestment ?? ''} onChange={(e) => updateForm({ monthlyInvestment: e.target.value })} placeholder={suggestedMonthlyInvestment ? `From ${suggestedMonthlyInvestmentSource}: ${suggestedMonthlyInvestment}` : 'e.g. 2000'} className="input-base w-full rounded-lg border-slate-200" />
                                                {sourceLabel('monthlyInvestment', formValues.monthlyInvestment) && <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('monthlyInvestment', formValues.monthlyInvestment)}</p>}
                                            </div>
                                        )}
                                        {expert.params.includes('currentNetWorth') && (
                                            <div className="space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Current net worth (SAR)
                                                    <InfoHint text="Always pulled from your live Finova data — same formula as Summary / Dashboard (cash, investments, assets, commodities, brokerage cash, minus debt, plus receivables). Not editable here." />
                                                </label>
                                                <div className="input-base w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900 tabular-nums font-medium">
                                                    {formatCurrencyString(Math.round(liveNetWorthSAR))}
                                                </div>
                                                <p className="text-[11px] text-emerald-600 font-medium">{suggestedCurrentPortfolioSource}</p>
                                            </div>
                                        )}
                                        {expert.params.includes('debtList') && (
                                            <div className="sm:col-span-2 space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Debts you owe (name, amount SAR, rate if known)
                                                    <InfoHint text="Money you must repay. In Finova these are liabilities with a negative balance. Receivables (money owed to you) go in the field below — not here." />
                                                </label>
                                                <textarea
                                                    rows={3}
                                                    value={formValues.debtList ?? ''}
                                                    onChange={(e) => updateForm({ debtList: e.target.value })}
                                                    placeholder={suggestedDebtList || 'Credit card A: 24000 SAR at 2.5% monthly; Personal loan: 48000 SAR'}
                                                    className="input-base w-full rounded-lg border-slate-200"
                                                />
                                                {sourceLabel('debtList', formValues.debtList) && (
                                                    <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('debtList', formValues.debtList)}</p>
                                                )}
                                            </div>
                                        )}
                                        {expert.params.includes('receivableList') && (
                                            <div className="sm:col-span-2 space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Money owed to you — receivables (optional, context only)
                                                    <InfoHint text="Amounts others owe you (positive liability balance or “Money Owed to Me” on the Liabilities page). The AI uses this only as context — it is not a debt to pay off." />
                                                </label>
                                                <textarea
                                                    rows={3}
                                                    value={formValues.receivableList ?? ''}
                                                    onChange={(e) => updateForm({ receivableList: e.target.value })}
                                                    placeholder={suggestedReceivableList || 'e.g. Mohammed Othman: 1800 SAR (they owe you)'}
                                                    className="input-base w-full rounded-lg border-slate-200"
                                                />
                                                {sourceLabel('receivableList', formValues.receivableList) && (
                                                    <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('receivableList', formValues.receivableList)}</p>
                                                )}
                                            </div>
                                        )}
                                        {expert.params.includes('investmentAmountOrPct') && (
                                            <div className="space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Monthly investment (amount or %)
                                                    <InfoHint text="Pre-filled from Investment Plan when available (amount and % of salary)." />
                                                </label>
                                                <input type="text" value={formValues.investmentAmountOrPct ?? ''} onChange={(e) => updateForm({ investmentAmountOrPct: e.target.value })} placeholder={suggestedInvestmentAmountOrPct || 'e.g. 2000 SAR or 15%'} className="input-base w-full rounded-lg border-slate-200" />
                                                {sourceLabel('investmentAmountOrPct', formValues.investmentAmountOrPct) && <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('investmentAmountOrPct', formValues.investmentAmountOrPct)}</p>}
                                            </div>
                                        )}
                                        {expert.params.includes('riskTolerance') && (
                                            <div className="space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Risk tolerance
                                                    <InfoHint text="Low: prefer stability (e.g. Sukuk, deposits). Medium: balanced mix. High: more equity for long-term growth. Affects suggested asset allocation." />
                                                </label>
                                                <select value={formValues.riskTolerance ?? 'MEDIUM'} onChange={(e) => updateForm({ riskTolerance: e.target.value })} className="select-base w-full rounded-lg border-slate-200">
                                                    <option value="LOW">Low</option>
                                                    <option value="MEDIUM">Medium</option>
                                                    <option value="HIGH">High</option>
                                                </select>
                                            </div>
                                        )}
                                        {expert.params.includes('monthlyExpenses') && (
                                            <div className="space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Monthly expenses to maintain (SAR)
                                                    <InfoHint text="Lifestyle spending to sustain in retirement. Pre-filled from Transactions (avg/month) when available." />
                                                </label>
                                                <input type="number" min={0} value={formValues.monthlyExpenses ?? ''} onChange={(e) => updateForm({ monthlyExpenses: e.target.value })} placeholder={suggestedMonthlyExpenses ? `From Transactions: ${suggestedMonthlyExpenses}` : 'e.g. 12000'} className="input-base w-full rounded-lg border-slate-200" />
                                                {sourceLabel('monthlyExpenses', formValues.monthlyExpenses) && <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('monthlyExpenses', formValues.monthlyExpenses)}</p>}
                                            </div>
                                        )}
                                        {expert.params.includes('currentPortfolio') && (
                                            <div className="space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Current portfolio / investable savings (SAR)
                                                    <InfoHint text="Uses your live Finova net worth (same as Summary / Dashboard), not a separate manual entry." />
                                                </label>
                                                <div className="input-base w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900 tabular-nums font-medium">
                                                    {formatCurrencyString(Math.round(liveNetWorthSAR))}
                                                </div>
                                                <p className="text-[11px] text-emerald-600 font-medium">{suggestedCurrentPortfolioSource}</p>
                                            </div>
                                        )}
                                        {expert.params.includes('currentExpenses') && (
                                            <div className="space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Current monthly expenses (SAR)
                                                    <InfoHint text="Total monthly spending. Pre-filled from Transactions (avg/month) when available." />
                                                </label>
                                                <input type="number" min={0} value={formValues.currentExpenses ?? ''} onChange={(e) => updateForm({ currentExpenses: e.target.value })} placeholder={suggestedCurrentExpenses ? `From Transactions: ${suggestedCurrentExpenses}` : 'e.g. 10000'} className="input-base w-full rounded-lg border-slate-200" />
                                                {sourceLabel('currentExpenses', formValues.currentExpenses) && <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('currentExpenses', formValues.currentExpenses)}</p>}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3 pt-1">
                                        <button
                                            type="button"
                                            disabled={!isAiAvailable || loadingId === expert.id}
                                            onClick={() => handleRun(expert)}
                                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                                        >
                                            {loadingId === expert.id ? <SparklesIcon className="h-4 w-4 animate-pulse" /> : <SparklesIcon className="h-4 w-4" />}
                                            {loadingId === expert.id ? 'Running…' : 'Run analysis'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleCopyPrompt(expert)}
                                            className="inline-flex items-center gap-2 px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 shadow-sm"
                                            title="Copy prompt to clipboard (use in any AI chat)"
                                        >
                                            {copiedId === expert.id ? <CheckIcon className="h-4 w-4 text-emerald-600" /> : <DocumentDuplicateIcon className="h-4 w-4" />}
                                            {copiedId === expert.id ? 'Copied!' : 'Copy prompt'}
                                        </button>
                                    </div>
                                    {result?.expertId === expert.id && (
                                        <div className="mt-6 pt-5 border-t border-slate-200">
                                            <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800 mb-2">
                                                Result
                                                <InfoHint
                                                    text={
                                                        expert.id === 'salary-allocation'
                                                            ? SALARY_ALLOCATION_RESULT_HINT
                                                            : DEFAULT_EXPERT_RESULT_HINT
                                                    }
                                                />
                                            </h4>
                                            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                                                <div className="prose prose-sm max-w-none text-slate-800">
                                                    <SafeMarkdownRenderer content={result.markdown} />
                                                </div>
                                            </div>
                                            {expert.id === 'salary-allocation' && (
                                                <div className="mt-4 pt-3 border-t border-slate-100">
                                                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2 flex flex-wrap items-center gap-1">
                                                        Guide to allocation categories
                                                        <InfoHint text="These labels often appear in Salary Allocation results. Other experts use different headings—read the markdown above for their definitions." />
                                                    </p>
                                                    <ul className="text-xs text-slate-600 space-y-1.5">
                                                        <li className="flex items-center gap-2">
                                                            <span className="font-medium text-slate-700">Essentials %</span>
                                                            <InfoHint text="Rent, utilities, insurance, groceries, debt payments—must-pay items. Keep this sustainable so you can stick to the plan." />
                                                        </li>
                                                        <li className="flex items-center gap-2">
                                                            <span className="font-medium text-slate-700">Savings %</span>
                                                            <InfoHint text="Emergency fund and short-term goals. Build 3–6 months of expenses first, then allocate to specific goals." />
                                                        </li>
                                                        <li className="flex items-center gap-2">
                                                            <span className="font-medium text-slate-700">Investment %</span>
                                                            <InfoHint text="Long-term wealth (e.g. index funds, retirement). Pay yourself first; automate this amount each month." />
                                                        </li>
                                                        <li className="flex items-center gap-2">
                                                            <span className="font-medium text-slate-700">Discretionary %</span>
                                                            <InfoHint text="Flexible spending—dining, hobbies, travel. Enjoy responsibly without compromising essentials or savings targets." />
                                                        </li>
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </SectionCard>
    );
};

export default SalaryPlanningExperts;
