import type { FunctionDeclaration } from '@google/genai';
import { SchemaType } from './geminiSchemaTypes';
import { KPISummary, Holding, Goal, InvestmentTransaction, WatchlistItem, Transaction, Budget, FinancialData, InvestmentPortfolio, CommodityHolding, FeedItem, PersonaAnalysis, InvestmentPlanSettings, UniverseTicker, InvestmentPlanExecutionResult, ProposedTrade, TradeCurrency } from '../types';
import { finnhubFetch, toFinnhubSymbol, fromFinnhubSymbol, canonicalQuoteLookupKey, toStooqSymbol, getFinnhubQuoteCandidates } from './finnhubService';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from './transactionFilters';
import { capitalizeCategoryName } from '../utils/categoryFormat';
import { DEFAULT_SAR_PER_USD } from '../utils/currencyMath';
import { effectiveHoldingValueInBookCurrency } from '../utils/holdingValuation';
import { fetchStooq } from './stooqClient';
import { fetchGeminiProxyHealthStatus, getGeminiProxyEndpoints } from './aiProxyEndpoints';
import { computeGoalMonthlyAllocation, normalizeGoalAllocationPercent } from './goalAllocation';

// --- Model Constants ---
const FAST_MODEL = 'gemini-3-flash-preview';

/** Expert advisor persona: used so the AI speaks as a senior financial and investment advisor everywhere. */
const EXPERT_ADVISOR_PERSONA = `You are Finova AI: an expert financial and investment advisor. Wealth management, portfolio construction, budgeting, goal-based planning. Authoritative, clear, insightful—never generic. Direct, actionable guidance with precise numbers and concrete next steps.`;

/** Scope instruction: all data passed to you is the user's personal wealth only. */
const PERSONAL_WEALTH_SCOPE = `All data is the user's personal wealth only—their accounts, assets, transactions. Analyze only their personal finances.`;

/** Strict response rules: brief, direct, useful. No filler, no hedging, no test phrases. */
const BRIEF_DIRECT_RULES = `CRITICAL: Be brief. Be direct. Be useful. No filler, no hedging, no generic phrases like "I'd be happy to help" or "Here are some thoughts." Lead with the insight. One sentence per bullet. Use exact numbers. Markdown only: ### headers, - bullets, ** emphasis. No HTML.`;

const DEFAULT_SYSTEM_INSTRUCTION = `${EXPERT_ADVISOR_PERSONA}

${PERSONAL_WEALTH_SCOPE}

${BRIEF_DIRECT_RULES}`;


// --- AI Error Formatting (single source for all AI pages) ---
/** User-facing message for rate-limit / quota: neutral wording (not "you exceeded"). */
const AI_QUOTA_MESSAGE = "The AI service is temporarily unavailable (usage limit reached). This can happen even if you didn't use it—limits may be account- or service-wide. Try again later or use features that don't require AI (e.g. Wealth Ultra, manual updates).";

function isQuotaOrRateLimitError(message: string, parsed?: { error?: { code?: number; status?: string } }): boolean {
    if (/quota|RESOURCE_EXHAUSTED|429|rate.?limit/i.test(message)) return true;
    const code = parsed?.error?.code;
    const status = parsed?.error?.status;
    return code === 429 || status === 'RESOURCE_EXHAUSTED';
}


function extractErrorMessageParts(error: any): string[] {
    const parts: string[] = [];
    const push = (v: any) => {
        if (typeof v === 'string' && v.trim()) parts.push(v.trim());
    };
    if (typeof error === 'string') push(error);
    if (error instanceof Error) push(error.message);
    if (error && typeof error === 'object') {
        push((error as any).message);
        push((error as any).error);
        if ((error as any).error && typeof (error as any).error === 'object') {
            push((error as any).error.message);
            push((error as any).error.status);
        }
        if ((error as any).response && typeof (error as any).response === 'object') {
            push((error as any).response.message);
            push((error as any).response.error);
            if ((error as any).response.error && typeof (error as any).response.error === 'object') {
                push((error as any).response.error.message);
                push((error as any).response.error.status);
            }
        }
    }
    return [...new Set(parts)];
}

export function formatAiError(error: any): string {
    console.error("Error from AI Service:", error);
    const messageParts = extractErrorMessageParts(error);
    let message = messageParts[0] || String(error ?? '');
    const mergedMessage = messageParts.join(' | ') || message;
    // Proxy may return stringified JSON in error; parse to detect quota/429
    let parsed: { error?: { code?: number; status?: string; message?: string } | string } | null = null;
    try {
        const trimmed = mergedMessage.trim();
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
    if (isQuotaOrRateLimitError(mergedMessage, parsedForQuota)) {
        return AI_QUOTA_MESSAGE;
    }
    if (/GEMINI_API_KEY not set|No AI providers configured/i.test(mergedMessage)) {
        return `AI not configured. Set at least one in Netlify env: GEMINI_API_KEY, GEMINI_API_KEY_BACKUP, ANTHROPIC_API_KEY, OPENAI_API_KEY, or GROK_API_KEY (Grok is tried last; use another provider if Grok has no credits).`;
    }
    if (/GROK_ACCOUNT_NOT_USABLE|Grok \(xAI\)|xAI Grok returned|console\.x\.ai|no credits or licenses|does not have permission to execute/i.test(mergedMessage)) {
        return `Grok (xAI) isn’t usable for this team yet (credits or license). Add billing at https://console.x.ai or set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in Netlify so AI runs on another provider. You can also set GROK_DISABLED=1 to skip Grok without removing the key.`;
    }
    if (/API key not valid/i.test(mergedMessage)) {
        return "The AI service API key is not valid. Please check the backend configuration.";
    }
    if (/Inactivity Timeout|request timed out while waiting for proxy|AI request timed out at the proxy/i.test(mergedMessage)) {
        return "The AI request took too long and timed out at the server. Please try again, or continue with the auto-filled default analyst settings.";
    }
    if (/model|404|not found|invalid model|unsupported/i.test(mergedMessage)) {
        return `There was an issue with the specified AI model. ${mergedMessage}`;
    }
    if (mergedMessage) return `AI Service Error: ${mergedMessage}`;
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


const fmtSar = (value: number): string => `${Number.isFinite(value) ? value : 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function buildDirectExecutiveFallback(monthlyPnL: number, overspentBudgets: string, goalProgress: string): string {
    const direction = monthlyPnL >= 0 ? 'positive' : 'negative';
    return `### Overall Financial Health
- Monthly P&L is **${fmtSar(monthlyPnL)} SAR** (${direction} month).

### Key Highlights
- Budget pressure list: **${overspentBudgets || 'None'}**.
- Goal tracking snapshot: **${goalProgress || 'No goals set'}**.

### Areas for Attention
- Protect cash flow if P&L stays negative for 2+ months.

### Strategic Recommendation
- Set one immediate action this week: cap highest spend bucket and auto-transfer savings on payday.`;
}

function buildDirectPlanFallback(totals: any, scenarios: any): string {
    const projectedNet = Number(totals?.projectedNet || 0);
    const incomeShockPct = Number(scenarios?.incomeShock?.percent || 0);
    const incomeShockDuration = Number(scenarios?.incomeShock?.duration || 0);
    const expenseStressPct = Number(scenarios?.expenseStress?.percent || 0);
    const monthlyImpact = (projectedNet / 12) * ((-incomeShockPct + -expenseStressPct) / 100);
    const annualImpact = monthlyImpact * Math.max(1, incomeShockDuration);
    const revised = projectedNet + annualImpact;
    return `### Scenario Impact
- Projected annual savings: **${fmtSar(projectedNet)} SAR → ${fmtSar(revised)} SAR** (estimated impact **${fmtSar(annualImpact)} SAR**).

### Strategic Recommendation
- Keep a dedicated contingency buffer equal to at least one month of essential costs before increasing discretionary allocation.

### Summary
- Stress-testing now keeps execution disciplined later.`;
}

function buildDirectAnalysisFallback(
    spendingData: { name: string; value: number }[],
    trendData: { name: string; income: number; expenses: number }[],
    compositionData: { name: string; value: number }[]
): string {
    const topSpend = [...spendingData].sort((a, b) => b.value - a.value)[0];
    const avgIncome = trendData.length ? trendData.reduce((s, r) => s + (r.income || 0), 0) / trendData.length : 0;
    const avgExpense = trendData.length ? trendData.reduce((s, r) => s + (r.expenses || 0), 0) / trendData.length : 0;
    const assets = compositionData.filter((x) => x.name !== 'Debt').reduce((s, x) => s + Math.max(0, x.value || 0), 0);
    const debt = compositionData.filter((x) => x.name === 'Debt').reduce((s, x) => s + Math.max(0, x.value || 0), 0);
    return `### Spending Habits
- Top spend bucket is **${topSpend?.name || 'N/A'}** at **${fmtSar(topSpend?.value || 0)} SAR**.

### Cash Flow Dynamics
- Average monthly income vs expense is **${fmtSar(avgIncome)} vs ${fmtSar(avgExpense)} SAR**.

### Balance Sheet Health
- Assets vs debt snapshot: **${fmtSar(assets)} vs ${fmtSar(debt)} SAR**.`;
}

function buildDefaultPersonaFallback(
    savingsRate: number,
    debtToAssetRatio: number,
    emergencyFundMonths: number,
    investmentStyle: string
): PersonaAnalysis {
    const savingsPct = Math.max(0, savingsRate * 100);
    const debtPct = Math.max(0, debtToAssetRatio * 100);
    const ef = Math.max(0, emergencyFundMonths);
    const rate = (value: number, good: number, ok: number): 'Excellent' | 'Good' | 'Needs Improvement' =>
        value >= good ? 'Excellent' : value >= ok ? 'Good' : 'Needs Improvement';

    return {
        persona: {
            title: savingsPct >= 25 ? 'The Disciplined Wealth Builder' : savingsPct >= 10 ? 'The Steady Optimizer' : 'The Recovery-Focused Planner',
            description: `Direct snapshot: savings ${savingsPct.toFixed(1)}%, debt ratio ${debtPct.toFixed(1)}%, emergency fund ${ef.toFixed(1)} months, style ${investmentStyle}.`,
        },
        reportCard: [
            {
                metric: 'Savings Discipline',
                value: `${savingsPct.toFixed(1)}%`,
                rating: rate(savingsPct, 20, 10),
                analysis: 'Higher recurring savings increases strategic flexibility and compounding capacity.',
                suggestion: 'Automate a fixed transfer to long-term investing immediately after income posts.',
            },
            {
                metric: 'Debt Pressure',
                value: `${debtPct.toFixed(1)}%`,
                rating: debtPct <= 30 ? 'Excellent' : debtPct <= 50 ? 'Good' : 'Needs Improvement',
                analysis: 'Debt load determines how aggressively you can allocate to growth assets.',
                suggestion: 'Prioritize highest-cost debt first while preserving a minimum emergency buffer.',
            },
            {
                metric: 'Emergency Preparedness',
                value: `${ef.toFixed(1)} months`,
                rating: rate(ef, 6, 3),
                analysis: 'Emergency runway protects long-term plans from short-term shocks.',
                suggestion: 'Target 6 months of core expenses in liquid, low-volatility accounts.',
            },
            {
                metric: 'Investment Alignment',
                value: investmentStyle,
                rating: 'Good',
                analysis: 'Style is useful when allocation rules and risk controls are consistently executed.',
                suggestion: 'Review sleeve drift monthly and execute rebalancing in small controlled steps.',
            },
        ],
    };
}


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
const isFinnhub403 = (error: unknown): boolean =>
    /\b403\b|forbidden|plan\/key restriction|premium|not available/i.test(error instanceof Error ? error.message : String(error ?? ''));
let warnedFinnhub403InGeminiService = false;

const getFinnhubLivePrices = async (symbols: string[]): Promise<{ [symbol: string]: { price: number; change: number; changePercent: number } }> => {
    if (symbols.length === 0) return {};
    const token = getFinnhubApiKey();
    const mapped: { [symbol: string]: { price: number; change: number; changePercent: number } } = {};

    for (const rawSymbol of symbols) {
        const candidateSymbols = getFinnhubQuoteCandidates(rawSymbol);
        for (const finnhubSymbol of candidateSymbols) {
            try {
                const response = await finnhubFetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${encodeURIComponent(token)}`);
                if (!response.ok) continue;
                const row = await response.json();
                const price = Number(row?.c ?? row?.pc ?? row?.p);
                let change = Number(row?.d ?? 0);
                let changePercent = Number(row?.dp ?? 0);
                if (!Number.isFinite(price) || price <= 0) continue;
                if (!Number.isFinite(change)) change = 0;
                if (!Number.isFinite(changePercent)) changePercent = 0;
                const quote = { price, change, changePercent };
                const displayKey = fromFinnhubSymbol(finnhubSymbol);
                const rawUpper = (rawSymbol || '').trim().toUpperCase();
                const keys = new Set<string>([displayKey, rawUpper].filter(Boolean));
                const tad = displayKey.match(/^([0-9]{4,6})\.SR$/);
                if (tad) {
                    keys.add(`${tad[1]}.SA`);
                    keys.add(`${tad[1]}.SE`);
                }
                for (const k of keys) mapped[k] = quote;
                break;
            } catch (error) {
                if (isFinnhub403(error)) {
                    if (!warnedFinnhub403InGeminiService) {
                        warnedFinnhub403InGeminiService = true;
                        console.warn('Finnhub returned 403 for this key; quote research fallback will use other sources.');
                    }
                } else {
                    console.warn(`Finnhub quote failed for ${rawSymbol} (${finnhubSymbol}):`, error);
                }
            }
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
            if (!isFinnhub403(error)) console.warn(`Finnhub company news failed for ${rawSymbol}:`, error);
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
            const stooqUrl = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqCode)}&f=sd2t2ohlcvcp&h&e=csv`;
            const response = await fetchStooq(stooqUrl);
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
/** Clears legacy client block (older builds set this after Grok/credit errors). Safe to call from Settings. */
export function clearAiProxySessionBlock(): void {
    try {
        sessionStorage.removeItem('finova_ai_proxy_block_reason');
    } catch {
        /* ignore */
    }
}

async function invokeGeminiProxy(payload: { model: string, contents: any, config?: any, signal?: AbortSignal }): Promise<any> {
    clearAiProxySessionBlock();
    const endpoints = getGeminiProxyEndpoints();
    let lastError: Error | null = null;

    for (const endpoint of endpoints) {
        const controller = new AbortController();
        const externalSignal = payload.signal;
        const onExternalAbort = () => controller.abort();
        if (externalSignal) {
            if (externalSignal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        try {
            const { signal: _unusedSignal, ...safePayload } = payload;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(safePayload),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorBody = await response.text();
                let errorMessage: string;
                try {
                    const jsonError = JSON.parse(errorBody);
                    errorMessage = jsonError.error || `AI proxy failed with status ${response.status}`;
                } catch (e) {
                    if (/Inactivity Timeout/i.test(errorBody)) {
                        errorMessage = 'AI request timed out at the proxy (Inactivity Timeout).';
                    } else {
                        errorMessage = `AI proxy failed with status ${response.status}. The server returned an invalid response.`;
                    }
                }

                const endpointMissing = response.status === 404 || /not found/i.test(errorBody);
                if (endpointMissing) {
                    lastError = new Error(`${errorMessage} Tried endpoint: ${endpoint}`);
                    continue;
                }
                throw new Error(errorMessage);
            }

            return await response.json();
        } catch (error) {
            console.warn(`AI proxy endpoint ${endpoint} failed:`, error instanceof Error ? error.message : String(error));
            if (error instanceof DOMException && error.name === 'AbortError') {
                lastError = new Error('AI request timed out while waiting for proxy response.');
                continue;
            }
            if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('network'))) {
                lastError = new Error('Could not connect to the AI proxy function. Please ensure the Netlify function is deployed correctly.');
                continue;
            }
            lastError = error instanceof Error ? error : new Error(String(error));
            break;
        } finally {
            clearTimeout(timeoutId);
            if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
        }
    }

    throw (lastError || new Error('AI proxy invocation failed for all known endpoints.'));
}

/** Lightweight proxy ping — no LLM call. Matches `AiContext` health body. */
export async function probeGeminiProxyHealth(): Promise<{
    ok: boolean;
    ms: number;
    error?: string;
    configured?: boolean;
}> {
    const start = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
        const r = await fetchGeminiProxyHealthStatus(controller.signal);
        const ms = Math.round(performance.now() - start);
        if (!r.reachable) {
            return {
                ok: false,
                ms,
                error: 'Could not reach AI proxy. Deploy Netlify functions, use dev with @netlify/vite-plugin, or set VITE_AI_PROXY_EXTRA_ORIGIN.',
            };
        }
        if (!r.configured) {
            return {
                ok: false,
                ms,
                configured: false,
                error: 'Proxy reachable but no AI provider key configured (GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or GROK_API_KEY on the server).',
            };
        }
        return { ok: true, ms, configured: true };
    } finally {
        clearTimeout(timeoutId);
    }
}

// Unified AI invocation function. Proxy-only for security (prevents client-bundle key exposure).
// Do not send systemInstruction with responseMimeType application/json + responseSchema — Gemini returns 400 when both are set.
// For JSON structured responses, prepend PERSONAL_WEALTH_SCOPE to string prompts so scope is preserved without systemInstruction.
export async function invokeAI(payload: { model: string, contents: any, config?: any, signal?: AbortSignal }): Promise<any> {
    const rawConfig = payload.config ?? {};
    const isJsonMime = rawConfig.responseMimeType === 'application/json';
    // Strip systemInstruction for JSON responses — Gemini rejects systemInstruction + responseSchema together (400).
    const { systemInstruction: _stripForJson, ...configWithoutSystem } = rawConfig;
    const config = isJsonMime
        ? configWithoutSystem
        : {
              ...rawConfig,
              systemInstruction: rawConfig.systemInstruction ?? DEFAULT_SYSTEM_INSTRUCTION,
          };

    let contents = payload.contents;
    if (isJsonMime && typeof contents === 'string' && PERSONAL_WEALTH_SCOPE) {
        contents = `[Context — ${PERSONAL_WEALTH_SCOPE}]\n\n${contents}`;
    }

    const mergedPayload = {
        ...payload,
        contents,
        config,
    };

    return invokeGeminiProxy(mergedPayload);
}

// --- Salary & Planning Experts (7 modes: allocation, cash flow, 5Y wealth, debt, automation, FI timeline, lifestyle) ---
const SALARY_EXPERT_SYSTEM = `${EXPERT_ADVISOR_PERSONA}

${PERSONAL_WEALTH_SCOPE}

${BRIEF_DIRECT_RULES}

SAR, Saudi context. Exact amounts and percentages.

Output rules (mandatory):
- Return valid Markdown only (no HTML).
- Start with "## Executive Summary" (3-5 bullets, direct language).
- Add "## Recommended Plan" with a Markdown table including: Category, Amount (SAR), Percent, Why.
- Add "## 30-Day Actions" with numbered steps.
- Add "## Assumptions & Gaps" listing any missing data and the exact impact.
- Do not return plain paragraphs only; use headings, bullets, and at least one table.`;

export type SalaryAllocationExpertParams = { salary: number; fixedExpenses: number; currentSavings: number; goal: string };
export type CashFlowExpertParams = { salary: number; expenseBreakdown: string };
export type Wealth5YExpertParams = { salary: number; monthlyInvestment: number; currentNetWorth: number };
export type DebtEliminationExpertParams = { salary: number; debtList: string; receivablesContext?: string };
export type InvestmentAutomationExpertParams = { salary: number; investmentAmountOrPct: string; riskTolerance: string };
export type FinancialIndependenceExpertParams = { monthlyExpenses: number; currentPortfolio: number; monthlyInvestment: number };
export type LifestyleUpgradeExpertParams = { salary: number; currentExpenses: number };

export async function getSalaryAllocationExpert(params: SalaryAllocationExpertParams): Promise<string> {
    const prompt = `Act as my personal finance expert.
My monthly salary is ${params.salary} SAR.
My fixed monthly expenses are ${params.fixedExpenses} SAR.
My current savings / emergency fund is ${params.currentSavings} SAR.
My main financial goal right now is ${params.goal}.

Create a smart monthly salary allocation plan that balances spending, saving, investing and debt payoff (if any). Prioritize: essentials first → protect savings → enjoy responsibly → accelerate wealth. Show exact amounts and percentages for each category.`;
    const response = await invokeAI({ model: FAST_MODEL, contents: prompt, config: { systemInstruction: SALARY_EXPERT_SYSTEM } });
    return response?.text ?? '';
}

export async function getCashFlowAnalystExpert(params: CashFlowExpertParams): Promise<string> {
    const prompt = `My monthly take-home salary is ${params.salary} SAR.
Here is my current monthly expense breakdown: ${params.expenseBreakdown}.

Analyze my cash flow.
Calculate my current savings rate.
Show me exactly where my money is leaking.
Propose a restructured spending plan that permanently increases my savings rate by at least 10–20% without making life feel worse. Track every riyal; find permanent structural improvements.`;
    const response = await invokeAI({ model: FAST_MODEL, contents: prompt, config: { systemInstruction: SALARY_EXPERT_SYSTEM } });
    return response?.text ?? '';
}

export async function getWealth5YearExpert(params: Wealth5YExpertParams): Promise<string> {
    const prompt = `My current monthly salary is ${params.salary} SAR.
I can realistically invest ${params.monthlyInvestment} SAR every month starting now.
My current total net worth (savings + investments – debts) is ${params.currentNetWorth} SAR.

Build me a realistic 5-year wealth growth plan.
Assume conservative to moderate annual returns (6–10%).
Show projected net worth at year 1, 3 and 5.
Highlight the single change that would have the biggest impact on the final number. Use realistic compounding and milestone tracking.`;
    const response = await invokeAI({ model: FAST_MODEL, contents: prompt, config: { systemInstruction: SALARY_EXPERT_SYSTEM } });
    return response?.text ?? '';
}

export async function getDebtEliminationExpert(params: DebtEliminationExpertParams): Promise<string> {
    const recv = (params.receivablesContext ?? '').trim();
    const recvBlock = recv
        ? `

Amounts owed TO me (receivables — money others owe me; these are ASSETS for context only, NOT debts to pay off):
${recv}`
        : '';
    const prompt = `My monthly take-home salary is ${params.salary} SAR.

DEBTS I OWE (money I must repay — analyze ONLY these for payoff order, interest, and timeline):
${params.debtList}
${recvBlock}

Important: In Finova, negative liability balances are debts you owe; positive balances are receivables (owed to you). Never treat receivables as debt to "pay off." If the debt section is empty or none, say so and give general debt-payoff guidance only.

Calculate the fastest and cheapest way to become completely debt-free for debts I actually owe.
Show month-by-month payoff timeline, total interest paid, and how much faster/cheaper it is compared to minimum payments only.
Recommend avalanche vs snowball and why. Minimize total interest and time to payoff.`;
    const response = await invokeAI({ model: FAST_MODEL, contents: prompt, config: { systemInstruction: SALARY_EXPERT_SYSTEM } });
    return response?.text ?? '';
}

export async function getInvestmentAutomationExpert(params: InvestmentAutomationExpertParams): Promise<string> {
    const prompt = `My monthly salary is ${params.salary} SAR.
I want to automatically invest ${params.investmentAmountOrPct} every month.
My risk tolerance is ${params.riskTolerance}.

Design a simple, long-term investment system I can stick to for 10–30 years.
Suggest asset allocation and specific investment types suitable for someone living in Saudi Arabia (Sukuk, local funds, global ETFs, etc.).
Explain how to automate it and why this mix fits my risk level. Pay yourself first; match risk to personality; keep it simple and boring long-term.`;
    const response = await invokeAI({ model: FAST_MODEL, contents: prompt, config: { systemInstruction: SALARY_EXPERT_SYSTEM } });
    return response?.text ?? '';
}

export async function getFinancialIndependenceExpert(params: FinancialIndependenceExpertParams): Promise<string> {
    const prompt = `My current monthly expenses (lifestyle I want to maintain forever) are ${params.monthlyExpenses} SAR.
My current investable savings / portfolio is ${params.currentPortfolio} SAR.
I can invest ${params.monthlyInvestment} SAR every month going forward.

Using a 3.5–4% safe withdrawal rate, tell me:
1. How big my portfolio needs to be to reach financial independence (expenses × 25–28.6).
2. Realistic years until I get there (assume 7–9% average annual return).
3. 3–4 specific changes (cut expenses, increase savings, side income, etc.) that would shorten the timeline the most.`;
    const response = await invokeAI({ model: FAST_MODEL, contents: prompt, config: { systemInstruction: SALARY_EXPERT_SYSTEM } });
    return response?.text ?? '';
}

export async function getLifestyleUpgradeExpert(params: LifestyleUpgradeExpertParams): Promise<string> {
    const prompt = `My current monthly take-home salary is ${params.salary} SAR.
My current monthly expenses are roughly ${params.currentExpenses} SAR.
I want to noticeably improve my daily quality of life (better food, travel, hobbies, home, health, time freedom, etc.) but I refuse to slow down my wealth building speed.

Propose specific upgrades and changes that:
- Feel significantly better day-to-day
- Keep my savings & investment rate the same or higher
- Come mostly from cutting low-value spending and replacing it with high-value spending
Give exact example swaps and new monthly budget if possible. Swap low-joy spending for high-joy; small cost increase, big happiness gain; wealth velocity stays high.`;
    const response = await invokeAI({ model: FAST_MODEL, contents: prompt, config: { systemInstruction: SALARY_EXPERT_SYSTEM } });
    return response?.text ?? '';
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
    const cacheKey = `getAIFeedInsights:${(data?.transactions ?? []).length}:${(data?.goals ?? []).length}:${(data?.budgets ?? []).length}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
        const personalTx = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        const personalInv = (data as any)?.personalInvestments ?? data?.investments ?? [];
        const prompt = `You are Finova AI, expert financial advisor. Return 4-5 feed items as JSON. Brief: each title = one punchy line; each description = one sentence with a number or action.
Data: Recent tx: ${personalTx.slice(0, 5).map((t: { description?: string; amount?: number }) => `${t.description ?? ''} ${t.amount ?? 0}`).join('; ')}. Budgets: ${(data?.budgets ?? []).map(b => `${b.category ?? ''} ${b.limit ?? 0}`).join('; ')}. Goals: ${(data?.goals ?? []).map(g => `${g.name ?? ''} ${((g.targetAmount ?? 0) > 0 ? (((g.currentAmount ?? 0) / (g.targetAmount ?? 1)) * 100).toFixed(0) : '0')}%`).join('; ')}. Top holding: ${getTopHoldingSymbol(personalInv)}.
Each item: type (BUDGET|GOAL|INVESTMENT|SAVINGS), title (short), description (one sentence, specific), emoji (single). Prioritize what matters most.`;

        const response = await invokeAI({
            model: FAST_MODEL,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: SchemaType.ARRAY,
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            type: { type: SchemaType.STRING, description: "Type of insight (BUDGET, GOAL, INVESTMENT, SAVINGS)" },
                            title: { type: SchemaType.STRING },
                            description: { type: SchemaType.STRING },
                            emoji: { type: SchemaType.STRING }
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
    const prompt = `You are Finova AI, expert advisor. Summary (SAR): Net worth ${summary.netWorth.toLocaleString()}; income ${summary.monthlyIncome.toLocaleString()}; expenses ${summary.monthlyExpenses.toLocaleString()}; ROI ${(summary.roi * 100).toFixed(1)}%. Brief Markdown analysis. Direct. Numbers. No filler.

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

export type LogicEnginesAiContext = {
  netWorthSar: number;
  monthlyIncomeSar: number;
  monthlyExpensesSar: number;
  monthlyNetSar: number;
  savingsRatePct: number;
  portfolioSnapshotReturnPct: number;
  runwayMonths: number;
  emergencyMonthsCovered: number;
  usdToSarRate: number;
  alertCount: number;
  symbolCount: number;
};

/** Money Tools / “Behind the numbers” — concise insight from live engine snapshot (SAR-normalized). */
export const getAILogicEnginesInsight = async (ctx: LogicEnginesAiContext): Promise<string> => {
  const cacheKey = `getAILogicEnginesInsight:${JSON.stringify(ctx)}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const prompt = `You are Finova AI advisor. Money Tools snapshot (amounts in SAR).
Net worth: ~${Math.round(ctx.netWorthSar).toLocaleString()} SAR
This month — income ~${Math.round(ctx.monthlyIncomeSar).toLocaleString()}, expenses ~${Math.round(ctx.monthlyExpensesSar).toLocaleString()}, net ~${Math.round(ctx.monthlyNetSar).toLocaleString()}
Savings rate (month): ${ctx.savingsRatePct.toFixed(1)}%
Net worth snapshot simple return (last two device snapshots): ${ctx.portfolioSnapshotReturnPct.toFixed(2)}%
Liquidity runway: ${ctx.runwayMonths.toFixed(1)} months
Emergency fund (months of core spend covered): ${ctx.emergencyMonthsCovered.toFixed(1)}
App FX rate: 1 USD = ${ctx.usdToSarRate.toFixed(4)} SAR
Cross-engine alerts: ${ctx.alertCount} · Tracked symbols (holdings/watchlist): ${ctx.symbolCount}

Write concise Markdown only:
### Snapshot
One sentence on overall position.

### Verify
Two bullets: what the user should cross-check in Transactions, Accounts, or Settings.

### Next step
One actionable bullet.

End with a single short line: not personalized financial advice.`;

    const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
    const result = response.text || 'Could not retrieve insight.';
    setToCache(cacheKey, result);
    return result;
  } catch (error) {
    return formatAiError(error);
  }
};

export type NotificationDigestItem = {
  category: string;
  severity?: string;
  message: string;
  actionHint?: string;
};

/** Prioritize and explain the current in-app notification feed (English; use translateFinancialInsightToArabic in UI). */
export const getAINotificationsDigest = async (
  items: NotificationDigestItem[],
  meta: { unreadCount: number; sarPerUsd: number }
): Promise<string> => {
  const slice = items.slice(0, 18);
  const cacheKey = `getAINotificationsDigest:${meta.unreadCount}:${slice.map((i) => i.message).join('|').slice(0, 400)}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  if (slice.length === 0) {
    const empty =
      '### Summary\n- No items in your notification feed right now.\n\n### Verify\n- Import recent transactions if you expect alerts.\n- Refresh live prices if you hold market symbols.\n\n### Next step\n- Revisit after your next statement upload or budget change.\n\n_Not personalized financial advice._';
    setToCache(cacheKey, empty);
    return empty;
  }

  try {
    const lines = slice.map(
      (i, idx) =>
        `${idx + 1}. [${i.category}] (${i.severity || 'info'}) ${i.message}${i.actionHint ? ` — Suggested: ${i.actionHint}` : ''}`,
    );
    const prompt = `${DEFAULT_SYSTEM_INSTRUCTION}

Notifications digest. Personal Finova user. Amounts and runway logic use **SAR**; FX assumption **1 USD = ${meta.sarPerUsd.toFixed(4)} SAR**.
Unread count in feed: ${meta.unreadCount}.

Alerts:
${lines.join('\n')}

Output Markdown only:
### Top priorities
- 2–3 bullets: what to handle first and why (reference exact alert text).

### Cross-checks
- Two bullets: which screens to open (Accounts, Budgets, Investments, Plan) and what to validate.

### If everything is noise
- One line on when to dismiss vs. when to act.

Last line exactly: Not personalized financial advice.`;

    const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
    const result = response.text?.trim() || 'Could not summarize notifications.';
    setToCache(cacheKey, result);
    return result;
  } catch (error) {
    return formatAiError(error);
  }
};

export type SettingsGuidanceContext = {
  sarPerUsd: number;
  displayCurrency: 'SAR' | 'USD';
  riskProfile: string;
  budgetThresholdPct: number;
  driftThresholdPct: number;
  profileSetupPct: number;
  accountsSetupPct: number;
  personalAccountCount: number;
  preferencesDone: number;
  preferencesTotal: number;
  activePriceAlerts: number;
  portfolioDriftFlag: number;
  sleeveDriftPct: number | null;
  trackedSymbols: number;
  inAppFeedCount: number;
  unreadNotifications: number;
  enableWeeklyEmail: boolean;
  inAppSoundEnabled: boolean;
  liquidCashSarApprox: number;
};

/** Settings page coaching from live metrics (English in model; UI can translate to Arabic). */
export const getAISettingsGuidance = async (ctx: SettingsGuidanceContext): Promise<string> => {
  const cacheKey = `getAISettingsGuidance:${ctx.displayCurrency}:${ctx.riskProfile}:${ctx.inAppFeedCount}:${ctx.unreadNotifications}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const driftLine =
    ctx.sleeveDriftPct == null ? 'Sleeve drift: not computed (add holdings / Wealth Ultra targets).' : `Sleeve drift (max abs): ~${ctx.sleeveDriftPct}%. Threshold: ${ctx.driftThresholdPct}%.`;

  try {
    const prompt = `${DEFAULT_SYSTEM_INSTRUCTION}

Finova **Settings** coaching. Data is live snapshot for this user.
Display currency: **${ctx.displayCurrency}**. FX: **1 USD = ${ctx.sarPerUsd.toFixed(4)} SAR**.

- Risk: ${ctx.riskProfile}; budget alert at ${ctx.budgetThresholdPct}%; drift alert at ${ctx.driftThresholdPct}%.
- Profile readiness: ${ctx.profileSetupPct}%; accounts readiness: ${ctx.accountsSetupPct}% (${ctx.personalAccountCount} personal accounts).
- Preferences checklist: ${ctx.preferencesDone}/${ctx.preferencesTotal}.
- ${driftLine}
- Active **price alerts**: ${ctx.activePriceAlerts}; portfolio drift **attention flag**: ${ctx.portfolioDriftFlag}.
- Tracked symbols (holdings + watchlist): ${ctx.trackedSymbols}.
- In-app notification **feed** size: ${ctx.inAppFeedCount}; **unread**: ${ctx.unreadNotifications}.
- Weekly email summaries: ${ctx.enableWeeklyEmail ? 'on' : 'off'}; in-app sound: ${ctx.inAppSoundEnabled ? 'on' : 'off'}.
- Liquid cash (checking/savings, SAR-normalized): ~${Math.round(ctx.liquidCashSarApprox).toLocaleString()} SAR.

Markdown only:
### What looks healthy
- 1–2 bullets with numbers.

### Tune next
- 2 bullets: settings or data to adjust (risk, drift, gold/Zakat, alerts).

### Where to tap
- One line each: Accounts, Investments, Notifications pages if relevant.

Last line exactly: Not personalized financial advice.`;

    const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
    const result = response.text?.trim() || 'Could not generate settings guidance.';
    setToCache(cacheKey, result);
    return result;
  } catch (error) {
    return formatAiError(error);
  }
};

export type SystemHealthAiContext = {
  overallStatus: string;
  healthScore: number;
  degradedCount: number;
  outageCount: number;
  avgLatencyMs: number;
  serviceLines: string;
  integritySummaryLine: string;
  sarPerUsd: number;
  lastCheckedLabel?: string;
};

export const getAISystemHealthDigest = async (ctx: SystemHealthAiContext): Promise<string> => {
  const cacheKey = `getAISystemHealthDigest:${ctx.overallStatus}:${ctx.healthScore}:${ctx.outageCount}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const prompt = `${DEFAULT_SYSTEM_INSTRUCTION}

System & APIs Health digest for Finova operator. FX reference: **1 USD = ${ctx.sarPerUsd.toFixed(4)} SAR** (for data-drift context only).

Overall: **${ctx.overallStatus}** · Health score **${ctx.healthScore}/100** · Degraded: ${ctx.degradedCount} · Outages: ${ctx.outageCount} · Avg probe latency: ${ctx.avgLatencyMs} ms
${ctx.lastCheckedLabel ? `Last check: ${ctx.lastCheckedLabel}` : ''}

Services:
${ctx.serviceLines}

Data / reconciliation: ${ctx.integritySummaryLine}

Markdown only:
### What this page means
- 2 bullets: probes vs. your ledger data.

### Fix first
- 2 bullets ordered by severity.

### Noise vs. real issues
- 1 bullet (e.g. single-user deployments).

Last line exactly: Not personalized financial advice.`;

    const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
    const result = response.text?.trim() || 'Could not generate system health digest.';
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
        transactions.filter(t => countsAsExpenseForCashflowKpi(t) && t.budgetCategory).forEach(t => {
            const currentSpend = spending.get(t.budgetCategory!) || 0;
            spending.set(t.budgetCategory!, currentSpend + Math.abs(t.amount));
        });

        const budgetPerformance = budgets.map(b => {
            const spent = spending.get(b.category) || 0;
            const percentage = b.limit > 0 ? (spent / b.limit) * 100 : 0;
            return `- **${b.category}**: Spent ${spent.toLocaleString()} of ${b.limit.toLocaleString()} SAR (${percentage.toFixed(0)}% used)`;
        }).join('\n');

        const prompt = `You are Finova AI, expert advisor. Monthly spending:
${budgetPerformance}
Brief Markdown. One sentence or 2 bullets per section. Numbers. No filler.

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
                    type: SchemaType.OBJECT,
                    properties: {
                        persona: { type: SchemaType.OBJECT, properties: { title: { type: SchemaType.STRING }, description: { type: SchemaType.STRING } } },
                        reportCard: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { metric: { type: SchemaType.STRING }, value: { type: SchemaType.STRING }, rating: { type: SchemaType.STRING }, analysis: { type: SchemaType.STRING }, suggestion: { type: SchemaType.STRING } } } }
                    }
                }
            }
        });
        const result = robustJsonParse(response.text);
        if (result && result.persona && Array.isArray(result.reportCard)) {
            setToCache(cacheKey, result);
            return result;
        }
        const fallback = buildDefaultPersonaFallback(savingsRate, debtToAssetRatio, emergencyFundMonths, investmentStyle);
        setToCache(cacheKey, fallback);
        return fallback;

    } catch (error) {
        console.warn("[getAIFinancialPersona] AI unavailable, using deterministic fallback.", error);
        return buildDefaultPersonaFallback(savingsRate, debtToAssetRatio, emergencyFundMonths, investmentStyle);
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
        return buildDirectPlanFallback(totals, scenarios);
    }
}

export const getAIHouseholdEngineAnalysis = async (householdEngine: any, scenarios: any): Promise<string> => {
    const months = Array.isArray(householdEngine?.months) ? householdEngine.months : [];
    const pressureMonths = months.filter((m: any) => (m.warnings || []).length > 0).length;
    const criticalMonths = months.filter((m: any) => (m.validationErrors || []).length > 0).length;
    const avgGoal = months.length > 0 ? months.reduce((s: number, m: any) => s + Number(m.routedGoalAmount || 0), 0) / months.length : 0;
    const projected = Number(householdEngine?.plannedVsActual?.plannedNet || 0);
    const mode = String(householdEngine?.config?.operatingMode || 'Balanced');

    const fallback = `### Household Engine Summary
- Mode: **${mode}**; projected annual net: **${fmtSar(projected)}**.
- Pressure months: **${pressureMonths}**; critical months: **${criticalMonths}**.

### Adjustment Order (recommended)
1. Reduce unusual-month extras and Uber/support overrides first.
2. Then reduce flexible operations/personal support.
3. Keep reserve/emergency minimums protected unless critical pressure persists.

### Goal & Long-Term Outlook
- Average monthly goal push: **${fmtSar(avgGoal)}**.
- If pressure rises, switch to Protection First temporarily, then restore goal acceleration when stable.`;

    try {
        const prompt = `You are Finova AI, a very clever expert financial and investment advisor. Analyze this household budget engine snapshot and provide direct decision support in Markdown only (no HTML), with concise bullets.

Data:
- Mode: ${mode}
- Projected annual net: ${projected}
- Pressure months: ${pressureMonths}
- Critical months: ${criticalMonths}
- Average monthly goal routing amount: ${avgGoal}
- Scenarios: ${JSON.stringify(scenarios || {})}

Required sections:
### Why pressure happens
### Best adjustment order
### Normal vs heavy-month impact
### House-goal completion outlook
### Next-best actions

Rules:
- Recommend reducing flexible items/Uber/investing only in a practical order.
- Mention temporary mode switching when appropriate.
- Keep strategic minimums protected unless critical pressure.
- Keep response short and operational.`;

        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || fallback;
    } catch {
        return fallback;
    }
};

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
        return buildDirectAnalysisFallback(spendingData, trendData, compositionData);
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
    const transactions = (data as any)?.personalTransactions ?? data?.transactions ?? [];
    const cacheKey = `getAIExecutiveSummary:${transactions.length}:${((data as any)?.personalInvestments ?? data?.investments ?? []).length}`;
    const cached = getFromCache(cacheKey);
    if(cached) return cached;

    // Calculate some metrics for the prompt (personal wealth only)
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyTransactions = transactions.filter((t: { date: string }) => new Date(t.date) >= firstDayOfMonth);
    const monthlyIncome = monthlyTransactions.filter((t: { type?: string; category?: string }) => countsAsIncomeForCashflowKpi(t)).reduce((sum: number, t: { amount?: number }) => sum + (t.amount ?? 0), 0);
    const monthlyExpenses = monthlyTransactions.filter((t: { type?: string; category?: string }) => countsAsExpenseForCashflowKpi(t)).reduce((sum: number, t: { amount?: number }) => sum + Math.abs(t.amount ?? 0), 0);
    const monthlyPnL = monthlyIncome - monthlyExpenses;

    const budgetMonthlyLimit = (b: { limit: number; period?: string }) => b.period === 'yearly' ? b.limit / 12 : b.period === 'weekly' ? b.limit * (52 / 12) : b.period === 'daily' ? b.limit * (365 / 12) : b.limit;
    const overspentBudgets = (data?.budgets ?? [])
        .map(budget => {
            const spent = monthlyTransactions
                .filter((t: { type?: string; budgetCategory?: string; category?: string }) => countsAsExpenseForCashflowKpi(t) && t.budgetCategory === budget.category)
                .reduce((sum: number, t: { amount?: number }) => sum + Math.abs(t.amount ?? 0), 0);
            const limit = budgetMonthlyLimit(budget);
            const percentage = limit > 0 ? (spent / limit) * 100 : 0;
            return { ...budget, spent, percentage };
        })
        .filter(b => b.percentage > 90)
        .map(b => `${b.category} (${b.percentage.toFixed(0)}% used)`)
        .join(', ');
    
    const goalProgress = (data?.goals ?? []).map((g: { name?: string; currentAmount?: number; targetAmount?: number }) => {
        const currentAmount = g.currentAmount ?? 0;
        const targetAmount = g.targetAmount ?? 0;
        const progress = targetAmount > 0 ? (currentAmount / targetAmount) * 100 : 0;
        return `${g.name ?? ''} (${progress.toFixed(0)}%)`;
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
        return buildDirectExecutiveFallback(monthlyPnL, overspentBudgets, goalProgress);
    }
}


export interface InvestmentHubAiMeta {
  activeTab?: string;
  portfolioCount?: number;
  holdingCount?: number;
  watchlistCount?: number;
  totalValueSAR?: number;
  /** Paper P/L in SAR (from app engine — do not invent). */
  unrealizedGainLossSAR?: number;
  /** Simple ROI % on net capital. */
  roiPct?: number;
  /** Estimated one-day change SAR. */
  dailyPnLSAR?: number;
  commoditiesValueSAR?: number;
  appDisplayCurrency?: string;
  executionLogCount?: number;
}

export const getInvestmentAIAnalysis = async (holdings: Holding[], meta?: InvestmentHubAiMeta): Promise<string> => {
  const symKey = holdings.map((h) => (h.symbol ?? '') + h.quantity).join(',');
  const metaKey = meta
    ? `${meta.activeTab ?? ''}|${meta.portfolioCount ?? ''}|${meta.holdingCount ?? ''}|${meta.watchlistCount ?? ''}|${meta.totalValueSAR ?? ''}|${meta.unrealizedGainLossSAR ?? ''}|${meta.roiPct ?? ''}|${meta.dailyPnLSAR ?? ''}|${meta.commoditiesValueSAR ?? ''}|${meta.executionLogCount ?? ''}`
    : '';
  const cacheKey = `getInvestmentAIAnalysis:${symKey}:${metaKey}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const facts: string[] = [];
    if (meta) {
      facts.push(`Tab: ${meta.activeTab ?? 'Investments'}.`);
      facts.push(`Portfolios (personal): ${meta.portfolioCount ?? 'n/a'}; holdings listed: ${meta.holdingCount ?? 'n/a'}; watchlist symbols: ${meta.watchlistCount ?? 'n/a'}.`);
      if (typeof meta.totalValueSAR === 'number') facts.push(`Total portfolio value (SAR, app-calculated): ${meta.totalValueSAR.toFixed(0)}.`);
      if (typeof meta.unrealizedGainLossSAR === 'number') facts.push(`Unrealized P/L (SAR): ${meta.unrealizedGainLossSAR.toFixed(0)}.`);
      if (typeof meta.roiPct === 'number' && Number.isFinite(meta.roiPct)) facts.push(`Portfolio ROI (%): ${meta.roiPct.toFixed(2)}.`);
      if (typeof meta.dailyPnLSAR === 'number') facts.push(`Estimated daily P/L (SAR): ${meta.dailyPnLSAR.toFixed(0)}.`);
      if (typeof meta.commoditiesValueSAR === 'number') facts.push(`Commodities value (SAR): ${meta.commoditiesValueSAR.toFixed(0)}.`);
      facts.push(`App display currency label: ${meta.appDisplayCurrency ?? 'SAR'}.`);
      if (typeof meta.executionLogCount === 'number') facts.push(`Stored plan execution log rows: ${meta.executionLogCount}.`);
    }
    const factsBlock = facts.length ? `FACTS (use only these numbers; if something is missing say "not shown in app" — do not invent prices, balances, or returns):\n${facts.join(' ')}\n` : '';
    const symbolsList = holdings.map((h) => h.symbol ?? '').filter(Boolean).join(', ') || '(none)';
    const prompt = `You are Finova AI. Write for someone who is NOT a finance professional: short sentences, plain words, no jargon without a one-line explanation.

${factsBlock}
Holdings symbols (from the user's data only): ${symbolsList}

Return GitHub-flavored Markdown with exactly these ### sections in order:
### Portfolio snapshot
Reference only the FACTS numbers above for totals and P/L. One short paragraph.

### Diversification
What the mix of symbols suggests (no invented percentages per symbol).

### Concentration risk
If few symbols or one sector could dominate — stay general unless FACTS imply it.

### How to use this workspace
One paragraph: how the Investments tabs (Overview, Plan, etc.) help them stay organized.

Rules: No buy/sell recommendations. No HTML. No tables. Use **bold** sparingly for key terms.`;
    const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
    const result = response.text || 'Could not retrieve analysis.';
    setToCache(cacheKey, result);
    return result;
  } catch (error) {
    return formatAiError(error);
  }
};

export interface CommoditiesAiContextItem {
  name: string;
  quantity: number;
  unit: string;
  zakahClass?: string;
  currentValue?: number;
  unrealizedGain?: number;
  owner?: string | null;
}

export interface CommoditiesAiContext {
  items: CommoditiesAiContextItem[];
  totalValueSar: number;
  sarPerUsd: number;
  holdingCount: number;
}

/** Context for Wealth Ultra plain-language digest (engine uses USD for portfolio math; plan budget may be SAR). */
export interface WealthUltraAiContext {
  totalPortfolioValueUsd: number;
  deployableCashUsd: number;
  totalPlannedBuyCostUsd: number;
  monthlyDeployUsd: number;
  monthlyBudgetTotal: number;
  monthlyBudgetCurrency: string;
  sarPerUsd: number;
  portfolioHealthLabel: string;
  portfolioHealthScore: number;
  alertCount: number;
  buyOrderCount: number;
  positionCount: number;
  investmentPortfolioCount: number;
  universeTickerCount: number;
  cashPlannerStatus: string;
}

export const getAIWealthUltraInsight = async (ctx: WealthUltraAiContext): Promise<string> => {
  const sig = [
    ctx.totalPortfolioValueUsd,
    ctx.deployableCashUsd,
    ctx.monthlyBudgetTotal,
    ctx.portfolioHealthScore,
    ctx.alertCount,
    ctx.buyOrderCount,
  ].join(':');
  const cacheKey = `getAIWealthUltraInsight:${sig}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const budgetLine =
      ctx.monthlyBudgetTotal > 0
        ? `Combined monthly investment plan budget (from your plan): ${ctx.monthlyBudgetTotal.toFixed(2)} ${ctx.monthlyBudgetCurrency}.`
        : 'No positive monthly investment plan budget is set across portfolios — deployment targets use engine defaults until you set budgets in Investments.';
    const prompt = `You are Finova AI. Write for someone who is NOT a finance professional.

Facts (do not invent numbers or time windows):
- Wealth Ultra engine values positions and suggested orders in **USD** (US dollars), using prices from holdings and market data.
- Conversion reference: **${ctx.sarPerUsd.toFixed(4)} SAR = 1 USD** (used so SAR and USD labels stay consistent elsewhere in the app).
- Total portfolio value (USD): ${ctx.totalPortfolioValueUsd.toFixed(2)}
- Deployable cash passed into the engine (USD): ${ctx.deployableCashUsd.toFixed(2)}
- Planned buy cost of suggested orders (USD): ${ctx.totalPlannedBuyCostUsd.toFixed(2)}
- Monthly deployment suggestion (USD): ${ctx.monthlyDeployUsd.toFixed(2)}
- ${budgetLine}
- Portfolio health: "${ctx.portfolioHealthLabel}" (score ${ctx.portfolioHealthScore}/100).
- Alerts: ${ctx.alertCount}. Suggested BUY orders: ${ctx.buyOrderCount}. Open positions in engine: ${ctx.positionCount}. Investment portfolios (accounts): ${ctx.investmentPortfolioCount}. Universe tickers: ${ctx.universeTickerCount}.
- Cash plan vs orders: ${ctx.cashPlannerStatus}

Return Markdown with:
### What this screen is doing (plain English)
### What to look at first (based on alerts and cash plan)
### Currency note (USD vs SAR — one short paragraph, no jargon)

No buy/sell recommendations. No "48 hours" or fake deadlines. No HTML.`;
    const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
    const result = response.text || 'Could not retrieve analysis.';
    setToCache(cacheKey, result);
    return result;
  } catch (error) {
    return formatAiError(error);
  }
};

export const getAICommoditiesInsight = async (ctx: CommoditiesAiContext): Promise<string> => {
  const sig = ctx.items
    .map((i) => `${i.name}:${i.quantity}:${i.zakahClass ?? ''}:${Math.round(i.currentValue ?? 0)}`)
    .join('|');
  const cacheKey = `getAICommoditiesInsight:${ctx.holdingCount}:${Math.round(ctx.totalValueSar)}:${ctx.sarPerUsd.toFixed(4)}:${sig.slice(0, 200)}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const rows =
      ctx.items.length === 0
        ? 'No rows yet.'
        : ctx.items
            .map(
              (i) =>
                `${i.name} ${i.quantity} ${i.unit}${i.owner ? ` (owner: ${i.owner})` : ''} · Zakat: ${i.zakahClass ?? 'n/a'} · ~${Math.round(i.currentValue ?? 0)} SAR · unrealized Δ ~${Math.round(i.unrealizedGain ?? 0)} SAR`,
            )
            .join('\n');
    const prompt = `You are Finova AI. The user tracks physical/digital commodities in Finova; values are in SAR and USD spot prices are converted using USD→SAR = ${ctx.sarPerUsd}.\nTotal SAR (personal rows): ${Math.round(ctx.totalValueSar)} across ${ctx.holdingCount} row(s).\nHoldings:\n${rows}\n\nReturn concise Markdown with ### Snapshot, ### Zakat & reporting (educational, not a religious ruling), ### Concentration & volatility (metals vs crypto). No buy/sell instructions. No HTML.`;
    const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
    const result = response.text || 'Could not retrieve analysis.';
    setToCache(cacheKey, result);
    return result;
  } catch (error) {
    return formatAiError(error);
  }
};

export const getPlatformPerformanceAnalysis = async (holdings: (Holding & { gainLoss: number; gainLossPercent: number; })[]): Promise<string> => {
    try {
        const prompt = `You are Finova AI, expert advisor. Unrealized gains/losses for ${holdings.length} assets. Brief Markdown: Key Contributors, Key Detractors, Risk Assessment. Direct. No HTML.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not retrieve analysis.";
    } catch (error) { return formatAiError(error); }
};

export const getAIStrategy = async (holdings: Holding[]): Promise<string> => {
    try {
        const prompt = `You are Finova AI, expert advisor. Holdings: ${holdings.map(h => h.symbol ?? '').join(', ')}. Brief Markdown: Strategy Assessment, Opportunities. Educational. No buy/sell advice. No HTML.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not retrieve strategy.";
    } catch (error) { return formatAiError(error); }
};

export const getAIResearchNews = async (stocks: (Holding | WatchlistItem)[]): Promise<{ content: string, groundingChunks: any[] }> => {
    try {
        const finnhubBrief = await buildFinnhubResearchBrief(stocks.map(s => s.symbol ?? '').filter(Boolean));
        const prompt = `You are Finova AI, a very clever expert investment analyst. For stocks: ${stocks.map(s => s.symbol ?? '').join(', ')}. Use Google Search and the Finnhub digest below. Return a concise Markdown summary (no HTML). Use ### for each symbol and one short section ### Calendar Watch for major macro events. Be direct; one paragraph or 2-3 bullets per symbol.\n\n${finnhubBrief ? `Reference:\n${finnhubBrief}` : ''}`;
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
        const fallbackBrief = await buildFinnhubResearchBrief(stocks.map(s => s.symbol ?? '').filter(Boolean));
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
    /** Plan / execution currencies for grounding. */
    planBudgetCurrency?: string;
    planExecutionCurrency?: string;
    /** User risk profile label from Settings. */
    riskProfile?: string;
    /** One-line summary e.g. "8 buys, 2 sells over 90d". */
    tradeActivitySummary?: string;
    /** ISO date for "as of" grounding. */
    asOfDate?: string;
    /** Oldest / newest trade date in the analyzed batch (ISO YYYY-MM-DD). */
    txDateOldest?: string;
    txDateNewest?: string;
    /** Human note e.g. "Last 20 trades by date (preferring last 90 days)." */
    tradeSelectionNote?: string;
}

export const getAITradeAnalysis = async (
    transactions: InvestmentTransaction[],
    context?: TradeAnalysisContext
): Promise<string> => {
    const ensureStructuredMarkdown = (raw: string, sections: string[]): string => {
        const text = String(raw || '').trim();
        if (!text) return '### Summary\nNo analysis generated.\n\n### Arabic Summary (ملخص عربي)\n- تعذر إنشاء الرد حالياً.';
        const hasAnyHeading = /(^|\n)###\s+/m.test(text);
        let out = hasAnyHeading ? text : `### Summary\n${text}`;
        for (const section of sections) {
            const re = new RegExp(`(^|\\n)###\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|\\s)`, 'm');
            if (!re.test(out)) out += `\n\n### ${section}\n- Not available in this response.`;
        }
        if (!/(^|\n)###\s+Arabic Summary\s*\(ملخص عربي\)/m.test(out)) {
            out += '\n\n### Arabic Summary (ملخص عربي)\n- تعذر إنشاء الملخص العربي في هذه المحاولة. يرجى إعادة التوليد.';
        }
        return out;
    };
    const MS_90D = 90 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const sorted = [...(transactions ?? [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const within90 = sorted.filter((t) => now - new Date(t.date).getTime() <= MS_90D);
    const picked = (within90.length > 0 ? within90 : sorted).slice(0, 20);
    const dates = picked.map((t) => new Date(t.date)).filter((d) => !isNaN(d.getTime()));
    const minD = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
    const maxD = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
    const iso = (d: Date | null) => (d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : undefined);

    const txList = picked
        .map(
            (t) =>
                `${t.type} ${t.symbol} qty=${t.quantity} @ ${t.price} total=${t.total} ${t.currency ?? ''} acct=${t.accountId?.slice(0, 8) ?? '—'}… on ${t.date}`,
        )
        .join('\n');
    const mergedContext: TradeAnalysisContext = {
        ...context,
        txDateOldest: context?.txDateOldest ?? iso(minD),
        txDateNewest: context?.txDateNewest ?? iso(maxD),
        tradeSelectionNote:
            context?.tradeSelectionNote ??
            (picked.length
                ? `Analyzing ${picked.length} trade row(s), preferring the last 90 days when available. Oldest trade date in this batch: ${iso(minD) ?? 'n/a'}; newest: ${iso(maxD) ?? 'n/a'}.`
                : undefined),
    };

    const contextBlock = mergedContext
        ? `
Current context (use to tailor feedback; educational only):
${mergedContext.asOfDate ? `Report run date: ${mergedContext.asOfDate}` : ''}
${mergedContext.txDateOldest || mergedContext.txDateNewest ? `Trade dates in this batch: ${mergedContext.txDateOldest ?? '?'} → ${mergedContext.txDateNewest ?? '?'}` : ''}
${mergedContext.tradeSelectionNote ? `Selection: ${mergedContext.tradeSelectionNote}` : ''}
${mergedContext.riskProfile ? `User risk profile (from settings): ${mergedContext.riskProfile}` : ''}
${mergedContext.holdingsSummary ? `Holdings (values aggregated in SAR for comparison): ${mergedContext.holdingsSummary}` : ''}
${mergedContext.watchlistSymbols?.length ? `Watchlist symbols: ${mergedContext.watchlistSymbols.join(', ')}` : ''}
${mergedContext.planBudget != null && mergedContext.planBudget > 0 ? `Monthly plan budget: ${mergedContext.planBudget} ${mergedContext.planBudgetCurrency ?? ''}`.trim() : 'Monthly plan budget: not set or zero in app — do not assume a monthly cap.'}
${mergedContext.planExecutionCurrency ? `Plan execution currency: ${mergedContext.planExecutionCurrency}` : ''}
${mergedContext.corePct != null ? `Core/Upside sleeve split: ${(mergedContext.corePct * 100).toFixed(0)}% / ${((mergedContext.upsidePct ?? 0) * 100).toFixed(0)}%` : ''}
${mergedContext.tradeActivitySummary ? `Activity summary: ${mergedContext.tradeActivitySummary}` : ''}
`.trim()
        : '';

    const prompt = `You are Finova AI, an expert investment and trading advisor. Analyze these transactions and return direct, educational feedback in Markdown only (no HTML). Use ### for each section. Be specific and actionable; reference symbols and amounts where relevant.

CRITICAL:
- Use only the trade rows and dates below.
- If dates span weeks, months, or years, say that clearly.
- Do **not** claim trades happened in "the last 48 hours" unless every listed trade date is in that window.
- Mixed USD/SAR amounts appear on rows—describe them exactly as recorded.
- Do not invent FX conversions. Keep currency labels accurate.

${contextBlock ? '\n' + contextBlock + '\n' : ''}

Transactions (most recent first; amounts as stored per row):
${txList || 'None.'}

Respond with exactly these ### sections in order (one short paragraph or 2-3 bullets each; be specific):
### Summary
What the user did in one sentence (buys/sells, main symbols, size). Use numbers.

### Patterns
- 1-2 bullets on concentration, timing, lot size, or alignment with a plan. Be direct.

### Portfolio Impact
- 1-2 bullets on what this implies for the portfolio (diversification, cost basis, risk). Plain language.

### Do’s (habits)
- 1-2 bullets: good practices you see or could reinforce (e.g. journaling, sizing, plan alignment).

### Don’ts (pitfalls)
- 1-2 bullets: common mistakes to avoid in general terms (no shaming; no buy/sell commands).

### Suggestions
- One or two concrete, educational trading suggestions (entry planning, sizing discipline, risk controls). Keep them scenario-based, never guaranteed.

### Concept to Research
- One concept to look up (e.g. dollar-cost averaging, rebalancing, diversification). One sentence.

### Technical Framework Matrix
- Dow Theory: regime (uptrend/downtrend/range) and why.
- Elliott Wave: likely wave context (impulse/corrective) and what would invalidate it.
- Fibonacci: key retracement/extension zone(s) to monitor.
- Chart Patterns: active pattern hypothesis and trigger level.
- Candlestick Patterns: strongest recent candle signal and interpretation.
- Combined Method (confluence): where 2+ frameworks align and where they conflict.

### Trade Plan (Educational)
- Entry zone(s), invalidation level, and two target scenarios.
- Position sizing and risk notes using the row currencies as recorded (USD/SAR labels must remain exact).

### Confidence Score
- Provide a score from 0-100 and one sentence explaining uncertainty drivers (data limits, mixed signals, timeframe mismatch).

### Arabic Summary (ملخص عربي)
- Provide a concise Arabic translation of Summary + Suggestions + Risk framing in 3-5 bullets.
- Keep all numbers and currency labels consistent with the English sections.

Rules:
- English sections first, then Arabic summary section.
- Educational only, not financial advice.
- Markdown only.`;

    const execute = async () => {
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return ensureStructuredMarkdown(response.text || 'Could not retrieve analysis.', [
            'Summary',
            'Patterns',
            'Portfolio Impact',
            'Do’s (habits)',
            'Don’ts (pitfalls)',
            'Suggestions',
            'Concept to Research',
            'Technical Framework Matrix',
            'Trade Plan (Educational)',
            'Confidence Score',
        ]);
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
- AI suggestions are educational only (not financial advice).

### General tips
- Review sector and region concentration; consider diversifying if heavily concentrated.
- Revisit themes (e.g. dividend vs growth) and position sizing.
- Try again later for AI-generated tips when the service is available.`;
}

/** AI suggestions for watchlist symbols: diversification, themes, concepts to research. Educational only. Returns fallback text when AI is unavailable. */
export const getAIWatchlistAdvice = async (symbols: string[]): Promise<string> => {
    if (!symbols?.length) return 'Add symbols to your watchlist to get AI tips.';
    const list = symbols.slice(0, 25).join(', ');
    const ensureWatchlistMarkdown = (raw: string): string => {
        const text = String(raw || '').trim();
        if (!text) return '### Diversification\n- No suggestions generated.\n\n### Arabic Summary (ملخص عربي)\n- تعذر إنشاء الرد حالياً.';
        const hasAnyHeading = /(^|\n)###\s+/m.test(text);
        let out = hasAnyHeading ? text : `### Diversification\n- ${text}`;
        for (const section of ['Diversification', 'Themes to Consider', 'Concepts to Research']) {
            const re = new RegExp(`(^|\\n)###\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|\\s)`, 'm');
            if (!re.test(out)) out += `\n\n### ${section}\n- Not available in this response.`;
        }
        if (!/(^|\n)###\s+Arabic Summary\s*\(ملخص عربي\)/m.test(out)) {
            out += '\n\n### Arabic Summary (ملخص عربي)\n- تعذر إنشاء الملخص العربي في هذه المحاولة. يرجى إعادة التوليد.';
        }
        return out;
    };
    const prompt = `You are Finova AI, an expert investment advisor. The user's watchlist contains these symbols: ${list}.

Return short, educational suggestions in Markdown only (no HTML). Use ### for section headers. Be concise (2–4 short bullets per section).

Sections:
### Diversification
- One or two bullets on sector/region concentration if obvious from symbols; otherwise a general tip.

### Themes to Consider
- 1–2 themes or concepts that might apply (e.g. dividend focus, growth vs value, region mix).

### Concepts to Research
- One or two concepts the user could look up (e.g. position sizing, rebalancing, dollar-cost averaging).

### Arabic Summary (ملخص عربي)
- 3–5 Arabic bullets that summarize Diversification + Themes + Concepts to research.
- Keep numbers/tickers consistent with the English sections.

Rules:
- English sections first, then Arabic summary.
- Educational only, not financial advice.
- Markdown only.`;

    try {
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return ensureWatchlistMarkdown(response.text || 'No suggestions generated.');
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
        const projectedMonthlyContribution = computeGoalMonthlyAllocation(monthlySavings, goal.savingsAllocationPercent);

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
        const assets = (allData as any)?.personalAssets ?? allData.assets ?? [];
        const investments = (allData as any)?.personalInvestments ?? allData.investments ?? [];
         const goalDataWithProgress = goals.map(goal => {
            const linkedItemsValue = assets.filter((a: { goalId?: string; value?: number }) => a.goalId === goal.id).reduce((sum: number, a: { value?: number }) => sum + (a.value ?? 0), 0) +
                                  investments.flatMap((p: { holdings?: { goalId?: string; currentValue?: number }[] }) => p.holdings ?? []).filter((h: { goalId?: string }) => h.goalId === goal.id).reduce((sum: number, h: { currentValue?: number }) => sum + (h.currentValue ?? 0), 0);
            
            const currentAmount = linkedItemsValue;
            const progress = goal.targetAmount > 0 ? (currentAmount / goal.targetAmount) * 100 : 0;
            return `- ${goal.name}: ${progress.toFixed(0)}% complete`;
        }).join('\n');

        const totalAllocatedPercent = goals.reduce((sum, g) => sum + normalizeGoalAllocationPercent(g.savingsAllocationPercent), 0);
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

/** Same shape as MarketDataContext simulated prices — used so AI math matches the Investments UI. */
export type RebalancingSimulatedPrices = Record<string, { price?: number; change?: number } | undefined>;

export interface RebalancingPlanMeta {
    bookCurrency: TradeCurrency;
    sarPerUsd: number;
    portfolioName?: string;
    simulatedPrices: RebalancingSimulatedPrices;
}

function formatBookCurrencyAmount(amount: number, bookCurrency: TradeCurrency): string {
    const code = bookCurrency === 'USD' ? 'USD' : 'SAR';
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(amount);
    } catch {
        return `${amount.toFixed(0)} ${code}`;
    }
}

function normalizeHoldingsForRebalancer(holdings: Holding[], meta: RebalancingPlanMeta) {
    const { bookCurrency, sarPerUsd, simulatedPrices } = meta;
    return holdings
        .map((h) => {
            const value = effectiveHoldingValueInBookCurrency(h, bookCurrency, simulatedPrices, sarPerUsd);
            return {
                ...h,
                value,
                assetClass: (h.assetClass || 'Other') as string,
            };
        })
        .filter((h) => Number.isFinite(h.value) && h.value > 0);
}

const buildRuleBasedRebalancingPlan = (
    holdings: Holding[],
    riskProfile: 'Conservative' | 'Moderate' | 'Aggressive',
    meta: RebalancingPlanMeta,
): string => {
    const targetByRisk: Record<'Conservative' | 'Moderate' | 'Aggressive', { stocks: number; sukuk: number; other: number }> = {
        Conservative: { stocks: 45, sukuk: 45, other: 10 },
        Moderate: { stocks: 60, sukuk: 30, other: 10 },
        Aggressive: { stocks: 75, sukuk: 15, other: 10 },
    };

    const { bookCurrency, sarPerUsd, portfolioName } = meta;
    const curLabel = bookCurrency === 'USD' ? 'USD' : 'SAR';
    const normalized = normalizeHoldingsForRebalancer(holdings, meta);

    const totalValue = normalized.reduce((sum, h) => sum + h.value, 0);
    if (totalValue <= 0) {
        return `### Current Portfolio Analysis\n- We could not detect positive holding values for **${portfolioName || 'this portfolio'}** (add positions or refresh live prices on the **Portfolios** tab).\n- Amounts are meant to be in **${curLabel}** (your portfolio's currency).\n\n### Target Allocation (${riskProfile})\n- Stocks: ${targetByRisk[riskProfile].stocks}%\n- Sukuk/Bonds: ${targetByRisk[riskProfile].sukuk}%\n- Other assets: ${targetByRisk[riskProfile].other}%\n\n### Rebalancing Suggestions\n- Enter quantities and latest prices so market values update.\n- Then run this tool again; use **Investment Plan** for budgeted changes.\n\n_Generated with resilient rule-based logic (AI fallback mode)._`;
    }

    const equityLike = new Set(['Stock', 'ETF', 'Mutual Fund', 'REIT']);
    const bucket = { stocks: 0, sukuk: 0, other: 0 };
    normalized.forEach((h) => {
        const ac = h.assetClass || 'Other';
        if (ac === 'Sukuk') bucket.sukuk += h.value;
        else if (equityLike.has(ac)) bucket.stocks += h.value;
        else bucket.other += h.value;
    });

    const toPct = (v: number) => (v / totalValue) * 100;
    const current = {
        stocks: toPct(bucket.stocks),
        sukuk: toPct(bucket.sukuk),
        other: toPct(bucket.other),
    };

    const byVal = normalized.slice().sort((a, b) => b.value - a.value);
    const topHolding = byVal[0];
    const secondHolding = byVal[1];
    const topPct = topHolding ? toPct(topHolding.value) : 0;
    const topTwoPct = topPct + (secondHolding ? toPct(secondHolding.value) : 0);
    const target = targetByRisk[riskProfile];
    const fivePct = totalValue * 0.05;
    const fmt = (n: number) => formatBookCurrencyAmount(n, bookCurrency);

    return `### Current Portfolio Analysis
- **${portfolioName || 'Portfolio'}** total (holdings only): **${fmt(totalValue)}** — all figures in **${curLabel}** (1 USD = ${sarPerUsd.toFixed(4)} SAR for reference).
- Concentration is ${topPct > 35 ? '**high**' : topPct > 20 ? '**moderate**' : '**controlled**'}; largest line is **${topHolding?.symbol || 'N/A'}** at **${topPct.toFixed(1)}%**; top **two** lines combined **${topTwoPct.toFixed(1)}%**${secondHolding ? ` (${secondHolding.symbol} ${toPct(secondHolding.value).toFixed(1)}%)` : ''}.
- Current mix: **Stocks ${current.stocks.toFixed(1)}% · Sukuk/Bonds ${current.sukuk.toFixed(1)}% · Other ${current.other.toFixed(1)}%**.

### Target Allocation (${riskProfile})
- Stocks: **${target.stocks}%** · Sukuk/Bonds: **${target.sukuk}%** · Other: **${target.other}%** (illustrative split for this risk level).

### Rebalancing Suggestions
- Move toward the target mix in **small steps** (e.g. monthly), focusing on the bucket that is furthest from its target.
- As a rule of thumb, consider keeping any **single stock** below roughly **${fmt(fivePct)}** (~5% of this portfolio) unless you intentionally concentrate.
- Record trades under **Investment Plan** so amounts stay within your budget.

_Generated with resilient rule-based logic (AI fallback mode)._`;
};

export const getAIRebalancingPlan = async (
    holdings: Holding[],
    riskProfile: 'Conservative' | 'Moderate' | 'Aggressive',
    meta: RebalancingPlanMeta,
): Promise<string> => {
    const normalized = normalizeHoldingsForRebalancer(holdings, meta);
    const { bookCurrency, sarPerUsd, portfolioName } = meta;
    const curLabel = bookCurrency === 'USD' ? 'USD' : 'SAR';
    const totalValue = normalized.reduce((s, h) => s + h.value, 0);
    if (normalized.length === 0 || totalValue <= 0) {
        return buildRuleBasedRebalancingPlan(holdings, riskProfile, meta);
    }

    const equityLike = new Set(['Stock', 'ETF', 'Mutual Fund', 'REIT']);
    const bucket = { stocks: 0, sukuk: 0, other: 0 };
    normalized.forEach((h) => {
        const ac = h.assetClass || 'Other';
        if (ac === 'Sukuk') bucket.sukuk += h.value;
        else if (equityLike.has(ac)) bucket.stocks += h.value;
        else bucket.other += h.value;
    });
    const toPct = (v: number) => (totalValue > 0 ? (v / totalValue) * 100 : 0);
    const currentBuckets = {
        stocks: toPct(bucket.stocks),
        sukuk: toPct(bucket.sukuk),
        other: toPct(bucket.other),
    };

    const sorted = normalized.slice().sort((a, b) => b.value - a.value);
    const h1 = sorted[0];
    const h2 = sorted[1];
    const top1Pct = h1 && totalValue > 0 ? (h1.value / totalValue) * 100 : 0;
    const top2Pct = h2 && totalValue > 0 ? (h2.value / totalValue) * 100 : 0;
    const topTwoCombinedPct = top1Pct + (h2 ? top2Pct : 0);
    const fivePctAmount = formatBookCurrencyAmount(totalValue * 0.05, bookCurrency);

    const lines = sorted
        .slice(0, 24)
        .map(
            (h) =>
                `${h.symbol ?? '—'}: ${formatBookCurrencyAmount(h.value, bookCurrency)} (${h.assetClass || 'Other'}, ${totalValue > 0 ? ((h.value / totalValue) * 100).toFixed(1) : '0'}%)`,
        );
    const holdingsSummary = lines.join('; ') || '(no priced positions)';

    try {
        const prompt = `${DEFAULT_SYSTEM_INSTRUCTION}

You must ground every numeric claim in the **Ground truth** block below. If a figure is not listed there, do not invent it. Do not restate a different portfolio total, concentration %, or top-holding weight than given.

**Ground truth (${curLabel} book currency, same as Portfolios / this screen):**
- Portfolio name: **${portfolioName || 'Selected portfolio'}**
- Holdings count (priced lines): **${normalized.length}**
- Total market value (holdings only): **${formatBookCurrencyAmount(totalValue, bookCurrency)}**
- FX reference only: 1 USD = ${sarPerUsd.toFixed(4)} SAR (use **${curLabel}** for all primary amounts)
- Asset-class mix by value: Stocks **${currentBuckets.stocks.toFixed(1)}%** · Sukuk/Bonds **${currentBuckets.sukuk.toFixed(1)}%** · Other **${currentBuckets.other.toFixed(1)}%**
- Largest line: **${h1?.symbol ?? '—'}** = **${top1Pct.toFixed(2)}%** of portfolio
- Second largest: **${h2 ? `${h2.symbol} = ${top2Pct.toFixed(2)}%` : 'N/A (single position)'}**
- Combined weight of top two lines: **${topTwoCombinedPct.toFixed(2)}%**
- Example single-name cap (5% of portfolio, educational): **${fivePctAmount}**

Risk profile selected by user: **${riskProfile}**.

**Line items (symbol: amount, class, weight):** ${holdingsSummary}

Return a short rebalancing analysis in Markdown only (no HTML). Use ### for each section. Be direct.

### Current Portfolio Analysis
- Two bullets: cite **exact** concentration using largest line % and combined top-two % from Ground truth. Mention asset-class mix **exactly** as given.

### Target Allocation (${riskProfile})
- 2–3 bullets: educational ideas for this profile; do not contradict Ground truth totals.

### Rebalancing Suggestions
- 3 bullets: practical, educational steps (no specific buy/sell orders). If you mention a position-size example, use **${fivePctAmount}** (${curLabel}) or refer to it as ~5% of the stated total.

Markdown only.`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || buildRuleBasedRebalancingPlan(holdings, riskProfile, meta);
    } catch (error) {
        console.warn('[getAIRebalancingPlan] AI unavailable, using deterministic fallback.', error);
        return buildRuleBasedRebalancingPlan(holdings, riskProfile, meta);
    }
};

export function buildFallbackAnalystReport(holding: Holding): string {
    const name = holding.name || holding.symbol;
    const qty = holding.quantity ?? 0;
    const cost = (holding.avgCost ?? 0) * qty;
    const value = holding.currentValue ?? 0;
    const gainLoss = value - cost;
    const gainLossPct = cost > 0 ? ((value - cost) / cost) * 100 : 0;
    return `## Position Summary\n\n**${holding.symbol ?? ''}** — ${name}\n\n- **Shares:** ${qty.toLocaleString()}\n- **Cost basis:** ${cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n- **Market value:** ${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n- **Unrealized G/L:** ${gainLoss >= 0 ? '+' : ''}${gainLoss.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${gainLossPct >= 0 ? '+' : ''}${gainLossPct.toFixed(1)}%)\n\n### Coverage status\n- AI analyst engine was unavailable for this request.\n- Showing a resilient fallback summary now.\n- If configured, Finnhub headlines are attached below.`;
}

async function buildFallbackAnalystReportWithFinnhub(holding: Holding): Promise<string> {
    const base = buildFallbackAnalystReport(holding);
    try {
        const headlines = await getFinnhubCompanyNews([holding.symbol ?? '']);
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
    const cacheKey = `getAIStockAnalysis:${holding.symbol ?? ''}:${dayKey}:${positionSnapshotKey}`;
    const cached = getFromCache(cacheKey);
    if (!options?.forceRefresh && cached) return cached;

    const approxPrice = Number(holding.quantity || 0) > 0
        ? Number(holding.currentValue || 0) / Number(holding.quantity || 1)
        : Number(holding.avgCost || 0);
    const primaryPrompt = `You are Finova AI, a very clever expert investment analyst.
Generate a **fresh, current-market** analyst update for ${holding.name} (${holding.symbol ?? ''}) using Google Search.
Treat stale/outdated references as low confidence and prefer latest items.

Portfolio snapshot context (for relevance only):
- Shares: ${Number(holding.quantity || 0).toLocaleString()}
- Avg cost: ${Number(holding.avgCost || 0).toFixed(2)}
- Approx latest price from portfolio: ${Number.isFinite(approxPrice) ? approxPrice.toFixed(2) : 'N/A'}

Return Markdown only (no HTML):

### TL;DR
- One direct sentence with the current thesis in plain language.

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
            const finnhubBrief = await buildFinnhubResearchBrief([holding.symbol ?? '']);
            const fallbackAiPrompt = `You are Finova AI, a very clever expert investment analyst. For ${holding.name} (${holding.symbol ?? ''}), produce a concise Markdown analyst update (no HTML).

Structure:
### TL;DR
- One direct sentence with current thesis.

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
        const raw = response.text?.trim() || "";
        if (!raw) return "";
        const exact = categories.find((c) => c === raw);
        if (exact) return exact;
        const ci = categories.find((c) => c.toLowerCase() === raw.toLowerCase());
        if (ci) return ci;
        return capitalizeCategoryName(raw);
    } catch (error) {
        console.error("Error fetching AI category suggestion:", error);
        throw error;
    }
};

const GRAMS_PER_TROY_OZ = 31.1035;
const BINANCE_BASE = 'https://api.binance.com/api/v3';

/**
 * Finnhub free plans often return 403 for OANDA forex/metal symbols (XAU/XAG).
 * PAX Gold (~1 troy oz per token) is a practical public spot proxy in USD/oz for the same math as OANDA:XAU_USD.
 */
async function getGoldSpotUsdPerTroyOzCoinGecko(): Promise<number | null> {
    try {
        const res = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd',
            { headers: { Accept: 'application/json' } },
        );
        if (!res.ok) return null;
        const j = (await res.json()) as { 'pax-gold'?: { usd?: number } };
        const v = j?.['pax-gold']?.usd;
        return Number.isFinite(v) && v! > 0 ? v! : null;
    } catch {
        return null;
    }
}

/** ~1 troy oz silver proxy when OANDA:XAG_USD is 403 (same free-tier limitation as gold). */
async function getSilverSpotUsdPerTroyOzCoinGecko(): Promise<number | null> {
    try {
        const res = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=kinesis-silver&vs_currencies=usd',
            { headers: { Accept: 'application/json' } },
        );
        if (!res.ok) return null;
        const j = (await res.json()) as { 'kinesis-silver'?: { usd?: number } };
        const v = j?.['kinesis-silver']?.usd;
        return Number.isFinite(v) && v! > 0 ? v! : null;
    } catch {
        return null;
    }
}

/** Fetch BTC/ETH prices from Binance (no API key). Returns SAR. Used when Finnhub fails or is unavailable. */
async function getBinanceCryptoPrices(symbols: string[], sarPerUsd: number = DEFAULT_SAR_PER_USD): Promise<{ symbol: string; price: number }[]> {
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
            out.push({ symbol: normalized, price: priceUsd * sarPerUsd });
        } catch {
            // skip
        }
    }
    return out;
}

/** Fetch commodity prices from Finnhub (crypto + metals). Returns unit prices in SAR. `sarPerUsd` should match app FX (e.g. from `resolveSarPerUsd`). */
export async function getFinnhubCommodityPrices(
    commodities: Pick<CommodityHolding, 'symbol' | 'name' | 'goldKarat'>[],
    sarPerUsd: number = DEFAULT_SAR_PER_USD,
): Promise<{ symbol: string; price: number }[]> {
    const token = import.meta.env.VITE_FINNHUB_API_KEY;
    const fx = Number.isFinite(sarPerUsd) && sarPerUsd > 0 ? sarPerUsd : DEFAULT_SAR_PER_USD;
    const out: { symbol: string; price: number }[] = [];
    let coinGeckoGoldUsd: number | null | undefined;
    let coinGeckoSilverUsd: number | null | undefined;
    for (const c of commodities) {
        const sym = (c.symbol || '').toUpperCase().trim();
        let finnhubSym = '';
        let priceMultiplier = fx;
        let normalizedSym = sym;
        const karatFromSymbol = Number(sym.match(/_(24|22|21|18)K$/)?.[1] || 0);
        const normalizedKarat = Number(c.goldKarat ?? (Number.isFinite(karatFromSymbol) && karatFromSymbol > 0 ? karatFromSymbol : 24));
        const karatFactor = sym.startsWith('XAU_') ? Math.min(1, Math.max(0, normalizedKarat / 24)) : 1;
        if (sym === 'BTC_USD' || sym === 'BTC') {
            finnhubSym = 'BINANCE:BTCUSDT';
            normalizedSym = 'BTC';
        } else if (sym === 'ETH_USD' || sym === 'ETH') {
            finnhubSym = 'BINANCE:ETHUSDT';
            normalizedSym = 'ETH';
        } else if (sym.startsWith('XAU_OUNCE')) {
            finnhubSym = 'OANDA:XAU_USD';
            priceMultiplier = fx;
            normalizedSym = sym;
        } else if (sym.startsWith('XAU_GRAM') || sym === 'XAU') {
            finnhubSym = 'OANDA:XAU_USD';
            priceMultiplier = fx / GRAMS_PER_TROY_OZ;
            normalizedSym = sym === 'XAU' ? 'XAU' : sym;
        } else if (sym.startsWith('XAG_OUNCE')) {
            finnhubSym = 'OANDA:XAG_USD';
            priceMultiplier = fx;
            normalizedSym = sym;
        } else if (sym.startsWith('XAG_GRAM') || sym === 'XAG') {
            finnhubSym = 'OANDA:XAG_USD';
            priceMultiplier = fx / GRAMS_PER_TROY_OZ;
            normalizedSym = sym === 'XAG' ? 'XAG' : sym;
        }
        if (!finnhubSym) continue;
        try {
            let priceUsd: number | null = null;
            if (token) {
                const res = await finnhubFetch(
                    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSym)}&token=${encodeURIComponent(token)}`,
                );
                if (res.ok) {
                    const row = await res.json();
                    const v = Number(row?.c ?? row?.pc ?? row?.p);
                    if (Number.isFinite(v) && v > 0) priceUsd = v;
                }
            }
            if (priceUsd == null && finnhubSym === 'OANDA:XAU_USD') {
                if (coinGeckoGoldUsd === undefined) coinGeckoGoldUsd = await getGoldSpotUsdPerTroyOzCoinGecko();
                if (coinGeckoGoldUsd != null) priceUsd = coinGeckoGoldUsd;
            }
            if (priceUsd == null && finnhubSym === 'OANDA:XAG_USD') {
                if (coinGeckoSilverUsd === undefined) coinGeckoSilverUsd = await getSilverSpotUsdPerTroyOzCoinGecko();
                if (coinGeckoSilverUsd != null) priceUsd = coinGeckoSilverUsd;
            }
            if (priceUsd == null) continue;
            out.push({ symbol: normalizedSym, price: priceUsd * priceMultiplier * karatFactor });
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

export type AICommodityPricesOptions = { sarPerUsd?: number };

/** Commodity prices: Finnhub first, then Binance fallback for crypto so metals and crypto are reliably retrieved. */
export const getAICommodityPrices = async (
    commodities: Pick<CommodityHolding, 'symbol' | 'name' | 'goldKarat'>[],
    options?: AICommodityPricesOptions,
): Promise<{ prices: { symbol: string; price: number }[], groundingChunks: any[] }> => {
    if (commodities.length === 0) return { prices: [], groundingChunks: [] };
    const rawFx = options?.sarPerUsd;
    const sarPerUsd = typeof rawFx === 'number' && Number.isFinite(rawFx) && rawFx > 0 ? rawFx : DEFAULT_SAR_PER_USD;
    let prices = await getFinnhubCommodityPrices(commodities, sarPerUsd);
    const haveSymbol = new Set(prices.map(p => normalizeCommoditySymbolForMatch(p.symbol)));
    const missingCrypto = commodities
        .map(c => (c.symbol || '').toUpperCase().trim())
        .filter(s => (s === 'BTC' || s === 'BTC_USD' || s === 'ETH' || s === 'ETH_USD') && !haveSymbol.has(normalizeCommoditySymbolForMatch(s)));
    if (missingCrypto.length > 0) {
        const binancePrices = await getBinanceCryptoPrices([...new Set(missingCrypto)], sarPerUsd);
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

/** Translate an English financial insight to Modern Standard Arabic; keeps numbers and currency tokens. */
export async function translateFinancialInsightToArabic(englishText: string): Promise<string> {
    const src = (englishText || '').trim();
    if (!src) return '';
    const prompt = `You are a professional financial translator. Translate the following text into Modern Standard Arabic.

Rules:
- Preserve every number, percentage, date, and currency label (SAR, USD, etc.) exactly as in the source.
- Use clear, direct Arabic suitable for a personal finance app.
- Output plain text only: short paragraphs and/or lines starting with "- " for bullets. Do NOT use markdown headers (no ###).
- Do not add disclaimers or meta-commentary.`;

    const response = await invokeAI({
        model: FAST_MODEL,
        contents: `${prompt}\n\n---\n${src}\n---`,
        config: { systemInstruction: DEFAULT_SYSTEM_INSTRUCTION },
    });
    const out = (response?.text ?? '').trim();
    return out || src;
}

export const getAIDividendAnalysis = async (
    ytdIncome: number,
    projectedAnnual: number,
    trailing12mActual: number,
    topPayers: { name: string; symbol: string; projected: number }[],
): Promise<string> => {
    try {
        const payerLines =
            topPayers.length > 0
                ? topPayers
                      .map(
                          (p) =>
                              `${(p.symbol || '—').trim()} — ${(p.name || '').trim()} — ${Math.round(p.projected).toLocaleString()} SAR/yr (forward model estimate)`,
                      )
                      .join('\n')
                : '(none — no forward estimates available)';
        const prompt = `You are a dividend analyst for a personal finance app. Use ONLY the figures below. Do not invent amounts, symbols, yields, or company facts not stated here.

Figures (SAR, display currency):
- YTD dividend income (actual, from ledger): ${Math.round(ytdIncome).toLocaleString()}
- Trailing 12 months dividend income (actual, from ledger): ${Math.round(trailing12mActual).toLocaleString()}
- Projected annual dividend income (forward-looking model from holdings + fundamentals, not broker-reported): ${Math.round(projectedAnnual).toLocaleString()}

Top contributors by projected annual income (forward model):
${payerLines}

Rules:
- If YTD and trailing 12m are both zero, say recorded dividend history is empty and do not speculate about portfolio performance or future dividends.
- Do not equate projected annual with realized income; label projections as estimates when you mention them.
- Keep commentary educational; no personalized investment advice or buy/sell instructions.

Return Markdown only (no HTML). Use ### for each section.

### On track?
- One or two short sentences comparing actuals (YTD / trailing 12m) to the forward projection only when at least one actual figure is non-zero; otherwise explain that there is no dividend history in the ledger yet.

### Concentration
- 1–2 bullets on concentration among the listed top contributors (if any); if none, say estimates are unavailable.

### Suggestion
- One sentence: general educational practice for dividend income tracking (not ticker-specific advice).`;
        const response = await invokeAI({ model: FAST_MODEL, contents: prompt });
        return response.text || "Could not retrieve dividend analysis.";
    } catch (error) {
        return formatAiError(error);
    }
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
                    type: SchemaType.OBJECT,
                    additionalProperties: {
                        type: SchemaType.OBJECT,
                        properties: {
                            price: { type: SchemaType.NUMBER },
                            change: { type: SchemaType.NUMBER },
                            changePercent: { type: SchemaType.NUMBER }
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
        try {
            return await getFinnhubLivePrices(symbols);
        } catch (e) {
            console.warn('Finnhub live batch failed:', e);
            return {};
        }
    };
    const tryStooq = async (syms: string[]) => {
        const stooq = await getStooqLivePrices(syms);
        return Object.keys(stooq).length > 0 ? stooq : {};
    };

    const mergeFinnhubAndStooq = async (): Promise<{ [symbol: string]: { price: number; change: number; changePercent: number } }> => {
        const finnhub = await tryFinnhub();
        const missing = symbols.filter((s) => {
            const u = (s || '').trim().toUpperCase();
            const canon = canonicalQuoteLookupKey(s);
            const has =
                finnhub[s] ||
                finnhub[u] ||
                finnhub[canon] ||
                Object.keys(finnhub).some((k) => canonicalQuoteLookupKey(k) === canon);
            return !has;
        });
        if (missing.length === 0 && Object.keys(finnhub).length > 0) return finnhub;
        const stooq = await tryStooq(missing.length > 0 ? missing : symbols);
        return { ...stooq, ...finnhub };
    };

    try {
        if (provider === 'stooq') {
            const stooq = await tryStooq(symbols);
            if (Object.keys(stooq).length > 0) return stooq;
            throw new Error('Stooq returned no symbols');
        }
        if (provider === 'ai') return await aiFetch();
        // finnhub | auto | unset: Finnhub first, Stooq fills gaps (same mapping as finnhubService)
        const merged = await mergeFinnhubAndStooq();
        if (Object.keys(merged).length > 0) return merged;
        throw new Error('No live prices from Finnhub or Stooq');
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
    source: 'ai' | 'fallback';
};

/** Suggest analyst & eligibility parameters from AI based on universe and context. Use to auto-fill the plan; no manual entry required. */
export const getAIMarketEventInsight = async (
    event: {
        title: string;
        description: string;
        category: string;
        impact: string;
        symbol?: string;
        date: string;
        id?: string;
        detailedInfo?: {
            meetingType?: string;
            historicalContext?: string;
            keyMetrics?: string[];
            marketImpactHistory?: string;
            preparationTips?: string[];
        };
    },
    portfolio: { holdings: Array<{ symbol: string; quantity: number; currentValue: number }>; watchlist: string[] }
): Promise<{ insight: string; action: string; relevance: string }> => {
    const eventId = event.id || `${event.title}-${event.date}-${event.symbol || 'general'}`;
    const cacheKey = `marketEventInsight:${eventId}:${new Date().toISOString().slice(0, 10)}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    const holdingsSummary = portfolio.holdings.length > 0
        ? portfolio.holdings.slice(0, 5).map(h => `${h.symbol} (${h.quantity} shares)`).join(', ')
        : 'No holdings';
    const watchlistSummary = portfolio.watchlist.length > 0
        ? portfolio.watchlist.slice(0, 5).join(', ')
        : 'No watchlist';

    const detailedContext = event.detailedInfo ? `
**Detailed Event Information:**
${event.detailedInfo.meetingType ? `- Meeting Type: ${event.detailedInfo.meetingType}` : ''}
${event.detailedInfo.historicalContext ? `- Historical Context: ${event.detailedInfo.historicalContext}` : ''}
${event.detailedInfo.keyMetrics && event.detailedInfo.keyMetrics.length > 0 ? `- Key Metrics: ${event.detailedInfo.keyMetrics.join(', ')}` : ''}
${event.detailedInfo.marketImpactHistory ? `- Market Impact History: ${event.detailedInfo.marketImpactHistory}` : ''}
${event.detailedInfo.preparationTips && event.detailedInfo.preparationTips.length > 0 ? `- Preparation Tips: ${event.detailedInfo.preparationTips.join('; ')}` : ''}
` : '';

    const prompt = `${EXPERT_ADVISOR_PERSONA}

Analyze this market event and provide personalized insights:

**Event:** ${event.title}
**Date:** ${event.date}
**Category:** ${event.category}
**Impact:** ${event.impact}
**Description:** ${event.description}
${event.symbol ? `**Symbol:** ${event.symbol}` : ''}
${detailedContext}
**Your Portfolio Context:**
- Holdings: ${holdingsSummary}
- Watchlist: ${watchlistSummary}

Provide a comprehensive analysis in JSON format:
{
  "insight": "One clear, detailed sentence explaining how this event impacts your portfolio specifically, considering the historical context and market impact patterns",
  "action": "One specific, actionable step you should take (e.g., 'Review AAPL position before earnings', 'Reduce leverage before FOMC meeting', 'Revisit position size vs your risk budget'). Reference the preparation tips if applicable.",
  "relevance": "Brief explanation of why this matters to your investments (High/Medium/Low relevance). Consider both direct portfolio impact and broader market implications."
}

Be specific, actionable, and leverage the detailed event information provided. If the event doesn't directly impact the portfolio, explain general market implications and how they might affect your holdings indirectly.`;

    try {
        const response = await invokeAI({
            model: FAST_MODEL,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: SchemaType.OBJECT,
                    properties: {
                        insight: { type: SchemaType.STRING },
                        action: { type: SchemaType.STRING },
                        relevance: { type: SchemaType.STRING },
                    },
                    required: ['insight', 'action', 'relevance'],
                },
            },
        });

        const parsed = robustJsonParse(response?.text) || {
            insight: 'Market event may impact broader market sentiment and your portfolio indirectly.',
            action: 'Monitor market reaction and review your positions if volatility increases.',
            relevance: 'Medium',
        };

        const result = {
            insight: parsed.insight || 'Market event may impact broader market sentiment.',
            action: parsed.action || 'Monitor market reaction.',
            relevance: parsed.relevance || 'Medium',
        };

        setToCache(cacheKey, result);
        return result;
    } catch (error) {
        console.warn('AI market event insight failed:', error);
        return {
            insight: `${event.category} event with ${event.impact.toLowerCase()} impact. ${event.symbol ? `Directly affects ${event.symbol}.` : 'May impact broader market.'}`,
            action: event.impact === 'High' ? 'Monitor closely and be prepared for volatility.' : 'Stay informed about market developments.',
            relevance: event.symbol && portfolio.watchlist.includes(event.symbol) ? 'High' : event.impact === 'High' ? 'Medium' : 'Low',
        };
    }
};

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
            source: 'fallback',
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
                    type: SchemaType.OBJECT,
                    properties: {
                        minimumUpsidePercentage: { type: SchemaType.NUMBER },
                        stale_days: { type: SchemaType.NUMBER },
                        min_coverage_threshold: { type: SchemaType.NUMBER },
                        redirect_policy: { type: SchemaType.STRING },
                        target_provider: { type: SchemaType.STRING },
                    },
                    required: ['minimumUpsidePercentage', 'stale_days', 'min_coverage_threshold', 'redirect_policy', 'target_provider'],
                },
            },
        });
        const raw = robustJsonParse(response.text);
        if (!raw || typeof raw !== 'object') return { ...DEFAULT_ANALYST_ELIGIBILITY, source: 'fallback' };
        const minUpside = Math.min(50, Math.max(10, Number(raw.minimumUpsidePercentage) || DEFAULT_ANALYST_ELIGIBILITY.minimumUpsidePercentage));
        const staleDays = Math.min(365, Math.max(7, Math.round(Number(raw.stale_days) || DEFAULT_ANALYST_ELIGIBILITY.stale_days)));
        const minCov = Math.min(10, Math.max(1, Math.round(Number(raw.min_coverage_threshold) || DEFAULT_ANALYST_ELIGIBILITY.min_coverage_threshold)));
        const redirect = (raw.redirect_policy === 'priority' ? 'priority' : 'pro-rata') as 'pro-rata' | 'priority';
        const provider = String(raw.target_provider || DEFAULT_ANALYST_ELIGIBILITY.target_provider).trim() || DEFAULT_ANALYST_ELIGIBILITY.target_provider;
        return { minimumUpsidePercentage: minUpside, stale_days: staleDays, min_coverage_threshold: minCov, redirect_policy: redirect, target_provider: provider, source: 'ai' };
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
            type: SchemaType.OBJECT,
            properties: {
                totalInvestment: { type: SchemaType.NUMBER },
                coreInvestment: { type: SchemaType.NUMBER },
                upsideInvestment: { type: SchemaType.NUMBER },
                speculativeInvestment: { type: SchemaType.NUMBER },
                redirectedInvestment: { type: SchemaType.NUMBER },
                unusedUpsideFunds: { type: SchemaType.NUMBER },
                status: { type: SchemaType.STRING, enum: ['success', 'failure'] },
                log_details: { type: SchemaType.STRING, description: 'Markdown formatted audit log of the execution.' },
                trades: {
                    type: SchemaType.ARRAY,
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            ticker: { type: SchemaType.STRING },
                            amount: { type: SchemaType.NUMBER },
                            reason: { type: SchemaType.STRING },
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


export async function suggestRecoveryParameters(input: {
    symbol: string;
    sleeveType: 'Core' | 'Upside' | 'Spec';
    riskTier: 'Low' | 'Med' | 'High' | 'Spec';
    plPct: number;
    deployableCash: number;
    currentPrice: number;
    avgCost: number;
}): Promise<{ lossTriggerPct: number; cashCap: number; recoveryEnabled: boolean; notes?: string }> {
    const buildRuleBasedSuggestion = () => {
        const lossMagnitude = Math.max(0, Math.abs(Number(input.plPct) || 0));
        const baseTrigger = input.riskTier === 'Low' ? 12 : input.riskTier === 'Med' ? 15 : input.riskTier === 'High' ? 18 : 22;
        const tightenedTrigger = baseTrigger - Math.min(4, lossMagnitude / 10);
        const lossTriggerPct = Number(Math.max(8, Math.min(30, tightenedTrigger)).toFixed(1));

        const sleeveCap = input.sleeveType === 'Core' ? 0.22 : input.sleeveType === 'Upside' ? 0.16 : 0.1;
        const riskCap = input.riskTier === 'Low' ? 0.2 : input.riskTier === 'Med' ? 0.16 : input.riskTier === 'High' ? 0.12 : 0.08;
        const lossBoost = 1 + Math.min(0.3, lossMagnitude / 100);
        const rawCap = Math.max(500, (Number(input.deployableCash) || 0) * Math.min(sleeveCap, riskCap) * lossBoost);
        const cashCap = Number(Math.max(500, Math.min(rawCap, (Number(input.deployableCash) || 0) * 0.35)).toFixed(2));

        const recoveryEnabled = input.sleeveType !== 'Spec';
        const notes = `Rule-based recovery tuning for ${input.symbol}: trigger ${lossTriggerPct}% and cap ${cashCap.toFixed(0)} based on ${input.riskTier} risk tier and ${lossMagnitude.toFixed(1)}% drawdown.`;

        return { lossTriggerPct, cashCap, recoveryEnabled, notes };
    };

    const ruleBased = buildRuleBasedSuggestion();
    const deployable = Math.max(0, Number(input.deployableCash) || 0);
    if (deployable <= 0) return ruleBased;

    const prompt = `You are a portfolio risk-control optimizer. Propose conservative recovery parameters for one position.
Return JSON with:
- lossTriggerPct (number between 8 and 30)
- cashCap (number between 500 and deployableCash*0.35)
- recoveryEnabled (boolean)
- notes (short string)

Context:
- symbol: ${input.symbol}
- sleeveType: ${input.sleeveType}
- riskTier: ${input.riskTier}
- plPct: ${Number(input.plPct || 0).toFixed(2)}
- deployableCash: ${deployable.toFixed(2)}
- currentPrice: ${Number(input.currentPrice || 0).toFixed(4)}
- avgCost: ${Number(input.avgCost || 0).toFixed(4)}

Priorities:
1) Avoid oversized averaging and protect cash.
2) Higher risk tier => smaller cashCap and stricter trigger.
3) For Spec sleeve, recoveryEnabled should usually be false.
4) Keep notes specific and practical.`;

    try {
        const response = await invokeAI({
            model: FAST_MODEL,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: SchemaType.OBJECT,
                    properties: {
                        lossTriggerPct: { type: SchemaType.NUMBER },
                        cashCap: { type: SchemaType.NUMBER },
                        recoveryEnabled: { type: SchemaType.BOOLEAN },
                        notes: { type: SchemaType.STRING },
                    },
                    required: ['lossTriggerPct', 'cashCap', 'recoveryEnabled'],
                },
            },
        });

        const parsed = robustJsonParse(response?.text) || {};
        const rawTrigger = Number(parsed.lossTriggerPct);
        const rawCap = Number(parsed.cashCap);

        const maxCap = deployable * 0.35;
        const safeTrigger = Number(Math.max(8, Math.min(30, Number.isFinite(rawTrigger) ? rawTrigger : ruleBased.lossTriggerPct)).toFixed(1));
        const safeCap = Number(Math.max(500, Math.min(maxCap, Number.isFinite(rawCap) ? rawCap : ruleBased.cashCap)).toFixed(2));
        const safeEnabled = typeof parsed.recoveryEnabled === 'boolean' ? parsed.recoveryEnabled : ruleBased.recoveryEnabled;
        const safeNotes = typeof parsed.notes === 'string' && parsed.notes.trim().length > 0
            ? parsed.notes.trim()
            : `AI-optimized recovery tuning for ${input.symbol}.`;

        return {
            lossTriggerPct: safeTrigger,
            cashCap: safeCap,
            recoveryEnabled: safeEnabled,
            notes: safeNotes,
        };
    } catch (error) {
        console.warn('suggestRecoveryParameters AI failed; using rule-based fallback.', error);
        return { ...ruleBased, notes: `${ruleBased.notes} AI unavailable, applied resilient fallback.` };
    }
}
