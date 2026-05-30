# AI grounding & data manifest (Finova)

Use this checklist when wiring or auditing AI features.

## Grounding sources (in order of trust)

1. **User-entered structured data** — accounts, transactions, holdings, budgets (Supabase, user-scoped).
2. **Computed metrics** — `services/financeMetrics.ts`, `goalMetrics.ts`, reconciliation helpers (deterministic).
3. **Market quotes** — Finnhub / Stooq / session `simulatedPrices` (stale-symbol warnings apply).
4. **Model-generated text** — Gemini (and others); must be labeled “not financial advice.”

## Prompt hygiene

- Pass **aggregates** and **symbol lists**, not raw secrets.
- Never send full account numbers; mask IDs in logs.
- Include **currency** and **as-of** date for any numeric summary.
- For headline SAR figures, build prompts with `buildAiPersonalWealthGrounding` (`services/aiPersonalWealthGrounding.ts`) so net worth, liquid cash, and financial-month P&L match `computePersonalHeadlineNetWorthSar` / `computeDashboardKpiSnapshot`.
- Markdown replies run through `auditSarGrounding` in `invokeAI` (dev on by default; prod via `VITE_AI_SAR_GROUNDING_AUDIT=1`).

## Feature → primary file

| Feature | Primary code | Grounding summary |
|---------|----------------|-------------------|
| Dashboard executive summary / feed | `getAIExecutiveSummary`, `getAIFeedInsights` | `buildAiPersonalWealthGrounding` + live quotes when passed |
| Dashboard AI advisor card | `getAIDashboardInsight` via `AIAdvisor` | Same canonical grounding block |
| Live Advisor chat | `LiveAdvisorModal` + tools | `getNetWorth`, `getGoalsProgress`, `getTopHoldings`, budgets, recent tx |
| Transaction category sparkle | `getAICategorySuggestion` | Description + amount/date + prior labels + month spend hints |
| Investment plan execution | `executeInvestmentPlanRuleBased` (default) | Deterministic weights; AI execution opt-in via `useAiExecution` only |
| Dashboard AI (legacy) | `components/AIAdvisor.tsx` | Personal wealth slices from `DataContext` |
| Investments workspace coach | `Investments.tsx` → `AIAdvisor` | **Overview** sub-tab only; same grounding as hub insights |
| Execution History | — | **No AI surface**; logs/export only (avoids duplicate coaching next to static page copy) |
| Dividend analysis | `services/geminiService.ts` (`getAIDividendAnalysis`) | YTD + trailing-12m actuals + projected annual + top payers (symbols); model must not invent figures |
| Trade insights | `getAITradeAnalysis` | Last 20 personal `investmentTransactions` + holdings (SAR) + watchlist + plan + `riskProfile` + **as-of** date |
| Liabilities advisor | `getAILiabilitiesInsight` via `AIAdvisor` (`pageContext="liabilities"`) | Debt metrics + `buildAiPersonalWealthGrounding` |
| Forecast advisor | `getAIForecastInsight` via `AIAdvisor` (`pageContext="forecast"`) | Slider baseline/projection + scenario presets + trend sample |
| Zakat advisor | `getAIAnalysisPageInsights` via `AIAdvisor` (`pageContext="zakat"`) | Zakatable/deductible/outstanding + payment trend |
| Assets advisor | `getAIAnalysisPageInsights` via `AIAdvisor` (`pageContext="assets"`) | Physical + commodity totals + composition |
| Watchlist tips | `getAIWatchlistAdvice` | Symbols + names + holdings overlap + personal wealth grounding |
| Multi-stock analysis | `getAIMultiStockAnalysis`, `buildMultiSymbolMarketGrounding`, `MultiStockAnalysisPanel` | Live quotes + 52w + watchlist fair value; Arabic/English batch compare table; `groundingAuditExtra` — never invent analyst targets |
| Rebalancer | `getAIRebalancingPlan` | Holdings valued like **Portfolios** (`effectiveHoldingValueInBookCurrency` + `simulatedPrices`), **portfolio book currency** (USD/SAR), `sarPerUsd`, risk profile |
| Statement / SMS / trading parse | `invokeAI` in parser paths | Extracted rows + user account mapping (no full PAN) |
| Research / commodity / hybrid categorization | `geminiService.ts` | Varies by caller; prefer aggregates |
| Reconciliation hints | `StatementProcessingContext` | Discrepancy list + statement metadata |

## Rotation / keys (4-API fallback)

- **Netlify proxy** tries providers in order: Gemini primary → Gemini backup → Claude → Grok → OpenAI. When one hits rate limit or fails, the next is used. Set GEMINI_API_KEY, GEMINI_API_KEY_BACKUP, ANTHROPIC_API_KEY, GROK_API_KEY, OPENAI_API_KEY in Netlify env.
- **Client (Vite):** `VITE_GEMINI_API_KEY` — only for local/dev; **do not** ship real secrets in public builds.
- **Market data:** `VITE_FINNHUB_API_KEY` — client-side; not a secret but rate-limited.
- **Finnhub market session:** `/stock/market-status` `session` strings are normalized in `services/finnhubService.ts` (`normalizeFinnhubMarketSession`) to `pre-market` | `post-market` | `regular` | `closed` so Watchlist/System Health stay consistent if the API wording changes.

## Privacy

- **Mask balances** (Settings): client-only; redacts formatted amounts on Dashboard / Summary / Accounts—not a security guarantee on shared screens.

## Transaction splits

- Multi-category splits are encoded in `transactions.note` via `__FINOVA_SPLITS__` + JSON; parsed in `DataContext.normalizeTransaction`.

*Extend this doc as new AI surfaces ship.*
