import { GoogleGenAI, Type, GenerateContentResponse, FunctionDeclaration } from "@google/genai";
import { KPISummary, Holding, Goal, InvestmentTransaction, WatchlistItem, Transaction, Budget, FinancialData, InvestmentPortfolio, CommodityHolding, FeedItem, PersonaAnalysis, InvestmentPlanSettings, UniverseTicker, InvestmentPlanExecutionResult } from '../types';

// --- Model Constants ---
const FAST_MODEL = 'gemini-3-flash-preview';


// --- AI Error Formatting ---
export function formatAiError(error: any): string {
    console.error("Error from AI Service:", error);
    if (error instanceof Error) {
        if (error.message.includes('GEMINI_API_KEY not set')) {
            return `
### AI Service Configuration Error
The AI service is not configured correctly. The \`GEMINI_API_KEY\` is missing in your deployment environment.

**To fix this:**
- Go to your Netlify project settings.
- Navigate to **Site configuration > Environment variables**.
- Add a new variable with the key \`GEMINI_API_KEY\` and your Google Gemini API key as the value.
- Redeploy your site.
`;
        }
        if (error.message.includes('API key not valid')) {
            return "The AI service API key is not valid. Please check the backend configuration.";
        }
        if (error.message.includes('quota')) {
            return "The AI service has exceeded its usage quota. Please try again later.";
        }
        if (error.message.includes('model')) {
             return `There was an issue with the specified AI model. ${error.message}`;
        }
        return `AI Service Error: ${error.message}`;
    }
    return "An unknown error occurred while communicating with the AI service.";
}


// --- AI Request Cache ---
const aiAnalysisCache = new Map<string, { timestamp: number; result: any }>();
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

function getFromCache(key: string): any | null {
    const cached = aiAnalysisCache.get(key);
    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION_MS)) {
        console.log("Returning AI analysis from cache.");
        return cached.result;
    }
    aiAnalysisCache.delete(key); // Stale entry
    return null;
}

function setToCache(key: string, result: any) {
    aiAnalysisCache.set(key, { timestamp: Date.now(), result });
}
// --- End AI Request Cache ---

// --- Robust JSON Parsing ---
function robustJsonParse(jsonString: string | undefined): any {
    if (!jsonString) {
        return null;
    }
    
    const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const potentialJson = (jsonMatch && jsonMatch[1]) ? jsonMatch[1] : jsonString;
    
    try {
        return JSON.parse(potentialJson.trim());
    } catch (error) {
        console.error("Failed to parse AI JSON response:", error);
        console.error("Original string:", jsonString);
        return null;
    }
}
// --- End Robust JSON Parsing ---

// Helper function to securely invoke the Gemini API via a Netlify Function.
async function invokeGeminiProxy(payload: { model: string, contents: any, config?: any }): Promise<any> {
    try {
        const response = await fetch('/api/gemini-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            // If we get an error response, we can't assume the body is JSON.
            const errorBody = await response.text();
            let errorMessage;
            try {
                // Attempt to parse it as our expected JSON error format
                const jsonError = JSON.parse(errorBody);
                errorMessage = jsonError.error || `AI proxy failed with status ${response.status}`;
            } catch (e) {
                // If it's not JSON, it's likely an HTML error page from the hosting provider.
                errorMessage = `AI proxy failed with status ${response.status}. The server returned an invalid response. This may be due to a server-side configuration error (e.g., missing API key).`;
            }
            throw new Error(errorMessage);
        }
        
        // If response.ok, we assume it's valid JSON.
        return await response.json();

    } catch (error) {
        console.error("Error invoking Netlify function:", error);
        if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('network'))) {
             const detailedMessage = "Could not connect to the AI proxy function. Please ensure you are connected to the internet and that the Netlify function is deployed correctly.";
             throw new Error(detailedMessage);
        }
        throw error;
    }
}

// Unified AI invocation function. Decides whether to use client-side SDK or proxy.
export async function invokeAI(payload: { model: string, contents: any, config?: any }): Promise<any> {
    // In dev mode, use the client-side key if available.
    // In dev mode, use the client-side key if available. Otherwise, fall back to the proxy.
    if (import.meta.env.DEV && import.meta.env.VITE_GEMINI_API_KEY) {
        const clientSideApiKey = import.meta.env.VITE_GEMINI_API_KEY;
        try {
            const ai = new GoogleGenAI({ apiKey: clientSideApiKey });
            const response: GenerateContentResponse = await ai.models.generateContent(payload);
            return {
                text: response.text,
                candidates: response.candidates,
                functionCalls: response.functionCalls,
            };
        } catch (error) {
            throw new Error(formatAiError(error));
        }
    } else {
        // In production, or for local dev without a specific client-side key, use the proxy.
        return invokeGeminiProxy(payload);
    }
}


const getTopHoldingSymbol = (investments: InvestmentPortfolio[]): string => {
    if (!investments || investments.length === 0) {
        return 'N/A';
    }
    const firstPortfolio = investments[0];
    if (!firstPortfolio.holdings || firstPortfolio.holdings.length === 0) {
        return 'N/A';
    }
    const sortedHoldings = [...firstPortfolio.holdings].sort((a, b) => b.currentValue - a.currentValue);
    return sortedHoldings[0]?.symbol || 'N/A';
};


export const getAIFeedInsights = async (data: FinancialData): Promise<FeedItem[]> => {
    const cacheKey = `getAIFeedInsights:${data.transactions.length}:${data.goals.length}:${data.budgets.length}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
        const prompt = `
            You are a proactive financial analyst for the Wealth Ultra platform. 
            Analyze the user's complete financial data and generate a prioritized list of 4-5 insightful, encouraging, and actionable feed items.
            Financial Data Snapshot:
            - Net Worth: Calculate from assets, accounts, and liabilities.
            - Recent Transactions: ${data.transactions.slice(0, 5).map(t => `${t.description}: ${t.amount}`).join(', ')}
            - Budget Performance: ${data.budgets.map(b => `${b.category} limit ${b.limit}`).join(', ')}
            - Goal Progress: ${data.goals.map(g => `${g.name} is at ${((g.currentAmount/g.targetAmount)*100).toFixed(0)}%`).join(', ')}
            - Top Investment Holding: ${getTopHoldingSymbol(data.investments)}
            Generate a JSON array of feed items based on the provided schema. Each item should have a 'type', 'title', 'description', and a relevant emoji.
        `;

        const response = await invokeAI({
            model: FAST_MODEL,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            type: { type: Type.STRING, description: "Type of insight (BUDGET, GOAL, INVESTMENT, SAVINGS)" },
                            title: { type: Type.STRING },
                            description: { type: Type.STRING },
                            emoji: { type: Type.STRING }
                        }
                    }
                }
            }
        });
        const items = robustJsonParse(response.text);
        const result = Array.isArray(items) ? items : [];
        setToCache(cacheKey, result);
        return result;
    } catch (error) {
        console.error("Error fetching AI Feed insights:", error);
        throw error;
    }
};


export const getAIAnalysis = async (summary: KPISummary): Promise<string> => {
  const cacheKey = `getAIAnalysis:${JSON.stringify(summary)}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const prompt = `
      You are a helpful personal finance assistant. Based on the following financial summary (all values in SAR), provide a brief, insightful, and encouraging analysis in Markdown format.
      Your response must be in Markdown format only and contain no HTML tags.
      Explain trends in net worth, investment returns, and asset allocation.
      Start with a general overview, then provide two bullet points using ** for the title:
      - **Positive Trends:** Mention 1-2 positive aspects.
      - **Areas to Watch:** Gently point out 1-2 areas for improvement.
      Financial Summary:
      - Net Worth: ${summary.netWorth.toLocaleString()}
      - Monthly Income: ${summary.monthlyIncome.toLocaleString()}
      - Monthly Expenses: ${summary.monthlyExpenses.toLocaleString()}
      - Total Investment ROI: ${(summary.roi * 100).toFixed(1)}%
      Provide the Markdown analysis now.
    `;
    
    const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
    const result = response.text || "Could not retrieve AI analysis.";
    setToCache(cacheKey, result);
    return result;

  } catch (error) {
    return formatAiError(error);
  }
};

export const getAITransactionAnalysis = async (transactions: Transaction[], budgets: Budget[]): Promise<string> => {
    const cacheKey = `getAITransactionAnalysis:${transactions.length}:${budgets.length}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
        const spending = new Map<string, number>();
        transactions.filter(t => t.type === 'expense' && t.budgetCategory).forEach(t => {
            const currentSpend = spending.get(t.budgetCategory!) || 0;
            spending.set(t.budgetCategory!, currentSpend + Math.abs(t.amount));
        });

        const budgetPerformance = budgets.map(b => {
            const spent = spending.get(b.category) || 0;
            const percentage = b.limit > 0 ? (spent / b.limit) * 100 : 0;
            return `- **${b.category}**: Spent ${spent.toLocaleString()} of ${b.limit.toLocaleString()} SAR (${percentage.toFixed(0)}% used)`;
        }).join('\n');

        const prompt = `
            You are "HS", a sharp and encouraging AI financial analyst. Analyze the following monthly spending data and provide a concise, actionable analysis in Markdown format.

            **Spending Data for the Month:**
            ${budgetPerformance}

            **Your Task:**
            Structure your response with these exact headers. Be direct, use numbers, and keep each point to a single sentence.
            ### Key Spending Insight
            - Identify the most significant spending observation. (e.g., "Shopping is your highest expense category at 45% over budget.")

            ### Strategic Recommendation
            - Provide one practical tip to address the key insight. (e.g., "Consider setting a 'no-spend' challenge for 3 days next week in the Shopping category.")
            
            ### Positive Note
            - Highlight one area where spending is well-managed. (e.g., "Well done on keeping your 'Utilities' spending 20% under budget.")

            Provide the Markdown analysis now.
        `;

        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        const result = response.text || "Could not retrieve transaction analysis.";
        setToCache(cacheKey, result);
        return result;
    } catch (error) {
        return formatAiError(error);
    }
};


export const getAIFinancialPersona = async (
    savingsRate: number,
    debtToAssetRatio: number,
    emergencyFundMonths: number,
    investmentStyle: string
): Promise<PersonaAnalysis | null> => {
    const cacheKey = `getAIFinancialPersona:${savingsRate.toFixed(2)}:${debtToAssetRatio.toFixed(2)}:${emergencyFundMonths.toFixed(1)}:${investmentStyle}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
        const prompt = `
            Analyze these financial metrics: Savings Rate: ${(savingsRate * 100).toFixed(1)}%, Debt-to-Asset Ratio: ${(debtToAssetRatio * 100).toFixed(1)}%, Emergency Fund: ${emergencyFundMonths.toFixed(1)} months, Investment Style: ${investmentStyle}.
            Generate a financial persona and a detailed report card as a single JSON object.
            The persona title should be creative (e.g., "The Disciplined Planner").
            The report card ratings must be one of: "Excellent", "Good", or "Needs Improvement".
            Analysis and suggestions should be concise and educational.
        `;

        const response = await invokeAI({
            model: FAST_MODEL,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        persona: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, description: { type: Type.STRING } } },
                        reportCard: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { metric: { type: Type.STRING }, value: { type: Type.STRING }, rating: { type: Type.STRING }, analysis: { type: Type.STRING }, suggestion: { type: Type.STRING } } } }
                    }
                }
            }
        });
        const result = robustJsonParse(response.text);
        if (result) {
            setToCache(cacheKey, JSON.stringify(result));
        }
        return result;

    } catch (error) {
        console.error("Error fetching AI financial persona:", error);
        throw error;
    }
};

export const getAIPlanAnalysis = async (totals: any, scenarios: any): Promise<string> => {
    const cacheKey = `getAIPlanAnalysis:${JSON.stringify(totals)}:${JSON.stringify(scenarios)}`;
    const cached = getFromCache(cacheKey);
    if(cached) return cached;
    
    try {
        const { projectedNet } = totals;
        const { incomeShock, expenseStress } = scenarios;
        const prompt = `
            You are "HS", a forward-thinking AI financial strategist. Analyze the user's annual plan and the active 'what-if' scenarios. Provide a concise, insightful, and encouraging analysis in Markdown format.

            **Annual Plan Data:**
            - Baseline Projected Annual Savings: ${projectedNet.toLocaleString()} SAR

            **Active Scenarios:**
            - Income Shock: A ${incomeShock.percent}% change for ${incomeShock.duration} months.
            - Expense Stress: A ${expenseStress.percent}% increase in the "${expenseStress.category}" category.

            **Your Task:**
            Structure your response with these exact headers. Be direct and use numbers.
            ### Scenario Impact
            - Quantify the total impact of these combined scenarios on the annual projected savings. (e.g., "These scenarios reduce your projected annual savings by 15,000 SAR, a 25% decrease.")

            ### Resilience Tip
            - Provide one high-impact recommendation to build resilience against these specific shocks. (e.g., "To counter the expense stress, consider building a 'discretionary buffer' by allocating 5% of your income to a separate savings account for unexpected costs.")
            
            ### The Big Picture
            - Offer a brief, encouraging closing thought about the value of planning. (e.g., "Stress testing your plan like this is a powerful way to prepare for uncertainty and stay on track toward your long-term goals.")

            Provide the Markdown analysis now.
        `;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        const result = response.text || "Could not retrieve plan analysis.";
        setToCache(cacheKey, result);
        return result;
    } catch(e) {
        return formatAiError(e);
    }
}

export const getAIAnalysisPageInsights = async (
    spendingData: { name: string; value: number }[],
    trendData: { name: string; income: number; expenses: number }[],
    compositionData: { name: string; value: number }[]
): Promise<string> => {
    const cacheKey = `getAIAnalysisPageInsights:${JSON.stringify(spendingData)}:${JSON.stringify(trendData)}:${JSON.stringify(compositionData)}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
        const prompt = `
            You are a senior financial analyst providing a holistic overview based on three key charts. Analyze the following data and provide a concise, insightful summary in Markdown format.
            Your response must be in Markdown format only and contain no HTML tags.

            1.  **Spending by Budget Category (YTD):**
                ${spendingData.slice(0, 5).map(d => `- ${d.name}: ${d.value.toLocaleString()} SAR`).join('\n')}

            2.  **Monthly Income vs. Expense Trend (Recent Months):**
                ${trendData.map(d => `- ${d.name}: Income ${d.income.toLocaleString()} SAR, Expenses ${d.expenses.toLocaleString()} SAR`).join('\n')}

            3.  **Current Financial Position (Assets vs. Liabilities):**
                ${compositionData.map(d => `- ${d.name}: ${d.value.toLocaleString()} SAR`).join('\n')}

            Your analysis should have three sections using '###' headers:
            - ### Spending Habits: Comment on the top spending categories. Is spending concentrated?
            - ### Cash Flow Dynamics: Analyze the income vs. expense trend. Is the user saving money consistently?
            - ### Balance Sheet Health: Interpret the asset vs. liability composition. Is the user building wealth effectively?
            
            Provide the Markdown analysis now.
        `;

        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        const result = response.text || "Could not retrieve analysis.";
        setToCache(cacheKey, result);
        return result;

    } catch (error) {
        return formatAiError(error);
    }
};

export const getAIInvestmentOverviewAnalysis = async (
    portfolioAllocation: { name: string; value: number }[],
    assetClassAllocation: { name: string; value: number }[],
    topHoldings: { name: string; gainLossPercent: number }[]
): Promise<string> => {
    const cacheKey = `getAIInvestmentOverviewAnalysis:${JSON.stringify(portfolioAllocation)}:${JSON.stringify(assetClassAllocation)}:${JSON.stringify(topHoldings)}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
        const prompt = `
            You are a senior investment analyst performing a SWOT analysis (Strengths, Weaknesses, Opportunities, Threats) on a user's investment portfolio. Your response must be in Markdown format only and contain no HTML tags.
            Analyze the following data:

            1.  **Portfolio Allocation (Value by portfolio):**
                ${portfolioAllocation.map(p => `- ${p.name}: ${p.value.toLocaleString()} SAR`).join('\n')}

            2.  **Asset Class Allocation (Value by asset type):**
                ${assetClassAllocation.map(a => `- ${a.name}: ${a.value.toLocaleString()} SAR`).join('\n')}

            3.  **Top 5 Holdings by Performance:**
                ${topHoldings.slice(0, 5).map(h => `- ${h.name}: ${h.gainLossPercent.toFixed(2)}%`).join('\n')}

            Your analysis must have four sections using '###' headers:
            - ### Strengths: What are the strong points? (e.g., good performers, diversification).
            - ### Weaknesses: What are the weak points? (e.g., concentration risk, underperformers).
            - ### Opportunities: What potential actions could improve the portfolio? (e.g., explore new asset classes).
            - ### Threats: What are the external risks to this portfolio? (e.g., market volatility, sector-specific risks).
            
            Keep the analysis concise, strategic, and educational. Do not provide direct financial advice. Provide the Markdown analysis now.
        `;

        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        const result = response.text || "Could not retrieve analysis.";
        setToCache(cacheKey, result);
        return result;

    } catch (error) {
        return formatAiError(error);
    }
};

export const getAIExecutiveSummary = async (data: FinancialData): Promise<string> => {
    const cacheKey = `getAIExecutiveSummary:${data.transactions.length}:${data.investments.length}`;
    const cached = getFromCache(cacheKey);
    if(cached) return cached;

    // Calculate some metrics for the prompt
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyTransactions = data.transactions.filter(t => new Date(t.date) >= firstDayOfMonth);
    const monthlyIncome = monthlyTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const monthlyExpenses = monthlyTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const monthlyPnL = monthlyIncome - monthlyExpenses;

    const overspentBudgets = data.budgets
        .map(budget => {
            const spent = monthlyTransactions
                .filter(t => t.type === 'expense' && t.budgetCategory === budget.category)
                .reduce((sum, t) => sum + Math.abs(t.amount), 0);
            const percentage = budget.limit > 0 ? (spent / budget.limit) * 100 : 0;
            return { ...budget, spent, percentage };
        })
        .filter(b => b.percentage > 90)
        .map(b => `${b.category} (${b.percentage.toFixed(0)}% used)`)
        .join(', ');
    
    const goalProgress = data.goals.map(g => {
        const currentAmount = g.currentAmount; // simplified for prompt
        const progress = g.targetAmount > 0 ? (currentAmount / g.targetAmount) * 100 : 0;
        return `${g.name} (${progress.toFixed(0)}%)`;
    }).join(', ');

    const prompt = `
        You are "HS", a senior personal financial advisor for a sophisticated wealth management platform. Your tone is professional, insightful, and encouraging.
        Analyze the user's key financial data and provide a concise executive summary in Markdown format.
        Your response must be in Markdown format only and contain no HTML tags.
        
        Financial Snapshot:
        - This Month's P&L: ${monthlyPnL.toLocaleString()} SAR
        - Budgets nearing limit (>90%): ${overspentBudgets || 'None'}
        - Goal Progress: ${goalProgress || 'No goals set'}

        Structure your response with these exact headers:
        ### Overall Financial Health
        A single, concise sentence summarizing the user's current financial standing for the month.

        ### Key Highlights
        - 2-3 positive bullet points based on the data. Mention specific numbers.

        ### Areas for Attention
        - 1-2 constructive bullet points about areas that need monitoring. Be gentle but direct.

        ### Strategic Recommendation
        - Provide one actionable, forward-looking recommendation to improve their financial situation.
        
        Provide the Markdown summary now.
    `;

    try {
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        const result = response.text || "Could not retrieve executive summary.";
        setToCache(cacheKey, result);
        return result;
    } catch (e) {
        return formatAiError(e);
    }
}


export const getInvestmentAIAnalysis = async (holdings: Holding[]): Promise<string> => {
  const cacheKey = `getInvestmentAIAnalysis:${holdings.map(h => h.symbol + h.quantity).join(',')}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const prompt = `You are an expert investment analyst. Based on these holdings, provide a brief analysis on diversification and concentration risk in Markdown format. Do not give financial advice, and do not include any HTML tags. Holdings: ${holdings.map(h => h.symbol).join(', ')}`;
    const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
    const result = response.text || "Could not retrieve analysis.";
    setToCache(cacheKey, result);
    return result;
  } catch (error) { return formatAiError(error); }
};

export const getPlatformPerformanceAnalysis = async (holdings: (Holding & { gainLoss: number; gainLossPercent: number; })[]): Promise<string> => {
    try {
        const prompt = `You are a portfolio manager. Based on unrealized gains/losses, provide a performance and risk analysis in markdown. Your response must not contain any HTML. Sections: Key Performance Contributors, Key Performance Detractors, Risk Assessment. Holdings: ${holdings.length} assets.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not retrieve analysis.";
    } catch (error) { return formatAiError(error); }
};

export const getAIStrategy = async (holdings: Holding[]): Promise<string> => {
    try {
        const prompt = `You are an investment strategist. Analyze these holdings and provide educational strategic ideas in markdown. Your response must not contain any HTML. Sections: Current Strategy Assessment, Strategic Opportunities & Ideas. Do not give financial advice. Holdings: ${holdings.map(h => h.symbol).join(', ')}`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not retrieve strategy.";
    } catch (error) { return formatAiError(error); }
};

export const getAIResearchNews = async (stocks: (Holding | WatchlistItem)[]): Promise<{ content: string, groundingChunks: any[] }> => {
    try {
        const prompt = `You are a financial news analyst. For these stocks (${stocks.map(s => s.symbol).join(', ')}), use Google Search to generate a concise summary of the latest market news and analyst sentiment for each. Respond in markdown, using a '###' header for each stock symbol. Do not use any HTML tags in your response.`;
        const response = await invokeAI({
            model: FAST_MODEL,
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] }
        });
        const content = response.text || "Could not retrieve news.";
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        return { content, groundingChunks };
    } catch (error) {
        return { content: formatAiError(error), groundingChunks: [] };
    }
};

export const getAITradeAnalysis = async (transactions: InvestmentTransaction[]): Promise<string> => {
    try {
        const prompt = `You are an educational trading coach. Analyze these recent transactions and provide educational feedback in markdown. Your response must not contain any HTML. 
        Focus on identifying patterns (e.g., frequent trading, selling winners, buying losers) and explain the potential portfolio impact. 
        Conclude with a key concept the user could research (e.g., 'dollar-cost averaging', 'portfolio diversification').
        Avoid financial advice. Transactions: ${transactions.length} recent trades.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not retrieve analysis.";
    } catch (error) { return formatAiError(error); }
};

export const getGoalAIPlan = async (goal: Goal, monthlySavings: number, calculatedCurrentAmount: number): Promise<string> => {
    const cacheKey = `getGoalAIPlan:${goal.id}:${calculatedCurrentAmount}:${monthlySavings}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    try {
        const deadline = new Date(goal.deadline);
        const now = new Date();
        const monthsLeft = Math.max(0, (deadline.getFullYear() - now.getFullYear()) * 12 + deadline.getMonth() - now.getMonth());
        const remainingAmount = Math.max(0, goal.targetAmount - calculatedCurrentAmount);
        const requiredMonthlyContribution = monthsLeft > 0 ? remainingAmount / monthsLeft : remainingAmount;
        const projectedMonthlyContribution = monthlySavings * ((goal.savingsAllocationPercent || 0) / 100);

        const prompt = `
            You are "HS", a smart and encouraging AI financial coach. Analyze this goal and provide a direct, concise plan in Markdown.
            
            **Goal Data:**
            - **Name:** ${goal.name}
            - **Target:** ${goal.targetAmount.toLocaleString()} SAR
            - **Currently Saved:** ${calculatedCurrentAmount.toLocaleString()} SAR
            - **Time Remaining:** ${monthsLeft} months
            - **Required Monthly Savings:** ${requiredMonthlyContribution.toLocaleString(undefined, {maximumFractionDigits: 0})} SAR/month
            - **Projected Monthly Savings:** ${projectedMonthlyContribution.toLocaleString(undefined, {maximumFractionDigits: 0})} SAR/month (based on current allocation)

            **Your Task:**
            1.  **Status Assessment:** In one friendly sentence, state if the goal is on track, needs attention, or is at risk based on the data. Be direct.
            2.  **Actionable Steps:** Provide a maximum of two short, powerful, and creative bullet points for what to do next. Do not write an essay.

            Example for "On Track":
            ### Status Assessment
            Great job! You're on track to reach your "${goal.name}" goal.

            ### Next Steps
            - **Maintain Momentum:** Keep your savings allocation consistent to cruise to your target.
            - **Explore Acceleration:** Consider linking a high-performing investment to this goal to potentially reach it even faster.

            Example for "Needs Attention":
            ### Status Assessment
            You're making good progress, but your "${goal.name}" goal needs a small boost to stay on track.

            ### Next Steps
            - **Increase Allocation:** Try increasing your savings allocation for this goal by a few percentage points on the main Goals page.
            - **Review Spending:** Look for one small recurring expense in your 'Transactions' you could cut to redirect funds here.

            Provide the analysis for the user's goal now.
        `;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        const result = response.text || "Could not generate plan.";
        setToCache(cacheKey, result);
        return result;
    } catch (error) { return formatAiError(error); }
};

export const getAIGoalStrategyAnalysis = async (goals: Goal[], monthlySavings: number, allData: FinancialData): Promise<string> => {
    try {
         const goalDataWithProgress = goals.map(goal => {
            const linkedItemsValue = allData.assets.filter(a => a.goalId === goal.id).reduce((sum, a) => sum + a.value, 0) + 
                                  allData.investments.flatMap(p => p.holdings).filter(h => h.goalId === goal.id).reduce((sum, h) => sum + h.currentValue, 0);
            
            const currentAmount = linkedItemsValue;
            const progress = goal.targetAmount > 0 ? (currentAmount / goal.targetAmount) * 100 : 0;
            return `- ${goal.name}: ${progress.toFixed(0)}% complete`;
        }).join('\n');

        const totalAllocatedPercent = goals.reduce((sum, g) => sum + (g.savingsAllocationPercent || 0), 0);
        const allocatedSavings = monthlySavings * (totalAllocatedPercent / 100);

        const prompt = `
            You are "HS", a sharp and encouraging AI strategist. Analyze the user's overall goal portfolio based on the following data. Your response must be direct, concise, and in Markdown format.

            **Strategic Overview:**
            - **Total Monthly Savings Capacity:** ${monthlySavings.toLocaleString(undefined, {maximumFractionDigits: 0})} SAR
            - **Currently Allocated Savings:** ${allocatedSavings.toLocaleString(undefined, {maximumFractionDigits: 0})} SAR (${totalAllocatedPercent}%)
            - **Number of Goals:** ${goals.length}
            - **Individual Goal Progress:**
            ${goalDataWithProgress}

            **Your Task:**
            1.  **Overall Assessment (1 sentence):** Start with a single, powerful sentence summarizing the health of their overall goal strategy.
            2.  **Key Insight (1 bullet point):** Provide one crucial observation about their strategy (e.g., are they under-utilizing savings? are they spreading too thin?).
            3.  **Strategic Recommendation (1 bullet point):** Offer one high-impact, actionable recommendation to improve their strategy. Be specific.

            Example:
            ### Strategic Analysis
            Your goal strategy is solid, but you have untapped potential to accelerate your progress.
            - **Key Insight:** You currently have ${((monthlySavings - allocatedSavings)).toLocaleString(undefined, {maximumFractionDigits: 0})} SAR of unallocated savings each month.
            - **Strategic Recommendation:** Consider applying the 'Goal Avalanche' method: allocate your unallocated savings to the goal with the highest required monthly contribution to secure it faster.

            Provide the analysis for the user's goals now.
        `;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not generate analysis.";
    } catch (error) { return formatAiError(error); }
};

export const getAIRebalancingPlan = async (holdings: Holding[], riskProfile: 'Conservative' | 'Moderate' | 'Aggressive'): Promise<string> => {
    try {
        const holdingsSummary = holdings.map(h => `${h.symbol}: ${h.currentValue.toFixed(0)} SAR (${h.assetClass})`).join(', ');
        const prompt = `You are a portfolio analyst providing educational content. A user with a "${riskProfile}" profile has these holdings: ${holdingsSummary}. Generate a rebalancing plan analysis in markdown. Your response must not contain any HTML. Sections: Current Portfolio Analysis, Target Allocation for a ${riskProfile} Profile, Educational Rebalancing Suggestions. Do not give financial advice.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not retrieve plan.";
    } catch (error) { return formatAiError(error); }
};

export const getAIStockAnalysis = async (holding: Holding): Promise<{ content: string, groundingChunks: any[] }> => {
    const cacheKey = `getAIStockAnalysis:${holding.symbol}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    try {
        const prompt = `You are a financial analyst. Using Google Search, provide a concise analyst report summary for the stock ${holding.name} (${holding.symbol}). 
        Respond in markdown. Your response must not contain any HTML tags.
        Include these sections using '###' headers:
        - ### Recent News Summary: A brief of the latest significant news.
        - ### General Analyst Sentiment: Summarize the current market sentiment (e.g., bullish, bearish, neutral).
        Do not give direct buy/sell financial advice.`;
        const response = await invokeAI({
            model: FAST_MODEL,
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] }
        });
        const content = response.text || "Could not retrieve analysis.";
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const result = { content, groundingChunks };
        setToCache(cacheKey, result);
        return result;
    } catch (error) {
        return { content: formatAiError(error), groundingChunks: [] };
    }
};


export const getAIHolisticPlan = async (goals: Goal[], income: number, expenses: number): Promise<string> => {
    try {
        const prompt = `You are a holistic financial planner providing educational guidance. User overview: Monthly Income: ${income}, Monthly Expenses: ${expenses}, Goals: ${goals.length}. Generate a strategic financial plan in markdown. Your response must not contain any HTML tags. Sections: Financial Health Snapshot, Goal-Oriented Strategy, General Recommendations for Research. Do not give specific financial advice.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not generate plan.";
    } catch (error) { return formatAiError(error); }
};

export const getAICategorySuggestion = async (description: string, categories: string[]): Promise<string> => {
    try {
        const prompt = `You are an automated financial assistant. Categorize this transaction: "${description}". Choose one category from this list: [${categories.join(', ')}]. Respond with only the category name.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text?.trim() || "";
    } catch (error) {
        console.error("Error fetching AI category suggestion:", error);
        throw error;
    }
};

export const getAICommodityPrices = async (commodities: Pick<CommodityHolding, 'symbol' | 'name'>[]): Promise<{ prices: { symbol: string; price: number }[], groundingChunks: any[] }> => {
    if (commodities.length === 0) return { prices: [], groundingChunks: [] };

    try {
        const commodityList = commodities.map(c => `${c.name} (${c.symbol})`).join(', ');
        const prompt = `
            Provide the current market prices in Saudi Riyal (SAR) for the following commodities: ${commodityList}.
            For Gold (XAU_GRAM) and Silver (XAG_GRAM), provide the price per gram in SAR. For Bitcoin (BTC_USD), provide the price per BTC in SAR. For any others, provide the price per unit in SAR.
            Return the result as a JSON array based on the provided schema.
        `;

        const response = await invokeAI({
            model: FAST_MODEL,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            symbol: { type: Type.STRING, description: "The commodity symbol, e.g., XAU_GRAM" },
                            price: { type: Type.NUMBER, description: "The current market price in SAR." }
                        },
                        required: ["symbol", "price"]
                    }
                },
                tools: [{ googleSearch: {} }],
            }
        });

        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const prices = robustJsonParse(response.text);
        
        return { prices: prices || [], groundingChunks };

    } catch (error) {
        console.error("Error fetching AI commodity prices:", error);
        throw error;
    }
};

export const getAIDividendAnalysis = async (ytdIncome: number, projectedAnnual: number, topPayers: {name: string, projected: number}[]): Promise<string> => {
    try {
        const prompt = `You are a financial analyst specializing in dividend income. Analyze the following dividend data and provide a brief, insightful analysis in Markdown. Do not give financial advice, and do not include HTML tags.
        - Year-to-Date (YTD) Dividend Income: ${ytdIncome.toLocaleString()} SAR
        - Projected Annual Dividend Income: ${projectedAnnual.toLocaleString()} SAR
        - Top Dividend Contributors: ${topPayers.map(p => `${p.name} (~${p.projected.toLocaleString()} SAR/yr)`).join(', ')}

        Your analysis should cover:
        1.  The relationship between YTD and projected income (is it on track?).
        2.  Concentration risk based on the top contributors.
        3.  One educational suggestion for improving a dividend strategy.
        `;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not retrieve dividend analysis.";
    } catch (error) { return formatAiError(error); }
};

export async function executeInvestmentPlanStrategy(plan: InvestmentPlanSettings, universe: UniverseTicker[]): Promise<InvestmentPlanExecutionResult> {
    console.log('Executing investment plan with:', { plan, universe });

    const coreTickers = universe.filter(t => t.status === 'Core');
    const upsideTickers = universe.filter(t => t.status === 'High-Upside');

    const prompt = `
    You are a sophisticated financial analyst AI. Your task is to execute a monthly investment plan based on a "Core + Analyst-Upside Sleeve" strategy.

    **User's Plan:**
    - Monthly Budget: ${plan.monthlyBudget} ${plan.budgetCurrency}
    - Core Allocation: ${plan.coreAllocation * 100}%
    - High-Upside Allocation: ${plan.upsideAllocation * 100}%
    - Minimum Upside for Sleeve: ${plan.minimumUpsidePercentage}%

    **Portfolio Definitions:**
    - Core Portfolio (${coreTickers.join(', ')}): Target weights are ${JSON.stringify(plan.corePortfolio)}
    - High-Upside Sleeve (${upsideTickers.join(', ')}): Target weights are ${JSON.stringify(plan.upsideSleeve)}

    **Execution Steps:**
    1.  **Fetch Data:** Get the current stock price and the average 12-month analyst price target for all tickers in the High-Upside Sleeve.
    2.  **Calculate Upside:** For each sleeve ticker, calculate the potential upside: ((Analyst Target / Current Price) - 1) * 100.
    3.  **Determine Eligibility:** Identify which sleeve tickers meet the minimum upside requirement of ${plan.minimumUpsidePercentage}%.
    4.  **Allocate Funds:**
        a. Calculate the total funds for each sleeve: Core gets ${plan.monthlyBudget * plan.coreAllocation} ${plan.budgetCurrency}, High-Upside gets ${plan.monthlyBudget * plan.upsideAllocation} ${plan.budgetCurrency}.
        b. Allocate the High-Upside funds to the *eligible* tickers according to their defined weights.
        c. **Crucially, any funds allocated to a High-Upside ticker that was *not* eligible must be reallocated back to the Core portfolio.**
    5.  **Calculate Final Allocations:** Determine the final dollar amount to be invested in each Core ticker (initial allocation + reallocated funds) and each eligible High-Upside ticker.
    6.  **Generate Trades:** Create a list of proposed trades (buy orders) for each stock with the final calculated investment amount.

    Please provide the result as a single JSON object using the 'generate_investment_trades' function.
    `;

    const generateTradesFunction: FunctionDeclaration = {
        name: 'generate_investment_trades',
        description: 'Generates a list of proposed trades based on the investment plan execution.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                totalInvestment: { type: Type.NUMBER },
                coreInvestment: { type: Type.NUMBER },
                upsideInvestment: { type: Type.NUMBER },
                unusedUpsideFunds: { type: Type.NUMBER },
                trades: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            ticker: { type: Type.STRING },
                            amount: { type: Type.NUMBER },
                            reason: { type: Type.STRING },
                        },
                        required: ['ticker', 'amount', 'reason'],
                    },
                },
            },
            required: ['totalInvestment', 'coreInvestment', 'upsideInvestment', 'unusedUpsideFunds', 'trades'],
        },
    };

    try {
        const result = await invokeAI({
            model: 'gemini-3.1-pro-preview',
            contents: [{ parts: [{ text: prompt }] }],
            config: {
                tools: [{ functionDeclarations: [generateTradesFunction] }],
            }
        });

        if (result.functionCalls && result.functionCalls.length > 0) {
            const args = result.functionCalls[0].args;
            return {
                date: new Date().toISOString(),
                ...args,
            } as InvestmentPlanExecutionResult;
        }
        throw new Error('AI did not return the expected function call.');

    } catch (error) {
        console.error('Error executing investment plan strategy with AI:', error);
        throw new Error('Failed to get investment plan execution from AI.');
    }
}