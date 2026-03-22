# Pages ↔ services ↔ context wiring

This document is the **navigation and integration map** for Finova: how top-level **pages** connect to **React context providers**, **services**, and **cross-page actions** (`setActivePage`, `triggerPageAction`, `pageAction`). Use it when adding a page, debugging a broken link, or tracing data flow.

For storage and layer theory, see **[SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md)**. For product features, see **[../FEATURES.md](../FEATURES.md)**.

For a **page-by-page list of sections, cards, and tabs** (what each block is fed by), see **[FULL_UI_SECTIONS_WIRING.md](./FULL_UI_SECTIONS_WIRING.md)**.

---

## 1. Runtime shell (who wraps whom)

Authenticated users get this **provider order** (outer → inner). Inner providers can use outer ones.

| Layer | Provider | Role |
|-------|-----------|------|
| Theme | `ThemeProvider` | Theme / UI tokens |
| Auth | `AuthProvider` | Supabase session, `isApproved`, admin |
| UX | `ToastProvider` | Toasts |
| UX | `SelfLearningProvider` | Command palette ordering, form defaults, `trackAction` |
| AI (persona) | `AiProvider` | `geminiService` / advisor context |
| **Data hub** | **`DataProvider`** | **Supabase CRUD, `FinancialData`, personal scope (`getPersonalWealthData`)** |
| Money | `CurrencyProvider` | SAR/USD, `exchangeRate` |
| Market | `MarketDataProvider` | Quotes, Finnhub, simulated prices |
| Alerts | `NotificationsProvider` | In-app notifications |
| Import | `StatementProcessingProvider` | Statement pipeline |
| Tx AI | `AIProvider` (`TransactionAIContext`) | Transaction AI assist |
| Reco | `ReconciliationProvider` | Reconciliation flows |
| Multi-bank | `MultiBankProvider` | Multi-account semantics |
| Privacy | `PrivacyProvider` | Masking / privacy toggles |
| — | `MarketSimulator` | Price simulation side effects |
| Chrome | `Layout` | Header, nav, `CommandPalette`, `QuickActionsSidebar`, `LiveAdvisorModal` |
| Resilience | `AppErrorBoundary` | Page-level error recovery → `setActivePage('Dashboard')` |
| Code split | `Suspense` + `LoadingSpinner` | Lazy-loaded pages |

**Implication:** Any page under `Layout` may use `useContext(DataContext)`, `useCurrency()`, `useMarketData()` / `useContext(MarketDataContext)`, `useSelfLearning()`, `useAI()` (AiContext), etc., without extra wiring in `App.tsx` beyond being rendered in `renderPage()`.

---

## 2. Routing and URL

| Mechanism | Implementation |
|-----------|----------------|
| Active page state | `activePage: Page` in `App.tsx` |
| URL | Hash: `#${encodeURIComponent(page)}` (see `setActivePage`) |
| Valid routes | `VALID_PAGES` in `App.tsx` — must match `Page` in `types.ts` |
| Parse hash | `getPageFromHash()` — unknown hash → falls through to `default` branch (Dashboard) |
| Browser back/forward | `hashchange` → `setActivePageState(getPageFromHash() ?? 'Dashboard')` |
| Document title | `PAGE_DISPLAY_NAMES` from `constants.tsx` + `activePage` |

---

## 3. Cross-page actions (not navigation only)

| API | Defined in | Purpose |
|-----|------------|---------|
| `setActivePage(page)` | `App.tsx` | Switch route + update hash |
| `triggerPageAction(page, action)` | `App.tsx` | `setActivePage(page)` then `setPageAction(action)` — consumed on next render |
| `pageAction` / `clearPageAction` | `App.tsx` | Passed to pages that need **one-shot** actions (open modal, focus tab) |

**Consumers of `pageAction`:**

- **`Transactions`**, **`Investments`**, **`Assets`**, **`Settings`**, **`InvestmentPlanView`**, **`WealthUltraDashboard`**, **`EnginesAndToolsHub`** — receive `pageAction` + `clearPageAction` (subset also get `triggerPageAction`).

**`EnginesAndToolsHub`** maps actions to sub-tabs, e.g. `openLiquidation`, `openJournal`, `openLogic`, `openRiskTradingHub` (Safety & rules).

**`Investments`** maps e.g. `open-trade-modal`, `focus-investment-plan`. Legacy `openRiskTradingHub` is forwarded to **`Engines & Tools`** with the same action (opens Money Tools → Safety & rules).

---

## 4. Main nav vs full app surface

**`NAVIGATION_ITEMS`** in `constants.tsx` drives **Header** primary destinations (not every `Page`).

**Pages in `Page` / `VALID_PAGES` but not in `NAVIGATION_ITEMS`** (reachable via links, command palette, dashboard, or sub-hubs):

- `Recovery Plan`, `Investment Plan`, `Dividend Tracker`, `AI Rebalancer`, `Watchlist`
- `Commodities` (alias → `Assets` with same props)
- `Analysis`, `Forecast`, `Liabilities` (may appear in Quick Actions / command palette / in-page links)

**`Commodities`:** `App.tsx` renders **`Assets`** with the same `actionProps` — commodities UI lives inside Assets.

---

## 5. Page → `App.tsx` props → primary integration

Below, “**Data**” means `DataContext` (`data`, `loading`, mutations). “**Market**” means `MarketDataContext`. “**Currency**” means `CurrencyContext`.

| `Page` | Component file | Props from `renderPage` | Primary data / integration |
|--------|----------------|-------------------------|------------------------------|
| Dashboard | `pages/Dashboard.tsx` | `setActivePage`, `triggerPageAction` | Data, Currency, Market (KPIs), SelfLearning; services: `personalNetWorth`, `financeMetrics`, dashboards |
| Summary | `pages/Summary.tsx` | `setActivePage`, `triggerPageAction` | Data, Currency, AiContext |
| Accounts | `pages/Accounts.tsx` | `setActivePage` | Data (`addTransfer`, accounts); reconciliation |
| Liabilities | `pages/Liabilities.tsx` | `setActivePage` | Data; `liabilityMetrics`, `debtEngines` |
| Transactions | `pages/Transactions.tsx` | `setActivePage`, `triggerPageAction`, `pageAction`, `clearPageAction` | Data; `transactionFilters`, `dataQuality`, `geminiService` (category suggest) |
| Budgets | `pages/Budgets.tsx` | `setActivePage`, `triggerPageAction` | Data; `enhancedBudgetEngine`, shared budgets |
| Goals | `pages/Goals.tsx` | `setActivePage` | Data; `goalMetrics`, Monte Carlo |
| Forecast | `pages/Forecast.tsx` | `setActivePage` | Data; `stressScenario`, `scenarioTimelineEngine` |
| Analysis | `pages/Analysis.tsx` | `setActivePage` | Data; analytics services |
| Zakat | `pages/Zakat.tsx` | `setActivePage` | Data |
| Notifications | `pages/Notifications.tsx` | `setActivePage` | NotificationsContext + Data (admin views) |
| Settings | `pages/Settings.tsx` | `setActivePage`, `triggerPageAction` | Data (`updateSettings`, backup); audit log |
| Investments | `pages/Investments.tsx` | `setActivePage`, `triggerPageAction`, `pageAction`, `clearPageAction` | Data, Currency, Market; trades, portfolios, **internal tabs** (Overview, Plan, etc.) |
| Plan | `pages/Plan.tsx` | `setActivePage` | Data; `householdBudgetEngine`, plan buckets |
| Wealth Ultra | `pages/WealthUltraDashboard.tsx` | `setActivePage`, `triggerPageAction` | Data, Currency, Market; `wealth-ultra/*` engines |
| Market Events | `pages/MarketEvents.tsx` | `setActivePage` | Market; `finnhubService` |
| Recovery Plan | `pages/RecoveryPlanView.tsx` | `setActivePage`, `onOpenWealthUltra` | Data; `recoveryPlan` |
| Investment Plan | `pages/InvestmentPlanView.tsx` | `onExecutePlan`, `setActivePage`, `triggerPageAction` | Data; investment plan + execution |
| Dividend Tracker | `pages/DividendTrackerView.tsx` | `setActivePage` | Data, Market; dividends |
| AI Rebalancer | `pages/AIRebalancerView.tsx` | `setActivePage`, `onOpenWealthUltra` | Data, AiContext; `portfolioConstruction` |
| Watchlist | `pages/WatchlistView.tsx` | `setActivePage` | Data, Market; `technicalIndicators` |
| Assets | `pages/Assets.tsx` | `setActivePage`, `triggerPageAction`, `pageAction`, `clearPageAction` | Data; commodities, assets |
| Commodities | *same as Assets* | same | same |
| Statement Upload | `pages/StatementUpload.tsx` | `setActivePage` | Data, StatementProcessingContext |
| Statement History | `pages/StatementHistoryView.tsx` | `setActivePage` | Data, statement history |
| System & APIs Health | `pages/SystemHealth.tsx` | `setActivePage` | Health checks (Supabase, AI, Finnhub) |
| Engines & Tools | `pages/EnginesAndToolsHub.tsx` | `setActivePage`, `triggerPageAction`, `pageAction`, `clearPageAction` | Hosts lazy: `LogicEnginesHub`, `LiquidationPlanner`, `FinancialJournal`; `useFinancialEnginesIntegration`; `dataTick` on visibility |

**Lazy sub-pages (not direct `App` routes):**

| Embedded in | Files | Notes |
|-------------|--------|--------|
| Engines & Tools | `LogicEnginesHub.tsx`, `LiquidationPlanner.tsx`, `FinancialJournal.tsx` | Receive `setActivePage`, `triggerPageAction`, `dataTick` from hub |
| Investments | `InvestmentOverview.tsx`, `RiskTradingHub.tsx`, `SinkingFunds.tsx`, etc. | Tab / section composition inside `Investments.tsx` |

---

## 6. Layout and global UI wiring

| Component | Wiring |
|-----------|--------|
| `Header` | `activePage`, `setActivePage`; opens Live Advisor / Command Palette |
| `QuickActionsSidebar` | `onAction` → `triggerPageAction` |
| `CommandPalette` | `setActivePage`, `triggerPageAction`; SelfLearning for ranking |
| `LiveAdvisorModal` | Opens from Header; uses AiContext + Data as configured in modal |

---

## 7. Sections, cards & sub-pages — data binding

This section describes **where UI blocks get their numbers** so you can verify charts/cards match `DataContext` and personal scope. **Personal scope** (see `utils/wealthScope.ts`, applied in `DataContext` / `getPersonalWealthData`) exposes `personalTransactions`, `personalAccounts`, `personalInvestments`, etc. Pages should prefer these (or the same fallback pattern `d?.personalX ?? data?.x`) so KPIs align with “My” net worth and cashflow.

### 7.1 Dashboard (`pages/Dashboard.tsx`)

| UI block | Data / computation |
|----------|-------------------|
| KPI cards (order in `KPI_CARD_ORDER`) | `useMemo` on `data` + `exchangeRate`: net worth via `computePersonalNetWorthSAR`; monthly P&L from `personalTransactions` + `countsAsIncome/ExpenseForCashflowKpi`; emergency fund via `useEmergencyFund(data)`; budget variance from `data.budgets` vs monthly spend; ROI from personal `investmentTransactions` + `getAllInvestmentsValueInSAR`; investment plan % from `investmentPlan` + progress helpers; Wealth Ultra / Market Events cards are **navigation** (static labels) |
| Cashflow chart | `monthlyCashflowData` from 12 months of personal transactions |
| Net worth composition | `NetWorthCompositionChart` — personal-scoped aggregates |
| Performance treemap | `investmentTreemapData` from personal portfolio holdings |
| Accounts / budget / recent tx widgets | `AccountsOverview`, `BudgetHealth`, `RecentTransactions` fed from filtered `data` |
| AI executive summary | `getAIExecutiveSummary` + KPI snapshot |
| Transaction review modal | `uncategorizedTransactions` from same `useMemo` |

### 7.2 Summary (`pages/Summary.tsx`)

| UI block | Data |
|----------|------|
| Net worth / composition / treemap | `computePersonalNetWorthBreakdownSAR`, `getPersonalWealthData`, `computeLiquidNetWorth` |
| Report card / metrics | `financialMetrics` useMemo: same monthly tx filters as Dashboard |
| Household / stress / runway | `buildHouseholdEngineInputFromData`, `deriveCashflowStressSummary`, `computeLiquidityRunwayFromData`, `computeRiskLaneFromData` |
| Shock drill | `runShockDrill` + templates |
| AI persona | `getAIFinancialPersona` (Gemini) |
| Export | `reportingEngine` CSV/HTML/JSON |

### 7.3 Transactions (`pages/Transactions.tsx`)

| UI block | Data |
|----------|------|
| Table / filters | `data.transactions` (and shared-budget mirrors per DataContext rules) |
| Cashflow KPIs | `countsAsIncomeForCashflowKpi` / `countsAsExpenseForCashflowKpi` |
| Charts | Aggregations over filtered transactions |
| Add/edit modal | `budgetCategories`, `allCategories` from props (from parent’s `data.budgets` / category lists) |
| AI category | `getAICategorySuggestion` + `matchToAllowedCategory` → valid category list |

### 7.4 Budgets (`pages/Budgets.tsx`)

| UI block | Data |
|----------|------|
| Budget cards / progress | `data.budgets` + monthly spend from personal transactions |
| Household engine tab | `enhancedBudgetEngine` / household bulk flows (scoped in page) |
| Shared budgets / requests | `budgetRequests`, RPC-backed shared data via DataContext |

### 7.5 Goals, Liabilities, Plan, Forecast, Analysis, Zakat

Each uses **`useContext(DataContext)`** for entities (`goals`, `liabilities`, plan fields, etc.) plus dedicated services named in **FEATURES.md** / **SYSTEM_ARCHITECTURE.md** (e.g. `goalMetrics`, `liabilityMetrics`, `scenarioTimelineEngine`, `stressScenario`).

### 7.6 Investments hub (`pages/Investments.tsx`) — sub-tabs

All tabs sit **inside** the same DataContext/MarketData/Currency providers; the parent passes **`setActivePage`**, **`triggerPageAction`**, **`pageAction`** where needed.

| Sub-tab | Component | Data / notes |
|---------|-----------|----------------|
| Overview | `InvestmentOverview` | Portfolios, KPIs, `setActiveTab` for inner navigation |
| Portfolios | `PlatformView` | `data` + `simulatedPrices`, CRUD via context mutators |
| Investment Plan | `InvestmentPlan` (inner) | `investmentPlan`, planned trades, record trade callback |
| Dividend Tracker | `DividendTrackerView` | **Same component as top-level route**; `investmentTransactions` (dividends), holdings, **`setActivePage` passed when embedded** for cross-page links |
| Recovery Plan | `RecoveryPlanView` | `recoveryPlan` services + `onOpenWealthUltra` |
| AI Rebalancer | `AIRebalancerView` | Portfolios + `portfolioConstruction` / AI |
| Watchlist | `WatchlistView` | `data.watchlist` + MarketData quotes |
| Execution History | `ExecutionHistoryView` | `executionLogs` / plan execution from `data` |

### 7.7 Wealth Ultra (`pages/WealthUltraDashboard.tsx`)

Cards and engines consume **`data`** (personal investments, plan, config), **`wealthUltraConfig`**, **`CurrencyContext`**, **`MarketDataContext`**, and modules under **`wealth-ultra/`** (allocation, orders, drift, etc.).

### 7.8 Engines & Tools (`pages/EnginesAndToolsHub.tsx`)

| Sub-tab | Component | Data |
|---------|-----------|------|
| Logic & Engines | `LogicEnginesHub` | `useFinancialEnginesIntegration`, portfolio + metrics |
| Safety & rules | `RiskTradingHub` (`embedded`) | Policies, runway, net worth snapshots, MWRR; `setActivePage` / `triggerPageAction` |
| Liquidation | `LiquidationPlanner` | Theses + holdings + `dataTick` refresh |
| Journal | `FinancialJournal` | **localStorage** keys (`finova_financial_journal_v1`, `finova_thesis_records_v1`); not Supabase; **`dataTick`** reloads on tab visibility |

### 7.9 Market Events, Watchlist (standalone routes), System Health

- **Market Events:** `finnhubService` + `MarketDataContext` / calendar helpers.  
- **Watchlist (route):** Same `WatchlistView` as Investments tab; **`setActivePage`** from `App`.  
- **System Health:** Service checks (Supabase, AI, Finnhub), not user portfolio truth.

### 7.10 Statements

- **Upload / History:** `StatementProcessingContext` + `DataContext` for resulting transactions.

### 7.11 Consistency rules for contributors

1. **One source of truth:** User financial truth lives in **`FinancialData` via DataContext** (except Journal localStorage).  
2. **Personal scope:** Use `personalTransactions` / `personalAccounts` / `personalInvestments` when the UI says “my” net worth or P&L.  
3. **Internal transfers:** Exclude from cashflow KPIs using **`transactionFilters`** — keep UI labels aligned (see Transactions income categories).  
4. **Charts:** Build series from the **same filtered lists** as summary KPIs to avoid mismatches.  
5. **Embedded vs route:** Same component (e.g. `DividendTrackerView`) should receive the **same optional props** (`setActivePage`) whether opened from **Investments** tab or **App** route.

### 7.12 Honest coverage: what is and is not fully enumerated

**Card-by-card / tab-by-tab enumeration:** See **[FULL_UI_SECTIONS_WIRING.md](./FULL_UI_SECTIONS_WIRING.md)** (Accounts, Plan, Budgets section list, Risk Trading Hub, Wealth Ultra `SectionCard` titles, etc.).

**Covered in detail above (§7.1–7.4, 7.6–7.8):** Dashboard, Summary, Transactions, Budgets, Investments sub-tabs, Wealth Ultra, Engines & Tools, Market/Watchlist/System/Statements at a **section/card** level.

**Still summarized at route level in §5 when not duplicated in §7:**

| Area | Notes |
|------|--------|
| **Notifications** (page) | `NotificationsContext` + admin views into `allTransactions` / requests where applicable |

**Fully listed in [FULL_UI_SECTIONS_WIRING.md](./FULL_UI_SECTIONS_WIRING.md):**

| Area | Notes |
|------|--------|
| **Settings** | Every `SectionCard`, hero, anchor ids, persistence (Supabase vs device-only), exports |
| **Accounts** | Summary cards, emergency fund, transfers, account grid, sharing |
| **Assets** / **Commodities** | `Commodities` route renders **`Assets`** with same props |
| **Plan** | Sub-pages, fed-from strip, household intelligence, executive metrics; **`SinkingFunds`** embedded |
| **Goals, Liabilities, Forecast, Analysis, Zakat** | Major `SectionCard`s and data hooks |
| **InvestmentPlanView** (top-level route) | Large sections: health check, AI alignment, plans |
| **System Health** | Service checks + reconciliation tools (diagnostic) |

**Outside financial `DataContext` (by design):**

| Area | Notes |
|------|--------|
| **Login / Signup / PendingApproval** | Auth only; no `FinancialData` |
| **Financial Journal** (notes) | **localStorage** + `thesisJournalEngine`; not Supabase |

**Shared `components/` (charts, modals, cards):** Wiring is **through the page** that renders them (props + context). The doc does not duplicate every prop for every chart.

**Verification:** Automated checks (`typecheck`, `lint`, `vitest`, `build`) prove **compile-time** wiring, not that every number matches your business expectation. Use §7.11 + manual smoke tests for production confidence.

---

## 8. Service layer index (by concern)

Services are **imported by pages/contexts**, not registered in `App.tsx`. Key clusters:

| Concern | Folder / files | Typical consumers |
|---------|----------------|-------------------|
| Supabase I/O | `services/supabaseClient.ts` | `DataContext` only (single client) |
| Transaction rules | `transactionFilters.ts`, `transactionIntelligence.ts`, `dataQuality/*` | Transactions, Dashboard KPIs, imports |
| Net worth / cash | `personalNetWorth.ts`, `liquidNetWorth.ts`, `financeMetrics.ts` | Dashboard, Summary, AI advisor |
| Investments | `portfolioConstruction.ts`, `tradingExecution.ts`, `riskCompliance.ts`, `holdingMath.ts` | Investments, Wealth Ultra, Record Trade |
| Budgets | `enhancedBudgetEngine.ts`, `hybridBudgetCategorization.ts` | Budgets, Plan |
| Engines / drills | `shockDrillEngine.ts`, `scenarioTimelineEngine.ts`, `nextBestActionEngine.ts` | Forecast, Logic hub, Dashboard |
| Market | `finnhubService.ts` | MarketDataContext, Market Events, Watchlist |
| AI | `geminiService.ts` | AiContext, Transactions (suggest), statement parser |
| Thesis / journal | `thesisJournalEngine.ts` | Financial Journal (localStorage + engines) |

---

## 9. Checklist when adding a new page

1. Add literal to `Page` in `types.ts`.
2. Add to `VALID_PAGES` in `App.tsx`.
3. `lazy(() => import('./pages/...'))` + `case` in `renderPage` with correct props.
4. If user-facing nav: add to `NAVIGATION_ITEMS` and/or command palette commands in `CommandPalette.tsx`.
5. If deep-link or quick action: wire `triggerPageAction` / `pageAction` and document the action string.
6. Use **`DataContext`** for persisted data; avoid duplicate Supabase clients.

---

## 10. Related files (quick reference)

| File | Responsibility |
|------|----------------|
| `App.tsx` | Routes, providers, `triggerPageAction`, auth gates |
| `constants.tsx` | `NAVIGATION_ITEMS`, `PAGE_DISPLAY_NAMES` |
| `context/DataContext.tsx` | Central financial state and mutations |
| `components/Layout.tsx` | Shell + palette + quick actions |

---

*Generated to match the codebase structure. Update this file when adding routes or changing provider order.*
