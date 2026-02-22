import React, { useState, useRef, useContext, useCallback, useEffect } from 'react';
import Modal from './Modal';
import { Type, FunctionDeclaration, Content, Part, FunctionCall } from '@google/genai';
import { DataContext } from '../context/DataContext';
import { invokeAI } from '../services/geminiService';
import { HeadsetIcon } from './icons/HeadsetIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { SendIcon } from './icons/SendIcon';
import SafeMarkdownRenderer from './SafeMarkdownRenderer';

const LiveAdvisorModal: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
    const { data, addWatchlistItem } = useContext(DataContext)!;
    const [history, setHistory] = useState<Content[]>([]);
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [view, setView] = useState<'welcome' | 'chat'>('welcome');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [history]);
    
    useEffect(() => {
        if (isOpen && view === 'chat' && history.length === 0) {
            // Set initial message
            setHistory([
                { role: 'model', parts: [{ text: "Hello! I'm HS, your AI financial assistant. How can I help you today? You can ask me about your net worth, budgets, or recent transactions." }] }
            ]);
        }
    }, [isOpen, view, history]);

    // Function definitions
    const getNetWorth_ = useCallback(() => {
        const totalAssets = data.assets.reduce((sum, asset) => sum + asset.value, 0) + data.accounts.filter(a => a.balance > 0).reduce((sum, acc) => sum + acc.balance, 0);
        const totalLiabilities = data.liabilities.reduce((sum, liab) => sum + liab.amount, 0) + data.accounts.filter(a => a.balance < 0).reduce((sum, acc) => sum + acc.balance, 0);
        return { netWorth: totalAssets + totalLiabilities };
    }, [data]);

    const getBudgetStatus_ = useCallback(({ category }: { category: string }) => {
        const budget = data.budgets.find(b => b.category.toLowerCase() === category.toLowerCase());
        if (!budget) return { error: `Budget category "${category}" not found.` };
        
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const spent = data.transactions
            .filter(t => t.type === 'expense' && new Date(t.date) >= firstDayOfMonth && t.budgetCategory === budget.category)
            .reduce((sum, t) => sum + Math.abs(t.amount), 0);
        
        return { limit: budget.limit, spent, remaining: budget.limit - spent };
    }, [data]);
    
     const getRecentTransactions_ = useCallback(({ limit }: { limit: number }) => {
        const sortedTransactions = [...data.transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return { transactions: sortedTransactions.slice(0, limit).map(t => ({ description: t.description, amount: t.amount })) };
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
        { name: 'getNetWorth', parameters: { type: Type.OBJECT, properties: {} } },
        { name: 'getBudgetStatus', parameters: { type: Type.OBJECT, properties: { category: { type: Type.STRING } }, required: ['category'] } },
        { name: 'getRecentTransactions', parameters: { type: Type.OBJECT, properties: { limit: { type: Type.NUMBER } }, required: ['limit'] } },
        { name: 'addWatchlistItem', description: "Adds a stock to the user's watchlist.", parameters: { type: Type.OBJECT, properties: { symbol: { type: Type.STRING, description: "The stock ticker symbol, e.g., MSFT or 2222.SR" }, name: { type: Type.STRING, description: "The full name of the company, e.g., Microsoft Corp." } }, required: ['symbol', 'name'] } },
    ];
    
    const functionHandlers: Record<string, (args: any) => any> = {
        getNetWorth: getNetWorth_,
        getBudgetStatus: getBudgetStatus_,
        getRecentTransactions: getRecentTransactions_,
        addWatchlistItem: handleAddWatchlistItem_,
    };

    const processTurn = async (chatHistory: Content[], remainingToolRounds = 4) => {
        setIsLoading(true);
        try {
            const response = await invokeAI({
                model: 'gemini-3-flash-preview',
                contents: chatHistory,
                config: { 
                    tools: [{ functionDeclarations }],
                    systemInstruction: "You are HS, an expert personal financial advisor. Always answer directly, then provide a concise summary (max 3 bullets). Use tools when data is needed and include specific numbers from tool results."
                }
            });

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
            let errorMessage = "An unknown error occurred while communicating with the AI service.";
            if (e instanceof Error) {
                errorMessage = `AI Service Error: ${e.message}`;
            }
            setHistory(prev => [...prev, { role: 'model', parts: [{ text: errorMessage }] }]);
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
