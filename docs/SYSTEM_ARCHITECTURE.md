# System architecture — layered wealth system

**See also:** [PAGES_SERVICES_WIRING.md](./PAGES_SERVICES_WIRING.md) — hash routing, provider tree, each `Page` → props → contexts and services. [FULL_UI_SECTIONS_WIRING.md](./FULL_UI_SECTIONS_WIRING.md) — per-page sections/cards and data sources.

The system is structured in four layers so that **data**, **logic**, **output**, and **automation** stay separated and maintainable.

---

## A. Data layer

**Role:** Store and serve canonical entities. No business formulas here.

| Store | Where | Notes |
|-------|--------|--------|
| **accounts** | Supabase `accounts` | DataContext `fetchData` |
| **transactions** | Supabase `transactions` | Optional `note` (splits); realtime subs |
| **holdings** | Supabase `holdings` (under `investment_portfolios`) | Per-portfolio |
| **prices** | MarketDataContext, Finnhub, simulated | Session + optional persistence |
| **FX** | CurrencyContext, InvestmentPlanSettings `fxRateUpdatedAt` | SAR/USD rate; staleness in dataQuality |
| **goals** | Supabase `goals` | DataContext |
| **liabilities** | Supabase `liabilities` | DataContext |
| **rules** | Supabase `settings`, `trading_policy` (tradingPolicy), budget rules | Config + UI-editable |
| **snapshots** | `netWorthSnapshot.ts` (localStorage), `wealthUltraPerformance` (localStorage) | No DB yet; optional future table |
| **alerts** | Supabase `price_alerts`, Notifications (in-app) | DataContext + NotificationsContext |
| **journals** | FinancialJournal page (localStorage) | Local only |
| **forecasts** | ScenarioTimelineEngine output, Forecast page | Derived, not stored long-term |

---

## B. Logic layer

**Role:** Formulas, decision rules, scoring, validations, triggers, classification, scenario engines. No UI.

| Area | Services / modules |
|------|--------------------|
| **Formulas** | `financeMetrics.ts`, `goalMetrics.ts`, `liabilityMetrics.ts`, `portfolioMetrics.ts`, `portfolioXirr.ts`, `portfolioAttribution.ts`, `liquidNetWorth.ts`, `netWorthPeriodFlows.ts` |
| **Decision rules** | `decisionEngine.ts` (buy/sell scores), `tradingPolicy.ts`, `goalFundingRouter.ts`, `goalWaterfall.ts` |
| **Scoring** | `decisionEngine.ts`, `advancedRiskScoring.ts`, `disciplineScoreEngine.ts`, `sleeveAllocation.ts` |
| **Validations** | `dataQuality/transactionQuality.ts`, `transactionFilters.ts`, `transactionIntelligence.ts` (validateSplitTotal) |
| **Triggers** | NotificationsContext (alerts from data quality, goals, runway, salary coverage) |
| **Reallocation rules** | `goalFundingRouter.ts`, `sleeveAllocation.ts`, `tradingPolicy.ts` |
| **Classification** | `transactionFilters.ts`, `transactionIntelligence.ts`, `hybridBudgetCategorization.ts` (classifyTransaction) |
| **Scenario engines** | `scenarioTimelineEngine.ts`, `stressScenario.ts`, `shockDrillEngine.ts`, `householdBudgetStress.ts` |
| **Cash / liquidity** | `financeMetrics.ts`, `liquidNetWorth.ts`, `liquidityRunwayEngine.ts`, `cashAllocationEngine.ts` |
| **Debt** | `liabilityMetrics.ts`, `debtEngines.ts` |
| **FX** | `fxEngine.ts` |
| **Return measurement** | `returnMeasurementEngine.ts` |
| **Goal conflict** | `goalConflictEngine.ts` |
| **Reconciliation** | `reconciliationEngine.ts` |
| **Exception handling** | `exceptionHandlingEngine.ts` |
| **Fee/tax/obligation** | Removed (user preference); Zakat stays on Zakat page |
| **Strategy comparison** | `strategyComparisonEngine.ts` |
| **Thesis/journal** | `thesisJournalEngine.ts` |
| **Decision scoring** | `decisionScoringEngine.ts` |
| **Next-best-action & explainability** | `nextBestActionEngine.ts`, `explainabilityEngine.ts` |

---

## C. Output layer

**Role:** Dashboards, summaries, alerts, recommendations, review pages, action items, forecasts, reports.

| Output | Where |
|--------|--------|
| **Dashboards** | Dashboard page, WealthUltraDashboard, DataVisualizationContext widgets |
| **Summaries** | Summary page, Investment overview |
| **Alerts** | Notifications page, NotificationsContext |
| **Decision recommendations** | Investments RecordTradeModal (buy/sell policy), Settings rankCapitalUses, Watchlist rankWatchlistIdeas |
| **Review pages** | Goals, Analysis, Risk & Trading Hub, **Logic & Engines** (spec engines surfaced), Liquidation Planner, Dividend Tracker |
| **Action items** | Notifications, next-best-action (Dashboard), financial health score (Dashboard) |
| **Forecasts** | Forecast page, scenarioTimelineEngine |
| **Reports** | Settings “Reports & export” (monthly report, goal status, portfolio review); reportingEngine |
| **Goal conflict & feasibility** | Goals page SectionCard |
| **Debt intelligence** | Liabilities page (payoff order, stress score) |

---

## D. Automation layer

**Role:** Imports, sync, refresh, recurring posting, scheduled snapshots, watchlist scans, data cleanup, backup.

| Capability | Where | Status |
|------------|--------|--------|
| **Imports** | StatementUpload, StatementProcessingContext, statementParser, ocrDocumentParser | Manual upload; no scheduled import |
| **Sync** | DataContext `fetchData` on auth; OfflineContext `syncPendingActions` on reconnect | On-demand + offline replay |
| **Refresh** | MarketDataContext `refreshPrices` | User/event-triggered; no fixed interval |
| **Recurring posting** | DataContext `applyRecurringForMonth`, `applyRecurringDueToday` | Manual “apply”; no cron |
| **Scheduled snapshots** | `pushNetWorthSnapshot` from Dashboard (admin) | Manual; no schedule |
| **Email summaries** | Settings `enableEmails` | Flag only; no sending implemented |
| **Watchlist scans** | WatchlistView, decisionEngine rankWatchlistIdeas | On page load / user trigger |
| **Data cleanup** | dataQuality (dupes, reconciliation) | On-demand |
| **Backup** | Settings “Backup” copy; no restore flow | Partial |

**Principle:** Automation should be added behind this layer (e.g. cron jobs, serverless functions) without putting business logic in the automation layer itself.

---

## Cross-cutting

- **Auth:** AuthContext (Supabase).
- **Privacy:** PrivacyContext (mask balances).
- **AI:** Gemini service for narrative/categorization; rules remain source of truth for numbers.

When adding features, place them in the correct layer and reference this doc.
