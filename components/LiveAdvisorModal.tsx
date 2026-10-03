import React, { useState, useRef, useContext, useCallback, useEffect, useMemo } from 'react';
import Modal from './Modal';
import type { FunctionDeclaration, Content, Part, FunctionCall } from '@google/genai';
import { SchemaType } from '../services/geminiSchemaTypes';
import { DataContext } from '../context/DataContext';
import { useCanonicalFinancialMetrics, useCanonicalSimulatedPrices } from '../hooks/useCanonicalFinancialMetrics';
import { formatGoalsProgressForPrompt } from '../services/goalResolvedTotals';
import { buildAiPersonalWealthGrounding } from '../services/aiPersonalWealthGrounding';
import { computeCapitalDeployment } from '../services/capitalDeploymentOrchestrator';
import { getPersonalLiabilities, getPersonalTransactions } from '../utils/wealthScope';
import { invokeAI, formatAiError, buildLiveAdvisorSystemInstruction } from '../services/geminiService';
import { useAI } from '../context/AiContext';
import AiProxyUnavailableHint from './AiProxyUnavailableHint';
import { countsAsExpenseForCashflowKpi } from '../services/transactionFilters';
import { financialMonthRange, resolveMonthStartDayFromData, dateInRange } from '../utils/financialMonth';
import { HeadsetIcon } from './icons/HeadsetIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { SendIcon } from './icons/SendIcon';
import SafeMarkdownRenderer from './SafeMarkdownRenderer';
import {
    buildRuleBasedActionCards,
    formatInsightWithActionCards,
    splitInsightAndActionCards,
    type AiActionCard,
} from '../services/aiActionCards';
import { buildZakatTradeAdvice } from '../services/zakatTradeAdvisor';
import AiActionCardsPanel from './AiActionCardsPanel';

const ADVISOR_LANG_KEY = 'finova_default_ai_lang_v1';
const HISTORY_STORAGE_KEY = 'finova_live_advisor_history_v1';
const HISTORY_MAX_TURNS = 20;

const SUGGESTED_PROMPTS = [
    'Where should next salary go?',
    'Am I over-concentrated?',
    'What to cut this month?',
    'Recovery vs new buy?',
    'Am I on track for goals?',
    'Zakat due soon?',
] as const;

type StoredTurn = { role: 'user' | 'model'; text: string };

function loadPersistedHistory(): Content[] {
    try {
        if (typeof localStorage === 'undefined') return [];
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as StoredTurn[];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((t) => t && (t.role === 'user' || t.role === 'model') && typeof t.text === 'string' && t.text.trim())
            .slice(-HISTORY_MAX_TURNS)
            .map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
    } catch {
        return [];
    }
}

function persistHistory(history: Content[]): void {
    try {
        if (typeof localStorage === 'undefined') return;
        const turns: StoredTurn[] = [];
        for (const msg of history) {
            if (msg.role !== 'user' && msg.role !== 'model') continue;
            const text = (msg.parts ?? [])
                .map((p) => ('text' in p && typeof p.text === 'string' ? p.text : ''))
                .filter(Boolean)
                .join('\n')
                .trim();
            if (!text) continue;
            turns.push({ role: msg.role as 'user' | 'model', text });
        }
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(turns.slice(-HISTORY_MAX_TURNS)));
    } catch {
        /* ignore */
    }
}

function messageActionCards(text: string): { markdown: string; cards: AiActionCard[] } {
    const split = splitInsightAndActionCards(text);
    return { markdown: split.markdown || text, cards: split.actionCards };
}

const LiveAdvisorModal: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
    const { data, addWatchlistItem, getAvailableCashForAccount } = useContext(DataContext)!;
    const { aiActionsEnabled, aiHealthChecked, isAiAvailable } = useAI();
    const simulatedPrices = useCanonicalSimulatedPrices();
    const { netWorth: headlineNetWorthSar, liquidCashSar: headlineLiquidCashSar, kpiSnapshot, sarPerUsd } =
        useCanonicalFinancialMetrics();
    const [history, setHistory] = useState<Content[]>([]);
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [view, setView] = useState<'welcome' | 'chat'>('welcome');
    const [historyHydrated, setHistoryHydrated] = useState(false);
    const [replyLang, setReplyLang] = useState<'en' | 'ar'>(() => {
        try {
            return typeof localStorage !== 'undefined' && localStorage.getItem(ADVISOR_LANG_KEY) === 'ar' ? 'ar' : 'en';
        } catch {
            return 'en';
        }
    });
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const systemInstruction = useMemo(
        () => buildLiveAdvisorSystemInstruction(replyLang === 'ar' ? 'ar' : 'en'),
        [replyLang],
    );

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(scrollToBottom, [history]);

    useEffect(() => {
        if (!isOpen) {
            setHistoryHydrated(false);
            return;
        }
        const restored = loadPersistedHistory();
        if (restored.length > 0) {
            setHistory(restored);
            setView('chat');
        }
        setHistoryHydrated(true);
    }, [isOpen]);

    useEffect(() => {
        if (!historyHydrated || !isOpen) return;
        persistHistory(history);
    }, [history, historyHydrated, isOpen]);

    useEffect(() => {
        if (isOpen && view === 'chat' && history.length === 0 && historyHydrated) {
            const welcome =
                replyLang === 'ar'
                    ? 'مرحباً! أنا **Finova AI**، مستشارك المالي. يمكنني المساعدة في صافي الثروة، الميزانيات، الاستثمارات، الأهداف، والمعاملات الأخيرة. ما الذي تريد الاطلاع عليه؟'
                    : "Hello! I'm **Finova AI**, your expert financial and investment advisor. I can help with net worth, budgets, investments, goals, and recent transactions. What would you like to look at?";
            setHistory([{ role: 'model', parts: [{ text: welcome }] }]);
        }
    }, [isOpen, view, history, replyLang, historyHydrated]);

    const wealthGroundingRef = useMemo(
        () =>
            buildAiPersonalWealthGrounding({
                data,
                exchangeRate: sarPerUsd,
                getAvailableCashForAccount,
                simulatedPrices,
            }),
        [data, sarPerUsd, getAvailableCashForAccount, simulatedPrices],
    );

    const getNetWorth_ = useCallback(() => {
        return {
            netWorthSar: headlineNetWorthSar,
            liquidCashSar: headlineLiquidCashSar || wealthGroundingRef.liquidCashSar,
            monthlyPnLSar: kpiSnapshot?.monthlyPnL ?? wealthGroundingRef.monthlyPnLSar,
            financialMonth: wealthGroundingRef.financialMonthLabel,
        };
    }, [headlineNetWorthSar, headlineLiquidCashSar, kpiSnapshot?.monthlyPnL, wealthGroundingRef]);

    const getGoalsProgress_ = useCallback(() => {
        return {
            summary: formatGoalsProgressForPrompt(data, sarPerUsd) || 'No goals configured.',
        };
    }, [data, sarPerUsd]);

    const getTopHoldings_ = useCallback(() => {
        return { holdings: wealthGroundingRef.topHoldingsLines };
    }, [wealthGroundingRef]);

    const getBudgetStatus_ = useCallback(({ category }: { category: string }) => {
        const budget = (data?.budgets ?? []).find(b => b.category.toLowerCase() === category.toLowerCase());
        if (!budget) return { error: `Budget category "${category}" not found.` };
        const monthlyLimit = budget.period === 'yearly' ? budget.limit / 12 : budget.period === 'weekly' ? budget.limit * (52 / 12) : budget.period === 'daily' ? budget.limit * (365 / 12) : budget.limit;
        const now = new Date();
        const monthStartDay = resolveMonthStartDayFromData(data);
        const { start: firstDayOfMonth, end: lastDayOfMonth } = financialMonthRange(now, monthStartDay);
        const transactions = getPersonalTransactions(data);
        const spent = transactions
            .filter((t: { type?: string; date: string; budgetCategory?: string; category?: string }) =>
                countsAsExpenseForCashflowKpi(t) &&
                dateInRange(t.date, firstDayOfMonth, lastDayOfMonth) &&
                t.budgetCategory === budget.category,
            )
            .reduce((sum: number, t: { amount?: number }) => sum + Math.abs(t.amount ?? 0), 0);
        return { limit: monthlyLimit, spent, remaining: monthlyLimit - spent };
    }, [data]);

    const getRecentTransactions_ = useCallback(({ limit }: { limit: number }) => {
        const transactions = getPersonalTransactions(data);
        const sortedTransactions = [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return {
            transactions: sortedTransactions.slice(0, limit).map((t: { description?: string; amount?: number; date?: string; budgetCategory?: string; category?: string; type?: string }) => ({
                date: t.date?.slice(0, 10),
                description: t.description,
                amount: t.amount,
                category: t.budgetCategory || t.category,
                type: t.type,
            })),
        };
    }, [data]);

    const getLiabilitiesSummary_ = useCallback(() => {
        const liabs = getPersonalLiabilities(data);
        const active = liabs.filter((l) => (l.status ?? 'Active') === 'Active');
        const total = active.reduce((s, l) => s + Math.abs(Number(l.amount) || 0), 0);
        return {
            count: active.length,
            totalDebtSar: Math.round(total),
            top: active.slice(0, 5).map((l) => `${l.name} (${l.type}): ${Math.round(Math.abs(l.amount))} SAR`),
        };
    }, [data]);

    const getCapitalDeployment_ = useCallback(() => {
        const cap = computeCapitalDeployment(data, sarPerUsd, getAvailableCashForAccount, 0, 6);
        return {
            canInvest: cap.canInvest,
            runwayMonths: cap.runwayMonths,
            reasons: cap.reasons,
        };
    }, [data, sarPerUsd, getAvailableCashForAccount]);

    const getInvestmentRoi_ = useCallback(() => {
        return {
            roiPct: wealthGroundingRef.roiPct,
            netInvestedSar: wealthGroundingRef.netInvestedSar,
            presentValueSar: wealthGroundingRef.presentValueSar,
            principalFullyRecovered: wealthGroundingRef.principalFullyRecovered,
        };
    }, [wealthGroundingRef]);

    const getAllocation_ = useCallback(() => {
        return {
            topHoldingsLines: wealthGroundingRef.topHoldingsLines,
            topConcentrationPct: wealthGroundingRef.topConcentrationPct,
        };
    }, [wealthGroundingRef]);

    const getLiquidityRunway_ = useCallback(() => {
        return {
            emergencyFundMonths: wealthGroundingRef.emergencyFundMonths,
            liquidCashSar: wealthGroundingRef.liquidCashSar,
            investableCashSar: wealthGroundingRef.investableCashSar,
        };
    }, [wealthGroundingRef]);

    const getBudgetPressure_ = useCallback(() => {
        return { overspentBudgetLines: wealthGroundingRef.overspentBudgetLines };
    }, [wealthGroundingRef]);

    const getRebalanceDrift_ = useCallback(() => {
        return {
            suggestion: 'Open AI Rebalancer to review allocation drift and propose educational rebalance steps.',
            topConcentrationPct: wealthGroundingRef.topConcentrationPct,
            topHoldingsLines: wealthGroundingRef.topHoldingsLines,
            ctaHint: { page: 'AI Rebalancer', label: 'Open Rebalancer' },
        };
    }, [wealthGroundingRef]);

    const getRecoveryCandidates_ = useCallback(() => {
        return {
            platformsDailyPnLSar: wealthGroundingRef.platformsDailyPnLSar,
            note: 'Open Recovery Plan to review drawdowns and recovery parameters before adding risk.',
            ctaHint: { page: 'Recovery Plan', action: 'investment-tab:Recovery Plan', label: 'Open Recovery' },
        };
    }, [wealthGroundingRef]);

    const getDividendOutlook_ = useCallback(() => {
        return { dividendRunRateSar: wealthGroundingRef.dividendRunRateSar };
    }, [wealthGroundingRef]);

    const getZakatSnapshot_ = useCallback(() => {
        const zakat = buildZakatTradeAdvice(data, wealthGroundingRef.sarPerUsd);
        return {
            suggestionCount: zakat.suggestions.length,
            suggestions: zakat.suggestions.slice(0, 5).map((s) => ({
                symbol: s.symbol,
                reason: s.reason,
                impactDescription: s.impactDescription,
            })),
        };
    }, [data, wealthGroundingRef.sarPerUsd]);

    const proposeTrade_ = useCallback(({ symbol, tradeType, rationale }: { symbol: string; tradeType: string; rationale: string }) => {
        const sym = String(symbol || '').trim().toUpperCase();
        const side = String(tradeType || 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
        const card: AiActionCard = {
            id: `propose-trade-${sym}-${side}`,
            kind: 'trade',
            severity: 'info',
            title: `${side === 'sell' ? 'Sell' : 'Buy'} ${sym || 'position'}`,
            rationale: String(rationale || '').trim() || `Consider a ${side} for ${sym || 'this symbol'} via Record Trade.`,
            cta: {
                page: 'Investments',
                action: 'open-trade-modal',
                label: 'Open Record Trade',
                payload: { symbol: sym, tradeType: side, reason: rationale },
            },
        };
        return { actionCard: card };
    }, []);

    const proposeBudgetMove_ = useCallback(({ category, rationale }: { category: string; rationale: string }) => {
        const cat = String(category || '').trim() || 'Budget';
        const card: AiActionCard = {
            id: `propose-budget-${cat.slice(0, 32)}`,
            kind: 'budget',
            severity: 'watch',
            title: `Adjust ${cat}`,
            rationale: String(rationale || '').trim() || `Review or reallocate ${cat} in Budgets.`,
            cta: {
                page: 'Budgets',
                action: `budgets-advance-from-next-month:${encodeURIComponent(cat)}`,
                label: 'Open Budgets',
            },
        };
        return { actionCard: card };
    }, []);

    const proposeGoalFunding_ = useCallback(({ goalName, rationale }: { goalName: string; rationale: string }) => {
        const name = String(goalName || '').trim();
        const match = (data?.goals ?? []).find((g) => g.name?.toLowerCase() === name.toLowerCase());
        const card: AiActionCard = {
            id: `propose-goal-${(match?.id || name || 'goal').slice(0, 32)}`,
            kind: 'goal',
            severity: 'info',
            title: match ? `Fund ${match.name}` : name ? `Fund ${name}` : 'Review Goals',
            rationale: String(rationale || '').trim() || 'Re-prioritize goal funding from surplus cash.',
            cta: match
                ? { page: 'Goals', action: `focus-goal:${match.id}`, label: 'Focus goal' }
                : { page: 'Goals', label: 'Open Goals' },
        };
        return { actionCard: card };
    }, [data?.goals]);

    const proposeDebtPaydown_ = useCallback(({ name, rationale }: { name: string; rationale: string }) => {
        const debtName = String(name || '').trim() || 'Debt';
        const card: AiActionCard = {
            id: `propose-debt-${debtName.slice(0, 32)}`,
            kind: 'debt',
            severity: 'watch',
            title: `Pay down ${debtName}`,
            rationale: String(rationale || '').trim() || `Review payoff plan for ${debtName}.`,
            cta: { page: 'Liabilities', label: 'Open Liabilities' },
        };
        return { actionCard: card };
    }, []);

    const handleAddWatchlistItem_ = useCallback(async ({ symbol, name }: { symbol: string, name: string }) => {
        if (!symbol || !name) return { success: false, error: 'Symbol and name are required.' };
        try {
            await addWatchlistItem({ symbol, name });
            return { success: true, message: `Successfully added ${name} to the watchlist.` };
        } catch (e) {
            console.error('Error adding to watchlist via AI:', e);
            return { success: false, error: `Failed to add ${name} to watchlist.` };
        }
    }, [addWatchlistItem]);

    const functionDeclarations: FunctionDeclaration[] = [
        { name: 'getNetWorth', description: 'Headline net worth and financial-month P&L (SAR).', parameters: { type: SchemaType.OBJECT, properties: {} } },
        { name: 'getGoalsProgress', description: 'Goal progress using resolved linked wealth.', parameters: { type: SchemaType.OBJECT, properties: {} } },
        { name: 'getTopHoldings', description: 'Top personal holdings by app valuation (SAR).', parameters: { type: SchemaType.OBJECT, properties: {} } },
        { name: 'getBudgetStatus', parameters: { type: SchemaType.OBJECT, properties: { category: { type: SchemaType.STRING } }, required: ['category'] } },
        { name: 'getRecentTransactions', parameters: { type: SchemaType.OBJECT, properties: { limit: { type: SchemaType.NUMBER } }, required: ['limit'] } },
        { name: 'addWatchlistItem', description: "Adds a stock to the user's watchlist.", parameters: { type: SchemaType.OBJECT, properties: { symbol: { type: SchemaType.STRING, description: 'The stock ticker symbol, e.g., MSFT or 2222.SR' }, name: { type: SchemaType.STRING, description: 'The full name of the company, e.g., Microsoft Corp.' } }, required: ['symbol', 'name'] } },
        { name: 'getLiabilitiesSummary', description: 'Active liabilities total and top lines (SAR).', parameters: { type: SchemaType.OBJECT, properties: {} } },
        { name: 'getCapitalDeployment', description: 'Whether new investment is allowed and runway context.', parameters: { type: SchemaType.OBJECT, properties: {} } },
        { name: 'getInvestmentRoi', description: 'Investment ROI %, net invested, and present value (SAR) from Finova ground truth.', parameters: { type: SchemaType.OBJECT, properties: {} } },
        { name: 'getAllocation', description: 'Top holdings lines and concentration % of investments.', parameters: { type: SchemaType.OBJECT, properties: {} } },
        { name: 'getLiquidityRunway', description: 'Emergency fund months, liquid cash, and investable cash (SAR).', parameters: { type: SchemaType.OBJECT, properties: {} } },
        { name: 'getBudgetPressure', description: 'Overspent budget lines (≥75% used this financial month).', parameters: { type: SchemaType.OBJECT, properties: {} } },
        { name: 'getRebalanceDrift', description: 'Concentration + top holdings; suggest opening AI Rebalancer.', parameters: { type: SchemaType.OBJECT, properties: {} } },
        { name: 'getRecoveryCandidates', description: 'Platforms daily P/L and note to open Recovery Plan.', parameters: { type: SchemaType.OBJECT, properties: {} } },
        { name: 'getDividendOutlook', description: 'Trailing dividend run-rate (SAR).', parameters: { type: SchemaType.OBJECT, properties: {} } },
        { name: 'getZakatSnapshot', description: 'Light zakat trade advice snapshot from Finova zakat advisor.', parameters: { type: SchemaType.OBJECT, properties: {} } },
        {
            name: 'proposeTrade',
            description: 'Propose a confirmable Record Trade ActionCard (buy/sell). Does not execute.',
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    symbol: { type: SchemaType.STRING },
                    tradeType: { type: SchemaType.STRING, description: 'buy or sell' },
                    rationale: { type: SchemaType.STRING },
                },
                required: ['symbol', 'tradeType', 'rationale'],
            },
        },
        {
            name: 'proposeBudgetMove',
            description: 'Propose a Budgets ActionCard for a category.',
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    category: { type: SchemaType.STRING },
                    rationale: { type: SchemaType.STRING },
                },
                required: ['category', 'rationale'],
            },
        },
        {
            name: 'proposeGoalFunding',
            description: 'Propose a Goals ActionCard (focus-goal when id known).',
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    goalName: { type: SchemaType.STRING },
                    rationale: { type: SchemaType.STRING },
                },
                required: ['goalName', 'rationale'],
            },
        },
        {
            name: 'proposeDebtPaydown',
            description: 'Propose a Liabilities ActionCard for debt paydown.',
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    name: { type: SchemaType.STRING },
                    rationale: { type: SchemaType.STRING },
                },
                required: ['name', 'rationale'],
            },
        },
    ];

    const functionHandlers: Record<string, (args: any) => any> = {
        getNetWorth: getNetWorth_,
        getGoalsProgress: getGoalsProgress_,
        getTopHoldings: getTopHoldings_,
        getBudgetStatus: getBudgetStatus_,
        getRecentTransactions: getRecentTransactions_,
        addWatchlistItem: handleAddWatchlistItem_,
        getLiabilitiesSummary: getLiabilitiesSummary_,
        getCapitalDeployment: getCapitalDeployment_,
        getInvestmentRoi: getInvestmentRoi_,
        getAllocation: getAllocation_,
        getLiquidityRunway: getLiquidityRunway_,
        getBudgetPressure: getBudgetPressure_,
        getRebalanceDrift: getRebalanceDrift_,
        getRecoveryCandidates: getRecoveryCandidates_,
        getDividendOutlook: getDividendOutlook_,
        getZakatSnapshot: getZakatSnapshot_,
        proposeTrade: proposeTrade_,
        proposeBudgetMove: proposeBudgetMove_,
        proposeGoalFunding: proposeGoalFunding_,
        proposeDebtPaydown: proposeDebtPaydown_,
    };

    const buildDeterministicAdvisorReply = useCallback((question: string): string => {
        const budgets = data?.budgets ?? [];
        const tx = getPersonalTransactions(data)
            .slice()
            .sort((a: { date: string }, b: { date: string }) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const recent = tx.slice(0, 3);
        const monthStartDay = resolveMonthStartDayFromData(data);
        const { start: monthStart, end: monthEnd } = financialMonthRange(new Date(), monthStartDay);
        const approvedThisMonth = tx.filter((t: { date: string; status?: string }) => {
            const d = new Date(t.date);
            const status = (t.status ?? 'Approved').toLowerCase();
            return d >= monthStart && d <= monthEnd && status === 'approved';
        });
        const monthlyExpenses = approvedThisMonth
            .filter((t: { type?: string }) => countsAsExpenseForCashflowKpi(t))
            .reduce((sum: number, t: { amount?: number }) => sum + Math.abs(Number(t.amount) || 0), 0);
        const byCategory = new Map<string, number>();
        approvedThisMonth
            .filter((t: { type?: string; budgetCategory?: string; category?: string }) => countsAsExpenseForCashflowKpi(t))
            .forEach((t: { amount?: number; budgetCategory?: string; category?: string }) => {
                const key = String(t.budgetCategory ?? t.category ?? 'Uncategorized').trim() || 'Uncategorized';
                byCategory.set(key, (byCategory.get(key) ?? 0) + Math.abs(Number(t.amount) || 0));
            });
        const topCat = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1])[0];
        const q = question.toLowerCase();
        const askedBudget = budgets.find((b) => q.includes(String(b.category || '').toLowerCase()));
        const budgetSnippet = askedBudget
            ? `\n### Budget check (${askedBudget.category})\n- Limit: **${askedBudget.limit.toLocaleString()}**\n- Period: **${askedBudget.period || 'monthly'}**\n- Tip: review this category in Budgets for latest consumed/remaining figures.`
            : '';
        const recentSnippet = recent.length
            ? recent
                  .map((t: { description?: string; amount?: number; date?: string }) => `- ${t.date}: ${t.description || 'Transaction'} (${Number(t.amount || 0).toLocaleString()})`)
                  .join('\n')
            : '- No recent transactions found.';
        const adviceMd = `### Quick financial snapshot (fallback mode)
- Financial month: **${wealthGroundingRef.financialMonthLabel}**
- Net worth (SAR): **${wealthGroundingRef.netWorthSar.toLocaleString()}**
- Month P&L (SAR): **${wealthGroundingRef.monthlyPnLSar.toLocaleString()}** (income ${wealthGroundingRef.monthlyIncomeSar.toLocaleString()} / expenses ${wealthGroundingRef.monthlyExpensesSar.toLocaleString()})
- Liquid cash (SAR): **${wealthGroundingRef.liquidCashSar.toLocaleString()}**
- Investable cash (SAR): **${wealthGroundingRef.investableCashSar.toLocaleString()}**
- Emergency fund months: **${wealthGroundingRef.emergencyFundMonths != null ? wealthGroundingRef.emergencyFundMonths.toFixed(1) : 'n/a (no expense estimate)'}**
- Top concentration: **${wealthGroundingRef.topConcentrationPct.toFixed(1)}%**
- This month expenses (approved): **${monthlyExpenses.toLocaleString()}**
- Top spending category: **${topCat ? `${topCat[0]} (${topCat[1].toLocaleString()})` : 'No category data yet'}**

### Advice
- Prefer rebuilding cash if emergency months are under 2; otherwise deploy idle investable cash deliberately.
- Watch concentration and overspent budgets before new buys.

### Recent transactions
${recentSnippet}${budgetSnippet}

> Live AI provider is temporarily unavailable, so this answer is generated from your current in-app data.`;
        const seedCards = buildRuleBasedActionCards(wealthGroundingRef, data, 'dashboard');
        return formatInsightWithActionCards(adviceMd, seedCards);
    }, [data, wealthGroundingRef]);

    const appendModelReply = useCallback((text: string) => {
        setHistory((prev) => [...prev, { role: 'model', parts: [{ text }] }]);
    }, []);

    const processTurn = async (chatHistory: Content[], remainingToolRounds = 8) => {
        setIsLoading(true);
        try {
            let response;
            try {
                response = await invokeAI({
                    model: 'gemini-3-flash-preview',
                    contents: chatHistory,
                    config: {
                        tools: [{ functionDeclarations }],
                        systemInstruction,
                    },
                    groundingAuditExtra: wealthGroundingRef.promptBlock,
                });
            } catch (primaryError) {
                response = await invokeAI({
                    model: 'gemini-2.5-flash',
                    contents: chatHistory,
                    config: {
                        tools: [{ functionDeclarations }],
                        systemInstruction,
                    },
                });
            }

            if (!response) {
                throw new Error('AI provider returned empty response.');
            }

            if (response.functionCalls) {
                if (remainingToolRounds <= 0) {
                    appendModelReply('I reached my tool-call limit for this request. Please ask again with a narrower question.');
                    setIsLoading(false);
                    return;
                }

                const calls = response.functionCalls;
                const toolResponseParts: Part[] = [];

                for (const call of calls) {
                    const handler = functionHandlers[call.name];
                    if (handler) {
                        const result = await handler(call.args);
                        toolResponseParts.push({
                            functionResponse: { name: call.name, response: { result: JSON.stringify(result) } },
                        });
                    }
                }

                const functionCallParts: Part[] = calls.map((fc: FunctionCall) => ({ functionCall: fc }));
                const modelResponseWithFunctionCall: Content = { role: 'model', parts: functionCallParts };
                const toolResponse: Content = { role: 'tool', parts: toolResponseParts };

                await processTurn([...chatHistory, modelResponseWithFunctionCall, toolResponse], remainingToolRounds - 1);
                return;
            } else if (response.text) {
                const proposedCards: AiActionCard[] = [];
                for (const entry of chatHistory) {
                    if (entry.role !== 'tool') continue;
                    for (const part of entry.parts ?? []) {
                        const fr = (part as { functionResponse?: { response?: { result?: string } } }).functionResponse;
                        const raw = fr?.response?.result;
                        if (!raw) continue;
                        try {
                            const parsed = JSON.parse(raw);
                            if (parsed?.actionCard) proposedCards.push(parsed.actionCard as AiActionCard);
                        } catch {
                            /* ignore */
                        }
                    }
                }
                const split = splitInsightAndActionCards(response.text);
                const merged = formatInsightWithActionCards(
                    split.markdown || response.text,
                    [...proposedCards, ...split.actionCards],
                );
                appendModelReply(merged);
                setIsLoading(false);
            } else {
                appendModelReply("Sorry, I encountered an issue and can't respond right now.");
                setIsLoading(false);
            }
        } catch (e) {
            console.error('Error in Live Advisor processTurn:', e);
            const userQuestion = chatHistory
                .slice()
                .reverse()
                .find((entry) => entry.role === 'user')
                ?.parts?.find((p) => 'text' in p && typeof p.text === 'string') as { text?: string } | undefined;
            const deterministic = buildDeterministicAdvisorReply(userQuestion?.text || '');
            const normalized = formatAiError(e);
            const fallbackMessage = `### AI temporarily unavailable\n${normalized}\n\n${deterministic}`;
            appendModelReply(fallbackMessage);
            setIsLoading(false);
        }
    };

    const sendUserText = async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || isLoading) return;
        const newUserContent: Content = { role: 'user', parts: [{ text: trimmed }] };
        const newHistory = [...history, newUserContent];
        setHistory(newHistory);
        setUserInput('');
        setView('chat');

        if (!aiActionsEnabled) {
            setIsLoading(true);
            const deterministic = buildDeterministicAdvisorReply(trimmed);
            appendModelReply(deterministic);
            setIsLoading(false);
            return;
        }

        await processTurn(newHistory);
    };

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        await sendUserText(userInput);
    };

    const handleClose = () => {
        persistHistory(history);
        setUserInput('');
        setIsLoading(false);
        setView('welcome');
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Live AI Advisor">
            {view === 'welcome' ? (
                <div className="text-center p-4">
                    <HeadsetIcon className="h-16 w-16 mx-auto text-primary opacity-50 mb-4" />
                    <h3 className="text-lg font-semibold text-dark">Chat with your AI Assistant</h3>
                    <p className="text-sm text-gray-600 mt-2 max-w-sm mx-auto">
                        Get real-time answers about your accounts, budgets, and investments. Ask me anything!
                    </p>
                    {aiHealthChecked && !isAiAvailable && (
                        <div className="mt-4 text-left">
                            <AiProxyUnavailableHint variant="banner" />
                            <p className="mt-2 text-xs text-slate-600">
                                AI is offline — you can still chat with rules-based answers from your Finova data.
                            </p>
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={() => setView('chat')}
                        className="mt-6 px-6 py-3 bg-primary text-white font-semibold rounded-full hover:bg-secondary transition-colors"
                    >
                        Start Chat
                    </button>
                </div>
            ) : (
                <div className="flex flex-col h-[70vh]">
                    <div className="flex flex-wrap items-center justify-end gap-2 pb-2">
                        <span className="text-xs text-gray-500 mr-auto">Reply language</span>
                        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs font-semibold">
                            <button
                                type="button"
                                onClick={() => {
                                    setReplyLang('en');
                                    try {
                                        localStorage.setItem(ADVISOR_LANG_KEY, 'en');
                                    } catch {
                                        /* ignore */
                                    }
                                }}
                                className={`rounded-md px-2.5 py-1 ${replyLang === 'en' ? 'bg-primary text-white' : 'text-gray-600'}`}
                            >
                                English
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setReplyLang('ar');
                                    try {
                                        localStorage.setItem(ADVISOR_LANG_KEY, 'ar');
                                    } catch {
                                        /* ignore */
                                    }
                                }}
                                className={`rounded-md px-2.5 py-1 ${replyLang === 'ar' ? 'bg-primary text-white' : 'text-gray-600'}`}
                            >
                                العربية
                            </button>
                        </div>
                    </div>
                    <div className="flex-grow bg-gray-100 rounded-lg p-4 overflow-y-auto space-y-4">
                        {history.map((msg, index) =>
                            (msg.role === 'user' || msg.role === 'model') &&
                            msg.parts?.map((part, pIndex) => {
                                if (!part.text) return null;
                                const { markdown, cards } = msg.role === 'model' ? messageActionCards(part.text) : { markdown: part.text, cards: [] as AiActionCard[] };
                                return (
                                    <div key={`${index}-${pIndex}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-xs md:max-w-md p-3 rounded-lg shadow-sm ${msg.role === 'user' ? 'bg-primary text-white' : 'bg-white'}`}>
                                            <SafeMarkdownRenderer content={markdown} />
                                            {cards.length > 0 ? <AiActionCardsPanel cards={cards} /> : null}
                                        </div>
                                    </div>
                                );
                            }),
                        )}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="max-w-xs md:max-w-md p-3 rounded-lg bg-white shadow-sm flex items-center space-x-2">
                                    <SparklesIcon className="h-5 w-5 text-primary animate-pulse" />
                                    <span className="text-sm text-gray-500">Thinking...</span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-3 pb-1">
                        {SUGGESTED_PROMPTS.map((chip) => (
                            <button
                                key={chip}
                                type="button"
                                disabled={isLoading}
                                onClick={() => void sendUserText(chip)}
                                className="text-[11px] px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                                {chip}
                            </button>
                        ))}
                    </div>
                    <form onSubmit={handleSendMessage} className="flex-shrink-0 pt-2">
                        <div className="relative">
                            <input
                                type="text"
                                value={userInput}
                                onChange={(e) => setUserInput(e.target.value)}
                                placeholder={aiActionsEnabled ? 'Ask about your finances...' : 'Ask anyway — rules-based answers available'}
                                className="w-full p-3 pr-12 border border-gray-300 rounded-full focus:ring-primary focus:border-primary"
                                disabled={isLoading}
                            />
                            <button type="submit" disabled={isLoading || !userInput.trim()} className="absolute inset-y-0 right-0 flex items-center justify-center w-12 text-primary hover:text-secondary disabled:text-gray-300">
                                <SendIcon className="h-6 w-6" />
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </Modal>
    );
};

export default LiveAdvisorModal;
