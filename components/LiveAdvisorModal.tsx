import React, { useState, useRef, useContext, useCallback, useEffect, useMemo } from 'react';
import Modal from './Modal';
import type { FunctionDeclaration, Content, Part, FunctionCall } from '@google/genai';
import { SchemaType } from '../services/geminiSchemaTypes';
import { DataContext } from '../context/DataContext';
import { useCurrency } from '../context/CurrencyContext';
import { computePersonalNetWorthSAR } from '../services/personalNetWorth';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { invokeAI, formatAiError } from '../services/geminiService';
import { countsAsExpenseForCashflowKpi } from '../services/transactionFilters';
import { HeadsetIcon } from './icons/HeadsetIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { SendIcon } from './icons/SendIcon';
import SafeMarkdownRenderer from './SafeMarkdownRenderer';

const ADVISOR_LANG_KEY = 'finova_default_ai_lang_v1';

const LiveAdvisorModal: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
    const { data, addWatchlistItem, getAvailableCashForAccount } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const [history, setHistory] = useState<Content[]>([]);
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [view, setView] = useState<'welcome' | 'chat'>('welcome');
    const [replyLang, setReplyLang] = useState<'en' | 'ar'>(() => {
        try {
            return typeof localStorage !== 'undefined' && localStorage.getItem(ADVISOR_LANG_KEY) === 'ar' ? 'ar' : 'en';
        } catch {
            return 'en';
        }
    });
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const systemInstruction = useMemo(() => {
        const base =
            "You are Finova AI, a very clever expert financial and investment advisor. Be ultra direct: lead with the answer in one sentence, then 2-3 short bullets. Use Markdown: ### for sections, ** for emphasis. Use tools when the user asks about their data; cite specific numbers from tool results. Speak with authority and insight. No HTML. No filler. Important: All data from tools (net worth, budgets, transactions) is the user's personal wealth only—do not reference or mix in any third-party or managed wealth; respond only about the user's personal finances.";
        if (replyLang === 'ar') {
            return `${base} Always write your entire reply in Modern Standard Arabic. Keep numbers, percentages, dates, and currency labels (SAR, USD) exactly as in the data; keep Latin ticker symbols unchanged.`;
        }
        return base;
    }, [replyLang]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [history]);
    
    useEffect(() => {
        if (isOpen && view === 'chat' && history.length === 0) {
            const welcome =
                replyLang === 'ar'
                    ? 'مرحباً! أنا **Finova AI**، مستشارك المالي. يمكنني المساعدة في صافي الثروة، الميزانيات، الاستثمارات، الأهداف، والمعاملات الأخيرة. ما الذي تريد الاطلاع عليه؟'
                    : "Hello! I'm **Finova AI**, your expert financial and investment advisor. I can help with net worth, budgets, investments, goals, and recent transactions. What would you like to look at?";
            setHistory([{ role: 'model', parts: [{ text: welcome }] }]);
        }
    }, [isOpen, view, history, replyLang]);

    // Function definitions
    const getNetWorth_ = useCallback(() => {
        const fx = resolveSarPerUsd(data, exchangeRate);
        return { netWorth: computePersonalNetWorthSAR(data, fx, { getAvailableCashForAccount }) };
    }, [data, exchangeRate, getAvailableCashForAccount]);

    const getBudgetStatus_ = useCallback(({ category }: { category: string }) => {
        const budget = (data?.budgets ?? []).find(b => b.category.toLowerCase() === category.toLowerCase());
        if (!budget) return { error: `Budget category "${category}" not found.` };
        const monthlyLimit = budget.period === 'yearly' ? budget.limit / 12 : budget.period === 'weekly' ? budget.limit * (52 / 12) : budget.period === 'daily' ? budget.limit * (365 / 12) : budget.limit;
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const transactions = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const spent = transactions
            .filter((t: { type?: string; date: string; budgetCategory?: string; category?: string }) => countsAsExpenseForCashflowKpi(t) && new Date(t.date) >= firstDayOfMonth && t.budgetCategory === budget.category)
            .reduce((sum: number, t: { amount?: number }) => sum + Math.abs(t.amount ?? 0), 0);
        return { limit: monthlyLimit, spent, remaining: monthlyLimit - spent };
    }, [data]);
    
     const getRecentTransactions_ = useCallback(({ limit }: { limit: number }) => {
        const transactions = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const sortedTransactions = [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return { transactions: sortedTransactions.slice(0, limit).map((t: { description?: string; amount?: number }) => ({ description: t.description, amount: t.amount })) };
    }, [data]);
    
    const handleAddWatchlistItem_ = useCallback(async ({ symbol, name }: { symbol: string, name: string }) => {
        if (!symbol || !name) return { success: false, error: "Symbol and name are required." };
        try {
            await addWatchlistItem({ symbol, name });
            return { success: true, message: `Successfully added ${name} to the watchlist.` };
        } catch (e) {
            console.error("Error adding to watchlist via AI:", e);
            return { success: false, error: `Failed to add ${name} to watchlist.` };
        }
    }, [addWatchlistItem]);

    const functionDeclarations: FunctionDeclaration[] = [
        { name: 'getNetWorth', parameters: { type: SchemaType.OBJECT, properties: {} } },
        { name: 'getBudgetStatus', parameters: { type: SchemaType.OBJECT, properties: { category: { type: SchemaType.STRING } }, required: ['category'] } },
        { name: 'getRecentTransactions', parameters: { type: SchemaType.OBJECT, properties: { limit: { type: SchemaType.NUMBER } }, required: ['limit'] } },
        { name: 'addWatchlistItem', description: "Adds a stock to the user's watchlist.", parameters: { type: SchemaType.OBJECT, properties: { symbol: { type: SchemaType.STRING, description: "The stock ticker symbol, e.g., MSFT or 2222.SR" }, name: { type: SchemaType.STRING, description: "The full name of the company, e.g., Microsoft Corp." } }, required: ['symbol', 'name'] } },
    ];
    
    const functionHandlers: Record<string, (args: any) => any> = {
        getNetWorth: getNetWorth_,
        getBudgetStatus: getBudgetStatus_,
        getRecentTransactions: getRecentTransactions_,
        addWatchlistItem: handleAddWatchlistItem_,
    };

    const buildDeterministicAdvisorReply = useCallback((question: string): string => {
        const fx = resolveSarPerUsd(data, exchangeRate);
        const netWorthSar = computePersonalNetWorthSAR(data, fx, { getAvailableCashForAccount });
        const budgets = data?.budgets ?? [];
        const tx = ((data as any)?.personalTransactions ?? data?.transactions ?? [])
            .slice()
            .sort((a: { date: string }, b: { date: string }) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const recent = tx.slice(0, 3);
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const approvedThisMonth = tx.filter((t: { date: string; status?: string }) => {
            const d = new Date(t.date);
            const status = (t.status ?? 'Approved').toLowerCase();
            return d >= monthStart && status === 'approved';
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
        return `### Quick financial snapshot (fallback mode)
- Net worth (SAR): **${netWorthSar.toLocaleString()}**
- This month expenses (approved): **${monthlyExpenses.toLocaleString()}**
- Top spending category: **${topCat ? `${topCat[0]} (${topCat[1].toLocaleString()})` : 'No category data yet'}**

### Recent transactions
${recentSnippet}${budgetSnippet}

> Live AI provider is temporarily unavailable, so this answer is generated from your current in-app data.`;
    }, [data, exchangeRate, getAvailableCashForAccount]);

    const processTurn = async (chatHistory: Content[], remainingToolRounds = 4) => {
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
                });
            } catch (primaryError) {
                response = await invokeAI({
                    model: 'gemini-2.0-flash',
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
                    setHistory(prev => [...prev, { role: 'model', parts: [{ text: "I reached my tool-call limit for this request. Please ask again with a narrower question." }] }]);
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
                            functionResponse: { name: call.name, response: { result: JSON.stringify(result) } }
                        });
                    }
                }
                
                const functionCallParts: Part[] = calls.map((fc: FunctionCall) => ({ functionCall: fc }));
                const modelResponseWithFunctionCall: Content = { role: 'model', parts: functionCallParts };
                const toolResponse: Content = { role: 'tool', parts: toolResponseParts };

                // Recurse with the function response
                await processTurn([...chatHistory, modelResponseWithFunctionCall, toolResponse], remainingToolRounds - 1);
                return;

            } else if (response.text) {
                setHistory(prev => [...prev, { role: 'model', parts: [{ text: response.text }] }]);
                setIsLoading(false);
            } else {
                setHistory(prev => [...prev, { role: 'model', parts: [{ text: "Sorry, I encountered an issue and can't respond right now." }] }]);
                setIsLoading(false);
            }
        } catch (e) {
            console.error("Error in Live Advisor processTurn:", e);
            const userQuestion = chatHistory
                .slice()
                .reverse()
                .find((entry) => entry.role === 'user')
                ?.parts?.find((p) => 'text' in p && typeof p.text === 'string') as { text?: string } | undefined;
            const deterministic = buildDeterministicAdvisorReply(userQuestion?.text || '');
            const normalized = formatAiError(e);
            const fallbackMessage = `### AI temporarily unavailable\n${normalized}\n\n${deterministic}`;
            setHistory(prev => [...prev, { role: 'model', parts: [{ text: fallbackMessage }] }]);
            setIsLoading(false);
        }
    };

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userInput.trim() || isLoading) return;

        const newUserContent: Content = { role: 'user', parts: [{ text: userInput }] };
        const newHistory = [...history, newUserContent];
        setHistory(newHistory);
        setUserInput('');
        await processTurn(newHistory);
    };

    const handleClose = () => {
        setHistory([]);
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
                    <button onClick={() => setView('chat')} className="mt-6 px-6 py-3 bg-primary text-white font-semibold rounded-full hover:bg-secondary transition-colors">
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
                        {history.map((msg, index) => (
                            (msg.role === 'user' || msg.role === 'model') && msg.parts?.map((part, pIndex) => (
                                part.text && (
                                    <div key={`${index}-${pIndex}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-xs md:max-w-md p-3 rounded-lg shadow-sm ${msg.role === 'user' ? 'bg-primary text-white' : 'bg-white'}`}>
                                            <SafeMarkdownRenderer content={part.text} />
                                        </div>
                                    </div>
                                )
                            ))
                        ))}
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
                    <form onSubmit={handleSendMessage} className="flex-shrink-0 pt-4">
                        <div className="relative">
                            <input
                                type="text"
                                value={userInput}
                                onChange={e => setUserInput(e.target.value)}
                                placeholder="Ask about your finances..."
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
