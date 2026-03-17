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

type ExpertParamKey = 'salary' | 'fixedExpenses' | 'currentSavings' | 'goal' | 'expenseBreakdown' | 'monthlyInvestment' | 'currentNetWorth' | 'debtList' | 'investmentAmountOrPct' | 'riskTolerance' | 'monthlyExpenses' | 'currentPortfolio' | 'currentExpenses';

const EXPERTS: { id: string; name: string; logic: string; run: (p: any) => Promise<string>; params: ExpertParamKey[] }[] = [
    { id: 'salary-allocation', name: 'Salary Allocation Expert', logic: 'Prioritize essentials → protect savings → enjoy responsibly → accelerate wealth', run: getSalaryAllocationExpert, params: ['salary', 'fixedExpenses', 'currentSavings', 'goal'] },
    { id: 'cash-flow', name: 'Cash Flow Analyst', logic: 'Track every riyal → find permanent structural improvements → raise savings rate without misery', run: getCashFlowAnalystExpert, params: ['salary', 'expenseBreakdown'] },
    { id: 'wealth-5y', name: '5-Year Wealth Growth Plan', logic: 'Realistic compounding → fixed monthly investment → milestone tracking → biggest lever identification', run: getWealth5YearExpert, params: ['salary', 'monthlyInvestment', 'currentNetWorth'] },
    { id: 'debt-elimination', name: 'Debt Elimination Strategy', logic: 'Minimize total interest + time → choose avalanche or snowball → exact payoff calendar', run: getDebtEliminationExpert, params: ['salary', 'debtList'] },
    { id: 'investment-automation', name: 'Salary → Investment Automation', logic: 'Pay yourself first → match risk to personality → simple & boring long-term vehicles', run: getInvestmentAutomationExpert, params: ['salary', 'investmentAmountOrPct', 'riskTolerance'] },
    { id: 'financial-independence', name: 'Financial Freedom / Independence Timeline', logic: 'Portfolio = expenses × 25–28.6 → project contributions + growth → acceleration levers', run: getFinancialIndependenceExpert, params: ['monthlyExpenses', 'currentPortfolio', 'monthlyInvestment'] },
    { id: 'lifestyle-upgrade', name: 'Lifestyle Upgrade Without Slowing Wealth', logic: 'Swap low-joy for high-joy spending → small cost increase, big happiness gain → wealth velocity stays high', run: getLifestyleUpgradeExpert, params: ['salary', 'currentExpenses'] },
];

const SalaryPlanningExperts: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { isAiAvailable } = useAI();
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [formValues, setFormValues] = useState<Record<string, string>>({} as Record<string, string>);
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [result, setResult] = useState<{ expertId: string; markdown: string } | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const suggestedSalary = React.useMemo(() => {
        const incomeByMonth = Array(12).fill(0);
        (data?.transactions ?? []).forEach((t: { date: string; type?: string; amount?: number }) => {
            const d = new Date(t.date);
            if (d.getFullYear() !== new Date().getFullYear() || (t as any).type !== 'income') return;
            incomeByMonth[d.getMonth()] += Math.max(0, Number((t as any).amount) || 0);
        });
        const withData = incomeByMonth.filter((v) => v > 0);
        return withData.length > 0 ? Math.round(withData.reduce((a, b) => a + b, 0) / withData.length) : 0;
    }, [data?.transactions]);

    const suggestedSavings = React.useMemo(() => {
        const cash = (data?.accounts ?? []).filter((a: { type?: string }) => a.type === 'Checking' || a.type === 'Savings').reduce((s: number, a: { balance?: number }) => s + Math.max(0, (a.balance ?? 0)), 0);
        return cash;
    }, [data?.accounts]);

    const suggestedNetWorth = React.useMemo(() => {
        const assets = (data?.assets ?? []).reduce((s: number, a: { value?: number }) => s + (a.value ?? 0), 0);
        const accounts = (data?.accounts ?? []).reduce((s: number, a: { balance?: number }) => s + (a.balance ?? 0), 0);
        const liabilities = (data?.liabilities ?? []).reduce((s: number, l: { amount?: number }) => s + Math.max(0, (l.amount ?? 0)), 0);
        const commodities = (data?.commodityHoldings ?? []).reduce((s: number, c: { currentValue?: number }) => s + (c.currentValue ?? 0), 0);
        return assets + accounts - liabilities + commodities;
    }, [data?.assets, data?.accounts, data?.liabilities, data?.commodityHoldings]);

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

        const transactions = (data?.transactions ?? []) as { date: string; type?: string; amount?: number; transactionNature?: string }[];
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const fixedExpenses = transactions.filter(
            (t) => t.type === 'expense' && (t as any).transactionNature === 'Fixed' && new Date(t.date) >= threeMonthsAgo
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
        const transactions = (data?.transactions ?? []) as { date: string; type?: string; amount?: number; category?: string; budgetCategory?: string }[];
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const expenses = transactions.filter((t) => t.type === 'expense' && new Date(t.date) >= sixMonthsAgo);
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
    }, [data?.budgets, data?.transactions]);

    // Monthly investment: from Investment Plan or from investment transactions (avg monthly buy)
    const { suggestedMonthlyInvestment, suggestedMonthlyInvestmentSource } = React.useMemo(() => {
        const plan = data?.investmentPlan as { monthlyBudget?: number } | undefined;
        if (plan?.monthlyBudget != null && Number(plan.monthlyBudget) > 0)
            return { suggestedMonthlyInvestment: Math.round(Number(plan.monthlyBudget)), suggestedMonthlyInvestmentSource: 'Investment Plan' };

        const txns = (data?.investmentTransactions ?? []) as { date: string; type?: string; total?: number; quantity?: number; price?: number }[];
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
        return { suggestedMonthlyInvestment: 0, suggestedMonthlyInvestmentSource: '' };
    }, [data?.investmentPlan, data?.investmentTransactions]);

    // Debt list: from Liabilities
    const { suggestedDebtList, suggestedDebtListSource } = React.useMemo(() => {
        const liabilities = (data?.liabilities ?? []) as { name?: string; amount?: number; type?: string; status?: string }[];
        const active = liabilities.filter((l) => (l.status || 'Active') === 'Active' && Number(l.amount) > 0);
        if (active.length === 0) return { suggestedDebtList: '', suggestedDebtListSource: '' };
        const lines = active.map((l) => `${l.name || l.type || 'Debt'}: ${Math.round(Number(l.amount) || 0)} SAR`).join('; ');
        return { suggestedDebtList: lines, suggestedDebtListSource: 'Liabilities' };
    }, [data?.liabilities]);

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
        const transactions = (data?.transactions ?? []) as { date: string; type?: string; amount?: number }[];
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const expenses = transactions.filter((t) => t.type === 'expense' && new Date(t.date) >= sixMonthsAgo);
        const total = expenses.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
        const months = new Set(expenses.map((t) => `${new Date(t.date).getFullYear()}-${new Date(t.date).getMonth()}`)).size;
        const avg = months > 0 ? Math.round(total / months) : 0;
        return {
            suggestedMonthlyExpenses: avg,
            suggestedCurrentExpenses: avg,
            suggestedCurrentExpensesSource: avg > 0 ? 'Transactions (avg/month)' : '',
        };
    }, [data?.transactions]);

    // Current portfolio / investable: same as net worth for this context
    const suggestedCurrentPortfolio = suggestedNetWorth;
    const suggestedCurrentPortfolioSource = (suggestedNetWorth > 0 ? 'Accounts + Assets + Investments − Liabilities' : '') as string;

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
        if (suggestedNetWorth !== 0) f.currentNetWorth = String(Math.round(suggestedNetWorth));
        if (suggestedFixedExpenses > 0) f.fixedExpenses = String(suggestedFixedExpenses);
        if (suggestedExpenseBreakdown) f.expenseBreakdown = suggestedExpenseBreakdown;
        if (suggestedMonthlyInvestment > 0) f.monthlyInvestment = String(suggestedMonthlyInvestment);
        if (suggestedDebtList) f.debtList = suggestedDebtList;
        if (suggestedGoal) f.goal = suggestedGoal;
        if (suggestedMonthlyExpenses > 0) {
            f.monthlyExpenses = String(suggestedMonthlyExpenses);
            f.currentExpenses = String(suggestedCurrentExpenses);
        }
        if (suggestedCurrentPortfolio > 0) f.currentPortfolio = String(Math.round(suggestedCurrentPortfolio));
        if (suggestedInvestmentAmountOrPct) f.investmentAmountOrPct = suggestedInvestmentAmountOrPct;
        return f;
    }, [suggestedSalary, suggestedSavings, suggestedNetWorth, suggestedFixedExpenses, suggestedExpenseBreakdown, suggestedMonthlyInvestment, suggestedDebtList, suggestedGoal, suggestedMonthlyExpenses, suggestedCurrentExpenses, suggestedCurrentPortfolio, suggestedInvestmentAmountOrPct]);

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
        if (key === 'currentNetWorth' && v === String(Math.round(suggestedNetWorth))) return 'From Assets & Accounts';
        if (key === 'fixedExpenses' && v === String(suggestedFixedExpenses)) return suggestedFixedExpensesSource ? `From ${suggestedFixedExpensesSource}` : '';
        if (key === 'expenseBreakdown' && suggestedExpenseBreakdown && v === suggestedExpenseBreakdown) return suggestedExpenseBreakdownSource ? `From ${suggestedExpenseBreakdownSource}` : '';
        if (key === 'monthlyInvestment' && v === String(suggestedMonthlyInvestment)) return suggestedMonthlyInvestmentSource ? `From ${suggestedMonthlyInvestmentSource}` : '';
        if (key === 'debtList' && v === suggestedDebtList) return suggestedDebtListSource ? `From ${suggestedDebtListSource}` : '';
        if (key === 'goal' && v === suggestedGoal) return suggestedGoalSource ? `From ${suggestedGoalSource}` : '';
        if ((key === 'monthlyExpenses' || key === 'currentExpenses') && v === String(suggestedMonthlyExpenses)) return suggestedCurrentExpensesSource ? `From ${suggestedCurrentExpensesSource}` : '';
        if (key === 'currentPortfolio' && v === String(Math.round(suggestedCurrentPortfolio))) return suggestedCurrentPortfolioSource ? `From ${suggestedCurrentPortfolioSource}` : '';
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
                return `My current monthly salary is ${sal()} SAR.\nI can realistically invest ${s('monthlyInvestment', suggestedMonthlyInvestment) || '[MONTHLY INVESTMENT AMOUNT]'} SAR every month starting now.\nMy current total net worth (savings + investments – debts) is ${s('currentNetWorth', Math.round(suggestedNetWorth)) || '[CURRENT NET WORTH]'} SAR.\n\nBuild me a realistic 5-year wealth growth plan.\nAssume conservative to moderate annual returns (6–10%).\nShow projected net worth at year 1, 3 and 5.\nHighlight the single change that would have the biggest impact on the final number.`;
            case 'debt-elimination':
                return `My monthly take-home salary is ${sal()} SAR.\nI currently have the following debts:\n${s('debtList', suggestedDebtList) || '[LIST EACH DEBT like: Credit card A: 24,000 SAR at 2.5% monthly; Personal loan: 48,000 SAR at 1.8% monthly; Car loan: 85,000 SAR at 0.9% monthly]'}.\n\nCalculate the fastest and cheapest way to become completely debt-free.\nShow month-by-month payoff timeline, total interest paid, and how much faster/cheaper it is compared to minimum payments only.\nRecommend avalanche vs snowball and why.`;
            case 'investment-automation':
                return `My monthly salary is ${sal()} SAR.\nI want to automatically invest ${s('investmentAmountOrPct', suggestedInvestmentAmountOrPct) || '[FIXED AMOUNT OR % e.g. 2000 SAR or 15%]'} every month.\nMy risk tolerance is ${s('riskTolerance', 'MEDIUM')}.\n\nDesign a simple, long-term investment system I can stick to for 10–30 years.\nSuggest asset allocation and specific investment types suitable for someone living in Saudi Arabia (Sukuk, local funds, global ETFs, etc.).\nExplain how to automate it and why this mix fits my risk level.`;
            case 'financial-independence':
                return `My current monthly expenses (lifestyle I want to maintain forever) are ${s('monthlyExpenses', suggestedMonthlyExpenses) || '[YOUR MONTHLY EXPENSES]'} SAR.\nMy current investable savings / portfolio is ${s('currentPortfolio', Math.round(suggestedCurrentPortfolio)) || '[CURRENT PORTFOLIO]'} SAR.\nI can invest ${s('monthlyInvestment', suggestedMonthlyInvestment) || '[MONTHLY INVESTMENT]'} SAR every month going forward.\n\nUsing a 3.5–4% safe withdrawal rate, tell me:\n1. How big my portfolio needs to be to reach financial independence.\n2. Realistic years until I get there (assume 7–9% average annual return).\n3. 3–4 specific changes that would shorten the timeline the most.`;
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
                        currentNetWorth: Number(formValues.currentNetWorth) || suggestedNetWorth || 0,
                    });
                    break;
                case 'debt-elimination':
                    text = await getDebtEliminationExpert({
                        salary: Number(formValues.salary) || suggestedSalary || 0,
                        debtList: formValues.debtList || suggestedDebtList || 'No debts listed. Example: Credit card A: 24,000 SAR at 2.5% monthly; Personal loan: 48,000 SAR at 1.8% monthly.',
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
                        currentPortfolio: Number(formValues.currentPortfolio) || suggestedNetWorth || 0,
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
                    const isExpanded = expandedId === expert.id;
                    return (
                        <div key={expert.id} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden hover:border-slate-300 transition-colors">
                            <button
                                type="button"
                                onClick={() => setExpandedId(isExpanded ? null : expert.id)}
                                className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-slate-50/80 transition-colors"
                            >
                                <div className="min-w-0">
                                    <span className="font-semibold text-slate-800">{expert.name}</span>
                                    <p className="text-xs text-slate-500 mt-1">{expert.logic}</p>
                                </div>
                                <ChevronDownIcon className={`h-5 w-5 text-slate-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                            {isExpanded && (
                                <div className="border-t border-slate-200 bg-slate-50/50 p-5 sm:p-6 space-y-5">
                                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Your inputs</p>
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
                                                    <InfoHint text="Pre-filled from Investment Plan or recent buy history when available." />
                                                </label>
                                                <input type="number" min={0} value={formValues.monthlyInvestment ?? ''} onChange={(e) => updateForm({ monthlyInvestment: e.target.value })} placeholder={suggestedMonthlyInvestment ? `From ${suggestedMonthlyInvestmentSource}: ${suggestedMonthlyInvestment}` : 'e.g. 2000'} className="input-base w-full rounded-lg border-slate-200" />
                                                {sourceLabel('monthlyInvestment', formValues.monthlyInvestment) && <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('monthlyInvestment', formValues.monthlyInvestment)}</p>}
                                            </div>
                                        )}
                                        {expert.params.includes('currentNetWorth') && (
                                            <div className="space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Current net worth (SAR)
                                                    <InfoHint text="Assets + accounts + investments − liabilities. Pre-filled from Assets, Accounts, Liabilities, Commodities when available." />
                                                </label>
                                                <input type="number" value={formValues.currentNetWorth ?? ''} onChange={(e) => updateForm({ currentNetWorth: e.target.value })} placeholder={suggestedNetWorth ? `From Assets & Accounts: ${Math.round(suggestedNetWorth)}` : 'e.g. 200000'} className="input-base w-full rounded-lg border-slate-200" />
                                                {sourceLabel('currentNetWorth', formValues.currentNetWorth) && <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('currentNetWorth', formValues.currentNetWorth)}</p>}
                                            </div>
                                        )}
                                        {expert.params.includes('debtList') && (
                                            <div className="sm:col-span-2 space-y-1">
                                                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    Debts (name, amount SAR, rate)
                                                    <InfoHint text="Pre-filled from Liabilities when available. Add rate manually if needed for payoff strategy." />
                                                </label>
                                                <textarea rows={4} value={formValues.debtList ?? ''} onChange={(e) => updateForm({ debtList: e.target.value })} placeholder={suggestedDebtList || 'Credit card A: 24000 SAR at 2.5% monthly; Personal loan: 48000 SAR'} className="input-base w-full rounded-lg border-slate-200" />
                                                {sourceLabel('debtList', formValues.debtList) && <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('debtList', formValues.debtList)}</p>}
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
                                                    <InfoHint text="Pre-filled from net worth (Accounts + Assets + Investments − Liabilities) when available." />
                                                </label>
                                                <input type="number" min={0} value={formValues.currentPortfolio ?? ''} onChange={(e) => updateForm({ currentPortfolio: e.target.value })} placeholder={suggestedCurrentPortfolio ? `From net worth: ${Math.round(suggestedCurrentPortfolio)}` : 'e.g. 150000'} className="input-base w-full rounded-lg border-slate-200" />
                                                {sourceLabel('currentPortfolio', formValues.currentPortfolio) && <p className="text-[11px] text-emerald-600 font-medium">{sourceLabel('currentPortfolio', formValues.currentPortfolio)}</p>}
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
                                                <InfoHint text="Allocation percentages (e.g. Essentials %, Savings %, Investment %) show how to split your salary. Amounts are in SAR. Use this as a guide; adjust to your situation. Not financial advice." />
                                            </h4>
                                            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                                                <div className="prose prose-sm max-w-none text-slate-800">
                                                    <SafeMarkdownRenderer content={result.markdown} />
                                                </div>
                                            </div>
                                            <div className="mt-4 pt-3 border-t border-slate-100">
                                                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Guide to allocation categories</p>
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
