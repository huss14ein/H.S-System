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

## Feature → primary file

| Feature | Primary code | Grounding summary |
|---------|----------------|-------------------|
| Dashboard AI | `components/AIAdvisor.tsx` | Personal wealth slices from `DataContext` |
| Investments workspace coach | `Investments.tsx` → `AIAdvisor` | **Overview** sub-tab only; same grounding as hub insights |
| Execution History | — | **No AI surface**; logs/export only (avoids duplicate coaching next to static page copy) |
| Dividend analysis | `services/geminiService.ts` (`getAIDividendAnalysis`) | YTD + trailing-12m actuals + projected annual + top payers (symbols); model must not invent figures |
| Trade insights | `getAITradeAnalysis` | Last 20 personal `investmentTransactions` + holdings (SAR) + watchlist + plan + `riskProfile` + **as-of** date |
| Watchlist tips | `getAIWatchlistAdvice` | Symbol list only |
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
