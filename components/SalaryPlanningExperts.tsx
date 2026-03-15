import React, { useState, useContext } from 'react';
import SectionCard from './SectionCard';
import SafeMarkdownRenderer from './SafeMarkdownRenderer';
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

    const updateForm = (updates: Record<string, string>): void => setFormValues((prev: Record<string, string>) => ({ ...prev, ...updates }));

    const buildPromptText = (expert: typeof EXPERTS[0]): string => {
        const s = (k: string) => String(formValues[k] ?? '');
        const sal = () => String(formValues.salary || suggestedSalary || '');
        switch (expert.id) {
            case 'salary-allocation':
                return `Act as my personal finance expert.\nMy monthly salary is ${sal()} SAR.\nMy fixed monthly expenses are ${s('fixedExpenses') || '[YOUR FIXED EXPENSES]'} SAR.\nMy current savings / emergency fund is ${s('currentSavings') || suggestedSavings || '[CURRENT SAVINGS]'} SAR.\nMy main financial goal right now is ${s('goal') || '[YOUR GOAL e.g. buy apartment in 4 years, reach 1M SAR net worth]'}.\n\nCreate a smart monthly salary allocation plan that balances spending, saving, investing and debt payoff (if any). Show exact amounts and percentages for each category.`;
            case 'cash-flow':
                return `My monthly take-home salary is ${sal()} SAR.\nHere is my current monthly expense breakdown: ${s('expenseBreakdown') || '[PASTE YOUR EXPENSE LIST e.g. Rent 3500, groceries 1800, fuel 600, dining out 1200, subscriptions 400, etc.]'}.\n\nAnalyze my cash flow.\nCalculate my current savings rate.\nShow me exactly where my money is leaking.\nPropose a restructured spending plan that permanently increases my savings rate by at least 10–20% without making life feel worse.`;
            case 'wealth-5y':
                return `My current monthly salary is ${sal()} SAR.\nI can realistically invest ${s('monthlyInvestment') || '[MONTHLY INVESTMENT AMOUNT]'} SAR every month starting now.\nMy current total net worth (savings + investments – debts) is ${s('currentNetWorth') || suggestedNetWorth || '[CURRENT NET WORTH]'} SAR.\n\nBuild me a realistic 5-year wealth growth plan.\nAssume conservative to moderate annual returns (6–10%).\nShow projected net worth at year 1, 3 and 5.\nHighlight the single change that would have the biggest impact on the final number.`;
            case 'debt-elimination':
                return `My monthly take-home salary is ${sal()} SAR.\nI currently have the following debts:\n${s('debtList') || '[LIST EACH DEBT like: Credit card A: 24,000 SAR at 2.5% monthly; Personal loan: 48,000 SAR at 1.8% monthly; Car loan: 85,000 SAR at 0.9% monthly]'}.\n\nCalculate the fastest and cheapest way to become completely debt-free.\nShow month-by-month payoff timeline, total interest paid, and how much faster/cheaper it is compared to minimum payments only.\nRecommend avalanche vs snowball and why.`;
            case 'investment-automation':
                return `My monthly salary is ${sal()} SAR.\nI want to automatically invest ${s('investmentAmountOrPct') || '[FIXED AMOUNT OR % e.g. 2000 SAR or 15%]'} every month.\nMy risk tolerance is ${s('riskTolerance') || 'MEDIUM'}.\n\nDesign a simple, long-term investment system I can stick to for 10–30 years.\nSuggest asset allocation and specific investment types suitable for someone living in Saudi Arabia (Sukuk, local funds, global ETFs, etc.).\nExplain how to automate it and why this mix fits my risk level.`;
            case 'financial-independence':
                return `My current monthly expenses (lifestyle I want to maintain forever) are ${s('monthlyExpenses') || '[YOUR MONTHLY EXPENSES]'} SAR.\nMy current investable savings / portfolio is ${s('currentPortfolio') || suggestedNetWorth || '[CURRENT PORTFOLIO]'} SAR.\nI can invest ${s('monthlyInvestment') || '[MONTHLY INVESTMENT]'} SAR every month going forward.\n\nUsing a 3.5–4% safe withdrawal rate, tell me:\n1. How big my portfolio needs to be to reach financial independence.\n2. Realistic years until I get there (assume 7–9% average annual return).\n3. 3–4 specific changes that would shorten the timeline the most.`;
            case 'lifestyle-upgrade':
                return `My current monthly take-home salary is ${sal()} SAR.\nMy current monthly expenses are roughly ${s('currentExpenses') || '[CURRENT EXPENSES]'} SAR.\nI want to noticeably improve my daily quality of life but I refuse to slow down my wealth building speed.\n\nPropose specific upgrades and changes that:\n- Feel significantly better day-to-day\n- Keep my savings & investment rate the same or higher\n- Come mostly from cutting low-value spending and replacing it with high-value spending\nGive exact example swaps and new monthly budget if possible.`;
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
                        fixedExpenses: Number(formValues.fixedExpenses) || 0,
                        currentSavings: Number(formValues.currentSavings) || suggestedSavings || 0,
                        goal: formValues.goal || 'Build wealth and security',
                    });
                    break;
                case 'cash-flow':
                    text = await getCashFlowAnalystExpert({
                        salary: Number(formValues.salary) || suggestedSalary || 0,
                        expenseBreakdown: formValues.expenseBreakdown || 'No breakdown provided yet. Add items like: Rent 3500, groceries 1800, fuel 600, dining 1200, subscriptions 400 (SAR).',
                    });
                    break;
                case 'wealth-5y':
                    text = await getWealth5YearExpert({
                        salary: Number(formValues.salary) || suggestedSalary || 0,
                        monthlyInvestment: Number(formValues.monthlyInvestment) || 0,
                        currentNetWorth: Number(formValues.currentNetWorth) || suggestedNetWorth || 0,
                    });
                    break;
                case 'debt-elimination':
                    text = await getDebtEliminationExpert({
                        salary: Number(formValues.salary) || suggestedSalary || 0,
                        debtList: formValues.debtList || 'No debts listed. Example: Credit card A: 24,000 SAR at 2.5% monthly; Personal loan: 48,000 SAR at 1.8% monthly.',
                    });
                    break;
                case 'investment-automation':
                    text = await getInvestmentAutomationExpert({
                        salary: Number(formValues.salary) || suggestedSalary || 0,
                        investmentAmountOrPct: formValues.investmentAmountOrPct || '2000 SAR or 15%',
                        riskTolerance: formValues.riskTolerance || 'MEDIUM',
                    });
                    break;
                case 'financial-independence':
                    text = await getFinancialIndependenceExpert({
                        monthlyExpenses: Number(formValues.monthlyExpenses) || 0,
                        currentPortfolio: Number(formValues.currentPortfolio) || suggestedNetWorth || 0,
                        monthlyInvestment: Number(formValues.monthlyInvestment) || 0,
                    });
                    break;
                case 'lifestyle-upgrade':
                    text = await getLifestyleUpgradeExpert({
                        salary: Number(formValues.salary) || suggestedSalary || 0,
                        currentExpenses: Number(formValues.currentExpenses) || 0,
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
            <p className="text-sm text-slate-600 mb-4">
                Choose an expert, fill in your numbers (SAR), and run AI-powered plans. Logic and prompts are aligned with essentials-first, savings protection, and long-term wealth.
            </p>
            {!isAiAvailable && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 mb-4">
                    AI is disabled. Configure your API key in Settings to use these experts.
                </div>
            )}
            <div className="space-y-2">
                {EXPERTS.map((expert) => {
                    const isExpanded = expandedId === expert.id;
                    return (
                        <div key={expert.id} className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setExpandedId(isExpanded ? null : expert.id)}
                                className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-slate-100/80 transition-colors"
                            >
                                <div>
                                    <span className="font-semibold text-slate-800">{expert.name}</span>
                                    <p className="text-xs text-slate-500 mt-0.5">{expert.logic}</p>
                                </div>
                                <ChevronDownIcon className={`h-5 w-5 text-slate-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                            {isExpanded && (
                                <div className="border-t border-slate-200 bg-white p-4 space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {expert.params.includes('salary') && (
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Monthly salary (SAR)</label>
                                                <input type="number" min={0} value={formValues.salary ?? (suggestedSalary || '')} onChange={(e) => updateForm({ salary: e.target.value })} placeholder={String(suggestedSalary || '')} className="input-base w-full" />
                                            </div>
                                        )}
                                        {expert.params.includes('fixedExpenses') && (
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Fixed monthly expenses (SAR)</label>
                                                <input type="number" min={0} value={formValues.fixedExpenses ?? ''} onChange={(e) => updateForm({ fixedExpenses: e.target.value })} placeholder="e.g. 8000" className="input-base w-full" />
                                            </div>
                                        )}
                                        {expert.params.includes('currentSavings') && (
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Current savings / emergency fund (SAR)</label>
                                                <input type="number" min={0} value={formValues.currentSavings ?? (suggestedSavings || '')} onChange={(e) => updateForm({ currentSavings: e.target.value })} placeholder={String(suggestedSavings || '')} className="input-base w-full" />
                                            </div>
                                        )}
                                        {expert.params.includes('goal') && (
                                            <div className="sm:col-span-2">
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Main financial goal</label>
                                                <input type="text" value={formValues.goal ?? ''} onChange={(e) => updateForm({ goal: e.target.value })} placeholder="e.g. buy apartment in 4 years, reach 1M SAR net worth" className="input-base w-full" />
                                            </div>
                                        )}
                                        {expert.params.includes('expenseBreakdown') && (
                                            <div className="sm:col-span-2">
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Monthly expense breakdown (SAR)</label>
                                                <textarea rows={3} value={formValues.expenseBreakdown ?? ''} onChange={(e) => updateForm({ expenseBreakdown: e.target.value })} placeholder="e.g. Rent 3500, groceries 1800, fuel 600, dining 1200, subscriptions 400" className="input-base w-full" />
                                            </div>
                                        )}
                                        {expert.params.includes('monthlyInvestment') && (
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Monthly investment (SAR)</label>
                                                <input type="number" min={0} value={formValues.monthlyInvestment ?? ''} onChange={(e) => updateForm({ monthlyInvestment: e.target.value })} placeholder="e.g. 2000" className="input-base w-full" />
                                            </div>
                                        )}
                                        {expert.params.includes('currentNetWorth') && (
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Current net worth (SAR)</label>
                                                <input type="number" value={formValues.currentNetWorth ?? (suggestedNetWorth || '')} onChange={(e) => updateForm({ currentNetWorth: e.target.value })} placeholder={String(suggestedNetWorth || '')} className="input-base w-full" />
                                            </div>
                                        )}
                                        {expert.params.includes('debtList') && (
                                            <div className="sm:col-span-2">
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Debts (one per line: name, amount SAR, rate)</label>
                                                <textarea rows={4} value={formValues.debtList ?? ''} onChange={(e) => updateForm({ debtList: e.target.value })} placeholder="Credit card A: 24000 SAR at 2.5% monthly; Personal loan: 48000 SAR at 1.8% monthly; Car loan: 85000 SAR at 0.9% monthly" className="input-base w-full" />
                                            </div>
                                        )}
                                        {expert.params.includes('investmentAmountOrPct') && (
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Monthly investment (amount or %)</label>
                                                <input type="text" value={formValues.investmentAmountOrPct ?? ''} onChange={(e) => updateForm({ investmentAmountOrPct: e.target.value })} placeholder="e.g. 2000 SAR or 15%" className="input-base w-full" />
                                            </div>
                                        )}
                                        {expert.params.includes('riskTolerance') && (
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Risk tolerance</label>
                                                <select value={formValues.riskTolerance ?? 'MEDIUM'} onChange={(e) => updateForm({ riskTolerance: e.target.value })} className="select-base w-full">
                                                    <option value="LOW">Low</option>
                                                    <option value="MEDIUM">Medium</option>
                                                    <option value="HIGH">High</option>
                                                </select>
                                            </div>
                                        )}
                                        {expert.params.includes('monthlyExpenses') && (
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Monthly expenses to maintain (SAR)</label>
                                                <input type="number" min={0} value={formValues.monthlyExpenses ?? ''} onChange={(e) => updateForm({ monthlyExpenses: e.target.value })} placeholder="e.g. 12000" className="input-base w-full" />
                                            </div>
                                        )}
                                        {expert.params.includes('currentPortfolio') && (
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Current portfolio / investable savings (SAR)</label>
                                                <input type="number" min={0} value={formValues.currentPortfolio ?? (suggestedNetWorth || '')} onChange={(e) => updateForm({ currentPortfolio: e.target.value })} placeholder={String(suggestedNetWorth || '')} className="input-base w-full" />
                                            </div>
                                        )}
                                        {expert.params.includes('currentExpenses') && (
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Current monthly expenses (SAR)</label>
                                                <input type="number" min={0} value={formValues.currentExpenses ?? ''} onChange={(e) => updateForm({ currentExpenses: e.target.value })} placeholder="e.g. 10000" className="input-base w-full" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            disabled={!isAiAvailable || loadingId === expert.id}
                                            onClick={() => handleRun(expert)}
                                            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {loadingId === expert.id ? <SparklesIcon className="h-4 w-4 animate-pulse" /> : <SparklesIcon className="h-4 w-4" />}
                                            {loadingId === expert.id ? 'Running…' : 'Run analysis'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleCopyPrompt(expert)}
                                            className="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50"
                                            title="Copy prompt to clipboard (use in any AI chat)"
                                        >
                                            {copiedId === expert.id ? <CheckIcon className="h-4 w-4 text-emerald-600" /> : <DocumentDuplicateIcon className="h-4 w-4" />}
                                            {copiedId === expert.id ? 'Copied!' : 'Copy prompt'}
                                        </button>
                                    </div>
                                    {result?.expertId === expert.id && (
                                        <div className="mt-4 pt-4 border-t border-slate-200">
                                            <h4 className="text-sm font-semibold text-slate-800 mb-2">Result</h4>
                                            <div className="prose prose-sm max-w-none rounded-lg bg-slate-50 p-4 text-slate-800">
                                                <SafeMarkdownRenderer content={result.markdown} />
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
