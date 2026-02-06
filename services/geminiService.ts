import { GoogleGenAI, Type } from "@google/genai";
import { KPISummary, Holding, Goal, InvestmentTransaction, WatchlistItem, Transaction, Budget, FinancialData } from '../types';

// --- AI Request Cache ---
// Simple in-memory cache to avoid redundant API calls for the same data.
const aiAnalysisCache = new Map<string, { timestamp: number; result: string }>();
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

function getFromCache(key: string): string | null {
    const cached = aiAnalysisCache.get(key);
    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION_MS)) {
        console.log("Returning AI analysis from cache.");
        return cached.result;
    }
    aiAnalysisCache.delete(key); // Stale entry
    return null;
}

function setToCache(key: string, result: string) {
    aiAnalysisCache.set(key, { timestamp: Date.now(), result });
}
// --- End AI Request Cache ---


// Helper function to get the AI client only when needed.
function getAiClient() {
    // FIX: Use import.meta.env.VITE_GEMINI_API_KEY as this is the only
    // method that works in this project's direct-to-browser importmap setup.
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
        console.warn("VITE_GEMINI_API_KEY environment variable not set. AI features will be disabled.");
        return null;
    }
    return new GoogleGenAI({ apiKey });
}

export const getAIFeedInsights = async (data: FinancialData): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "[]";

    // Feed insights should always be fresh, so we don't cache this.
    try {
        const prompt = `
            You are a proactive financial analyst for the Wealth Ultra platform. 
            Analyze the user's complete financial data and generate a prioritized list of 4-5 insightful, encouraging, and actionable feed items.
            Prioritize the most important and timely information.
            Financial Data Snapshot:
            - Net Worth: Calculate from assets, accounts, and liabilities.
            - Recent Transactions: ${data.transactions.slice(0, 5).map(t => `${t.description}: ${t.amount}`).join(', ')}
            - Budget Performance: ${data.budgets.map(b => `${b.category} limit ${b.limit}`).join(', ')}
            - Goal Progress: ${data.goals.map(g => `${g.name} is at ${((g.currentAmount/g.targetAmount)*100).toFixed(0)}%`).join(', ')}
            - Top Investment Holding: ${data.investments[0]?.holdings.sort((a,b) => b.currentValue - a.currentValue)[0]?.symbol}
            Generate a JSON array of feed items based on the provided schema. Each item should have a 'type', 'title', 'description', and a relevant emoji.
        `;

        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
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
        return response.text || "[]";
    } catch (error) {
        console.error("Error fetching AI Feed insights:", error);
        return "[]";
    }
};


export const getAIAnalysis = async (summary: KPISummary): Promise<string> => {
  const ai = getAiClient();
  if (!ai) return "AI features are disabled because the API key is not configured.";

  const cacheKey = `getAIAnalysis:${JSON.stringify(summary)}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const prompt = `
      You are a helpful personal finance assistant. Based on the following financial summary (all values in SAR), provide a brief, insightful, and encouraging analysis in HTML.
      Explain trends in net worth, investment returns, and asset allocation.
      Start with a general overview, then provide two bullet points using <strong> for the title:
      - **Positive Trends:** Mention 1-2 positive aspects.
      - **Areas to Watch:** Gently point out 1-2 areas for improvement.
      Financial Summary:
      - Net Worth: ${summary.netWorth.toLocaleString()}
      - Monthly Income: ${summary.monthlyIncome.toLocaleString()}
      - Monthly Expenses: ${summary.monthlyExpenses.toLocaleString()}
      - Total Investment ROI: ${(summary.roi * 100).toFixed(1)}%
      Provide the HTML analysis now.
    `;
    
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    const result = response.text || "Could not retrieve AI analysis.";
    setToCache(cacheKey, result);
    return result;

  } catch (error) {
    console.error("Error fetching AI analysis:", error);
    return "An error occurred while generating the AI analysis.";
  }
};

export const getAITransactionAnalysis = async (transactions: Transaction[], budgets: Budget[]): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "AI features are disabled.";
    
    const cacheKey = `getAITransactionAnalysis:${transactions.length}:${budgets.length}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
        const budgetSummary = budgets.map(b => `- **${b.category}**: Limit ${b.limit.toLocaleString()} SAR`).join('\n');
        const prompt = `
            You are a helpful budget analyst. Based on the following monthly spending summary, provide a brief, insightful analysis in HTML.
            Highlight the top spending category, budget adherence, and one practical suggestion.
            Monthly Budget Summary:
            ${budgetSummary}
            Provide the HTML analysis now.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });
        const result = response.text || "Could not retrieve transaction analysis.";
        setToCache(cacheKey, result);
        return result;
    } catch (error) {
        console.error("Error fetching transaction analysis:", error);
        return "An error occurred.";
    }
};


export const getAIFinancialPersona = async (
    savingsRate: number,
    debtToAssetRatio: number,
    emergencyFundMonths: number,
    investmentStyle: string
): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "{}";

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

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-preview',
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
        const result = response.text || "{}";
        setToCache(cacheKey, result);
        return result;

    } catch (error) {
        console.error("Error fetching AI financial persona:", error);
        return "{}";
    }
};

export const getAIPlanAnalysis = async (totals: any, scenarios: any): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "AI features are disabled.";
    const cacheKey = `getAIPlanAnalysis:${JSON.stringify(totals)}:${JSON.stringify(scenarios)}`;
    const cached = getFromCache(cacheKey);
    if(cached) return cached;
    
    try {
        const { totalPlannedIncome, totalPlannedExpenses, projectedNet } = totals;
        const { incomeShock, expenseStress } = scenarios;
        const prompt = `
            You are a financial planning analyst. Based on the user's annual plan and active 'what-if' scenarios, provide a brief, insightful analysis in HTML.
            
            Annual Plan Summary:
            - Planned Income: ${totalPlannedIncome.toLocaleString()} SAR
            - Planned Expenses: ${totalPlannedExpenses.toLocaleString()} SAR
            - Projected Annual Savings: ${projectedNet.toLocaleString()} SAR

            Active Scenarios:
            - Income Shock: ${incomeShock.percent}% change for ${incomeShock.duration} months.
            - Expense Stress: ${expenseStress.percent}% increase for the "${expenseStress.category}" category.

            Your analysis should:
            1.  Comment on the base plan's health (e.g., savings rate).
            2.  Explain the impact of the active scenarios on their projected savings.
            3.  Provide one strategic suggestion to improve their plan's resilience.
            
            Provide the HTML analysis now.
        `;
        const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
        const result = response.text || "Could not retrieve plan analysis.";
        setToCache(cacheKey, result);
        return result;
    } catch(e) {
        console.error("Error fetching AI Plan analysis", e);
        return "An error occurred.";
    }
}

export const getAIAnalysisPageInsights = async (
    spendingData: { name: string; value: number }[],
    trendData: { name: string; income: number; expenses: number }[],
    compositionData: { name: string; value: number }[]
): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "AI features are disabled.";
    
    const cacheKey = `getAIAnalysisPageInsights:${JSON.stringify(spendingData)}:${JSON.stringify(trendData)}:${JSON.stringify(compositionData)}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
        const prompt = `
            You are a senior financial analyst providing a holistic overview based on three key charts. Analyze the following data and provide a concise, insightful summary in HTML format.

            1.  **Spending by Budget Category (YTD):**
                ${spendingData.slice(0, 5).map(d => `- ${d.name}: ${d.value.toLocaleString()} SAR`).join('\n')}

            2.  **Monthly Income vs. Expense Trend (Recent Months):**
                ${trendData.map(d => `- ${d.name}: Income ${d.income.toLocaleString()} SAR, Expenses ${d.expenses.toLocaleString()} SAR`).join('\n')}

            3.  **Current Financial Position (Assets vs. Liabilities):**
                ${compositionData.map(d => `- ${d.name}: ${d.value.toLocaleString()} SAR`).join('\n')}

            Your analysis should have three sections using <h3> tags:
            - ### Spending Habits: Comment on the top spending categories. Is spending concentrated?
            - ### Cash Flow Dynamics: Analyze the income vs. expense trend. Is the user saving money consistently?
            - ### Balance Sheet Health: Interpret the asset vs. liability composition. Is the user building wealth effectively?
            
            Provide the HTML analysis now.
        `;

        const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
        const result = response.text || "Could not retrieve analysis.";
        setToCache(cacheKey, result);
        return result;

    } catch (error) {
        console.error("Error fetching Analysis Page insights:", error);
        return "An error occurred during analysis.";
    }
};

export const getInvestmentAIAnalysis = async (holdings: Holding[]): Promise<string> => {
  const ai = getAiClient();
  if (!ai) return "AI features are disabled.";
  const cacheKey = `getInvestmentAIAnalysis:${holdings.map(h => h.symbol + h.quantity).join(',')}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const prompt = `You are an expert investment analyst. Based on these holdings, provide a brief analysis on diversification and concentration risk. Do not give financial advice. Holdings: ${holdings.map(h => h.symbol).join(', ')}`;
    const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
    const result = response.text || "Could not retrieve analysis.";
    setToCache(cacheKey, result);
    return result;
  } catch (error) { console.error(error); return "An error occurred."; }
};

export const getPlatformPerformanceAnalysis = async (holdings: (Holding & { gainLoss: number; gainLossPercent: number; })[]): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "AI features are disabled.";
    try {
        const prompt = `You are a portfolio manager. Based on unrealized gains/losses, provide a performance and risk analysis in markdown. Sections: Key Performance Contributors, Key Performance Detractors, Risk Assessment. Holdings: ${holdings.length} assets.`;
        const response = await ai.models.generateContent({ model: 'gemini-3-pro-preview', contents: prompt, config: { thinkingConfig: { thinkingBudget: 32768 } } });
        return response.text || "Could not retrieve analysis.";
    } catch (error) { console.error(error); return "An error occurred."; }
};

export const getAIStrategy = async (holdings: Holding[]): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "AI features are disabled.";
    try {
        const prompt = `You are an investment strategist. Analyze these holdings and provide educational strategic ideas in markdown. Sections: Current Strategy Assessment, Strategic Opportunities & Ideas. Do not give financial advice. Holdings: ${holdings.map(h => h.symbol).join(', ')}`;
        const response = await ai.models.generateContent({ model: 'gemini-3-pro-preview', contents: prompt });
        return response.text || "Could not retrieve strategy.";
    } catch (error) { console.error(error); return "An error occurred."; }
};

export const getAIResearchNews = async (stocks: (Holding | WatchlistItem)[]): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "AI features are disabled.";
    try {
        const prompt = `You are a financial news analyst. For these stocks (${stocks.map(s => s.symbol).join(', ')}), generate a realistic but fictional summary of market news and dividend announcements in markdown.`;
        const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
        return response.text || "Could not retrieve news.";
    } catch (error) { console.error(error); return "An error occurred."; }
};

export const getAITradeAnalysis = async (transactions: InvestmentTransaction[]): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "AI features are disabled.";
    try {
        const prompt = `You are an educational trading coach. Analyze these recent transactions and provide educational feedback in markdown. Sections: Trading Pattern Analysis, Potential Portfolio Impact, Key Concept for Research. Avoid financial advice. Transactions: ${transactions.length} recent trades.`;
        const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
        return response.text || "Could not retrieve analysis.";
    } catch (error) { console.error(error); return "An error occurred."; }
};

export const getGoalAIPlan = async (goal: Goal): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "AI features are disabled.";
    const cacheKey = `getGoalAIPlan:${goal.id}:${goal.currentAmount}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    try {
        const prompt = `You are a financial coach. A user has a goal: ${goal.name}. Target: ${goal.targetAmount}, Current: ${goal.currentAmount}, Deadline: ${goal.deadline}. Generate a simple, encouraging, actionable plan.`;
        const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
        const result = response.text || "Could not generate plan.";
        setToCache(cacheKey, result);
        return result;
    } catch (error) { console.error(error); return "An error occurred."; }
};

export const getAIGoalStrategyAnalysis = async (goals: Goal[], monthlySavings: number): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "AI features are disabled.";
    try {
        const prompt = `You are a financial advisor. Analyze the user's overall goal savings strategy. Total Monthly Savings: ${monthlySavings}. Goals: ${goals.length} goals. Provide a holistic analysis in markdown.`;
        const response = await ai.models.generateContent({ model: 'gemini-3-pro-preview', contents: prompt });
        return response.text || "Could not generate analysis.";
    } catch (error) { console.error(error); return "An error occurred."; }
};

export const getAIRebalancingPlan = async (holdings: Holding[], riskProfile: 'Conservative' | 'Moderate' | 'Aggressive'): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "AI features are disabled.";
    try {
        const holdingsSummary = holdings.map(h => `${h.symbol}: ${h.currentValue.toFixed(0)} SAR (${h.assetClass})`).join(', ');
        const prompt = `You are a portfolio analyst providing educational content. A user with a "${riskProfile}" profile has these holdings: ${holdingsSummary}. Generate a rebalancing plan analysis in markdown. Sections: Current Portfolio Analysis, Target Allocation for a ${riskProfile} Profile, Educational Rebalancing Suggestions. Do not give financial advice.`;
        const response = await ai.models.generateContent({ model: 'gemini-3-pro-preview', contents: prompt });
        return response.text || "Could not retrieve plan.";
    } catch (error) { console.error(error); return "An error occurred."; }
};

export const getAIStockAnalysis = async (holding: Holding): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "AI features are disabled.";
    const cacheKey = `getAIStockAnalysis:${holding.symbol}`; // Cache this for a while
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    try {
        const prompt = `You are a creative financial content generator. For the stock ${holding.name} (${holding.symbol}), generate a brief, fictional but realistic analyst report in markdown. Sections: Fictional Analyst Rating, Fictional Recent News. Do not use real-time data or give financial advice.`;
        const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
        const result = response.text || "Could not retrieve analysis.";
        setToCache(cacheKey, result);
        return result;
    } catch (error) { console.error(error); return "An error occurred."; }
};

export const getAIHolisticPlan = async (goals: Goal[], income: number, expenses: number): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "AI features are disabled.";
    try {
        const prompt = `You are a holistic financial planner providing educational guidance. User overview: Monthly Income: ${income}, Monthly Expenses: ${expenses}, Goals: ${goals.length}. Generate a strategic financial plan in markdown. Sections: Financial Health Snapshot, Goal-Oriented Strategy, General Recommendations for Research. Do not give specific financial advice.`;
        const response = await ai.models.generateContent({ model: 'gemini-3-pro-preview', contents: prompt });
        return response.text || "Could not generate plan.";
    } catch (error) { console.error(error); return "An error occurred."; }
};

export const getAICategorySuggestion = async (description: string, categories: string[]): Promise<string> => {
    const ai = getAiClient();
    if (!ai) return "";
    try {
        const prompt = `You are an automated financial assistant. Categorize this transaction: "${description}". Choose one category from this list: [${categories.join(', ')}]. Respond with only the category name.`;
        const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
        return response.text?.trim() || "";
    } catch (error) { console.error(error); return ""; }
};