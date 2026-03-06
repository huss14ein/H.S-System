import { Type, FunctionDeclaration } from "@google/genai";
import { KPISummary, Holding, Goal, InvestmentTransaction, WatchlistItem, Transaction, Budget, FinancialData, InvestmentPortfolio, CommodityHolding, FeedItem, PersonaAnalysis, InvestmentPlanSettings, UniverseTicker, InvestmentPlanExecutionResult, ProposedTrade, TradeCurrency } from '../types';
import { finnhubFetch } from './finnhubService';

// --- Model Constants ---
const FAST_MODEL = 'gemini-3-flash-preview';

/** Expert advisor persona: used so the AI speaks as a senior financial and investment advisor everywhere. */
const EXPERT_ADVISOR_PERSONA = `You are Finova AI: a very clever, expert-level financial and investment advisor. You have deep experience in wealth management, portfolio construction, budgeting, and goal-based planning. You speak with authority, clarity, and insight—never generic. You spot what others miss and give direct, actionable guidance. You use precise numbers and concrete next steps. You are encouraging but honest.`;

const DEFAULT_SYSTEM_INSTRUCTION = `${EXPERT_ADVISOR_PERSONA}

Response style:
- Lead with the main insight in one clear, expert-level sentence.
- Use Markdown only: ### for section headers, - for bullets, ** for emphasis. Never use HTML.
- Use section titles that convey meaning: "Key Highlights", "Areas for Attention", "Strategic Recommendation", "Status Assessment", "Next Steps".
- One sentence per bullet. Use concrete numbers. No filler or hedging. Sound like a senior advisor, not a generic assistant.`;


// --- AI Error Formatting (single source for all AI pages) ---
/** User-facing message for rate-limit / quota: neutral wording (not "you exceeded"). */
const AI_QUOTA_MESSAGE = "The AI service is temporarily unavailable (usage limit reached). This can happen even if you didn't use it—limits may be account- or service-wide. Try again later or use features that don't require AI (e.g. Wealth Ultra, manual updates).";

function isQuotaOrRateLimitError(message: string, parsed?: { error?: { code?: number; status?: string } }): boolean {
    if (/quota|RESOURCE_EXHAUSTED|429|rate.?limit/i.test(message)) return true;
    const code = parsed?.error?.code;
    const status = parsed?.error?.status;
    return code === 429 || status === 'RESOURCE_EXHAUSTED';
}

export function formatAiError(error: any): string {
    console.error("Error from AI Service:", error);
    let message: string;
    if (typeof error === 'string') {
        message = error;
    } else if (error instanceof Error) {
        message = error.message;
    } else if (error && typeof error === 'object' && typeof (error as { message?: string }).message === 'string') {
        message = (error as { message: string }).message;
    } else {
        message = String(error ?? '');
    }
    // Proxy may return stringified JSON in error; parse to detect quota/429
    let parsed: { error?: { code?: number; status?: string; message?: string } | string } | null = null;
    try {
        const trimmed = message.trim();
        if (trimmed.startsWith('{')) {
            parsed = JSON.parse(trimmed) as { error?: { code?: number; status?: string; message?: string } | string };
            // Proxy may return { error: "{\"error\":{...}}" }; parse inner string once
            if (typeof parsed?.error === 'string' && parsed.error.trim().startsWith('{')) {
                const inner = JSON.parse(parsed.error.trim()) as { error?: { code?: number; status?: string } };
                parsed = inner;
            }
        }
    } catch (_) {
        /* ignore parse errors */
    }
    const parsedForQuota: { error?: { code?: number; status?: string } } | undefined =
        parsed && typeof parsed.error === 'object' ? { error: parsed.error } : undefined;
    if (isQuotaOrRateLimitError(message, parsedForQuota)) {
        return AI_QUOTA_MESSAGE;
    }
    if (/GEMINI_API_KEY not set/i.test(message)) {
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
    if (/API key not valid/i.test(message)) {
        return "The AI service API key is not valid. Please check the backend configuration.";
    }
    if (/Inactivity Timeout|request timed out while waiting for proxy|AI request timed out at the proxy/i.test(message)) {
        return "The AI request took too long and timed out at the server. Please try again, or continue with the auto-filled default analyst settings.";
    }
    if (/model|404|not found|invalid model|unsupported/i.test(message)) {
        return `There was an issue with the specified AI model. ${message}`;
    }
    if (message) return `AI Service Error: ${message}`;
    return "An unknown error occurred while communicating with the AI service.";
}


// --- AI Request Cache ---
const aiAnalysisCache = new Map<string, { timestamp: number; result: any }>();
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

function getFromCache(key: string): any | null {
    const cached = aiAnalysisCache.get(key);
    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION_MS)) {
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

const normalizePriceMap = (prices: any): { [symbol: string]: { price: number; change: number; changePercent: number } } => {
    if (!prices || typeof prices !== 'object') return {};
    const normalized: { [symbol: string]: { price: number; change: number; changePercent: number } } = {};
    for (const [symbol, value] of Object.entries(prices)) {
        const candidate = value as any;
        const price = Number(candidate?.price);
        const change = Number(candidate?.change);
        const changePercent = Number(candidate?.changePercent);
        if (!Number.isFinite(price) || !Number.isFinite(change) || !Number.isFinite(changePercent)) continue;
        normalized[symbol.toUpperCase()] = { price, change, changePercent };
    }
    return normalized;
};

const getFinnhubApiKey = (): string => {
    const apiKey = import.meta.env.VITE_FINNHUB_API_KEY;
    if (!apiKey) throw new Error('Finnhub API key is missing. Set VITE_FINNHUB_API_KEY.');
    return apiKey;
};

const toFinnhubSymbol = (symbol: string): string => {
    const upper = symbol.toUpperCase().trim();
    if (!upper) return upper;
    if (upper === 'BTC' || upper === 'BTC-USD') return 'BINANCE:BTCUSDT';
    if (upper === 'ETH' || upper === 'ETH-USD') return 'BINANCE:ETHUSDT';
    return upper;
};

const fromFinnhubSymbol = (symbol: string): string => {
    const upper = symbol.toUpperCase();
    if (upper === 'BINANCE:BTCUSDT') return 'BTC';
    if (upper === 'BINANCE:ETHUSDT') return 'ETH';
    return upper;
};

/** Stooq uses lowercase with dot for Saudi: 2222.sr. Others use dash (e.g. aapl.us). */
const toStooqSymbol = (symbol: string): string => {
    const s = (symbol || '').trim();
    if (/\.SR$/i.test(s)) return s.toLowerCase();
    if (/\.SA$/i.test(s)) return s.toLowerCase();
    return s.toLowerCase().replace(/\./g, '-');
};

const getFinnhubLivePrices = async (symbols: string[]): Promise<{ [symbol: string]: { price: number; change: number; changePercent: number } }> => {
    if (symbols.length === 0) return {};
    const token = getFinnhubApiKey();
    const mapped: { [symbol: string]: { price: number; change: number; changePercent: number } } = {};

    for (const rawSymbol of symbols) {
        try {
            const finnhubSymbol = toFinnhubSymbol(rawSymbol);
            const response = await finnhubFetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${encodeURIComponent(token)}`);
            if (!response.ok) continue;
            const row = await response.json();
            const price = Number(row?.c ?? row?.pc ?? row?.p);
            let change = Number(row?.d ?? 0);
            let changePercent = Number(row?.dp ?? 0);
            if (!Number.isFinite(price) || price <= 0) continue;
            if (!Number.isFinite(change)) change = 0;
            if (!Number.isFinite(changePercent)) changePercent = 0;
            mapped[fromFinnhubSymbol(finnhubSymbol)] = { price, change, changePercent };
        } catch (error) {
            console.warn(`Finnhub quote failed for ${rawSymbol}:`, error);
        }
    }

    return mapped;
};

const getFinnhubCompanyNews = async (symbols: string[]): Promise<Array<{ symbol: string; headline: string; source: string; url: string; datetime: number }>> => {
    if (symbols.length === 0) return [];
    const token = getFinnhubApiKey();
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    const toDate = to.toISOString().split('T')[0];
    const fromDate = from.toISOString().split('T')[0];
    const rows: Array<{ symbol: string; headline: string; source: string; url: string; datetime: number }> = [];

    for (const rawSymbol of symbols.slice(0, 6)) {
        const symbol = toFinnhubSymbol(rawSymbol);
        if (symbol.includes(':')) continue;
        try {
            const response = await finnhubFetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${toDate}&token=${encodeURIComponent(token)}`);
            if (!response.ok) continue;
            const news = await response.json();
            if (!Array.isArray(news)) continue;
            news.slice(0, 2).forEach((item: any) => {
                if (!item?.headline || !item?.url) return;
                rows.push({
                    symbol: fromFinnhubSymbol(symbol),
                    headline: String(item.headline),
                    source: String(item.source || 'Unknown'),
                    url: String(item.url),
                    datetime: Number(item.datetime || 0),
                });
            });
        } catch (error) {
            console.warn(`Finnhub company news failed for ${rawSymbol}:`, error);
        }
    }

    return rows.sort((a, b) => b.datetime - a.datetime).slice(0, 8);
};

const getFinnhubEconomicCalendar = async (): Promise<Array<{ date: string; country: string; event: string; actual?: string; estimate?: string }>> => {
    const token = getFinnhubApiKey();
    const from = new Date();
    const to = new Date(from.getTime() + 10 * 24 * 60 * 60 * 1000);
    const fromDate = from.toISOString().split('T')[0];
    const toDate = to.toISOString().split('T')[0];
    const response = await finnhubFetch(`https://finnhub.io/api/v1/calendar/economic?from=${fromDate}&to=${toDate}&token=${encodeURIComponent(token)}`);
    if (!response.ok) return [];
    const json = await response.json();
    const events = Array.isArray(json?.economicCalendar) ? json.economicCalendar : [];
    return events.slice(0, 6).map((item: any) => ({
        date: String(item?.date || ''),
        country: String(item?.country || 'Global'),
        event: String(item?.event || 'Market event'),
        actual: item?.actual ? String(item.actual) : undefined,
        estimate: item?.estimate ? String(item.estimate) : undefined,
    }));
};

const buildFinnhubResearchBrief = async (symbols: string[]): Promise<string> => {
    try {
        const [news, calendar] = await Promise.all([
            getFinnhubCompanyNews(symbols),
            getFinnhubEconomicCalendar().catch(() => []),
        ]);

        const newsSection = news.length === 0
            ? '- No recent Finnhub headlines available for the selected symbols.'
            : news.map(item => `- **${item.symbol}** (${item.source}): ${item.headline} (${item.url})`).join('\n');
        const calendarSection = calendar.length === 0
            ? '- No near-term economic calendar events available.'
            : calendar.map(item => `- ${item.date} | ${item.country}: ${item.event}${item.estimate ? ` (Est: ${item.estimate})` : ''}${item.actual ? ` (Actual: ${item.actual})` : ''}`).join('\n');

        return `### Finnhub Headlines\n${newsSection}\n\n### Finnhub Economic Calendar\n${calendarSection}`;
    } catch (error) {
        console.warn('Unable to build Finnhub research brief:', error);
        return '';
    }
};


const getStooqLivePrices = async (symbols: string[]): Promise<{ [symbol: string]: { price: number; change: number; changePercent: number } }> => {
    if (symbols.length === 0) return {};

    const mapped: { [symbol: string]: { price: number; change: number; changePercent: number } } = {};

    for (const rawSymbol of symbols) {
        try {
            const symbol = rawSymbol.trim().toUpperCase();
            const stooqCode = toStooqSymbol(rawSymbol);
            const response = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(stooqCode)}&f=sd2t2ohlcvcp&h&e=csv`);
            if (!response.ok) continue;
            const csv = await response.text();
            const lines = csv.trim().split('\n');
            if (lines.length < 2) continue;
            const values = lines[1].split(',');
            const close = Number(values[6]);
            const changePercent = Number(values[9]);
            if (!Number.isFinite(close) || close <= 0) continue;
            const change = Number.isFinite(changePercent) ? (close * changePercent) / 100 : 0;
            const pct = Number.isFinite(changePercent) ? changePercent : 0;
            mapped[symbol] = { price: close, change, changePercent: pct };
        } catch (error) {
            console.warn(`Stooq quote failed for ${rawSymbol}:`, error);
        }
    }

    return mapped;
};

// Helper function to securely invoke the Gemini API via a Netlify Function.
async function invokeGeminiProxy(payload: { model: string, contents: any, config?: any }): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    try {
        const response = await fetch('/api/gemini-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
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
                if (/Inactivity Timeout/i.test(errorBody)) {
                    errorMessage = 'AI request timed out at the proxy (Inactivity Timeout).';
                } else {
                    errorMessage = `AI proxy failed with status ${response.status}. The server returned an invalid response. This may be due to a server-side configuration error (e.g., missing API key).`;
                }
            }
            throw new Error(errorMessage);
        }
        
        // If response.ok, we assume it's valid JSON.
        return await response.json();

    } catch (error) {
        console.error("Error invoking Netlify function:", error);
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('AI request timed out while waiting for proxy response.');
        }
        if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('network'))) {
             const detailedMessage = "Could not connect to the AI proxy function. Please ensure you are connected to the internet and that the Netlify function is deployed correctly.";
             throw new Error(detailedMessage);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

// Unified AI invocation function. Proxy-only for security (prevents client-bundle key exposure).
export async function invokeAI(payload: { model: string, contents: any, config?: any }): Promise<any> {
    const hasJsonSchema = payload.config?.responseMimeType === 'application/json';
    const mergedPayload = {
        ...payload,
        config: {
            ...payload.config,
            ...(hasJsonSchema ? {} : { systemInstruction: payload.config?.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION }),
        },
    };

    return invokeGeminiProxy(mergedPayload);
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
        const prompt = `You are Finova AI, a very clever expert financial and investment advisor. Analyze this snapshot and return 4-5 feed items as JSON. Be direct: each title is one short punchy line; each description is one sentence with a number or action.
Data: Recent tx: ${data.transactions.slice(0, 5).map(t => `${t.description} ${t.amount}`).join('; ')}. Budgets: ${data.budgets.map(b => `${b.category} ${b.limit}`).join('; ')}. Goals: ${data.goals.map(g => `${g.name} ${((g.currentAmount/g.targetAmount)*100).toFixed(0)}%`).join('; ')}. Top holding: ${getTopHoldingSymbol(data.investments)}.
Each item: type (BUDGET|GOAL|INVESTMENT|SAVINGS), title (short), description (one sentence, specific), emoji (single). Prioritize what matters most.`;

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
    const prompt = `You are Finova AI, a very clever expert financial and investment advisor. Summary (SAR): Net worth ${summary.netWorth.toLocaleString()}; income ${summary.monthlyIncome.toLocaleString()}; expenses ${summary.monthlyExpenses.toLocaleString()}; investment ROI ${(summary.roi * 100).toFixed(1)}%. Return a short, expert-level analysis in Markdown only (no HTML). Use ### for sections. Be direct with numbers and insight.

### Overall
One sentence on financial health this month.

### Key Highlights
- 1-2 positive bullets (trends, returns, allocation).

### Areas to Watch
- 1-2 bullets for improvement. Direct and brief.
Markdown only.`;
    
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

        const prompt = `You are Finova AI, a very clever expert financial advisor. Monthly spending:
${budgetPerformance}
Return a short, actionable analysis in Markdown only (no HTML). Use ### for each section. One sentence or 2 bullets each; use numbers.

### Key Spending Insight
- Main observation (e.g. which category is over/under; quote %).

### Strategic Recommendation
- One practical tip. One sentence.

### Positive Note
- One area well-managed. One sentence.
Markdown only.`;

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
            You are Finova AI, a very clever expert financial and investment advisor. Analyze these financial metrics: Savings Rate: ${(savingsRate * 100).toFixed(1)}%, Debt-to-Asset Ratio: ${(debtToAssetRatio * 100).toFixed(1)}%, Emergency Fund: ${emergencyFundMonths.toFixed(1)} months, Investment Style: ${investmentStyle}.
            Generate a financial persona and a detailed report card as a single JSON object.
            The persona title should be creative and insightful (e.g., "The Disciplined Planner").
            The report card ratings must be one of: "Excellent", "Good", or "Needs Improvement".
            Analysis and suggestions should be concise, educational, and expert-level—like a senior advisor's assessment.
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
            setToCache(cacheKey, result);
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
        const prompt = `You are Finova AI, a very clever expert financial and investment advisor. Annual plan: projected savings ${projectedNet.toLocaleString()} SAR. Scenarios: income shock ${incomeShock.percent}% for ${incomeShock.duration} mo; expense stress ${expenseStress.percent}% on "${expenseStress.category}". Return a short, expert-level analysis in Markdown only (no HTML). Use ### for sections. Be direct with numbers and strategic insight.

### Scenario Impact
- One sentence: total impact on projected annual savings (e.g. X SAR less, Y% decrease).

### Strategic Recommendation
- One high-impact tip to build resilience against these shocks. One sentence.

### Summary
- One short, encouraging line on the value of stress-testing the plan.
Markdown only.`;
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
        const prompt = `You are Finova AI, a very clever expert financial advisor. Data: (1) Spending YTD: ${spendingData.slice(0, 5).map(d => `${d.name} ${d.value.toLocaleString()} SAR`).join('; ')}. (2) Monthly trend: ${trendData.map(d => `${d.name} Income ${d.income.toLocaleString()} Expenses ${d.expenses.toLocaleString()}`).join('; ')}. (3) Position: ${compositionData.map(d => `${d.name} ${d.value.toLocaleString()}`).join('; ')}. Return a short analysis in Markdown only (no HTML). Use ### for each section. Be direct.

### Spending Habits
- 1-2 bullets: top categories, concentration. Use numbers.

### Cash Flow Dynamics
- 1-2 bullets: saving trend? Consistent? One sentence each.

### Balance Sheet Health
- One sentence: asset vs liability; building wealth? Markdown only.`;

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
        const prompt = `You are Finova AI, a very clever expert investment advisor. Portfolio: ${portfolioAllocation.map(p => `${p.name} ${p.value.toLocaleString()} SAR`).join('; ')}. Asset classes: ${assetClassAllocation.map(a => `${a.name} ${a.value.toLocaleString()}`).join('; ')}. Top holdings performance: ${topHoldings.slice(0, 5).map(h => `${h.name} ${h.gainLossPercent.toFixed(2)}%`).join('; ')}. Return a short SWOT in Markdown only (no HTML). Use ### for each section. Be direct; 1-2 bullets each.

### Strengths
- Strong points (performers, diversification). Use numbers.

### Weaknesses
- Weak points (concentration, underperformers).

### Opportunities
- 1-2 actions that could improve the portfolio. Educational only.

### Threats
- 1-2 external risks. One sentence each. No financial advice. Markdown only.`;

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

    const budgetMonthlyLimit = (b: { limit: number; period?: string }) => b.period === 'yearly' ? b.limit / 12 : b.period === 'weekly' ? b.limit * (52 / 12) : b.period === 'daily' ? b.limit * (365 / 12) : b.limit;
    const overspentBudgets = data.budgets
        .map(budget => {
            const spent = monthlyTransactions
                .filter(t => t.type === 'expense' && t.budgetCategory === budget.category)
                .reduce((sum, t) => sum + Math.abs(t.amount), 0);
            const limit = budgetMonthlyLimit(budget);
            const percentage = limit > 0 ? (spent / limit) * 100 : 0;
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
        You are Finova AI, a very clever expert financial and investment advisor. Analyze the user's data and return a short, direct executive summary in Markdown only (no HTML). Speak with authority and insight.

        Data: This month P&L ${monthlyPnL.toLocaleString()} SAR; budgets near limit (>90%): ${overspentBudgets || 'None'}; goal progress: ${goalProgress || 'No goals set'}.

        Use exactly these ### section headers (one sentence or 2-3 bullets each; be specific with numbers):
        ### Overall Financial Health
        One sentence: current standing for the month.

        ### Key Highlights
        - 2-3 positive bullets with numbers.

        ### Areas for Attention
        - 1-2 items to watch; direct and constructive.

        ### Strategic Recommendation
        - One actionable next step.

        Output Markdown only.
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
    const prompt = `You are Finova AI, a very clever expert investment advisor. Based on these holdings, provide a brief analysis on diversification and concentration risk in Markdown format. Be direct and insightful; do not give specific buy/sell advice. No HTML. Holdings: ${holdings.map(h => h.symbol).join(', ')}`;
    const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
    const result = response.text || "Could not retrieve analysis.";
    setToCache(cacheKey, result);
    return result;
  } catch (error) { return formatAiError(error); }
};

export const getPlatformPerformanceAnalysis = async (holdings: (Holding & { gainLoss: number; gainLossPercent: number; })[]): Promise<string> => {
    try {
        const prompt = `You are Finova AI, a very clever expert investment advisor. Based on unrealized gains/losses for ${holdings.length} assets, provide a performance and risk analysis in markdown. Your response must not contain any HTML. Sections: Key Performance Contributors, Key Performance Detractors, Risk Assessment. Be direct and insightful.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not retrieve analysis.";
    } catch (error) { return formatAiError(error); }
};

export const getAIStrategy = async (holdings: Holding[]): Promise<string> => {
    try {
        const prompt = `You are Finova AI, a very clever expert investment advisor. Analyze these holdings and provide educational strategic ideas in markdown. Your response must not contain any HTML. Sections: Current Strategy Assessment, Strategic Opportunities & Ideas. Speak as a senior advisor; do not give specific buy/sell advice. Holdings: ${holdings.map(h => h.symbol).join(', ')}`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not retrieve strategy.";
    } catch (error) { return formatAiError(error); }
};

export const getAIResearchNews = async (stocks: (Holding | WatchlistItem)[]): Promise<{ content: string, groundingChunks: any[] }> => {
    try {
        const finnhubBrief = await buildFinnhubResearchBrief(stocks.map(s => s.symbol));
        const prompt = `You are Finova AI, a very clever expert investment analyst. For stocks: ${stocks.map(s => s.symbol).join(', ')}. Use Google Search and the Finnhub digest below. Return a concise Markdown summary (no HTML). Use ### for each symbol and one short section ### Calendar Watch for major macro events. Be direct; one paragraph or 2-3 bullets per symbol.\n\n${finnhubBrief ? `Reference:\n${finnhubBrief}` : ''}`;
        const response = await invokeAI({
            model: FAST_MODEL,
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] }
        });
        const aiContent = response.text || "Could not retrieve news.";
        const content = finnhubBrief
            ? `${aiContent}\n\n---\n\n${finnhubBrief}`
            : aiContent;
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        return { content, groundingChunks };
    } catch (error) {
        const fallbackBrief = await buildFinnhubResearchBrief(stocks.map(s => s.symbol));
        const errorMessage = formatAiError(error);
        return {
            content: fallbackBrief
                ? `AI research is unavailable right now. Showing Finnhub market data instead.\n\n${fallbackBrief}`
                : errorMessage,
            groundingChunks: [],
        };
    }
};

export interface TradeAnalysisContext {
    holdingsSummary?: string;
    watchlistSymbols?: string[];
    planBudget?: number;
    corePct?: number;
    upsidePct?: number;
}

export const getAITradeAnalysis = async (
    transactions: InvestmentTransaction[],
    context?: TradeAnalysisContext
): Promise<string> => {
    const txList = transactions.slice(0, 15).map(t => `${t.type} ${t.symbol} ${t.quantity} @ ${t.price} = ${t.total} on ${t.date}`).join('\n');
    const contextBlock = context
        ? `
Current context (use to tailor feedback):
${context.holdingsSummary ? `Holdings: ${context.holdingsSummary}` : ''}
${context.watchlistSymbols?.length ? `Watchlist: ${context.watchlistSymbols.join(', ')}` : ''}
${context.planBudget != null ? `Monthly plan budget: ${context.planBudget}` : ''}
${context.corePct != null ? `Core/Upside split: ${(context.corePct * 100).toFixed(0)}% / ${(context.upsidePct ?? 0) * 100}%` : ''}
`.trim()
        : '';

    const prompt = `You are Finova AI, an expert investment and trading advisor. Analyze these transactions and return direct, educational feedback in Markdown only (no HTML). Use ### for each section. Be specific and actionable; reference symbols and amounts where relevant.
${contextBlock ? '\n' + contextBlock + '\n' : ''}

Transactions:
${txList || 'None.'}

Respond with exactly these ### sections (one short paragraph or 2-3 bullets each; be specific):
### Summary
What the user did in one sentence (buys/sells, main symbols, size). Use numbers.

### Patterns
- 1-2 bullets on concentration, timing, lot size, or alignment with a plan. Be direct.

### Portfolio Impact
- 1-2 bullets on what this implies for the portfolio (diversification, cost basis, risk). Plain language.

### Suggestions
- One or two concrete, educational suggestions (e.g. "Consider tracking X", "Look up Y"). No buy/sell recommendations.

### Concept to Research
- One concept to look up (e.g. dollar-cost averaging, tax-loss harvesting, rebalancing). One sentence.
Do not give buy/sell advice. Markdown only.`;

    const execute = async () => {
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not retrieve analysis.";
    };

    try {
        return await execute();
    } catch (error) {
        const details = formatAiError(error);
        const transient = details.includes('503') || details.toLowerCase().includes('unavailable') || details.toLowerCase().includes('high demand');
        if (transient) {
            try {
                await new Promise(resolve => setTimeout(resolve, 800));
                return await execute();
            } catch (retryError) {
                const retryDetails = formatAiError(retryError);
                return `AI Educational Feedback is temporarily unavailable due to high provider demand. Please try again shortly.

Details: ${retryDetails}`;
            }
        }
        return details;
    }
};

/** Fallback when AI is unavailable for watchlist tips. */
function buildFallbackWatchlistTips(symbols: string[]): string {
    const list = symbols.slice(0, 20).join(', ');
    return `## Watchlist summary (no AI)

Your watchlist: **${list}**

### When AI is available
- Use **Generate Watchlist Tips** for diversification, themes, and concepts to research.
- AI suggestions are educational only (no buy/sell advice).

### General tips
- Review sector and region concentration; consider diversifying if heavily concentrated.
- Revisit themes (e.g. dividend vs growth) and position sizing.
- Try again later for AI-generated tips when the service is available.`;
}

/** AI suggestions for watchlist symbols: diversification, themes, concepts to research. Educational only. Returns fallback text when AI is unavailable. */
export const getAIWatchlistAdvice = async (symbols: string[]): Promise<string> => {
    if (!symbols?.length) return 'Add symbols to your watchlist to get AI tips.';
    const list = symbols.slice(0, 25).join(', ');
    const prompt = `You are Finova AI, an expert investment advisor. The user's watchlist contains these symbols: ${list}.

Return short, educational suggestions in Markdown only (no HTML). Use ### for section headers. Be concise (2–4 short bullets per section). Do NOT give buy/sell recommendations.

Sections:
### Diversification
- One or two bullets on sector/region concentration if obvious from symbols; otherwise a general tip.

### Themes to Consider
- 1–2 themes or concepts that might apply (e.g. dividend focus, growth vs value, region mix).

### Concepts to Research
- One or two concepts the user could look up (e.g. position sizing, rebalancing, dollar-cost averaging).

Keep each section to 2–4 short bullets. Markdown only.`;

    try {
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || 'No suggestions generated.';
    } catch {
        return buildFallbackWatchlistTips(symbols);
    }
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
            You are Finova AI, a very clever expert financial and investment advisor. Analyze this goal and provide a direct, concise plan in Markdown. Speak as a senior advisor with clear, actionable guidance.
            
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

        const unallocated = monthlySavings - allocatedSavings;
        const prompt = `You are Finova AI, a very clever expert financial advisor. Goal strategy data: monthly savings ${monthlySavings.toLocaleString(undefined, {maximumFractionDigits: 0})} SAR; allocated ${allocatedSavings.toLocaleString(undefined, {maximumFractionDigits: 0})} SAR (${totalAllocatedPercent}%); ${goals.length} goals. Progress: ${goalDataWithProgress}. Unallocated: ${unallocated.toLocaleString(undefined, {maximumFractionDigits: 0})} SAR. Return a short analysis in Markdown only (no HTML). Use ### for each section. Be direct.

### Overall Assessment
One sentence: health of their goal strategy.

### Key Insight
- One crucial observation (e.g. under-using savings, spreading thin). Use numbers.

### Strategic Recommendation
- One high-impact, actionable tip. One sentence. Markdown only.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not generate analysis.";
    } catch (error) { return formatAiError(error); }
};

const buildRuleBasedRebalancingPlan = (holdings: Holding[], riskProfile: 'Conservative' | 'Moderate' | 'Aggressive'): string => {
    const targetByRisk: Record<'Conservative' | 'Moderate' | 'Aggressive', { stocks: number; sukuk: number; other: number }> = {
        Conservative: { stocks: 45, sukuk: 45, other: 10 },
        Moderate: { stocks: 60, sukuk: 30, other: 10 },
        Aggressive: { stocks: 75, sukuk: 15, other: 10 },
    };

    const normalized = holdings
        .map((h) => {
            const qty = Number(h.quantity || 0);
            const avgCost = Number(h.avgCost || 0);
            const marketValue = Number(h.currentValue || 0);
            const fallback = qty > 0 && avgCost > 0 ? qty * avgCost : 0;
            const value = marketValue > 0 ? marketValue : fallback;
            return {
                ...h,
                value,
                assetClass: h.assetClass || 'Other',
            };
        })
        .filter((h) => Number.isFinite(h.value) && h.value > 0);

    const totalValue = normalized.reduce((sum, h) => sum + h.value, 0);
    if (totalValue <= 0) {
        return `### Current Portfolio Analysis\n- We could not detect positive holding market values to analyze concentration.\n- Add or refresh holdings prices, then run rebalancing again.\n\n### Target Allocation (${riskProfile})\n- Stocks: ${targetByRisk[riskProfile].stocks}%\n- Sukuk/Bonds: ${targetByRisk[riskProfile].sukuk}%\n- Other assets: ${targetByRisk[riskProfile].other}%\n\n### Rebalancing Suggestions\n- Update market values first so concentration and sizing are computed accurately.\n- Then run rebalancing and execute via Investment Plan for budgeted, controlled allocation changes.`;
    }

    const bucket = { stocks: 0, sukuk: 0, other: 0 };
    normalized.forEach((h) => {
        if (h.assetClass === 'Stock') bucket.stocks += h.value;
        else if (h.assetClass === 'Sukuk') bucket.sukuk += h.value;
        else bucket.other += h.value;
    });

    const toPct = (v: number) => (v / totalValue) * 100;
    const current = {
        stocks: toPct(bucket.stocks),
        sukuk: toPct(bucket.sukuk),
        other: toPct(bucket.other),
    };

    const topHolding = normalized.slice().sort((a, b) => b.value - a.value)[0];
    const topPct = topHolding ? toPct(topHolding.value) : 0;
    const target = targetByRisk[riskProfile];

    return `### Current Portfolio Analysis
- Portfolio value analyzed: **${totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}**.
- Concentration is ${topPct > 35 ? '**high**' : topPct > 20 ? '**moderate**' : '**controlled**'} with top holding **${topHolding?.symbol || 'N/A'} (${topPct.toFixed(1)}%)**.
- Current mix is **Stocks ${current.stocks.toFixed(1)}% · Sukuk/Bonds ${current.sukuk.toFixed(1)}% · Other ${current.other.toFixed(1)}%**.

### Target Allocation (${riskProfile})
- Stocks: **${target.stocks}%**
- Sukuk/Bonds: **${target.sukuk}%**
- Other assets: **${target.other}%**

### Rebalancing Suggestions
- Adjust in small monthly steps to reduce drift: prioritize buckets furthest from target (current vs target gap).
- Cap single-position adds when top holding exceeds 25% until diversification improves.
- Execute changes through **Investment Plan / Execute & Results** so amounts remain budgeted and traceable.

_Generated with resilient rule-based logic (AI fallback mode)._`;
};

export const getAIRebalancingPlan = async (holdings: Holding[], riskProfile: 'Conservative' | 'Moderate' | 'Aggressive'): Promise<string> => {
    try {
        const holdingsSummary = holdings.map(h => `${h.symbol}: ${h.currentValue.toFixed(0)} SAR (${h.assetClass})`).join(', ');
        const prompt = `You are Finova AI, a very clever expert investment advisor specializing in portfolio construction. User risk profile: ${riskProfile}. Holdings: ${holdingsSummary}. Return a short rebalancing analysis in Markdown only (no HTML). Use ### for each section. Be direct and specific.

### Current Portfolio Analysis
- One sentence on concentration/diversification; one on risk level.

### Target Allocation (${riskProfile})
- 2-3 bullets on how a ${riskProfile} investor might allocate. Use numbers if possible.

### Rebalancing Suggestions
- 2-3 concrete, educational steps (no buy/sell advice). One sentence each.
Markdown only.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || buildRuleBasedRebalancingPlan(holdings, riskProfile);
    } catch (error) {
        console.warn('[getAIRebalancingPlan] AI unavailable, using deterministic fallback.', error);
        return buildRuleBasedRebalancingPlan(holdings, riskProfile);
    }
};

export function buildFallbackAnalystReport(holding: Holding): string {
    const name = holding.name || holding.symbol;
    const qty = holding.quantity ?? 0;
    const cost = (holding.avgCost ?? 0) * qty;
    const value = holding.currentValue ?? 0;
    const gainLoss = value - cost;
    const gainLossPct = cost > 0 ? ((value - cost) / cost) * 100 : 0;
    return `## Position Summary\n\n**${holding.symbol}** — ${name}\n\n- **Shares:** ${qty.toLocaleString()}\n- **Cost basis:** ${cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n- **Market value:** ${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n- **Unrealized G/L:** ${gainLoss >= 0 ? '+' : ''}${gainLoss.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${gainLossPct >= 0 ? '+' : ''}${gainLossPct.toFixed(1)}%)\n\n### Coverage status\n- AI analyst engine was unavailable for this request.\n- Showing a resilient fallback summary now.\n- If configured, Finnhub headlines are attached below.`;
}

async function buildFallbackAnalystReportWithFinnhub(holding: Holding): Promise<string> {
    const base = buildFallbackAnalystReport(holding);
    try {
        const headlines = await getFinnhubCompanyNews([holding.symbol]);
        if (headlines.length === 0) {
            return `${base}\n\n### Finnhub latest headlines\n- No recent headlines were available for this symbol right now.`;
        }

        const top = headlines
            .slice(0, 3)
            .map((item) => `- **${item.source}**: ${item.headline} (${item.url})`)
            .join('\n');

        return `${base}\n\n### Finnhub latest headlines\n${top}`;
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Finnhub fallback unavailable.';
        return `${base}\n\n### Finnhub latest headlines\n- Fallback data unavailable: ${reason}`;
    }
}


export const getAIStockAnalysis = async (holding: Holding, options?: { forceRefresh?: boolean }): Promise<{ content: string, groundingChunks: any[] }> => {
    const dayKey = new Date().toISOString().slice(0, 10);
    const positionSnapshotKey = [
        Number(holding.quantity || 0).toFixed(4),
        Number(holding.avgCost || 0).toFixed(2),
        Number(holding.currentValue || 0).toFixed(2),
    ].join(':');
    const cacheKey = `getAIStockAnalysis:${holding.symbol}:${dayKey}:${positionSnapshotKey}`;
    const cached = getFromCache(cacheKey);
    if (!options?.forceRefresh && cached) return cached;

    const approxPrice = Number(holding.quantity || 0) > 0
        ? Number(holding.currentValue || 0) / Number(holding.quantity || 1)
        : Number(holding.avgCost || 0);
    const primaryPrompt = `You are Finova AI, a very clever expert investment analyst.
Generate a **fresh, current-market** analyst update for ${holding.name} (${holding.symbol}) using Google Search.
Treat stale/outdated references as low confidence and prefer latest items.

Portfolio snapshot context (for relevance only):
- Shares: ${Number(holding.quantity || 0).toLocaleString()}
- Avg cost: ${Number(holding.avgCost || 0).toFixed(2)}
- Approx latest price from portfolio: ${Number.isFinite(approxPrice) ? approxPrice.toFixed(2) : 'N/A'}

Return Markdown only (no HTML):

### Recent News Summary
- 2-3 bullets on the latest significant news (recent period only). One sentence each.

### Analyst Sentiment
- One short paragraph: current sentiment (bullish/bearish/neutral) and why. No buy/sell advice.

### What Changed Recently
- 1-2 bullets highlighting what is new versus prior narrative.`;

    try {
        const response = await invokeAI({
            model: FAST_MODEL,
            contents: primaryPrompt,
            config: { tools: [{ googleSearch: {} }] }
        });
        const content = response.text || "Could not retrieve analysis.";
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const result = { content, groundingChunks };
        setToCache(cacheKey, result);
        return result;
    } catch (error) {
        const details = formatAiError(error);

        // Retry once without search tool, using Finnhub brief as context, to keep analyst report available.
        try {
            const finnhubBrief = await buildFinnhubResearchBrief([holding.symbol]);
            const fallbackAiPrompt = `You are Finova AI, a very clever expert investment analyst. For ${holding.name} (${holding.symbol}), produce a concise Markdown analyst update (no HTML).

Structure:
### Recent News Summary
- 2-3 concise bullets.

### Analyst Sentiment
- One short paragraph (bullish/bearish/neutral) with reasoning.

${finnhubBrief ? `Use this Finnhub reference when relevant:
${finnhubBrief}` : 'If live headlines are unavailable, rely on position context and provide a neutral status update.'}`;

            const retry = await invokeAI({ model: FAST_MODEL, contents: fallbackAiPrompt });
            const retryResult = {
                content: retry.text || await buildFallbackAnalystReportWithFinnhub(holding),
                groundingChunks: [],
            };
            setToCache(cacheKey, retryResult);
            return retryResult;
        } catch (_retryError) {
            return {
                content: `${await buildFallbackAnalystReportWithFinnhub(holding)}

> Analyst engine note: ${details}`,
                groundingChunks: [],
            };
        }
    }
};


export const getAIHolisticPlan = async (goals: Goal[], income: number, expenses: number): Promise<string> => {
    try {
        const prompt = `You are Finova AI, a very clever expert financial and investment advisor. User overview: Monthly Income: ${income}, Monthly Expenses: ${expenses}, Goals: ${goals.length}. Generate a strategic financial plan in markdown. Your response must not contain any HTML tags. Sections: Financial Health Snapshot, Goal-Oriented Strategy, General Recommendations for Research. Speak as a senior advisor; do not give specific buy/sell advice.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not generate plan.";
    } catch (error) { return formatAiError(error); }
};

export const getAICategorySuggestion = async (description: string, categories: string[]): Promise<string> => {
    try {
        const prompt = `You are Finova AI, an expert financial advisor. Categorize this transaction: "${description}". Choose one category from this list: [${categories.join(', ')}]. Respond with only the category name, nothing else.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text?.trim() || "";
    } catch (error) {
        console.error("Error fetching AI category suggestion:", error);
        throw error;
    }
};

const SAR_PER_USD = 3.75;
const GRAMS_PER_TROY_OZ = 31.1035;
const BINANCE_BASE = 'https://api.binance.com/api/v3';

/** Fetch BTC/ETH prices from Binance (no API key). Returns SAR. Used when Finnhub fails or is unavailable. */
async function getBinanceCryptoPrices(symbols: string[]): Promise<{ symbol: string; price: number }[]> {
    const out: { symbol: string; price: number }[] = [];
    const binancePairs: [string, string][] = []; // [requestSymbol, normalizedSymbol]
    for (const sym of symbols) {
        const s = (sym || '').toUpperCase().trim();
        if (s === 'BTC_USD' || s === 'BTC') binancePairs.push(['BTCUSDT', 'BTC']);
        else if (s === 'ETH_USD' || s === 'ETH') binancePairs.push(['ETHUSDT', 'ETH']);
    }
    for (const [pair, normalized] of binancePairs) {
        try {
            const res = await fetch(`${BINANCE_BASE}/ticker/price?symbol=${encodeURIComponent(pair)}`);
            if (!res.ok) continue;
            const data = await res.json();
            const priceUsd = Number(data?.price);
            if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;
            out.push({ symbol: normalized, price: priceUsd * SAR_PER_USD });
        } catch {
            // skip
        }
    }
    return out;
}

/** Fetch commodity prices from Finnhub (crypto + metals). Returns prices in SAR. */
export async function getFinnhubCommodityPrices(commodities: Pick<CommodityHolding, 'symbol' | 'name'>[]): Promise<{ symbol: string; price: number }[]> {
    const token = import.meta.env.VITE_FINNHUB_API_KEY;
    if (!token) return [];
    const out: { symbol: string; price: number }[] = [];
    for (const c of commodities) {
        const sym = (c.symbol || '').toUpperCase().trim();
        let finnhubSym = '';
        let priceMultiplier = SAR_PER_USD;
        let normalizedSym = sym;
        if (sym === 'BTC_USD' || sym === 'BTC') {
            finnhubSym = 'BINANCE:BTCUSDT';
            normalizedSym = 'BTC';
        } else if (sym === 'ETH_USD' || sym === 'ETH') {
            finnhubSym = 'BINANCE:ETHUSDT';
            normalizedSym = 'ETH';
        } else if (sym === 'XAU_GRAM' || sym === 'XAU') {
            finnhubSym = 'OANDA:XAU_USD';
            priceMultiplier = SAR_PER_USD / GRAMS_PER_TROY_OZ;
            normalizedSym = sym === 'XAU' ? 'XAU' : sym;
        } else if (sym === 'XAG_GRAM' || sym === 'XAG') {
            finnhubSym = 'OANDA:XAG_USD';
            priceMultiplier = SAR_PER_USD / GRAMS_PER_TROY_OZ;
            normalizedSym = sym === 'XAG' ? 'XAG' : sym;
        }
        if (!finnhubSym) continue;
        try {
            const res = await finnhubFetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSym)}&token=${encodeURIComponent(token)}`);
            if (!res.ok) continue;
            const row = await res.json();
            const priceUsd = Number(row?.c ?? row?.pc ?? row?.p);
            if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;
            out.push({ symbol: normalizedSym, price: priceUsd * priceMultiplier });
        } catch {
            // skip
        }
    }
    return out;
}

/** Normalize commodity symbol for matching (e.g. BTC_USD and BTC both match "BTC"). */
function normalizeCommoditySymbolForMatch(sym: string): string {
    const s = (sym || '').toUpperCase().trim();
    if (s === 'BTC_USD' || s === 'BTC') return 'BTC';
    if (s === 'ETH_USD' || s === 'ETH') return 'ETH';
    return s;
}

/** Commodity prices: Finnhub first, then Binance fallback for crypto so metals and crypto are reliably retrieved. */
export const getAICommodityPrices = async (commodities: Pick<CommodityHolding, 'symbol' | 'name'>[]): Promise<{ prices: { symbol: string; price: number }[], groundingChunks: any[] }> => {
    if (commodities.length === 0) return { prices: [], groundingChunks: [] };
    let prices = await getFinnhubCommodityPrices(commodities);
    const haveSymbol = new Set(prices.map(p => normalizeCommoditySymbolForMatch(p.symbol)));
    const missingCrypto = commodities
        .map(c => (c.symbol || '').toUpperCase().trim())
        .filter(s => (s === 'BTC' || s === 'BTC_USD' || s === 'ETH' || s === 'ETH_USD') && !haveSymbol.has(normalizeCommoditySymbolForMatch(s)));
    if (missingCrypto.length > 0) {
        const binancePrices = await getBinanceCryptoPrices([...new Set(missingCrypto)]);
        for (const p of binancePrices) {
            if (!prices.some(x => normalizeCommoditySymbolForMatch(x.symbol) === p.symbol)) {
                prices = [...prices, p];
            }
        }
    }
    // Map back to each commodity's symbol so UI matching works (e.g. BTC_USD vs BTC)
    const result: { symbol: string; price: number }[] = [];
    for (const c of commodities) {
        const orig = (c.symbol || '').toUpperCase().trim();
        const normalized = normalizeCommoditySymbolForMatch(orig);
        const found = prices.find(p => normalizeCommoditySymbolForMatch(p.symbol) === normalized);
        if (found) result.push({ symbol: orig, price: found.price });
    }
    // Always return result (keyed by original symbols); never raw prices (e.g. 'BTC') to avoid UI matching failures
    return { prices: result, groundingChunks: [] };
};

export const getAIDividendAnalysis = async (ytdIncome: number, projectedAnnual: number, topPayers: {name: string, projected: number}[]): Promise<string> => {
    try {
        const prompt = `You are a dividend analyst. Data: YTD ${ytdIncome.toLocaleString()} SAR; projected annual ${projectedAnnual.toLocaleString()} SAR; top payers: ${topPayers.map(p => `${p.name} (~${p.projected.toLocaleString()} SAR/yr)`).join(', ')}. Return a short analysis in Markdown only (no HTML). Use ### for each section. Be direct.

### On Track?
- One sentence: is YTD vs projected on track? Use numbers.

### Concentration
- 1-2 bullets on concentration risk from top contributors.

### Suggestion
- One educational tip to improve a dividend strategy. One sentence.
No financial advice. Markdown only.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not retrieve dividend analysis.";
    } catch (error) { return formatAiError(error); }
};

export const getLivePrices = async (symbols: string[]): Promise<{ [symbol: string]: { price: number; change: number; changePercent: number } }> => {
    if (symbols.length === 0) return {};

    const aiFetch = async () => {
        const prompt = `
            Fetch the current real-time market prices for the following stock/crypto symbols: ${symbols.join(', ')}.
            For each symbol, provide:
            1. The current price.
            2. The absolute change from the previous close.
            3. The percentage change from the previous close.
            
            Return the result as a JSON object where the keys are the symbols and the values are objects with 'price', 'change', and 'changePercent' properties.
            Example: {"AAPL": {"price": 185.20, "change": 1.50, "changePercent": 0.81}}
        `;

        const response = await invokeAI({
            model: FAST_MODEL,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    additionalProperties: {
                        type: Type.OBJECT,
                        properties: {
                            price: { type: Type.NUMBER },
                            change: { type: Type.NUMBER },
                            changePercent: { type: Type.NUMBER }
                        },
                        required: ["price", "change", "changePercent"]
                    }
                },
                tools: [{ googleSearch: {} }],
            }
        });
        return normalizePriceMap(robustJsonParse(response.text));
    };

    const provider = (import.meta.env.VITE_LIVE_PRICE_PROVIDER || 'auto').toLowerCase();
    const tryFinnhub = async () => {
        const finnhub = await getFinnhubLivePrices(symbols);
        if (Object.keys(finnhub).length > 0) return finnhub;
        throw new Error('Finnhub returned no symbols');
    };
    const tryStooq = async () => {
        const stooq = await getStooqLivePrices(symbols);
        if (Object.keys(stooq).length > 0) return stooq;
        throw new Error('Stooq returned no symbols');
    };

    try {
        if (provider === 'finnhub') return await tryFinnhub();
        if (provider === 'stooq') return await tryStooq();
        if (provider === 'ai') return await aiFetch();

        // auto: Finnhub first, then fill Saudi (.SR) and other missing symbols via Stooq
        let result = await getFinnhubLivePrices(symbols).catch(() => ({} as { [s: string]: { price: number; change: number; changePercent: number } }));
        const missing = symbols.filter((s) => !result[(s || '').trim().toUpperCase()]);
        if (missing.length > 0) {
            const stooqResult = await getStooqLivePrices(missing).catch(() => ({}));
            result = { ...result, ...stooqResult };
        }
        if (Object.keys(result).length > 0) return result;
        throw new Error('No live prices returned from Finnhub or Stooq');
    } catch (error) {
        console.error("Error fetching live prices:", error);
        throw error;
    }
};


/** Default analyst/eligibility values when AI is not used (app-level defaults, not manual entry). */
const DEFAULT_ANALYST_ELIGIBILITY = {
    minimumUpsidePercentage: 25,
    stale_days: 30,
    min_coverage_threshold: 3,
    redirect_policy: 'pro-rata' as const,
    target_provider: 'TipRanks',
};

export type SuggestedAnalystEligibility = {
    minimumUpsidePercentage: number;
    stale_days: number;
    min_coverage_threshold: number;
    redirect_policy: 'pro-rata' | 'priority';
    target_provider: string;
};

/** Suggest analyst & eligibility parameters from AI based on universe and context. Use to auto-fill the plan; no manual entry required. */
export async function getSuggestedAnalystEligibility(
    universe: UniverseTicker[],
    currentPlan?: Partial<InvestmentPlanSettings>
): Promise<SuggestedAnalystEligibility> {
    const fallbackFromUniverse = (): SuggestedAnalystEligibility => {
        const coreCount = universe.filter(t => t.status === 'Core').length;
        const upsideCount = universe.filter(t => t.status === 'High-Upside').length;
        const total = Math.max(1, coreCount + upsideCount);
        const upsideRatio = upsideCount / total;
        const baseUpside = currentPlan?.minimumUpsidePercentage ?? DEFAULT_ANALYST_ELIGIBILITY.minimumUpsidePercentage;
        const tunedUpside = Math.round(Math.min(35, Math.max(18, baseUpside + (upsideRatio >= 0.5 ? 3 : 0))));
        return {
            minimumUpsidePercentage: tunedUpside,
            stale_days: Math.min(90, Math.max(14, Math.round(currentPlan?.stale_days ?? DEFAULT_ANALYST_ELIGIBILITY.stale_days))),
            min_coverage_threshold: Math.min(5, Math.max(2, Math.round(currentPlan?.min_coverage_threshold ?? DEFAULT_ANALYST_ELIGIBILITY.min_coverage_threshold))),
            redirect_policy: (currentPlan?.redirect_policy === 'priority' ? 'priority' : 'pro-rata'),
            target_provider: String(currentPlan?.target_provider || DEFAULT_ANALYST_ELIGIBILITY.target_provider).trim() || DEFAULT_ANALYST_ELIGIBILITY.target_provider,
        };
    };

    try {
        const tickers = universe.slice(0, 30).map(t => t.ticker).join(', ') || 'none';
        const prompt = `You are Finova AI, an expert investment analyst. Suggest sensible default parameters for an investment plan's "Analyst & eligibility" rules.

Universe tickers (sample): ${tickers}.
Current plan (if any): min upside ${currentPlan?.minimumUpsidePercentage ?? 'not set'}%, stale days ${currentPlan?.stale_days ?? 'not set'}, min coverage ${currentPlan?.min_coverage_threshold ?? 'not set'}, provider ${currentPlan?.target_provider ?? 'not set'}.

Return a single JSON object with: minimumUpsidePercentage (number 15-35, typical 20-25), stale_days (number 14-90, typical 30), min_coverage_threshold (number 2-5, typical 3), redirect_policy ("pro-rata" or "priority"), target_provider (string, e.g. "TipRanks", "Reuters", "Bloomberg"). Be conservative and standard.`;

        const response = await invokeAI({
            model: FAST_MODEL,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        minimumUpsidePercentage: { type: Type.NUMBER },
                        stale_days: { type: Type.NUMBER },
                        min_coverage_threshold: { type: Type.NUMBER },
                        redirect_policy: { type: Type.STRING },
                        target_provider: { type: Type.STRING },
                    },
                    required: ['minimumUpsidePercentage', 'stale_days', 'min_coverage_threshold', 'redirect_policy', 'target_provider'],
                },
            },
        });
        const raw = robustJsonParse(response.text);
        if (!raw || typeof raw !== 'object') return DEFAULT_ANALYST_ELIGIBILITY;
        const minUpside = Math.min(50, Math.max(10, Number(raw.minimumUpsidePercentage) || DEFAULT_ANALYST_ELIGIBILITY.minimumUpsidePercentage));
        const staleDays = Math.min(365, Math.max(7, Math.round(Number(raw.stale_days) || DEFAULT_ANALYST_ELIGIBILITY.stale_days)));
        const minCov = Math.min(10, Math.max(1, Math.round(Number(raw.min_coverage_threshold) || DEFAULT_ANALYST_ELIGIBILITY.min_coverage_threshold)));
        const redirect = (raw.redirect_policy === 'priority' ? 'priority' : 'pro-rata') as 'pro-rata' | 'priority';
        const provider = String(raw.target_provider || DEFAULT_ANALYST_ELIGIBILITY.target_provider).trim() || DEFAULT_ANALYST_ELIGIBILITY.target_provider;
        return { minimumUpsidePercentage: minUpside, stale_days: staleDays, min_coverage_threshold: minCov, redirect_policy: redirect, target_provider: provider };
    } catch (_) {
        return fallbackFromUniverse();
    }
}

/** Rule-based execution (no AI): allocates budget by plan weights. Use when AI is unavailable or as fallback. */
type ExecutionCurrencyOptions = {
    planCurrency?: TradeCurrency;
    tickerCurrencyMap?: Record<string, TradeCurrency>;
    fxRate?: number;
};

const inferTradeCurrencyFromTicker = (ticker: string): TradeCurrency => (/(\.SR|\.SA)$/i.test(ticker) ? 'SAR' : 'USD');

const toTradeWithCurrency = (
    trade: ProposedTrade,
    opts: ExecutionCurrencyOptions
): ProposedTrade => {
    const planCurrency = opts.planCurrency ?? 'SAR';
    const ticker = (trade.ticker || '').trim().toUpperCase();
    const tradeCurrency = opts.tickerCurrencyMap?.[ticker] ?? inferTradeCurrencyFromTicker(trade.ticker);
    const rate = opts.fxRate && opts.fxRate > 0 ? opts.fxRate : 3.75;
    let converted = trade.amount;
    if (tradeCurrency !== planCurrency) {
        converted = tradeCurrency === 'USD' ? trade.amount / rate : trade.amount * rate;
    }
    return {
        ...trade,
        tradeCurrency,
        amountInTradeCurrency: Math.max(0, Number(converted.toFixed(2))),
    };
};

const enrichTradesWithCurrency = (result: InvestmentPlanExecutionResult, opts: ExecutionCurrencyOptions): InvestmentPlanExecutionResult => ({
    ...result,
    trades: (result.trades ?? []).map((trade) => toTradeWithCurrency(trade, opts)),
});

export function executeInvestmentPlanRuleBased(
    plan: InvestmentPlanSettings,
    universe: UniverseTicker[],
    options?: ExecutionCurrencyOptions
): InvestmentPlanExecutionResult {
    const date = new Date().toISOString();
    const coreTickers = universe.filter(t => t.status === 'Core');
    const upsideTickers = universe.filter(t => t.status === 'High-Upside');
    const speculativeTickers = universe.filter(t => t.status === 'Speculative');
    const budget = plan.monthlyBudget ?? 0;
    const minOrder = plan.brokerConstraints?.minimumOrderSize ?? 0;
    const corePct = plan.coreAllocation ?? 0.7;
    const upsidePct = plan.upsideAllocation ?? 0.3;

    const trades: InvestmentPlanExecutionResult['trades'] = [];
    let coreInvestment = 0;
    let upsideInvestment = 0;
    let speculativeInvestment = 0;
    const redirectPool: { ticker: string; amount: number }[] = [];

    const totalWeight = (arr: UniverseTicker[]) => arr.reduce((s, t) => s + (t.monthly_weight ?? 1), 0);
    const coreW = totalWeight(coreTickers);
    const upsideW = totalWeight(upsideTickers);
    const specW = totalWeight(speculativeTickers);

    const roundAmount = (amt: number): number => {
        if (plan.brokerConstraints?.roundingRule === 'floor') return Math.floor(amt);
        if (plan.brokerConstraints?.roundingRule === 'ceil') return Math.ceil(amt);
        return Math.round(amt);
    };

    coreTickers.forEach(t => {
        const w = (t.monthly_weight ?? 1) / (coreW || 1);
        let amt = roundAmount(budget * corePct * w);
        if (minOrder > 0 && amt > 0 && amt < minOrder) {
            redirectPool.push({ ticker: t.ticker, amount: amt });
            return;
        }
        if (amt > 0) {
            trades.push({ ticker: t.ticker, amount: amt, reason: 'Core' });
            coreInvestment += amt;
        }
    });

    upsideTickers.forEach(t => {
        const w = (t.monthly_weight ?? 1) / (upsideW || 1);
        let amt = roundAmount(budget * upsidePct * w);
        if (minOrder > 0 && amt > 0 && amt < minOrder) {
            redirectPool.push({ ticker: t.ticker, amount: amt });
            return;
        }
        if (amt > 0) {
            trades.push({ ticker: t.ticker, amount: amt, reason: 'Upside' });
            upsideInvestment += amt;
        }
    });

    speculativeTickers.forEach(t => {
        const w = (t.monthly_weight ?? 1) / (specW || 1);
        const cap = budget * 0.05;
        let amt = roundAmount(Math.min(cap * w, budget * 0.02));
        if (minOrder > 0 && amt > 0 && amt < minOrder) amt = 0;
        if (amt > 0) {
            trades.push({ ticker: t.ticker, amount: amt, reason: 'Speculative' });
            speculativeInvestment += amt;
        }
    });

    let redirectedInvestment = 0;
    const redirectSum = redirectPool.reduce((s, x) => s + x.amount, 0);
    if (redirectSum > 0 && coreTickers.length > 0 && plan.redirect_policy) {
        const proRata = plan.redirect_policy === 'pro-rata';
        if (proRata) {
            coreTickers.forEach(t => {
                const w = (t.monthly_weight ?? 1) / (coreW || 1);
                let amt = roundAmount(redirectSum * w);
                if (minOrder > 0 && amt > 0 && amt < minOrder) amt = 0;
                if (amt > 0) {
                    trades.push({ ticker: t.ticker, amount: amt, reason: 'Redirected' });
                    redirectedInvestment += amt;
                }
            });
        } else {
            if (redirectSum >= minOrder) {
                const amt = roundAmount(redirectSum);
                trades.push({ ticker: coreTickers[0].ticker, amount: amt, reason: 'Redirected' });
                redirectedInvestment = amt;
            }
        }
    }

    const totalInvestment = coreInvestment + upsideInvestment + speculativeInvestment + redirectedInvestment;
    const unusedUpsideFunds = Math.max(0, budget - totalInvestment);

    const log_details = `## Rule-based execution (no AI)
- **Date:** ${date}
- **Budget:** ${budget} ${plan.budgetCurrency}
- **Core:** ${coreInvestment} | **Upside:** ${upsideInvestment} | **Spec:** ${speculativeInvestment} | **Redirected:** ${redirectedInvestment}
- **Unused:** ${unusedUpsideFunds}
- Tickers: Core ${coreTickers.length}, High-Upside ${upsideTickers.length}, Speculative ${speculativeTickers.length}.
- No analyst targets or eligibility checks; allocation by weights only. Use AI execution for full logic.`;

    return enrichTradesWithCurrency({
        date,
        totalInvestment,
        coreInvestment,
        upsideInvestment,
        speculativeInvestment,
        redirectedInvestment,
        unusedUpsideFunds,
        trades,
        status: totalInvestment > 0 ? 'success' : 'failure',
        log_details,
    }, { planCurrency: options?.planCurrency ?? plan.budgetCurrency, tickerCurrencyMap: options?.tickerCurrencyMap, fxRate: options?.fxRate ?? 3.75 });
}

export async function executeInvestmentPlanStrategy(
    plan: InvestmentPlanSettings,
    universe: UniverseTicker[],
    options?: { forceRuleBased?: boolean } & ExecutionCurrencyOptions
): Promise<InvestmentPlanExecutionResult> {
    if (options?.forceRuleBased) {
        return Promise.resolve(executeInvestmentPlanRuleBased(plan, universe, options));
    }

    const coreTickers = universe.filter(t => t.status === 'Core');
    const upsideTickers = universe.filter(t => t.status === 'High-Upside');
    const speculativeTickers = universe.filter(t => t.status === 'Speculative');
    const quarantineTickers = universe.filter(t => t.status === 'Quarantine');

    const prompt = `
    You are an extremely precise, rules-based financial execution AI. Your sole task is to generate a list of trades based on a strict set of instructions. Adhere to all constraints perfectly.

    **Execution Date:** ${new Date().toISOString().split('T')[0]}

    **1. Global Configuration:**
    - Monthly Budget: ${plan.monthlyBudget} ${plan.budgetCurrency}
    - Core Allocation: ${plan.coreAllocation * 100}% (${plan.monthlyBudget * plan.coreAllocation} ${plan.budgetCurrency})
    - High-Upside Allocation: ${plan.upsideAllocation * 100}% (${plan.monthlyBudget * plan.upsideAllocation} ${plan.budgetCurrency})
    - Min Upside Threshold: ${plan.minimumUpsidePercentage}%
    - Stale Days: ${plan.stale_days}
    - Min Coverage Threshold: ${plan.min_coverage_threshold}
    - Redirect Policy: ${plan.redirect_policy}
    - Target Provider: ${plan.target_provider}

    **2. Broker & Execution Constraints:**
    - Allow Fractional Shares: ${plan.brokerConstraints.allowFractionalShares}
    - Minimum Order Size: ${plan.brokerConstraints.minimumOrderSize} ${plan.budgetCurrency}
    - Rounding Rule for Shares: ${plan.brokerConstraints.roundingRule}
    - Leftover Cash Rule: ${plan.brokerConstraints.leftoverCashRule}

    **3. Portfolio Universe & Definitions:**
    - Core Portfolio: ${JSON.stringify(coreTickers.map(t => ({ ticker: t.ticker, weight: t.monthly_weight, max_weight: t.max_position_weight })))}
    - High-Upside Sleeve: ${JSON.stringify(upsideTickers.map(t => ({ ticker: t.ticker, weight: t.monthly_weight, max_weight: t.max_position_weight, threshold_override: t.min_upside_threshold_override, coverage_override: t.min_coverage_override })))}
    - Speculative Assets: ${JSON.stringify(speculativeTickers.map(t => ({ ticker: t.ticker, weight: t.monthly_weight, max_weight: t.max_position_weight })))}
    - Quarantine Assets: ${JSON.stringify(quarantineTickers.map(t => ({ ticker: t.ticker })))} (Hold-only, 0 new allocation)
    - Watchlist/Excluded: Ignore completely.

    **4. Execution Logic (Strict Order):**

    **Step A: Data Retrieval & Validation**
    1. For each tradable asset (Core, High-Upside, Speculative), use Google Search to find:
       - Current Price
       - Analyst Price Target (from ${plan.target_provider} if possible)
       - Target Date/Timestamp
       - Coverage (number of analysts)
    2. Mark targets as STALE if older than ${plan.stale_days} days.

    **Step B: Eligibility Evaluation (High-Upside Gate)**
    1. A High-Upside asset is ELIGIBLE only if:
       - Target exists AND is not stale.
       - Implied upside >= threshold (Threshold is ${plan.minimumUpsidePercentage}% or ticker override).
       - Upside Rule: Eligible if CurrentPrice <= TargetPrice / (1 + (Threshold/100)).
    2. Confidence Gate (Low Coverage):
       - If Coverage < ${plan.min_coverage_threshold} (or ticker override), apply STRICTER conditions:
         - Choice: Require 10% higher upside than default.
    3. Create an eligibility list in your audit log.

    **Step C: Initial Allocation**
    1. CORE: Allocate (Budget * Core%) according to monthly_weights.
    2. HIGH_UPSIDE: Allocate (Budget * High-Upside%) according to monthly_weights ONLY for ELIGIBLE assets.
    3. SPECULATIVE: Allocate a tiny capped amount based on monthly_weights. Never boosted.
    4. QUARANTINE: Allocate 0.

    **Step D: Redirect Pool (No Idle Cash)**
    1. Any uninvested amount from ineligible high-upside, stale data, missing price, blocked by caps, or speculative pauses MUST be added to a 'Redirect Pool'.
    2. Redistribute the Redirect Pool to CORE assets using the Redirect Policy (${plan.redirect_policy}).
       - If 'pro-rata', distribute based on core weights.
       - If 'priority', distribute to the first core asset until its max_weight is hit, then the next.

    **Step E: Risk Caps & Constraints**
    1. Enforce max_position_weight for every trade. Block excess and move to Redirect Pool.
    2. Apply broker constraints (min order size, rounding). Move leftovers to Redirect Pool and redistribute to Core.

    **Step F: Finalize & Log**
    1. The final JSON output MUST contain a 'log_details' string (Markdown).
    2. Log: Prices used, targets used (provider/date/stale), eligibility results + reasons, planned vs final allocations, redirect pool distribution, blocked trades + reasons.

    **Output Schema:**
    You must call the 'record_investment_trades' function.
    `;

    const recordTradesFunction: FunctionDeclaration = {
        name: 'record_investment_trades',
        description: 'Records the results of the investment plan execution, including trades and audit logs.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                totalInvestment: { type: Type.NUMBER },
                coreInvestment: { type: Type.NUMBER },
                upsideInvestment: { type: Type.NUMBER },
                speculativeInvestment: { type: Type.NUMBER },
                redirectedInvestment: { type: Type.NUMBER },
                unusedUpsideFunds: { type: Type.NUMBER },
                status: { type: Type.STRING, enum: ['success', 'failure'] },
                log_details: { type: Type.STRING, description: 'Markdown formatted audit log of the execution.' },
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
            required: ['totalInvestment', 'coreInvestment', 'upsideInvestment', 'speculativeInvestment', 'redirectedInvestment', 'unusedUpsideFunds', 'status', 'log_details', 'trades'],
        },
    };

    const executeWithModel = async (model: string) => {
        const result = await invokeAI({
            model,
            contents: [{ parts: [{ text: prompt }] }],
            config: {
                tools: [{ functionDeclarations: [recordTradesFunction] }, { googleSearch: {} }],
            }
        });
        if (result.functionCalls && result.functionCalls.length > 0) {
            const args = result.functionCalls[0].args;
            return enrichTradesWithCurrency({
                date: new Date().toISOString(),
                ...args,
            } as InvestmentPlanExecutionResult, {
                planCurrency: options?.planCurrency ?? plan.budgetCurrency,
                tickerCurrencyMap: options?.tickerCurrencyMap,
                fxRate: options?.fxRate ?? 3.75,
            });
        }
        throw new Error('AI did not return the expected function call.');
    };

    const withAiFallbackNote = (result: InvestmentPlanExecutionResult, details: string): InvestmentPlanExecutionResult => ({
        ...result,
        log_details: `${result.log_details || ''}\n\n> AI execution unavailable. Automatically switched to rule-based mode.\n> Reason: ${details}`.trim(),
    });

    try {
        return await executeWithModel(FAST_MODEL);
    } catch (error) {
        const details = formatAiError(error);
        const shouldRetry = !details.includes('quota') && !details.includes('usage limit') && (details.includes('503') || details.toLowerCase().includes('unavailable') || details.toLowerCase().includes('high demand'));
        if (shouldRetry) {
            try {
                await new Promise(resolve => setTimeout(resolve, 800));
                return await executeWithModel(FAST_MODEL);
            } catch (retryError) {
                console.warn('AI execution failed (retry failed), falling back to rule-based:', retryError);
                return withAiFallbackNote(executeInvestmentPlanRuleBased(plan, universe), formatAiError(retryError));
            }
        }
        console.warn('AI execution failed, falling back to rule-based (no AI):', error);
        return withAiFallbackNote(executeInvestmentPlanRuleBased(plan, universe), details);
    }
}
