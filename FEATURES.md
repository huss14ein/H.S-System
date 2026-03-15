# Platform Features & Capabilities

This document reflects features and functionalities implemented in the codebase. It serves as the single source of truth for what the platform delivers.

---

## Investment Management

### Wealth Ultra Portfolio Engine
- **Location:** `wealth-ultra/`, `pages/WealthUltraDashboard.tsx`
- Allocation engine, order generator, cash planner, capital efficiency, spec risk, adjustment engine, alert engine, exit engine, monthly deployment
- Scenario hooks (e.g. market −10% / −20%), rebalance policy, diversification/concentration analysis
- Integration with investment plan, portfolio universe, and cross-engine constraints (cash, risk)

### AI Investment Rebalancer
- **Location:** `pages/AIRebalancerView.tsx`
- Portfolio selection and risk profile (Conservative, Moderate, Aggressive)
- AI-generated rebalancing plans via Gemini with rule-based fallback
- Allocation visualization and risk education

### Investment Recovery Plan
- **Location:** `pages/RecoveryPlanView.tsx`, `services/recoveryPlan.ts`, `services/recoveryPlanPerformance.ts`
- Loss qualification and recovery strategies
- Ladder generation and performance tracking

### Dividend Tracker
- **Location:** `pages/DividendTrackerView.tsx`
- YTD dividend income, monthly dividend charts, projected annual income
- Top payers ranking, AI dividend analysis (Gemini), concentration/diversification

### Investment Plan
- **Location:** `pages/InvestmentPlanView.tsx`
- Monthly investment plan (private per user), planned trades, control tower with cross-engine alerts and constraints

---

## Financial Planning

### Budget Planning
- **Location:** `pages/Budgets.tsx`, `services/enhancedBudgetEngine.ts`, `services/hybridBudgetCategorization.ts`
- Scenario analysis (recession, job loss, promotion), life events, household stress assessment
- Dynamic baselines, predictive spend, recurring bills & price benchmarks
- Saudi household budget: “Create budgets from household (Saudi)” using family size and salary
- Shared budgets, budget requests (New Category / Increase Limit), approval flow, governance categories
- Shared budget transactions: current month default, month/status/category filters

### Emergency Fund & Sinking Funds
- **Location:** `hooks/useEmergencyFund.ts`, `pages/SinkingFunds.tsx`, `pages/Accounts.tsx`, `pages/Goals.tsx`
- Emergency fund calculation and display
- Sinking funds / goal-based savings with tracking

### Plan (Annual Financial Plan)
- **Location:** `pages/Plan.tsx`
- Income/expense planning, household intelligence (dynamic baselines, predictive spend, cashflow stress)

---

## Asset & Liability Management

### Assets
- **Location:** `pages/Assets.tsx`
- Physical assets, property, vehicles, net worth and valuation

### Commodities
- **Location:** `pages/Commodities.tsx`
- Gold, Silver, Bitcoin and other commodity holdings with AI price updates (Gemini)

### Liabilities
- **Location:** `pages/Liabilities.tsx`
- Debt and liability tracking

---

## Market Intelligence

### Market Events Calendar
- **Location:** `pages/MarketEvents.tsx`, `services/finnhubService.ts`
- Macro (US NFP, CPI, PPI, FOMC), earnings, dividend, portfolio events
- Impact guidance (High / Medium / Low) and “what to do” text per event
- Filters: category, impact, search, include estimated, reminders only
- Priority/focus queue, reminders, .ics export

---

## System & Operations

### System & APIs Health
- **Location:** `pages/SystemHealth.tsx`
- Service checks: Authentication (Supabase), Database, AI (Gemini), Market Data (Finnhub), Multi-user
- Response time and status (Operational, Degraded, Outage, Simulated)
- Incident logging, auto-refresh (90s), market status and holidays (Finnhub)

---

## User Experience & UI

### Navigation & Layout
- **Location:** `App.tsx`, `components/Layout.tsx`, `components/PageLayout.tsx`
- Code-split (lazy-loaded) pages, hash-based routing
- Responsive layout and shared page structure

### Notifications
- **Location:** `context/NotificationsContext.tsx`, `pages/Notifications.tsx`
- Budget breach, goals near deadline, price alerts, planned trades triggered, expense spike
- Admin: pending budget requests, pending shared-budget transaction approvals
- User: budget request outcomes (approved/rejected)
- Severity (urgent, warning, info), read state, cross-page links

### Settings
- **Location:** `pages/Settings.tsx`
- Financial preferences, budget alerts, Wealth Ultra config, data management, export

---

## AI Integration

### AI Services
- **Location:** `context/AiContext.tsx`, `services/geminiService.ts`, `components/AIAdvisor.tsx`, `components/LiveAdvisorModal.tsx`, `components/AIFeed.tsx`
- Context-aware insights, financial education, multi-language support
- Used for: dividend analysis, commodity insights, market event context, rebalancing, budget automation, statement processing

### Transaction AI
- **Location:** `context/TransactionAIContext.tsx`
- Transaction categorization and review assistance

---

## Data & Integrations

### Data Context
- **Location:** `context/DataContext.tsx`
- Centralized data: accounts, transactions, budgets, investments, goals, watchlist, planned trades, investment plan, budget requests, recurring transactions, etc.
- User-scoped fetching; investment plan and planned trades private per user
- Shared budget transaction mirror sync on transaction add/update/delete

### Market Data
- **Location:** `context/MarketDataContext.tsx`, `services/finnhubService.ts`
- Real-time/cached prices, market calendar, market status

### Statement Upload & Processing
- **Location:** `pages/StatementUpload.tsx`, `pages/StatementHistoryView.tsx`, `context/StatementProcessingContext.tsx`, `services/statementParser.ts`
- File upload, parsing, and history

---

## Security & Multi-User

### Authentication
- **Location:** `context/AuthContext.tsx`
- Supabase auth; admin detection (role/email)

### Account Sharing
- **Location:** `pages/Accounts.tsx`, RPC `get_shared_accounts_for_me`
- Share accounts with optional “allow recipient to view balance” (`show_balance`)

### Budget Sharing & Requests
- **Location:** `pages/Budgets.tsx`, `budget_requests`, `get_shared_budgets_for_me`, `budget_shared_transactions`
- Share budget categories; request new category or increase; admin approval; approved requests displayed as budget cards when needed

---

## Transfers & Accounts

### Transfers
- **Location:** `pages/Accounts.tsx`
- One-time transfer between any account types (Checking, Savings, Investment, etc.)
- Recurring (auto) transfer: schedule monthly transfers; managed under Recurring Transactions

---

## Technical

- **Build:** TypeScript, React; `npm run typecheck` for type safety
- **Error handling:** `AppErrorBoundary` for graceful failures
- **Currency:** `CurrencyContext`, SAR and multi-currency support

---

---

## Portfolio & Trading Engine (Brain, Hands, Shield, Eyes)

### Portfolio construction (`services/portfolioConstruction.ts`)
- **Target allocation:** Profile → asset mix (e.g. Conservative 60% VTI / 40% BND, Moderate 70/30, Aggressive 85/15). Wired in AI Rebalancer.
- **Drift-based rebalancing:** Handled by `sleeveAllocation` and Wealth Ultra (threshold-based, not schedule-only).
- **Mean-Variance Optimization (MVO):** Efficient-frontier style; 2-asset closed form, N-asset equal-weight fallback. Optimal weights and Sharpe. Wired in AI Rebalancer (MVO suggested weights per portfolio).
- **Fractional share calculation:** `dollarToShareQuantity()` with Decimal.js, 6-decimal precision; respects allow fractional, minimum order size, rounding rule.
- **Monte Carlo goal success:** 2k–5k simulations for “Probability of success” per goal. Wired on Goals page.

### Trading execution (`services/tradingExecution.ts`)
- **Extended hours guardrail:** Rejects market orders outside 9:30 AM – 4:00 PM ET; suggests limit orders. Wired in Record Trade.
- **Time-In-Force (TIF):** Day, GTC, IOC labels and support. Wired: Record Trade modal has TIF dropdown with `getTIFLabel()` tooltip.
- **NBBO / SOR stubs:** `getNBBOStub`, `getSORStub` for best bid/offer and routing. Wired: Record Trade shows NBBO (sim) when symbol/price set; SOR (sim) for notional ≥ $10k. Record Trade also shows “NBBO (sim): bid/ask” when symbol and price are set.
- **VWAP:** `getVWAPSlices()` to split an order across the session. Wired: Record Trade shows "VWAP (sim): N slices" for large orders (qty ≥ 50 or notional ≥ $10k).

### Risk & compliance (`services/riskCompliance.ts`)
- **PDT tracker:** Rolling 5-business-day counter; blocks 4th day trade when equity &lt; $25k. Status shown on Wealth Ultra.
- **Value at Risk (VaR):** Historical simulation, 95% confidence. Used on Wealth Ultra dashboard.
- **T+1 settlement:** `getSettlementDate`, `isSettled` for good-faith compliance. Wired: Record Trade builds settlement state from recent buys, uses `isSettled()` to detect unsettled; shows warning and requires confirmation checkbox. User must confirm “I have other settled cash or understand T+1” to submit.
- **Volatility-based position sizing:** `volatilityAdjustedWeights()` for inverse-vol weighting. Wired: Wealth Ultra Risk & compliance card shows vol-adjusted allocation suggestion when 2+ positions.
- **Market hours & holidays:** `isNYSEHolidayOrWeekend`, `getMarketHoursGuardrail`; wired into dashboard.

### Technical indicators (`services/technicalIndicators.ts`)
- **RSI:** Overbought 70+, oversold 30-. Wired in Watchlist Signals column.
- **Bollinger Bands:** Middle (SMA), upper/lower bands. Wired in Watchlist (BB: near upper/mid/lower).
- **Z-Score:** Mean reversion; |z| &gt; 2 over-extended. Wired in Watchlist Signals column.
- **SMA / EMA and crossovers:** Golden Cross / Death Cross (e.g. SMA50 vs SMA200). Short-term crossover SMA(5)/SMA(10) for limited data; wired in Watchlist Signals.

### Tech stack (recommended / in use)
- **Math:** Decimal.js (installed; used in portfolio construction).
- **Database:** PostgreSQL (Supabase).
- **Indicators / state / broker:** Implemented in-house; XState and Alpaca can be added for order state and execution.

---

*Last updated to match the codebase. For release history or version notes, consider adding a `CHANGELOG.md`.*
