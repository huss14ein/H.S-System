# Full UI sections & cards — data wiring reference

This document is a **page-by-page inventory** of major UI blocks (cards, `SectionCard`s, tabs, collapsible regions) and **where their numbers come from**. It complements **[PAGES_SERVICES_WIRING.md](./PAGES_SERVICES_WIRING.md)** (routing, providers, cross-page actions).

**How to use:** When verifying that a screen “shows the right thing,” find the page here, then trace the listed **data source** to `DataContext`, services, or (for Journal) browser storage.

---

## Conventions (apply everywhere)

| Topic | Rule |
|--------|------|
| **Personal scope** | Prefer `personalTransactions`, `personalAccounts`, `personalInvestments` (or `d?.personalX ?? data?.x`) when the product copy implies “my” wealth or cashflow. |
| **Cashflow KPIs** | Income/expense inclusion uses **`services/transactionFilters`** (`countsAsIncomeForCashflowKpi`, `countsAsExpenseForCashflowKpi`). Internal **Transfer** rows are excluded from income-style KPIs where documented. |
| **Currency** | Display formatting uses **`CurrencyContext`** / `useFormatCurrency`; cross-asset totals often use **`toSAR`** / `getAllInvestmentsValueInSAR` with `exchangeRate`. |
| **Embedded vs route** | Same component (e.g. `DividendTrackerView`) should receive the **same optional navigation props** (`setActivePage`) whether opened from **Investments** tab or a top-level **`App`** route. |
| **Truth vs health checks** | **`SystemHealth`** probes APIs and can run reconciliation helpers—it does not define portfolio truth; user data still comes from **`DataContext`**. |

---

## Auth (no `FinancialData`)

| Page / file | Sections | Data |
|-------------|----------|------|
| **Login**, **Signup**, **Pending approval** | Forms, status messages | **`AuthContext`** / Supabase session only |

---

## Dashboard (`pages/Dashboard.tsx`)

| Block | Data / notes |
|-------|----------------|
| **Financial health score** banner | `personalFinanceHealthScore` + related inputs from `data` |
| **Draggable KPI grid** (`KPI_CARD_ORDER`) | `useMemo` on `data` + `exchangeRate`: net worth (`computePersonalNetWorthSAR`), monthly P&L (`personalTransactions` + cashflow filters), emergency fund (`useEmergencyFund`), budget variance, investment ROI, investment plan progress, static navigation tiles for Wealth Ultra / Market Events |
| **Next best actions** (when engine returns actions) | `generateNextBestActions` / `useFinancialEnginesIntegration` |
| **Cash & emergency fund** card | Projected cash, `useEmergencyFund`, privacy mask |
| **`AIFeed`** | Engine feed from integration hook |
| **Net worth composition** (admin) | `NetWorthCompositionChart` — personal aggregates; non-admin sees restriction copy |
| **Monthly cash flow** chart | 12-month series from personal transactions |
| **Investment allocation & performance** | `PerformanceTreemap` from personal holdings |
| **Accounts overview** | `personalAccounts ?? accounts` → list + navigate to Accounts |
| **Upcoming bills** | Recurring **fixed** expenses from personal tx (`countsAsExpenseForCashflowKpi` + `transactionNature === 'Fixed'`) |
| **Budget health** | Monthly budget rollups vs limits |
| **Recent transactions** | Recent personal transactions |
| **Quick next steps** | Navigation buttons only |
| **`AIExecutiveSummary`** | `getAIExecutiveSummary(data)` via Gemini |
| **`TransactionReviewModal`** | Uncategorized transactions + budget category names from `data.budgets` |

---

## Summary (`pages/Summary.tsx`)

| Block | Data |
|-------|------|
| **My Net Worth** card (admin) | Personal net worth + trend; managed wealth line when applicable |
| **Non-admin net worth** | Restriction copy |
| **Four metric cards** | Monthly income/expense, savings rate, emergency fund — same family of metrics as Dashboard |
| **Liquid net worth (simplified)** (`CollapsibleSection`) | `computeLiquidNetWorth` breakdown: cash, investments, commodities, receivables, debt, ~30d cashflow estimate |
| **Net worth change vs flows** (admin) | Local net worth snapshots from Dashboard visits; link to Safety & rules |
| **Historical net worth** | `NetWorthCompositionChart` (admin) |
| **Investment allocation & performance** | `PerformanceTreemap` from holdings |
| **Household cashflow stress** | Household engine output when present |
| **Risk lane / Liquidity runway / Discipline** | `computeRiskLaneFromData`, `computeLiquidityRunwayFromData`, discipline scoring |
| **Shock drill** | `runShockDrill` + default template |
| **Financial Advisor** | `getAIFinancialPersona` — persona + report card |
| **Page actions** | Export/print wealth summary, navigate to Wealth Ultra, Market Events, Assets, etc. |

---

## Accounts (`pages/Accounts.tsx`)

| Block | Data |
|-------|------|
| **Summary row** | `Card`s: total cash (Checking+Savings), total credit, total investment platform value |
| **Emergency fund** | `useEmergencyFund` + link to Summary |
| **Share account** (admin) | `data.accounts`, shareable users, Supabase share RPCs |
| **Transfer between accounts** | Tabs **Scheduled** \| **History**; `addTransfer`, recurring CRUD |
| **Account grid** | Per-account `AccountCardComponent`: balance, type, linked portfolios, cash reconciliation warning (`reconcileCashAccountBalance` pattern) |
| **Modals** | Add/edit account, transfer, recurring transfer, delete confirm |

---

## Transactions (`pages/Transactions.tsx`)

| Block | Data |
|-------|------|
| **Filters & table** | `data.transactions` (+ shared-budget rules from `DataContext`) |
| **Cashflow KPIs** | `transactionFilters` for income/expense inclusion |
| **Charts** | Aggregations on filtered set |
| **Add/edit modal** | Categories from budgets + static lists; AI suggest via `getAICategorySuggestion` + `matchToAllowedCategory` |
| **`pageAction`** | Can focus flows / open modals per `App` wiring |

---

## Budgets (`pages/Budgets.tsx`)

Major **`SectionCard`** regions (exact order varies with feature flags):

| Section | Purpose |
|---------|---------|
| Budget requests | Search & filters |
| Budget Intelligence | Portfolio / spend / attention |
| Recurring bills & price benchmarks | Bills, benchmarks |
| Cashflow signals | Household & budget engines |
| Household Budget Engine | Full household tab |
| Budget sharing | Shared budgets |
| Admin: Approved budgets & shared account tracking | Admin |
| Shared Budget Transactions | Shared tx |

Underlying data: **`data.budgets`**, personal transactions for spend, RPC-backed shared budget state.

---

## Goals (`pages/Goals.tsx`)

| Section | Data |
|---------|------|
| Weak cashflow alert | Optional `SectionCard` when runway logic triggers |
| Overall goal progress | Aggregates over `data.goals` |
| Savings allocation strategy | Goal allocation UI |
| (Additional goal rows / charts) | `goalMetrics`, Monte Carlo helpers per imports |

---

## Liabilities (`pages/Liabilities.tsx`)

| Section | Data |
|---------|------|
| Debt intelligence | Payoff order, stress (`debtEngines` / `liabilityMetrics`) |
| What I Owe | Liability rows |
| What I'm Owed | Receivables |

---

## Plan (`pages/Plan.tsx`)

| Area | Data |
|------|------|
| **Sub-pages** | **Plan overview** vs **Salary & Planning Experts** (`SalaryPlanningExperts`) |
| **Year** control | Calendar year selector; actuals filtered by year |
| **Fed from** strip | Navigation buttons to Accounts, Budgets, Transactions, Goals, Liabilities, Investment Plan, Forecast |
| **Household intelligence** | Dynamic baselines, predictive spend, cashflow stress — from household engine + transactions/budgets |
| **Liquid cash / Total debt** cards | Accounts (Checking+Savings sum), Liabilities (sum of \|amount\| excluding Receivable type) |
| **Executive summary metrics** | Projected surplus, actual net YTD, variance — plan vs transactions |
| **(Further sections)** | Category breakdowns, goals, investment plan ties — all from `DataContext` + plan helpers |

**Embedded:** **`SinkingFunds`** appears in Plan flow; fed from **`DataContext`** (sinking fund entities).

---

## Forecast (`pages/Forecast.tsx`)

| Block | Data |
|-------|------|
| **Forecast methodology** | `CollapsibleSection` — explanatory copy |
| **Forecast assumptions** | `SectionCard`: presets, horizon, monthly savings, growth rates, Run — uses personal net worth baseline + savings analytics from history |
| **Uncertainty band** | Heuristic band |
| **Projection chart** | Net worth & investments series |
| **Results** | Post-run summary |
| **Scenario comparison** | Conservative / Base / Aggressive |
| **Goal outlook** | Threshold-style checks vs goals |
| **Scenario timeline** | Narrative years |

---

## Analysis (`pages/Analysis.tsx`)

| Section | Data |
|---------|------|
| Salary vs expense coverage | `salaryToExpenseCoverage` / related |
| Spend intelligence | Subscriptions, patterns (`subscriptionSpendMonthly`, etc.) |
| Possible refund pairs | Duplicate detection heuristics |
| Spending by budget category | Chart on categorized spend |
| Monthly income vs expense | Chart |
| Current financial position | Net worth composition |

---

## Zakat (`pages/Zakat.tsx`)

| Section | Data |
|---------|------|
| Zakatable assets | Cash, investments, receivables from `data` |
| Deductible liabilities | Debts |
| Calculation | Zakat due |

---

## Notifications (`pages/Notifications.tsx`)

| Block | Data |
|-------|------|
| **Notifications** `SectionCard` | **`NotificationsContext`** + filters; admin paths may reference broader data |

---

## Settings (`pages/Settings.tsx`)

Layout: custom **`page-container`** (not `PageLayout`) with a **hero** strip and **in-page anchor nav** (`#settings-snapshot`, `#user-profile`, …). Props from `App`: optional **`setActivePage`**, **`triggerPageAction`** (opens Investments → Safety & rules from trading policy).

**Global wiring:** `DataContext` — `data`, `loading`, **`updateSettings`**, **`restoreFromBackup`**; `AuthContext`; `useCurrency` (`exchangeRate` for wealth summary payload); `useEmergencyFund(data)`; `usePrivacyMask`; `useToast`. Admin-only: Supabase `users` table + RPCs **`approve_signup_user`**, **`reject_signup_user`**.

---

### Hero (top `section-card`)

| Element | Purpose |
|---------|---------|
| Title + intro copy | Static |
| **Anchor nav** | Jumps to listed section `id`s (Snapshot, Profile, Financial, Parameters, …). **`user-approvals`** is not in this list — admins scroll to it or add `#user-approvals` manually. |
| Help blurb | Static |

---

### `settings-snapshot` — Settings Snapshot

| Control | Persists | Data source |
|---------|----------|-------------|
| Read-only **SnapCards**: Risk profile, Budget alert %, Drift %, Email summary on/off | — | **`localSettings`** mirroring `data.settings` |

---

### `user-profile` — User Profile

| Control | Persists | Data source |
|---------|----------|-------------|
| **Email** | — | `auth.user?.email` |
| **User ID** | — | `auth.user?.id` |

---

### `user-approvals` — User Approvals *(admin only)*

| Control | Persists | Data source |
|---------|----------|-------------|
| List of pending signups | — | Supabase `users` where `approved = false` |
| **Approve** / **Reject** | DB | RPCs `approve_signup_user`, `reject_signup_user` |

---

### `financial-preferences` — Financial Preferences

| Control | Persists | Data source / notes |
|---------|----------|---------------------|
| **Quick presets** (conservative / moderate / aggressive) | `data.settings` via **`updateSettings`** | `FINANCIAL_PREFERENCE_PRESETS` → `riskProfile`, `budgetThreshold`, `driftThreshold` |
| **Investment risk profile** (3 buttons) | `settings.riskProfile` | `handleSettingChange('riskProfile', …)` |
| **Budget alert threshold** (slider 0–100%) | `settings.budgetThreshold` | |
| **Portfolio drift threshold** (slider 0–20%) | `settings.driftThreshold` | |
| **Gold price (SAR/gram)** | `settings.goldPrice` | Used for Zakat Nisab; blur validation before `updateSettings` |
| **Nisab amount override (SAR)** | `settings.nisabAmount` optional | Empty = auto gold×85 |
| **Mask balances** | Device | **`PrivacyContext`** `maskSensitive` / `setMaskSensitive` — not Supabase |
| **Notification sound** | Device | **`PrivacyContext`** `playNotificationSound` — Web Audio beep preference |

---

### `default-parameters` — Enhanced Default Parameters

| Element | Data source |
|---------|-------------|
| **ParamCards** (FX, monthly deposit, cash reserve %, max per ticker, sleeve targets, trailing stop, risk weights, …) | **`defaultWealthUltra`** = `getDefaultWealthUltraConfig()` merged with **`data.wealthUltraConfig`** (Supabase / user row as described in UI copy) |
| **Copy config (JSON)** | Clipboard — current merged object |
| **Investment Plan** / **Open Wealth Ultra** | Navigation only — `setActivePage` |

---

### `decision-preview` — Decision preview (rules)

| Control | Persists | Data source |
|---------|----------|-------------|
| **Windfall / lump sum (SAR)** | Local React state only | Drives **`rankCapitalUses`** from `decisionEngine` |
| Ranked allocation list | — | Output of `rankCapitalUses(capitalPreviewAmount)` |
| **Max / Current position %**, **Drift from target %** sliders | Local state | **`buyScore`** preview with **`ef.monthsCovered`** from `useEmergencyFund` |

*(Does not write to `data.settings`.)*

---

### `trading-policy` — Trading policy (this device)

| Control | Persists | Data source |
|---------|----------|-------------|
| **Presets** | `localStorage` (debounced) | **`loadTradingPolicy` / `saveTradingPolicy`** — `services/tradingPolicy` |
| **Min runway (months) to allow buys** | same | `TradingPolicy` fields |
| **Max position weight after buy (%)** | same | |
| **Ack large sell over (SAR)** | same | |
| **Block buys if last-30d net cashflow negative** | same | |
| **Save policy** | Immediate save + toast | `saveTradingPolicy` |
| **Reset defaults** | same | `DEFAULT_TRADING_POLICY` |
| **Safety & rules** | Navigation | `triggerPageAction('Investments', 'openRiskTradingHub')` or `setActivePage('Investments')` |

Auto-save: **~1.5s debounce** on `tradingPolicyLocal` changes.

---

### `notifications` — Notifications

| Control | Persists | Data source |
|---------|----------|-------------|
| **Weekly email reports** toggle | `settings.enableEmails` | **`handleSettingChange('enableEmails', …)`** |

---

### `activity-log` — Activity log (this device)

| Control | Persists | Data source |
|---------|----------|-------------|
| Search, entity filter, Refresh | — | **`getAuditLog`** from `services/auditLog` — **browser-local** audit store |
| **Export CSV** | Download | `exportAuditLogAsCsv` |
| **Clear log** | Clears local store | `clearAuditLog()` |

Refresh also runs when **`data.transactions.length`** changes (effect dependency).

---

### `reports-export` — Reports & export

| Button | Output | Data / service |
|--------|--------|----------------|
| **Wealth summary** JSON / CSV / Print HTML | File or print | **`generateWealthSummaryReportJson/Csv/Html`** — payload from **`wealthSummaryPayload`** `useMemo`: `computePersonalNetWorthBreakdownSAR`, `personalTransactions`, `netCashFlowForMonth`, personal accounts/investments, `ef`, `localSettings.riskProfile` |
| **Monthly report (JSON)** | Download | **`generateMonthlyReport`** — current month label, liquid cash from checking/savings, `netCashFlowForMonth` on personal txs |
| **Goal status (CSV)** | Download | **`exportGoalStatus`** — `data.goals` |
| **Portfolio review (CSV)** | Download | **`exportPortfolioReview`** — positions from **`personalInvestments`** flattened holdings |

---

### `data-management` — Data Management

| Control | Persists | Data source |
|---------|----------|-------------|
| **Export full backup (JSON)** | User file | **`JSON.stringify(data)`** — full `FinancialData` snapshot from context |
| **Import from backup** | Replaces app data | **`restoreFromBackup(backup)`** — `DataContext`; confirm dialog |
| **Import from statements** | Navigate | `setActivePage('Statement Upload')` |
| Empty state CTA | Navigate | `Accounts`, `Statement Upload` |

**`hasData`:** true when **`personalAccounts ?? accounts`** has length &gt; 0.

---

## Investments hub (`pages/Investments.tsx`)

**Tabs** (`InvestmentSubPage`): Overview · Portfolios · Investment Plan · Safety & rules · Recovery Plan · Watchlist · AI Rebalancer · Dividend Tracker · Execution History.

| Tab | Component | Data |
|-----|-----------|------|
| Overview | `InvestmentOverview` | `personalInvestments`, `exchangeRate`, allocation + AI |
| Portfolios | `PlatformView` | Portfolios, holdings, `MarketDataContext` prices |
| Investment Plan | Inner `InvestmentPlan` | `investmentPlan`, trades |
| Safety & rules | `RiskTradingHub` | Policies, runway, snapshots — **`SectionCard`** list (see below) |
| Recovery Plan | `RecoveryPlanView` | Recovery services + `onOpenWealthUltra` |
| AI Rebalancer | `AIRebalancerView` | Portfolios, `portfolioConstruction`, Gemini plan |
| Watchlist | `WatchlistView` | Watchlist + quotes + AI |
| Dividend Tracker | `DividendTrackerView` | **`setActivePage` must be passed when embedded** |
| Execution History | `ExecutionHistoryView` | Execution logs |

### Risk Trading Hub (`pages/RiskTradingHub.tsx`) — section titles

- Months of expenses covered  
- Buy readiness  
- Your safety rules  
- Portfolio return (simplified)  
- Why did net worth change?  
- Net worth snapshots  
- Review cadence  

### Investment Overview (`pages/InvestmentOverview.tsx`)

- Holdings gains (SAR-normalized), asset class and portfolio allocation pies/bars  
- Diversification heuristics  
- AI investment overview (`getAIInvestmentOverviewAnalysis`)

### AI Rebalancer (`pages/AIRebalancerView.tsx`)

- Custom gradient layout (not always `SectionCard`): portfolio picker, risk profile, target mix, MVO demo, current allocation chart, AI plan markdown  

### Watchlist (`pages/WatchlistView.tsx`)

- Buckets, symbols, live prices (`MarketDataContext`), technical indicators, AI watchlist advice, price alerts  

---

## Top-level routes mirroring Investment tabs

| Page | Notes |
|------|--------|
| **Investment Plan** (`InvestmentPlanView.tsx`) | Full-page plan: health check `SectionCard`, AI rebalance candidates, plan vs AI alignment, investment plans list — **`PageLayout`**; uses `triggerPageAction` where wired |
| **Dividend Tracker** (`DividendTrackerView.tsx`) | Dividend YTD, charts, projected income, MWRR, AI — uses `personalAccounts` / `personalInvestments` for scoping |
| **AI Rebalancer** | Same as tab |
| **Watchlist** | Same as tab |

---

## Wealth Ultra (`pages/WealthUltraDashboard.tsx`)

**`SectionCard`** titles (engine UI):

1. Wealth Ultra Engine  
2. *(KPI strip: Total portfolio value, Deployable cash, Planned buys, Cash plan)*  
3. Alerts & Recommendations  
4. Engine Intelligence & Decision Summary  
5. Sleeve Allocation & Drift Analysis  
6. Generated Orders  
7. Next Move — Monthly Deployment  
8. Speculative Sleeve Status  
9. All Positions  
10. Top Gainers / Top Losers  
11. Capital Efficiency Ranking  
12. Exception History  
13. Risk Distribution  

Data: **`data`** (personal investments, plan, config), **`wealthUltraConfig`**, **`CurrencyContext`**, **`MarketDataContext`**, modules under `wealth-ultra/`.

---

## Market Events (`pages/MarketEvents.tsx`)

| Block | Data |
|-------|------|
| **Filters** | View calendar/list, search, category, impact, toggles |
| **Summary stats** | Counts from merged event list |
| **Calendar or List** | Earnings, dividends, macro, holidays — Finnhub + holdings/watchlist derived events |

---

## Assets & Commodities (`pages/Assets.tsx`)

| Section | Data |
|---------|------|
| Physical assets | `SectionCard` — property, vehicles, etc. |
| Commodities (metals & crypto) | Holdings list + CRUD |

**Route `Commodities`:** Renders **`Assets`** with identical props (commodities live inside Assets).

---

## Statement Upload (`pages/StatementUpload.tsx`)

| Tab | Section | Data |
|-----|---------|------|
| **Bank** | Upload bank statement | `SectionCard`; accounts from `data`; **`StatementProcessingContext`** pipeline |
| **SMS** | Paste SMS | SMS parser flow |
| **Trading** | Trading file upload | Trading import |

Action: **View History** → `Statement History`.

---

## Statement History (`pages/StatementHistoryView.tsx`)

| Block | Data |
|-------|------|
| **Statement History** | Past uploads, filters — `DataContext` + statement metadata |

---

## Engines & Tools (`pages/EnginesAndToolsHub.tsx`)

| Tab | Component | Data |
|-----|-----------|------|
| Logic & Engines (`Behind the numbers`) | `LogicEnginesHub` | `useFinancialEnginesIntegration` |
| Liquidation | `LiquidationPlanner` | Theses + holdings; `dataTick` refresh |
| Journal | `FinancialJournal` | **localStorage** + `dataTick` on visibility |

**`pageAction`:** `openLogic`, `openLiquidation`, `openJournal` map to tabs.

---

## Financial Journal (`pages/FinancialJournal.tsx`)

| Section | Storage |
|---------|---------|
| Add an investment idea | localStorage / thesis engine |
| Quick note | Notes |
| Your saved ideas | Saved theses |
| Note history | History |

Not persisted in Supabase by default.

---

## System & APIs Health (`pages/SystemHealth.tsx`)

| Area | Purpose |
|------|---------|
| Service status list | Supabase auth/DB ping, Gemini `invokeAI`, Finnhub, etc. |
| Market status / holidays | `finnhubService` |
| Incidents | localStorage log |
| Reconciliation tools | `reconcileCashAccountBalance`, `reconcileHoldings`, integrity validators — **diagnostic**, not primary UI truth |

---

## Standalone / misc

| Page | Notes |
|------|--------|
| **Recovery Plan** | Same as Investments tab; `RecoveryPlanView` |
| **Execution History** (route) | Same `ExecutionHistoryView` as tab |

---

## Shared components

Charts (`NetWorthCompositionChart`, `PerformanceTreemap`, `CashflowChart`, etc.) receive **arrays or aggregates built in the parent page**—always trace the **parent** in this doc or in **[PAGES_SERVICES_WIRING.md §7](./PAGES_SERVICES_WIRING.md)**.

---

## Verification

- **Compile-time:** `npm run typecheck`, `lint`, `test:unit`, `build`.  
- **Semantic:** Spot-check that the **same filters** (personal scope + `transactionFilters`) are used for KPIs and charts on a given page.  
- **Manual:** Cross-check Dashboard vs Summary net worth definitions when both show “personal” wealth.

---

*Last expanded: comprehensive pass over major `pages/*.tsx` section markers. If a subsection is missing, search the page file for `SectionCard`, `PageLayout`, or `section-card`.*
