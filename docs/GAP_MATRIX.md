# Finova gap matrix

**Purpose:** Map the “good → great” product spec to **what exists today** (file pointers) vs **missing work**.  
**Companion:** [`GAP_IMPLEMENTATION_TODOS.md`](./GAP_IMPLEMENTATION_TODOS.md) — phased checklist.  
**Related:** [`FEATURES.md`](../FEATURES.md) — shipped capabilities.

**Columns**

| Column | Meaning |
|--------|---------|
| **Feature** | Desired capability |
| **Exists (files / notes)** | Where something related ships (may be partial) |
| **Missing work** | Gaps to close for full spec |

---

## §1 Core money management

| Feature | Exists (files / notes) | Missing work |
|---------|------------------------|--------------|
| Income types (salary, bonus, side, dividends, rental, one-off) | `pages/Transactions.tsx`, recurring tx, `pages/DividendTrackerView.tsx` | Structured income taxonomy; recurring vs one-off; expected vs actual; **income stability score** |
| Expense taxonomy (fixed/variable/annual, debt, subs, lifestyle, travel) | `pages/Budgets.tsx`, `services/enhancedBudgetEngine.ts`, `services/hybridBudgetCategorization.ts` | BNPL/family support/installments as first-class; unified **expense drift** + unusual spend |
| Needs / wants / obligations | Core/Discretionary on transactions & hybrid categories | Obligation vs want across all spend reports |
| Normalized monthly expense | `hooks/useEmergencyFund.ts`, `services/householdBudgetEngine.ts` | Single exported `normalizedMonthlyExpense()` used app-wide |
| Budget variance | `context/NotificationsContext.tsx` | Central variance API + baseline drift |
| Net / free cash flow | `pages/Dashboard.tsx`, `pages/Summary.tsx`, `pages/Plan.tsx` | `services/cashFlowEngine.ts`: `netCashFlow()`, `freeCashFlow()` |
| Cash runway | `context/NotificationsContext.tsx`, `services/liquidityRunwayEngine.ts` | Dedupe formulas; `cashRunwayMonths()`; mandatory outflow forecast; **deficit months** |
| Salary-to-expense coverage | Implicit in summaries | Explicit ratio + alerts |
| “Can I invest?” / untouchable cash | `wealth-ultra/`, `hooks/useEmergencyFund.ts`, household buckets | One orchestrated **capital deployment** answer |
| Liquidity pressure score | Runway + EF metrics | Unified score + dashboard |

---

## §2 Net worth & balance sheet

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Assets stack | `pages/Accounts.tsx`, `pages/Assets.tsx`, `utils/wealthScope.ts`, `context/DataContext.tsx` | — |
| Liabilities | `pages/Liabilities.tsx`, Credit accounts | BNPL as structured liability |
| NW trend | `pages/Summary.tsx`, `pages/Dashboard.tsx` | **Contribution vs market** decomposition |
| Liquid / invested / debt-adjusted NW | Partial | `liquidNetWorth()`, explicit APIs |
| Allocation % / concentration | `pages/AIRebalancerView.tsx`, `pages/DividendTrackerView.tsx`, `wealth-ultra/` | Single balance-sheet allocation view |
| Leverage / debt service | Debt-to-asset on Summary | `debtServiceRatio()`, `liquidityRatio()` |

---

## §3 Goals & funding

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Goal CRUD + priority | `pages/Goals.tsx`, `types.ts` | Funding rule, linked account, inflation-adjusted target, contribution mode |
| Required $ / gap / on-track | `pages/Plan.tsx`, `services/goalFundingRouter.ts` | Exported `requiredMonthlyContribution()`, `goalFundingGap()` |
| Waterfall / surplus redirect | `services/householdBudgetEngine.ts`, `goalFundingRouter.ts` | Auto redirect when goal completes; pause low-priority on weak CF; bonus rules |
| Monte Carlo | `services/portfolioConstruction.ts` → Goals | — |
| APIs | Partial | `reallocateGoalContribution()`, `prioritizeGoals()` + UI |

---

## §4 Investment & trading intelligence

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Holdings, P/L, dividends | `pages/Investments.tsx`, dividend tracker | Central WAC; fees in math |
| XIRR / MWRR / TWRR | — | `xirrReturn()` etc. |
| Total return incl. dividends | Partial UI | `dividendAdjustedReturn()`, yield on cost |
| Break-even | — | `breakEvenPrice()` |
| Drift / rebalance | `services/sleeveAllocation.ts`, `wealth-ultra/`, `pages/AIRebalancerView.tsx` | Unified `allocationDrift()`, `rebalanceSuggestion()` |
| Exposure | Watchlist, Ultra, dividends | `exposureBySector()`, `exposureByCurrency()`, `concentrationScore()` |
| Entry engine (buy score) | `pages/WatchlistView.tsx`, AI | Rule `buyScore()` + gates (EF, cash, concentration) |
| Exit engine | `wealth-ultra/alertEngine.ts` | Structured sell reasons + `sellScore()` |
| Position playbook | `services/tradingExecution.ts`, `services/riskCompliance.ts` | Scaling, trailing, cool-off; `canAverageDown()` |

---

## §5 Risk, stress, forecast, alerts

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Emergency fund | `hooks/useEmergencyFund.ts`, household | `emergencyFundCoverage()` everywhere |
| VaR, vol, PDT | `services/riskCompliance.ts`, Wealth Ultra | Unified **risk dashboard** |
| Stress | `services/householdBudgetStress.ts`, recovery, Ultra | One `stressTestScenario()` runner |
| Multi-horizon forecast | `pages/Forecast.tsx`, Plan | 3/12/36 mo + FI with inflation |
| Alerts | `context/NotificationsContext.tsx` | Drift, buy/sell zones, large withdrawal, drawdown cap |
| Savings rate | `pages/Summary.tsx` | Export from shared module |

---

## §6–10 Named functions (spec)

| Area | Exists | Missing work |
|------|--------|--------------|
| Finance | Scattered | `services/financeMetrics.ts`: netCashFlow, freeCashFlow, normalizedMonthlyExpense, cashRunwayMonths, emergencyFundCoverage, debtServiceRatio, liquidityRatio, netWorth, liquidNetWorth |
| Goals | Plan/Goals | requiredMonthlyContribution, goalFundingGap, goalProgressPercent, projectedGoalCompletionDate, reallocateGoalContribution, prioritizeGoals |
| Investment | Spread | weightedAverageCost, unrealizedPnL, realizedPnL, totalReturn, xirrReturn, dividendAdjustedReturn, portfolioAllocation, allocationDrift, rebalanceSuggestion, breakEvenPrice, exposureBySector/Currency, concentrationScore |
| Trading | Partial | buyScore, sellScore, thesisHealthCheck, entryZoneCheck, stopLossCheck, takeProfitCheck, trailingStopCheck, riskRewardRatio, maxPositionAllowed, canAverageDown, capitalAtRisk |
| Forecast / scenario | Fragments | futureCashProjection, futureNetWorthProjection, stressTestScenario, marketCrashImpact, jobLossImpact, inflationAdjustedGoalCost, compareStrategies, compareGoalFundingPaths, compareLumpSumVsDCA |

---

## §11 Decision engines (surplus, buy/sell, rank)

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Surplus routing | Household + router | **`rankCapitalUses()`** + UI |
| Smart buy/sell | AI + Ultra | Rule-first scores + replace-holding |
| Rebalance policy | sleeve + Ultra | User picks calendar vs threshold vs cash-only |
| Idea ranking | — | **`rankWatchlistIdeas()`** |

---

## §12 Automations & dashboards

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Recurring tx | `context/DataContext.tsx` | Annual expense auto-post to monthly |
| Prices / FX | `context/MarketDataContext.tsx` | Stale data job + alerts |
| Snapshots | — | Monthly NW snapshot job |
| Review narrative | — | Weekly/monthly AI+rules summary |
| Audit | Export, `execution_logs` | Full CRUD audit |
| Dashboards | Many pages | Dedicated **Risk** + **Trading** pages |

---

## §13 Config / personal policy

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Thresholds | `pages/Settings.tsx`, wealth-ultra config | **Policy engine**: max single stock, no invest if CF−, travel cap, avg-down rules |

---

## §14 Behavioral, thesis DB, tagging, tax

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Cooldown / max trades | — | Behavioral engine |
| Thesis per holding | AI copy | DB + `logInvestmentThesis()`, `reviewPastDecisionQuality()` |
| Capital source | — | Tag flows |
| Account purpose | Types only | Roles: salary/bill/EF/funding/trading |
| Tax | `pages/Zakat.tsx` | Fees/withholding beyond Zakat |

---

## §15 Data quality & control

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Dupes / reconcile import | `pages/StatementUpload.tsx`, `context/ReconciliationContext.tsx` | Manual-entry dupes; **`reconcileAccountBalance()`**; balance mismatch alerts |
| Validation | Forms | Global `validateRequiredFields()` |
| Stale market/FX | Prompts | `detectStaleMarketData()` |
| Integrity | — | Recompute vs stored checks |
| Audit trail | Partial | `auditChangeLog()` for mutations |

---

## §16 Transaction intelligence

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Auto-cat | `context/TransactionAIContext.tsx`, `services/aiBudgetAutomation.ts` | — |
| Recurring / subs | `services/hybridBudgetCategorization.ts` | Stronger subscription model |
| Merchant | Descriptions | Merchant graph + spend-by-merchant |
| Salary pattern | — | Detector |
| Internal transfer ≠ expense | `pages/Accounts.tsx` transfers | Global exclusion from spend KPIs |
| Split / refund / BNPL | — | Model + UI |

---

## §17 Account & bucket orchestration

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Purpose tags | — | Min balance, sweep suggestions, idle cash alerts |
| Excess cash | Ultra cash planner | Tie to `rankCapitalUses` |

---

## §18 Review & workflow

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Nudges | `pages/MarketEvents.tsx` | `generateWeeklyActionList()`, `monthEndCloseChecklist()`, `quarterlyPortfolioReview()`, `annualGoalReset()` |

---

## §19 Decision journaling

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Structured log | — | DB + compare expected vs actual |

---

## §20 Watchlist pipeline

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Watchlist + TA | `pages/WatchlistView.tsx`, `services/technicalIndicators.ts` | Buy range, FV, catalyst dates, scores |
| Rank | — | `updateWatchlistScore()`, `detectBuyZoneEntry()`, `detectCatalystWindow()`, `rankWatchlistIdeas()` |

---

## §21 Performance attribution

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Docs | `docs/PROFESSIONAL_OVERVIEW.md` | Implement `attributionByAsset/Sector/CashFlow/FX()` |

---

## §22 Withdrawal planning

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Liquidation order | — | `suggestLiquidationOrder()`, `estimateWithdrawalImpact()`, `protectLongTermAssets()` |

---

## §23 Life events

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Stress templates | Household | Wizard: marriage, kids, house, relocation → goals/liquidity |

---

## §24 AI layer

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Narrative / Q&A | `services/geminiService.ts`, `components/AIAdvisor.tsx`, `LiveAdvisorModal` | Ground on validated metrics + rule outputs |

---

## §25 Security

| Feature | Exists | Missing work |
|---------|--------|--------------|
| Auth / admin | `context/AuthContext.tsx`, `utils/role.ts` | Spouse RBAC beyond shared accounts |
| Backup | Command palette export | Encrypted backup + restore |
| Versioning | — | Snapshots / restore points |
| Masking | — | Sensitive fields |

---

## §26 Commonly forgotten items

| Item | Status | Action |
|------|--------|--------|
| Fees in performance | Partial | Attribution |
| FX in returns | Display | Attribution |
| Transfers as expenses | Risk | Global exclusion |
| Annual → monthly | Partial | Normalize everywhere |
| Reserved cash for obligations | — | Obligation calendar |
| EF vs investable | Partial | Hard buy gates |
| Concentration | Yes | Policy enforcement |
| Thesis / journal / stale / audit / withdrawal / opportunity cost | Gaps | See §15–22 |

---

## §27 Best-in-class seven layers

| # | Layer | Primary files today | Gap headline |
|---|-------|---------------------|--------------|
| 1 | Data validation & reconciliation | `ReconciliationContext.tsx`, `StatementUpload.tsx` | Ledger reconcile, stale data, audit |
| 2 | Transaction intelligence | `hybridBudgetCategorization.ts`, `TransactionAIContext.tsx` | Transfer/BNPL/split/refund |
| 3 | Opportunity cost | — | `rankCapitalUses()` |
| 4 | Decision journal | — | DB + review loop |
| 5 | Performance attribution | — | Implement stack |
| 6 | Scenario comparison | Plan, household, Ultra | `compareStrategies()` suite |
| 7 | Review / next-action | Notifications, Market Events | Weekly/month-end engines |

---

## §28 Ten questions (coverage)

| Question | Support today | Gap |
|----------|---------------|-----|
| Own / owe? | Summary, Accounts, Liabilities | Personal vs managed UX consistency |
| Safe to invest? | Fragmented | Single deployment answer |
| Goals on track? | Goals, Plan, MC | Unified goals dashboard |
| Money leaking? | Budgets, AI | Merchant + drift |
| Too risky? | Ultra, VaR | Risk page + policy |
| What to buy? | Watchlist, AI | buyScore + rank |
| What to sell? | Alerts | sellScore + liquidation |
| Income/market shock? | Fragments | Scenario runner |
| Discipline vs market? | — | Attribution |

---

*Update this matrix when capabilities ship. Cross-check against [`FEATURES.md`](../FEATURES.md).*
