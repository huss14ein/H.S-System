import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { KPISummary, Holding, Goal, InvestmentTransaction, WatchlistItem, Transaction, Budget, FinancialData, InvestmentPortfolio, CommodityHolding, FeedItem, PersonaAnalysis } from '../types';
import { supabase } from './supabaseClient';

// --- Client-side Gemini Initialization ---
// Check for a client-side API key. If present, use it directly. Otherwise, fall back to the proxy.
const clientSideApiKey = import.meta.env.VITE_GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (clientSideApiKey) {
    console.log("Using client-side Gemini API key. AI requests will bypass the proxy.");
    ai = new GoogleGenAI({ apiKey: clientSideApiKey });
} else {
    console.log("Using Supabase proxy for Gemini API calls.");
}
// --- End Initialization ---


// --- Model Constants ---
// Use stable model aliases to avoid issues with preview model lifecycles.
// FIX: Updated model aliases to recommended versions for better performance and features.
const FAST_MODEL = 'gemini-3-flash-preview';
const DEEP_MODEL = 'gemini-3-pro-preview';

// --- AI Error Formatting ---
function formatAiError(error: any): string {
    console.error("Error from AI Service:", error);
    if (error instanceof Error) {
        // Provide more actionable feedback for common issues.
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
    
    // Attempt to find JSON within markdown code blocks
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

// Helper function to securely invoke the Gemini API via a Supabase Edge Function.
async function invokeGeminiProxy(payload: { model: string, contents: any, config?: any }): Promise<any> {
    if (!supabase) {
        const errorMsg = "AI features are disabled because the backend (Supabase) is not configured. Please check your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.";
        console.error(errorMsg);
        throw new Error(errorMsg);
    }

    const { data, error } = await supabase.functions.invoke('gemini-proxy', {
        body: payload,
    });

    if (error) {
        console.error("Error invoking Gemini proxy function:", error);
        throw new Error(`AI service error: ${error.message}`);
    }
    
    if (data.error) {
         console.error("Error from Gemini proxy function:", data.error);
         throw new Error(`AI service error: ${data.error}`);
    }
    
    return data;
}

// Unified AI invocation function. Decides whether to use client-side SDK or proxy.
export async function invokeAI(payload: { model: string, contents: any, config?: any }): Promise<any> {
    if (ai) {
        // Use client-side SDK
        try {
            const response: GenerateContentResponse = await ai.models.generateContent(payload);
            // Replicate the proxy response structure for consistency
            return {
                text: response.text,
                candidates: response.candidates,
                functionCalls: response.functionCalls,
            };
        } catch (error) {
            // Re-throw with a formatted message
            throw new Error(formatAiError(error));
        }
    } else {
        // Use Supabase proxy
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
    // Create a copy before sorting to avoid mutating state
    const sortedHoldings = [...firstPortfolio.holdings].sort((a, b) => b.currentValue - a.currentValue);
    return sortedHoldings[0]?.symbol || 'N/A';
};


export const getAIFeedInsights = async (data: FinancialData): Promise<FeedItem[]> => {
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
            - Top Investment Holding: ${getTopHoldingSymbol(data.investments)}
            Generate a JSON array of feed items based on the provided schema. Each item should have a 'type', 'title', 'description', and a relevant emoji.
        `;

        const response = await invokeAI({
            model: DEEP_MODEL,
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
        return Array.isArray(items) ? items : [];
    } catch (error) {
        console.error("Error fetching AI Feed insights:", error);
        return [];
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
    
    const response = await invokeAI({
      model: FAST_MODEL,
      contents: prompt,
    });

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
        const budgetSummary = budgets.map(b => `- **${b.category}**: Limit ${b.limit.toLocaleString()} SAR`).join('\n');
        const prompt = `
            You are a helpful budget analyst. Based on the following monthly spending summary, provide a brief, insightful analysis in Markdown.
            Your response must be in Markdown format only and contain no HTML tags.
            Highlight the top spending category, budget adherence, and one practical suggestion.
            Monthly Budget Summary:
            ${budgetSummary}
            Provide the Markdown analysis now.
        `;

        const response = await invokeAI({
            model: FAST_MODEL,
            contents: prompt,
        });
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
            model: DEEP_MODEL,
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
        return null;
    }
};

export const getAIPlanAnalysis = async (totals: any, scenarios: any): Promise<string> => {
    const cacheKey = `getAIPlanAnalysis:${JSON.stringify(totals)}:${JSON.stringify(scenarios)}`;
    const cached = getFromCache(cacheKey);
    if(cached) return cached;
    
    try {
        const { totalPlannedIncome, totalPlannedExpenses, projectedNet } = totals;
        const { incomeShock, expenseStress } = scenarios;
        const prompt = `
            You are a financial planning analyst. Based on the user's annual plan and active 'what-if' scenarios, provide a brief, insightful analysis in Markdown.
            Your response must be in Markdown format only and contain no HTML tags.

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
            You are a senior investment analyst providing a high-level summary of a user's investment portfolio. Your response must be in Markdown format only and contain no HTML tags.
            Analyze the following data:

            1.  **Portfolio Allocation (Value by portfolio):**
                ${portfolioAllocation.map(p => `- ${p.name}: ${p.value.toLocaleString()} SAR`).join('\n')}

            2.  **Asset Class Allocation (Value by asset type):**
                ${assetClassAllocation.map(a => `- ${a.name}: ${a.value.toLocaleString()} SAR`).join('\n')}

            3.  **Top 5 Holdings by Performance:**
                ${topHoldings.slice(0, 5).map(h => `- ${h.name}: ${h.gainLossPercent.toFixed(2)}%`).join('\n')}

            Your analysis should have two sections using '###' headers:
            - ### Composition & Diversification: Comment on how the investments are spread across different portfolios and asset classes. Is there a heavy concentration?
            - ### Performance Highlights: Briefly mention any standout performers from the top holdings list.
            
            Keep the analysis concise and educational. Do not provide financial advice. Provide the Markdown analysis now.
        `;

        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        const result = response.text || "Could not retrieve analysis.";
        setToCache(cacheKey, result);
        return result;

    } catch (error) {
        return formatAiError(error);
    }
};


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
        const response = await invokeAI({ model: DEEP_MODEL, contents: prompt, config: { thinkingConfig: { thinkingBudget: 32768 } } });
        return response.text || "Could not retrieve analysis.";
    } catch (error) { return formatAiError(error); }
};

export const getAIStrategy = async (holdings: Holding[]): Promise<string> => {
    try {
        const prompt = `You are an investment strategist. Analyze these holdings and provide educational strategic ideas in markdown. Your response must not contain any HTML. Sections: Current Strategy Assessment, Strategic Opportunities & Ideas. Do not give financial advice. Holdings: ${holdings.map(h => h.symbol).join(', ')}`;
        const response = await invokeAI({ model: DEEP_MODEL, contents: prompt });
        return response.text || "Could not retrieve strategy.";
    } catch (error) { return formatAiError(error); }
};

export const getAIResearchNews = async (stocks: (Holding | WatchlistItem)[]): Promise<string> => {
    try {
        const prompt = `You are a financial news analyst. For these stocks (${stocks.map(s => s.symbol).join(', ')}), generate a realistic but fictional summary of market news and dividend announcements in markdown. Do not use any HTML tags in your response.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not retrieve news.";
    } catch (error) { return formatAiError(error); }
};

export const getAITradeAnalysis = async (transactions: InvestmentTransaction[]): Promise<string> => {
    try {
        const prompt = `You are an educational trading coach. Analyze these recent transactions and provide educational feedback in markdown. Your response must not contain any HTML. Sections: Trading Pattern Analysis, Potential Portfolio Impact, Key Concept for Research. Avoid financial advice. Transactions: ${transactions.length} recent trades.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not retrieve analysis.";
    } catch (error) { return formatAiError(error); }
};

export const getGoalAIPlan = async (goal: Goal): Promise<string> => {
    const cacheKey = `getGoalAIPlan:${goal.id}:${goal.currentAmount}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    try {
        const prompt = `You are a financial coach. A user has a goal: ${goal.name}. Target: ${goal.targetAmount}, Current: ${goal.currentAmount}, Deadline: ${goal.deadline}. Generate a simple, encouraging, actionable plan in Markdown format. Your response must not contain any HTML tags.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        const result = response.text || "Could not generate plan.";
        setToCache(cacheKey, result);
        return result;
    } catch (error) { return formatAiError(error); }
};

export const getAIGoalStrategyAnalysis = async (goals: Goal[], monthlySavings: number): Promise<string> => {
    try {
        const prompt = `You are a financial advisor. Analyze the user's overall goal savings strategy. Total Monthly Savings: ${monthlySavings}. Goals: ${goals.length} goals. Provide a holistic analysis in markdown. Do not use any HTML tags in your response.`;
        const response = await invokeAI({ model: DEEP_MODEL, contents: prompt });
        return response.text || "Could not generate analysis.";
    } catch (error) { return formatAiError(error); }
};

export const getAIRebalancingPlan = async (holdings: Holding[], riskProfile: 'Conservative' | 'Moderate' | 'Aggressive'): Promise<string> => {
    try {
        const holdingsSummary = holdings.map(h => `${h.symbol}: ${h.currentValue.toFixed(0)} SAR (${h.assetClass})`).join(', ');
        const prompt = `You are a portfolio analyst providing educational content. A user with a "${riskProfile}" profile has these holdings: ${holdingsSummary}. Generate a rebalancing plan analysis in markdown. Your response must not contain any HTML. Sections: Current Portfolio Analysis, Target Allocation for a ${riskProfile} Profile, Educational Rebalancing Suggestions. Do not give financial advice.`;
        const response = await invokeAI({ model: DEEP_MODEL, contents: prompt });
        return response.text || "Could not retrieve plan.";
    } catch (error) { return formatAiError(error); }
};

export const getAIStockAnalysis = async (holding: Holding): Promise<string> => {
    const cacheKey = `getAIStockAnalysis:${holding.symbol}`; // Cache this for a while
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    try {
        const prompt = `You are a creative financial content generator. For the stock ${holding.name} (${holding.symbol}), generate a brief, fictional but realistic analyst report in markdown. Your response must not contain any HTML tags. Sections: Fictional Analyst Rating, Fictional Recent News. Do not use real-time data or give financial advice.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        const result = response.text || "Could not retrieve analysis.";
        setToCache(cacheKey, result);
        return result;
    } catch (error) { return formatAiError(error); }
};

export const getAIHolisticPlan = async (goals: Goal[], income: number, expenses: number): Promise<string> => {
    try {
        const prompt = `You are a holistic financial planner providing educational guidance. User overview: Monthly Income: ${income}, Monthly Expenses: ${expenses}, Goals: ${goals.length}. Generate a strategic financial plan in markdown. Your response must not contain any HTML tags. Sections: Financial Health Snapshot, Goal-Oriented Strategy, General Recommendations for Research. Do not give specific financial advice.`;
        const response = await invokeAI({ model: DEEP_MODEL, contents: prompt });
        return response.text || "Could not generate plan.";
    } catch (error) { return formatAiError(error); }
};

export const getAICategorySuggestion = async (description: string, categories: string[]): Promise<string> => {
    try {
        const prompt = `You are an automated financial assistant. Categorize this transaction: "${description}". Choose one category from this list: [${categories.join(', ')}]. Respond with only the category name.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text?.trim() || "";
    } catch (error) { console.error(error); return ""; }
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
            model: DEEP_MODEL,
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
        return { prices: [], groundingChunks: [] };
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