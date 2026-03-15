# Pages and Services Coverage

This document lists every **page** and **service** in the app and what was audited/fixed in the full coverage pass.

---

## Pages (31)

| Page | Status | Changes |
|------|--------|--------|
| **Accounts** | ✅ | Null-safe `data?.accounts` / `data?.investments` in useMemo, transfer handler, share select; loading state when `loading \|\| !data`. |
| **AIRebalancerView** | ✅ | Already uses `data?.investments`; has loading UI. |
| **Analysis** | ✅ | Already uses `data?.` and has loading state. |
| **Assets** | ✅ | Null-safe `data?.assets` / `data?.commodityHoldings`; loading state (previous pass). |
| **Budgets** | ✅ | Household engine exports, goals mapping, suggestedProfile cast, Spending Trends optional chaining (previous pass). |
| **Commodities** | ✅ | Loading state when `loading \|\| !data` (previous pass). |
| **Dashboard** | ✅ | Already has loading state and `data?.`. |
| **DividendTrackerView** | ✅ | Uses `data?.investmentTransactions` / `data?.investments`; has loading UI. |
| **ExecutionHistoryView** | ✅ | Uses `data?.executionLogs`; sub-view. |
| **Forecast** | ✅ | Already has loading state and `data?.`. |
| **Goals** | ✅ | Already uses `data?.` throughout. |
| **InvestmentOverview** | ✅ | Null-safe `data?.investments` in useMemo; loading state; dependency fix. |
| **InvestmentPlanView** | ✅ | Uses `data?.plannedTrades` / `data?.portfolioUniverse`; has loading UI. |
| **Investments** | ✅ | `data?.` in investmentProgress useMemo and RecordTradeModal goals; loading guard before main return; `investmentAccounts` useMemo null-safe. |
| **Liabilities** | ✅ | Null-safe `data?.accounts` / `data?.liabilities` / `data?.assets`; loading state. |
| **LoginPage** | ✅ | Auth flow; no DataContext. |
| **MarketEvents** | ✅ | Uses `data?.watchlist` / `data?.investments` / `data?.investmentTransactions`. |
| **Notifications** | ✅ | Uses `ctx?.notifications`; loading when `!ctx`. |
| **Plan** | ✅ | Uses `buildHouseholdEngineInputFromPlanData`; processedPlanData from state. |
| **RecoveryPlanView** | ✅ | Uses `data?.investments` / `data?.accounts` / `data?.portfolioUniverse` / `data?.investmentPlan`. |
| **Settings** | ✅ | Nav buttons wired (previous pass). |
| **SignupPage** | ✅ | Auth flow; hash routing (previous pass). |
| **SinkingFunds** | ✅ | Null-safe `(data?.transactions ?? [])` in useMemo; loading guard when `loading \|\| !data` (spinner in card). |
| **StatementHistoryView** | ✅ | `setActivePage`, Upload button; empty-state CTA "Upload statement" when no statements. |
| **StatementUpload** | ✅ | Uses `data?.accounts` / `data?.transactions` / `data?.investmentTransactions`; `PageLoading` for loading state. |
| **Summary** | ✅ | Already has loading and `data?.`. |
| **SystemHealth** | ✅ | No DataContext; self-contained health checks. |
| **Transactions** | ✅ | `setActivePage`, Import button (previous pass); uses `data?.`. |
| **WatchlistView** | ✅ | Null-safe `data?.watchlist?.length` in handlers and button disabled state. |
| **WealthUltraDashboard** | ✅ | Uses `data?.` throughout. |
| **Zakat** | ✅ | `setActivePage` and links (previous pass). |

---

## Services (29)

| Service | Status | Notes |
|---------|--------|--------|
| **advancedRiskScoring** | ✅ | Not imported in app; available for future use. |
| **aiBudgetAutomation** | ✅ | Used by Budgets/AI flows. |
| **benchmarkService** | ✅ | Available for benchmarks. |
| **crossPageIntegration** | ✅ | Page actions / related pages. |
| **demoDataService** | ✅ | Demo data (no Load Demo button in UI). |
| **disciplineScoreEngine** | ✅ | Exports `computeDisciplineScore`; used by Summary. |
| **engineIntegration** | ✅ | Unified context / action queue. |
| **enhancedBudgetEngine** | ✅ | Budget engine. |
| **finnhubService** | ✅ | Exports used by SystemHealth, MarketEvents, WatchlistView, Investments, RecoveryPlanView, PriceAlertModal, useSymbolCompanyName. |
| **geminiService** | ✅ | All AI: summaries, persona, analysis, plans, trades, etc. |
| **goalFundingRouter** | ✅ | Exports `computeGoalFundingPlan`, types; used by Goals. |
| **householdBudgetAnalytics** | ✅ | Exports used by Budgets. |
| **householdBudgetEngine** | ✅ | Exports `HOUSEHOLD_ENGINE_PROFILES`, `generateSaudiBudgetCategories`, `buildHouseholdEngineInputFromPlanData`, etc.; used by Budgets, Plan, Summary. |
| **householdBudgetStress** | ✅ | Exports used by Summary, InvestmentPlanView. |
| **hybridBudgetCategorization** | ✅ | Category definitions. |
| **liquidityRunwayEngine** | ✅ | Exports `computeLiquidityRunwayFromData`; used by Summary. |
| **ocrDocumentParser** | ✅ | Exports `ParsedTransaction`; used by TransactionAIContext. |
| **recoveryPlan** | ✅ | Exports used by RecoveryPlanView. |
| **recoveryPlanPerformance** | ✅ | Exports used by RecoveryPlanView. |
| **riskLaneEngine** | ✅ | Exports `computeRiskLaneFromData`; used by Summary. |
| **scenarioTimelineEngine** | ✅ | Exports `buildBaselineScenarioTimeline`; used by Forecast. |
| **shockDrillEngine** | ✅ | Exports `runShockDrill`, `SHOCK_TEMPLATES`; used by Summary. |
| **sleeveAllocation** | ✅ | Wealth Ultra / allocation. |
| **statementParser** | ✅ | Exports `parseBankStatement`, `parseSMSTransactions`, `parseTradingStatement`, `validateFile`; used by StatementUpload. |
| **supabaseClient** | ✅ | Used app-wide for auth and data. |
| **tradeRanking** | ✅ | Trade scoring. |
| **wealthUltraPerformance** | ✅ | Performance snapshots. |
| **wealthUltraPredictive** | ✅ | Predictive analytics. |
| **zakatTradeAdvisor** | ✅ | Zakat-related advice. |

---

## Summary of fixes (this pass)

- **Null-safety:** `data?.` and `?? []` / `?? 0` added where context `data` is used (Accounts, Liabilities, SinkingFunds, InvestmentOverview, WatchlistView, Assets, Investments, **AIAdvisor**, **Header**).
- **Investments:** All `data.` in PlatformView, InvestmentPlan, and main component useMemos/callbacks updated to `data?.` / `?? []`; loading return before main render; goals/portfolios props use `data?.goals ?? []` and `data?.investments ?? []`.
- **Loading states:** Loading spinner + `aria-busy` / `aria-label` where missing (Accounts, Liabilities, InvestmentOverview, Commodities, Assets, Investments).
- **Components:** **AIAdvisor** – `data?.assets` / `data?.accounts` / `data?.liabilities` / `data?.investments`. **Header** – `data?.accounts` for hasData; `data?.investmentTransactions` and `data?.investmentPlan` in investmentProgress useMemo.
- **Services:** Confirmed exports match imports (householdBudgetEngine, goalFundingRouter, scenarioTimelineEngine, recoveryPlan, recoveryPlanPerformance, riskLaneEngine, liquidityRunwayEngine, disciplineScoreEngine, shockDrillEngine, etc.).
- **Router:** All 26 `Page` values from `types.ts` are present in `App.tsx` (VALID_PAGES + renderPage switch); default falls back to Dashboard.

`npm run typecheck` passes after all changes.

---

## Verification checklist

- [x] Every page under `pages/` is in `types.ts` `Page` and in `App.tsx` (VALID_PAGES + renderPage).
- [x] All `data.` usages in pages and in DataContext-consuming components (AIAdvisor, Header) use `data?.` or run after a `!data` guard.
- [x] Loading states where needed: Accounts, Liabilities, Assets, Commodities, InvestmentOverview, Investments, Dashboard, Summary, Forecast, Analysis, Zakat (per page design).
- [x] Services: all imported symbols exist in the corresponding service files.
- [x] No remaining unsafe `data.` in Investments (PlatformView, InvestmentPlan, main component useMemos and JSX).

---

## Components & shared UI (this pass)

- **PageLoading** – New shared component: `ariaLabel`, optional `message`, `minHeight`; used for full-page/section loading (e.g. StatementUpload, MarketEvents). Use where `loading || !data` to avoid duplicated spinner markup.
- **LoadingSpinner** – Optional `ariaLabel` prop for accessibility; `aria-busy` and `role="status"` when label provided.
- **Layout** – `<main>` has `aria-label="Main content"`; Skip to main content link present.
- **Modal** – Focus trap (Tab), Escape to close, focus restore on close.
- **CommandPalette** – Export uses `data ?? {}` when data is null.

---

## Service → consumer map (all 29 services)

| Service | Consumed by |
|---------|-------------|
| **supabaseClient** | AuthContext, DataContext, NotificationsContext, LoginPage, SignupPage, Accounts, Dashboard, Summary, Transactions, Budgets, SystemHealth, StatementProcessingContext |
| **geminiService** | Dashboard, Summary, AIAdvisor, TransactionReviewModal, Investments, RecoveryPlanView, InvestmentOverview, DividendTrackerView, WatchlistView, AIRebalancerView, Goals, LiveAdvisorModal, AIFeed, Assets, Commodities, MarketSimulator, SystemHealth, StatementProcessingContext, TransactionAIContext (ocr types) |
| **finnhubService** | SystemHealth, MarketEvents, WatchlistView, Investments, RecoveryPlanView, PriceAlertModal, useSymbolCompanyName |
| **statementParser** | StatementUpload |
| **householdBudgetEngine** | Budgets, Plan, Summary |
| **householdBudgetStress** | Summary, InvestmentPlanView |
| **householdBudgetAnalytics** | Budgets |
| **goalFundingRouter** | Goals |
| **scenarioTimelineEngine** | Forecast |
| **riskLaneEngine** | Summary (uses wealthUltraPerformance) |
| **liquidityRunwayEngine** | Summary (uses wealthUltraPerformance) |
| **disciplineScoreEngine** | Summary |
| **shockDrillEngine** | Summary |
| **recoveryPlan** | RecoveryPlanView |
| **recoveryPlanPerformance** | RecoveryPlanView |
| **ocrDocumentParser** | TransactionAIContext (types only) |
| **wealthUltraPerformance** | riskLaneEngine, liquidityRunwayEngine (service-to-service) |
| **advancedRiskScoring** | sleeveAllocation, tradeRanking (service-to-service) |
| **sleeveAllocation** | engineIntegration re-exports |
| **tradeRanking** | engineIntegration re-exports |
| **enhancedBudgetEngine** | engineIntegration (service-to-service) |
| **hybridBudgetCategorization** | engineIntegration (service-to-service) |
| **engineIntegration** | No direct app import; re-exports used by other services. |
| **demoDataService** | DataContext (loadDemoData); no UI button. |
| **aiBudgetAutomation** | Not directly imported in app (docs). |
| **crossPageIntegration** | Not directly imported in app (docs). |
| **benchmarkService** | Not directly imported in app (docs). |
| **wealthUltraPredictive** | Not directly imported in app (docs). |
| **zakatTradeAdvisor** | Not directly imported in app (docs). |
