
import { GoogleGenAI, Type } from "@google/genai";
import { KPISummary, Holding, Goal, InvestmentTransaction, WatchlistItem, Transaction, Budget, FinancialData } from '../types';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.warn("API_KEY environment variable not set. AI features will be disabled.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

export const getAIFeedInsights = async (data: FinancialData): Promise<string> => {
    if (!API_KEY) {
        return "[]";
    }

    try {
        const prompt = `
            You are a proactive financial analyst for the Wealth Ultra platform. 
            Analyze the user's complete financial data and generate a prioritized list of 4-5 insightful, encouraging, and actionable feed items.
            
            Prioritize the most important and timely information (e.g., budget overages, major investment gains).

            Financial Data Snapshot:
            - Net Worth: Calculate from assets, accounts, and liabilities.
            - Recent Transactions: ${data.transactions.slice(0, 5).map(t => `${t.description}: ${t.amount}`).join(', ')}
            - Budget Performance: ${data.budgets.map(b => `${b.category} limit ${b.limit}`).join(', ')}
            - Goal Progress: ${data.goals.map(g => `${g.name} is at ${((g.currentAmount/g.targetAmount)*100).toFixed(0)}%`).join(', ')}
            - Top Investment Holding: ${data.investments[0]?.holdings.sort((a,b) => b.currentValue - a.currentValue)[0]?.symbol}

            Generate a JSON array of feed items based on the provided schema. Each item should have a 'type', 'title', 'description', and a relevant emoji.
            - For BUDGET, find the category with the highest spending or that is most over budget this month.
            - For GOAL, celebrate significant progress (e.g., crossing a 50% or 75% milestone).
            - For INVESTMENT, highlight the best or worst performing stock.
            - For SAVINGS, provide a motivational tip or observation about their recent cash flow.
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
                            title: { type: Type.STRING, description: "A short, catchy title for the feed item." },
                            description: { type: Type.STRING, description: "A one-sentence summary of the insight." },
                            emoji: { type: Type.STRING, description: "A single emoji character relevant to the item." }
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
  if (!API_KEY) {
    return "AI features are disabled because the API key is not configured.";
  }

  try {
    const prompt = `
      You are a helpful personal finance assistant for the Wealth Ultra platform. 
      Based on the following financial summary (all values in SAR), provide a brief, insightful, and encouraging analysis.
      Explain trends in net worth, investment returns, and asset allocation.
      The output should be a single string of HTML, using paragraphs (<p>) and bold tags (<strong>) for emphasis. Do not include markdown.
      
      Start with a general overview, then provide two bullet points using <strong> for the title:
      - **Positive Trends:** Mention 1-2 positive aspects, like strong savings or investment performance.
      - **Areas to Watch:** Gently point out 1-2 areas for improvement, like high expenses or concentration in certain assets.

      Financial Summary:
      - Net Worth: ${summary.netWorth.toLocaleString()}
      - Liquid Net Worth (Cash & Investments): ${summary.liquidNetWorth.toLocaleString()}
      - Total Assets Value: ${(summary.netWorth + Math.abs(summary.liabilitiesCoverage)).toLocaleString()}
      - Total Liabilities: ${summary.liabilitiesCoverage.toLocaleString()}
      - Monthly Income: ${summary.monthlyIncome.toLocaleString()}
      - Monthly Expenses: ${summary.monthlyExpenses.toLocaleString()}
      - Total Investment ROI: ${(summary.roi * 100).toFixed(1)}%
      - Asset Allocation: ${summary.assetMix.map(a => `${a.name}: ${(a.value / (summary.netWorth + Math.abs(summary.liabilitiesCoverage)) * 100).toFixed(1)}%`).join(', ')}

      Provide the HTML analysis now.
    `;
    
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || "Could not retrieve AI analysis.";

  } catch (error) {
    console.error("Error fetching AI analysis:", error);
    return "An error occurred while generating the AI analysis. Please check your API key and network connection.";
  }
};

export const getAITransactionAnalysis = async (transactions: Transaction[], budgets: Budget[]): Promise<string> => {
    if (!API_KEY) {
        return "AI features are disabled because the API key is not configured.";
    }

    try {
        const spending = new Map<string, number>();
        transactions
            .filter(t => t.type === 'expense')
            .forEach(t => {
                const currentSpend = spending.get(t.category) || 0;
                spending.set(t.category, currentSpend + Math.abs(t.amount));
            });

        const budgetSummary = budgets.map(b => {
            const spent = spending.get(b.category) || 0;
            const variance = b.limit - spent;
            return `- **${b.category}**: Spent ${spent.toLocaleString()} of ${b.limit.toLocaleString()} SAR (Variance: ${variance.toLocaleString()} SAR)`;
        }).join('\n');

        const prompt = `
            You are a helpful budget analyst for the Wealth Management System. 
            Based on the following monthly spending summary, provide a brief, insightful analysis.
            The output should be HTML. Do not include markdown.

            Start with a general overview of the spending. Then, highlight:
            - **Top Spending Category**: Identify the category with the highest spending.
            - **Budget Adherence**: Mention 1-2 categories that are well within budget and 1-2 that are over or close to the limit.
            - **A Smart Suggestion**: Provide one practical, encouraging tip for better budget management.

            Monthly Budget Summary:
            ${budgetSummary}

            Provide the HTML analysis now.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });

        return response.text || "Could not retrieve transaction analysis.";
    } catch (error) {
        console.error("Error fetching transaction analysis:", error);
        return "An error occurred while generating the analysis.";
    }
};


export const getAIFinancialPersona = async (
    savingsRate: number,
    debtToAssetRatio: number,
    emergencyFundMonths: number,
    investmentStyle: string
): Promise<string> => {
    if (!API_KEY) {
        return "AI features are disabled because the API key is not configured.";
    }

    try {
        const prompt = `
            Analyze the following financial metrics for a user of the Wealth Ultra platform.
            - Savings Rate: ${(savingsRate * 100).toFixed(1)}%
            - Debt-to-Asset Ratio: ${(debtToAssetRatio * 100).toFixed(1)}%
            - Emergency Fund: ${emergencyFundMonths.toFixed(1)} months of expenses
            - Investment Portfolio Style: ${investmentStyle}

            Based on this data, generate a financial persona and a detailed report card.
            The persona title should be creative and encouraging (e.g., "The Disciplined Planner", "The Growth Accumulator").
            The report card ratings must be one of: "Excellent", "Good", or "Needs Improvement".
            The analysis and suggestions should be concise (one sentence each) and educational. For suggestions, include concepts for the user to research, like "simple risk bands" or "diversification strategies".

            Return the entire response as a single JSON object matching the provided schema. Do not include any other text or markdown formatting.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        persona: {
                            type: Type.OBJECT,
                            properties: {
                                title: { type: Type.STRING },
                                description: { type: Type.STRING }
                            }
                        },
                        reportCard: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    metric: { type: Type.STRING },
                                    value: { type: Type.STRING },
                                    rating: { type: Type.STRING },
                                    analysis: { type: Type.STRING },
                                    suggestion: { type: Type.STRING }
                                }
                            }
                        }
                    }
                }
            }
        });

        return response.text || "{}";

    } catch (error) {
        console.error("Error fetching AI financial persona:", error);
        return "An error occurred while generating the AI analysis.";
    }
};


export const getInvestmentAIAnalysis = async (holdings: Holding[]): Promise<string> => {
  if (!API_KEY) {
    return "AI features are disabled because the API key is not configured.";
  }

  try {
    const holdingsSummary = holdings.map(h => 
      `- ${h.symbol}: ${h.quantity} shares, Current Value: ${h.currentValue.toLocaleString()} SAR`
    ).join('\n');

    const prompt = `
      You are an expert investment analyst for the Wealth Ultra platform. 
      Based on the following investment portfolio holdings, provide a brief analysis. 
      Do NOT give financial advice. Instead, focus on educational insights about portfolio structure.
      Comment on:
      1.  **Diversification**: How well is the portfolio spread across different assets?
      2.  **Concentration Risk**: Is there a heavy concentration in any single stock? What are the general risks associated with that?
      3.  **General Observations**: Provide high-level, educational observations about the portfolio's composition.

      Keep the analysis concise (2-3 short paragraphs) and easy for a retail investor to understand.

      Portfolio Holdings:
      ${holdingsSummary}

      Provide the analysis now.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || "Could not retrieve investment analysis.";
  } catch (error) {
    console.error("Error fetching investment analysis:", error);
    return "An error occurred while generating the investment analysis.";
  }
};

export const getPlatformPerformanceAnalysis = async (holdings: (Holding & { gainLoss: number; gainLossPercent: number; })[]): Promise<string> => {
    if (!API_KEY) {
        return "AI features are disabled because the API key is not configured.";
    }

    try {
        const holdingsSummary = holdings.map(h => 
            `- ${h.symbol}: Unrealized G/L: ${h.gainLoss.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} SAR (${h.gainLossPercent.toFixed(2)}%), Market Value: ${h.currentValue.toLocaleString()} SAR`
        ).join('\n');

        const prompt = `
            You are a professional portfolio manager for the Wealth Ultra platform, tasked with performance attribution.
            Based on the unrealized gains and losses for the following holdings, provide a deep and comprehensive performance and risk analysis.
            Structure your response in markdown with the following sections:
            
            ### Key Performance Contributors
            Identify the top 2-3 assets that contributed most positively to the portfolio's performance in absolute SAR terms. Explain their impact briefly.
            
            ### Key Performance Detractors
            Identify any assets that negatively impacted the portfolio's performance. If all are positive, state that.
            
            ### Risk Assessment
            Analyze the portfolio's diversification and concentration risk in detail. Assign a qualitative risk level (e.g., Conservative, Moderately Conservative, Moderate, Moderately Aggressive, Aggressive) and justify your choice based on the asset mix (e.g., concentration in specific stocks vs. broad-market ETFs). Do NOT give financial advice.

            Portfolio Holdings & Performance:
            ${holdingsSummary}

            Provide the detailed analysis now.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: prompt,
            config: {
                thinkingConfig: { thinkingBudget: 32768 }
            }
        });

        return response.text || "Could not retrieve performance analysis.";
    } catch (error) {
        console.error("Error fetching performance analysis:", error);
        return "An error occurred while generating the performance analysis.";
    }
};

export const getAIStrategy = async (holdings: Holding[]): Promise<string> => {
    if (!API_KEY) {
        return "AI features are disabled because the API key is not configured.";
    }

    try {
        const holdingsSummary = holdings.map(h => 
            `- ${h.name} (${h.symbol}): Market Value ${h.currentValue.toLocaleString()} SAR`
        ).join('\n');

        const prompt = `
            You are a sophisticated investment strategist for the Wealth Ultra platform. 
            Analyze the following investment holdings and provide high-level, educational strategic ideas.
            **Do NOT give financial advice or recommend buying/selling specific securities.**
            
            Your analysis should be in markdown and include:
            1.  **Current Strategy Assessment**: Based on the holdings, what is the likely investment strategy (e.g., US-focused large-cap growth, balanced ETF portfolio, etc.)?
            2.  **Strategic Opportunities & Ideas**: Suggest 2-3 educational ideas for the user to research. Focus on concepts like:
                *   **Diversification**: Mentioning asset classes or geographic regions not currently represented (e.g., "Exploring emerging markets" or "Considering real estate exposure through REITs").
                *   **Thematic Investing**: Highlighting potential long-term themes that could complement the portfolio (e.g., "Investigating clean energy trends" or "The rise of AI and robotics").
                *   **Hedging/Risk Management**: Briefly explain a concept like adding exposure to bonds or commodities to potentially balance equity risk.
            
            Keep the tone professional, educational, and empowering. The goal is to give the user ideas to research, not instructions to follow.

            Portfolio Holdings:
            ${holdingsSummary}

            Provide the strategy analysis now.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-preview', // Using Pro for more nuanced strategic thinking
            contents: prompt,
        });

        return response.text || "Could not retrieve AI strategy.";
    } catch (error) {
        console.error("Error fetching AI strategy:", error);
        return "An error occurred while generating the AI strategy analysis.";
    }
};

export const getAIResearchNews = async (stocks: (Holding | WatchlistItem)[]): Promise<string> => {
    if (!API_KEY) {
        return "AI features are disabled because the API key is not configured.";
    }

    try {
        const symbols = stocks.map(s => `${s.symbol} (${s.name})`).join(', ');

        const prompt = `
            You are a financial news analyst for the Wealth Ultra platform, skilled at creating realistic, fictional market updates.
            For the following list of stocks, generate a plausible and recent-looking summary of market news and dividend announcements.
            
            **Do not use real-time data. All information must be fictional but realistic.**
            
            Structure your response in markdown with the following sections:

            ### Fictional Market News
            - Generate 3-5 varied and compelling news headlines and a brief one-sentence summary for each.
            - The news should cover different companies from the list provided.
            - Include a mix of news types: product launches, earnings reports, market trends, or strategic partnerships.
            - Example: "**TSLA Unveils New Battery Tech**: Tesla announced a breakthrough in battery efficiency, promising extended range and lower costs for its next generation of vehicles."

            ### Fictional Dividend Announcements
            - Generate 1-2 dividend announcements. **Only announce dividends for companies that typically pay them (like AAPL, MSFT, or broad-market ETFs like SPY/VTI).** Do not create announcements for all holdings.
            - For each announcement, provide:
                - **Symbol**: The stock symbol.
                - **Amount**: A realistic dividend per share (e.g., 0.95 SAR).
                - **Yield**: A plausible annual yield (e.g., "1.25%").
                - **Ex-Date**: A recent or upcoming fictional date.
                - **Payable-Date**: A fictional date a few weeks after the ex-date.
            - If no companies in the list are typical dividend payers, state: "No significant dividend announcements for this selection of stocks."
            
            Stocks: ${symbols}

            Provide the news and dividends summary now.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });

        return response.text || "Could not retrieve news and dividends information.";
    } catch (error) {
        console.error("Error fetching news and dividends:", error);
        return "An error occurred while generating the news and dividends summary.";
    }
};

export const getAITradeAnalysis = async (transactions: InvestmentTransaction[]): Promise<string> => {
    if (!API_KEY) {
        return "AI features are disabled because the API key is not configured.";
    }

    try {
        // Get the last 5 transactions
        const recentTransactions = transactions.slice(0, 5).map(t => 
            `- ${t.type.toUpperCase()} ${t.quantity} ${t.symbol} @ ${t.price.toFixed(2)} on ${new Date(t.date).toLocaleDateString()}`
        ).join('\n');

        const prompt = `
            You are an expert educational trading coach for the H.S platform. 
            Analyze the following recent investment transactions and provide clear, insightful, educational feedback.
            **Strictly avoid giving financial advice. Do not judge trades as "good" or "bad."**

            Your analysis must be in markdown format with three distinct sections:

            ### Trading Pattern Analysis
            - Clearly identify the user's recent trading pattern. Be specific. Examples of patterns include:
                - **Consistent Accumulation**: Regularly buying the same asset(s) over time.
                - **Position Consolidation**: Selling multiple assets to buy more of a single asset.
                - **Diversification**: Adding new, different types of assets (e.g., ETFs, different sectors).
                - **Profit Taking / Cutting Losses**: Selling positions that have recently gone up or down significantly.
            - Describe the pattern in one or two sentences.

            ### Potential Portfolio Impact
            - Explain the direct consequence of the identified trading pattern on the portfolio's structure.
            - **Concentration Risk**: Clearly state whether the pattern *increases* or *decreases* concentration risk. Explain what this means in simple terms (e.g., "Increasing concentration in [Symbol] means a larger portion of your portfolio's performance depends on this single stock.").
            - **Diversification**: Clearly state whether the pattern *increases* or *decreases* diversification. Explain the benefit or drawback (e.g., "Adding an ETF like VTI increases diversification, spreading risk across hundreds of companies, which can cushion against poor performance from any single one.").

            ### Key Concept for Research
            - Suggest **one specific and relevant financial concept** for the user to research based on their trading pattern.
            - If they are buying consistently, suggest: **"Dollar-Cost Averaging (DCA)"**.
            - If they are buying different individual stocks, suggest: **"Sector Allocation and Correlation"**.
            - If they are selling a losing stock, suggest: **"Tax-Loss Harvesting"**.
            - If they are selling a winning stock, suggest: **"Rebalancing and Profit Taking Strategies"**.
            - Provide a brief, one-sentence explanation of why this concept is relevant to their actions.

            Recent Transactions:
            ${recentTransactions}

            Provide the detailed trade analysis now.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });

        return response.text || "Could not retrieve trade analysis.";
    } catch (error) {
        console.error("Error fetching trade analysis:", error);
        return "An error occurred while generating the trade analysis.";
    }
};


export const getGoalAIPlan = async (goal: Goal): Promise<string> => {
    if (!API_KEY) {
        return "AI features are disabled because the API key is not configured.";
    }

    try {
        const remainingAmount = goal.targetAmount - goal.currentAmount;
        const monthsLeft = (new Date(goal.deadline).getFullYear() - new Date().getFullYear()) * 12 + new Date(goal.deadline).getMonth() - new Date().getMonth();
        const monthlyContribution = monthsLeft > 0 ? remainingAmount / monthsLeft : remainingAmount;

        const prompt = `
          You are a supportive financial coach for the Wealth Ultra platform.
          A user is working towards the following financial goal:
          - Goal: ${goal.name}
          - Target Amount: ${goal.targetAmount.toLocaleString()} SAR
          - Current Savings: ${goal.currentAmount.toLocaleString()} SAR
          - Remaining Amount: ${remainingAmount.toLocaleString()} SAR
          - Deadline: ${new Date(goal.deadline).toLocaleDateString()} (${monthsLeft} months remaining)
          - Current Savings Allocation: ${goal.savingsAllocationPercent || 0}%

          Based on this, generate a simple, encouraging, and actionable plan. 
          The plan should be a short paragraph followed by 2-3 bullet points with practical tips.
          Start by calculating the required monthly savings: approximately ${monthlyContribution.toFixed(0)} SAR/month.
          
          Comment on whether the current savings allocation is sufficient. If not, suggest what percentage might be more appropriate.

          Example tips could be about setting up automatic transfers, reviewing budgets for potential savings, or exploring a small side income.
          Do NOT give specific investment advice. Keep the tone positive and motivational.

          Provide the plan now.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });

        return response.text || "Could not generate an AI plan for your goal.";
    } catch (error) {
        console.error("Error fetching goal AI plan:", error);
        return "An error occurred while generating the AI plan. Please check your API key and network connection.";
    }
};

export const getAIGoalStrategyAnalysis = async (goals: Goal[], monthlySavings: number): Promise<string> => {
    if (!API_KEY) {
        return "AI features are disabled.";
    }

    try {
        const goalsSummary = goals.map(g => {
            const remaining = g.targetAmount - g.currentAmount;
            const monthsLeft = (new Date(g.deadline).getFullYear() - new Date().getFullYear()) * 12 + new Date(g.deadline).getMonth() - new Date().getMonth();
            const requiredMonthly = monthsLeft > 0 ? remaining / monthsLeft : remaining;
            return `- **${g.name}**: Needs ${requiredMonthly.toFixed(0)}/month. Currently allocated ${g.savingsAllocationPercent || 0}% of savings.`;
        }).join('\n');

        const totalAllocation = goals.reduce((sum, g) => sum + (g.savingsAllocationPercent || 0), 0);

        const prompt = `
            You are a wise financial advisor for the Wealth Ultra platform. 
            Analyze the user's overall goal savings strategy based on the following data.
            - **Total Monthly Savings**: ${monthlySavings.toLocaleString()} SAR
            - **Goal Breakdown**:
            ${goalsSummary}
            - **Total Percentage Allocated**: ${totalAllocation}%

            Provide a holistic analysis in markdown. Structure your response with:
            ### Strategy Overview
            Comment on the overall strategy. Is the total allocation 100%? Is it logical based on goal priorities (implied by deadlines and amounts)?

            ### Key Observations & Suggestions
            - Provide 2-3 bullet points with actionable, educational suggestions.
            - If a high-priority goal (near deadline) is underfunded, suggest reallocating from a lower-priority one.
            - If the total allocation is not 100%, advise on allocating the remaining percentage.
            - If savings are insufficient for all goals, suggest either increasing savings or reprioritizing goals.

            Keep the tone strategic and empowering.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: prompt,
        });

        return response.text || "Could not generate strategy analysis.";

    } catch (error) {
        console.error("Error fetching AI goal strategy:", error);
        return "An error occurred.";
    }
};


export const getAIRebalancingPlan = async (holdings: Holding[], riskProfile: 'Conservative' | 'Moderate' | 'Aggressive'): Promise<string> => {
    if (!API_KEY) {
        return "AI features are disabled because the API key is not configured.";
    }

    try {
        const totalValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
        const holdingsSummary = holdings.map(h => 
            `- ${h.name} (${h.symbol}): ${h.currentValue.toLocaleString()} SAR (${(h.currentValue / totalValue * 100).toFixed(1)}%)`
        ).join('\n');

        const prompt = `
            You are an expert portfolio analyst for the Wealth Ultra platform, providing educational content. 
            **You must not give financial advice.** Your goal is to educate the user on portfolio rebalancing concepts.

            A user has a portfolio valued at ${totalValue.toLocaleString()} SAR and has selected a **"${riskProfile}"** risk profile.
            
            Current Portfolio Holdings:
            ${holdingsSummary}

            Based on this, generate a rebalancing plan analysis in markdown format. The analysis should include the following sections:

            ### Current Portfolio Analysis
            Briefly describe the current allocation. Is it concentrated in certain assets or sectors? What is its implied risk level?

            ### Target Allocation for a ${riskProfile} Profile
            Describe a *typical, hypothetical* asset allocation for a ${riskProfile} profile. For example, a conservative profile might have more in bonds and broad-market ETFs, while an aggressive one might have more in individual growth stocks. Provide percentage ranges for major classes (e.g., Large-Cap Stocks, International Stocks, Bonds, etc.).

            ### Educational Rebalancing Suggestions
            Based on the difference between the current and target allocations, provide a few high-level, educational suggestions for the user to research. **Do not recommend buying or selling specific amounts of any stock.** Instead, use conceptual language. For example:
            - "To align closer to a ${riskProfile} profile, one might research increasing exposure to diversified bond funds."
            - "To reduce concentration risk, a common strategy to investigate is trimming positions in overweight individual stocks and reallocating towards broad-market index ETFs."
            - "Consider exploring international markets to enhance geographic diversification."

            The output should be clear, educational, and strictly avoid making direct buy/sell recommendations.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: prompt,
        });

        return response.text || "Could not retrieve AI rebalancing plan.";
    } catch (error) {
        console.error("Error fetching AI rebalancing plan:", error);
        return "An error occurred while generating the AI rebalancing plan.";
    }
};

export const getAIStockAnalysis = async (holding: Holding): Promise<string> => {
    if (!API_KEY) {
        return "AI features are disabled because the API key is not configured.";
    }

    try {
        const prompt = `
            You are a creative financial content generator for the Wealth Ultra platform. 
            For the stock **${holding.name} (${holding.symbol})**, generate a brief, **fictional but realistic** analyst report.
            
            **Do not use real-time data or give financial advice.**
            
            Structure your response in markdown with the following sections:

            ### Fictional Analyst Rating
            - **Rating**: Assign a fictional rating (e.g., "Outperform," "Market Perform," "Underperform").
            - **Price Target**: Generate a plausible fictional 12-month price target in SAR.
            - **Summary**: Write a one-sentence summary justifying the rating (e.g., "Rating is based on strong projected growth in their cloud division and recent product innovations.").

            ### Fictional Recent News
            - Generate 1-2 compelling but **fictional** recent news headlines for the company.
            - Examples:
                - "${holding.symbol} announces strategic partnership with a major European automaker."
                - "Regulatory approval granted for ${holding.symbol}'s new product line in key Asian markets."
                - "${holding.symbol} exceeds quarterly earnings expectations on the back of strong consumer demand."

            Provide the fictional analysis now.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });

        return response.text || "Could not retrieve AI stock analysis.";
    } catch (error) {
        console.error("Error fetching AI stock analysis:", error);
        return "An error occurred while generating the AI stock analysis.";
    }
};


export const getAIHolisticPlan = async (goals: Goal[], income: number, expenses: number): Promise<string> => {
    if (!API_KEY) {
        return "AI features are disabled because the API key is not configured.";
    }

    try {
        const goalsSummary = goals.map(g => 
            `- **${g.name}**: Target ${g.targetAmount.toLocaleString()} SAR, Saved ${g.currentAmount.toLocaleString()} SAR, Deadline ${new Date(g.deadline).toLocaleDateString()}`
        ).join('\n');

        const savings = income - expenses;

        const prompt = `
            You are a holistic financial planner for the Wealth Ultra platform, providing high-level, educational guidance.
            **Do not give specific financial advice.** Your purpose is to educate and empower the user to think strategically.

            Here is the user's financial overview:
            - **Monthly Income**: ${income.toLocaleString()} SAR
            - **Monthly Expenses**: ${expenses.toLocaleString()} SAR
            - **Monthly Savings**: ${savings.toLocaleString()} SAR
            - **Financial Goals**:
            ${goalsSummary}

            Based on this information, generate a strategic financial plan in markdown format. The plan should include the following sections:

            ### Financial Health Snapshot
            Briefly comment on the user's savings rate and their capacity to achieve their goals. Keep it encouraging.

            ### Goal-Oriented Strategy
            Provide high-level, educational strategies for achieving the listed goals. For example:
            - "For a near-term goal like the **${goals[1]?.name || 'New Car'}**, a common approach is to allocate savings to low-risk vehicles like high-yield savings accounts or short-term bonds to preserve capital."
            - "For a long-term goal like the **${goals[0]?.name || 'House Purchase'}**, individuals often research a balanced investment approach that includes a mix of equities (like S&P 500 ETFs) for growth and bonds for stability."

            ### General Recommendations for Research
            Suggest 2-3 educational topics for the user to explore further. These should be general principles, not direct advice. Examples:
            - **Emergency Fund**: "Investigate building an emergency fund covering 3-6 months of living expenses to provide a financial safety net."
            - **Investment Diversification**: "Research the importance of diversification across different asset classes (stocks, bonds, real estate) and geographies to manage risk."
            - **Automating Savings**: "Explore setting up automatic monthly transfers from your checking account to your savings and investment accounts to ensure consistent progress towards your goals."
            
            Provide the holistic plan now.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: prompt,
        });

        return response.text || "Could not generate a holistic financial plan.";
    } catch (error) {
        console.error("Error fetching holistic plan:", error);
        return "An error occurred while generating the plan.";
    }
};

export const getAICategorySuggestion = async (description: string, categories: string[]): Promise<string> => {
    if (!API_KEY) {
        return "";
    }
    
    try {
         const prompt = `
            You are an automated financial assistant for a user in Saudi Arabia. Your task is to categorize a transaction based on its description.

            Analyze the following transaction description: "${description}"

            Choose the single most appropriate category from this list:
            [${categories.join(', ')}]

            Here is some context on common expenses in Saudi Arabia to help you decide:
            - Housing: Rent, Property maintenance, Compound fees, Home insurance.
            - Utilities: Electricity, Water, Internet, Phone bills (STC, Mobily, Zain).
            - Transportation: Car loan, Fuel, Uber, Careem.
            - Food and Groceries: Groceries (Lulu, Carrefour), Dining out, HungerStation, Jahez.
            - Healthcare: Health insurance, Medical consultations, Medications.
            - Education: International school fees, Tutoring.
            - Personal Care: Grooming, cosmetics, haircuts.
            - Work and Residency-Related Expenses: Iqama fees, Visa renewal, Dependent fees.
            - Entertainment and Leisure: Travel, Event tickets, Subscriptions (Netflix, Shahid), Gym.
            
            Respond with only the single, most likely category name from the provided list. Do not add any explanation or other text.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });

        return response.text?.trim() || "";

    } catch (error) {
        console.error("Error fetching AI category suggestion:", error);
        return "";
    }
};
