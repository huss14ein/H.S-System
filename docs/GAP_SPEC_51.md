# 51-point wealth system spec — implementation status

This document is a **coverage map** (spec ↔ code), **not** a promise that every row will become “Done.” Product delivery priorities live in [`GAP_IMPLEMENTATION_TODOS.md`](./GAP_IMPLEMENTATION_TODOS.md). **Income-tax / generic tax-engine** spec rows are **out of current product scope**; **Zakat** remains a dedicated calculator page.

**Done** = implemented and wired. **Partial** = logic or UI exists but not all spec items. **Missing** = not implemented.

---

## 1) System architecture logic

| Layer | Status | Where |
|-------|--------|--------|
| A. Data layer (accounts, transactions, holdings, prices, FX, goals, liabilities, rules, snapshots, alerts, journals, forecasts) | **Partial** | Supabase + DataContext; snapshots/journals local; see [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md) |
| B. Logic layer (formulas, decision rules, scoring, validations, triggers, reallocation, classification, scenario engines) | **Done** | services/*; [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md) |
| C. Output layer (dashboards, summaries, alerts, recommendations, review pages, action items, forecasts, reports) | **Partial** | Pages; next-best-action on Dashboard; no dedicated report generator |
| D. Automation layer (imports, sync, refresh, recurring, snapshots, email, watchlist, cleanup, backup) | **Partial** | Manual/on-demand only; no cron/scheduled jobs |

---

## 2) Data model design

| Entity / field | Status | Where |
|----------------|--------|--------|
| User / profile (base currency, timezone, risk profile, investment style, family size, salary cycle) | **Partial** | Settings.riskProfile; Profile type in types.ts; base currency in CurrencyContext/plan |
| Accounts (full spec: provider, currency, opening balance, status, bucket type, liquidity level) | **Partial** | Account type; AccountRole, AccountBucketType in types.ts for logic |
| Transactions (settlement date, currency, FX rate, merchant, linked account/goal/asset, tags, reconciliation status) | **Partial** | Transaction type; TransactionType enum for classification |
| Assets / holdings (region, sector, risk class, conviction, status) | **Partial** | Holding; Wealth Ultra / Recovery extend |
| Goals (inflation rule, pause flag, linked account, contribution rule, success threshold) | **Partial** | Goal type |
| Liabilities (remaining balance, rate, monthly payment, maturity, prepayment, payoff priority) | **Partial** | Liability type; liabilityMetrics, debtEngines |
| Watchlist idea (target buy range, fair value, quality/valuation score, catalyst, thesis, status) | **Partial** | WatchlistItem minimal; decisionEngine ranks |
| Rules / config (source module, last changed) | **Partial** | Settings, tradingPolicy; auditLog |
| Snapshots (cash, debt, allocation, returns, goal %, risk score, runway) | **Partial** | NetWorthSnapshot (date, netWorth); extended shape recommended in DATA_MODEL_SPEC |

See [DATA_MODEL_SPEC.md](./DATA_MODEL_SPEC.md).

---

## 3) Full transaction logic

| Item | Status | Where |
|------|--------|--------|
| Transaction types (income, transfer, expense, buy, sell, dividend, interest, fee, refund, debt payment, goal contribution/withdrawal, adjustment, FX, cash in/out) | **Partial** | TransactionType enum; Transaction.type income/expense; InvestmentTransaction types |
| Classification (spending vs transfer, dividend vs salary, refund vs negative expense, etc.) | **Partial** | transactionFilters, transactionIntelligence, hybridBudgetCategorization.classifyTransaction |
| Recurring ID, merchant cleanup, duplicate detection, split support, installment grouping, transfer pairing, refund reversal, category confidence | **Partial** | transactionIntelligence (normalizeMerchant, findRefundPairs, validateSplitTotal, etc.); dataQuality/transactionQuality |
| classifyTransaction, normalizeMerchantName, detectTransferPair, detectInstallmentPlan, splitTransaction, reverseRefundImpact | **Partial** | classifyTransaction in hybridBudgetCategorization; transfer via category; split in transactionSplitNote; refund pairs in transactionIntelligence |

---

## 4) Full account orchestration logic

| Item | Status | Where |
|------|--------|--------|
| Account roles (operating cash, salary, bills, emergency, investment funding, trading capital, goal reserve, debt servicing) | **Partial** | AccountRole type; logic in cashAllocationEngine |
| Cash allocation engine (operating vs goals vs investable vs replenish) | **Done** | cashAllocationEngine.allocateCashAcrossBuckets |
| Account sweep engine (excess idle, top up bills, refill emergency, surplus to goal/investments) | **Done** | cashAllocationEngine.suggestCashSweep, detectIdleCash |
| Liquidity ranking | **Done** | cashAllocationEngine.rankLiquiditySources |
| allocateCashAcrossBuckets, detectIdleCash, suggestCashSweep, rankLiquiditySources | **Done** | services/cashAllocationEngine.ts |

---

## 5) Liability and debt intelligence

| Item | Status | Where |
|------|--------|--------|
| Debt payoff (avalanche, snowball, hybrid, liquidity-preserving) | **Done** | debtEngines.debtPayoffPlan |
| Cost-of-debt (financing burden, effective rate, future payable, prepayment savings) | **Done** | debtEngines.effectiveDebtCost, prepaymentSavings |
| Debt stress (payment coverage, debt-to-income, early warning) | **Done** | debtEngines.debtStressScore; liabilityMetrics.debtServiceRatio, liquidityRatio |
| debtPayoffPlan, effectiveDebtCost, prepaymentSavings, debtStressScore | **Done** | services/debtEngines.ts |

---

## 6) Multi-currency and FX logic

| Item | Status | Where |
|------|--------|--------|
| Base currency normalization, FX rate by date, realized/unrealized FX, account/asset currency mismatch, goal currency mapping | **Partial** | CurrencyContext; InvestmentPlanSettings; fxEngine |
| convertToBaseCurrency, realizedFXGain, unrealizedFXExposure, portfolioFXAllocation | **Done** | services/fxEngine.ts |
| Wealth by original/base currency, FX contribution to return, FX risk concentration | **Partial** | fxEngine + portfolioFXAllocation; no full UI yet |

---

## 7) Return measurement logic

| Item | Status | Where |
|------|--------|--------|
| Cash return views (simple, realized, unrealized, dividend-adjusted, fee-adjusted) | **Partial** | Dividend Tracker; portfolioMetrics; not all views |
| Performance (MWRR, TWRR, IRR/XIRR, annualized, benchmark-relative) | **Partial** | portfolioXirr.approximatePortfolioMWRR; benchmarkService; no TWRR |
| Attribution (price, dividend, FX, contribution, timing) | **Partial** | portfolioAttribution.attributeNetWorthWithFlows, attributePeriodChange |
| simpleReturn, annualizedReturn, moneyWeightedReturn, timeWeightedReturn, benchmarkExcessReturn, totalReturnAttribution | **Partial** | MWRR and attribution in place; TWRR and full attribution formula set missing |

---

## 8) Benchmark and comparison logic

| Item | Status | Where |
|------|--------|--------|
| Benchmarks (S&P 500, Nasdaq, Saudi index, gold, sukuk, blended, inflation, savings rate) | **Partial** | benchmarkService (SPY, QQQ; simulated/cache) |
| compareToBenchmark, excessReturn, trackingDifference, benchmarkFitByAssetType | **Partial** | benchmarkService fetch + comparison; no full API set |

---

## 9) Portfolio sleeve logic

| Item | Status | Where |
|------|--------|--------|
| Sleeves (emergency, conservative income, core long-term, growth, tactical, speculative, goal-linked) | **Done** | sleeveAllocation, Wealth Ultra sleeves |
| Target size, allowed instruments, max risk, turnover rule, return expectation, review cycle | **Partial** | sleeveAllocation, tradingPolicy, InvestmentPlanSettings |
| sleeveAllocation, sleeveDrift, sleevePerformance, enforceSleevePolicy | **Done** | services/sleeveAllocation.ts |

---

## 10) Investment research support logic

| Item | Status | Where |
|------|--------|--------|
| Research fields per asset (sector, valuation, catalysts, risk, conviction, etc.) | **Partial** | WatchlistItem minimal; decisionEngine, rankWatchlistIdeas |
| updateResearchProfile, computeQualityScore, computeValuationScore, computeRiskPenalty, computePortfolioFitScore | **Partial** | decisionEngine scores; advancedRiskScoring; no dedicated research profile DB |

---

## 11) Technical and trading support logic

| Item | Status | Where |
|------|--------|--------|
| Moving averages, support/resistance, drawdown, distance from lows, volatility, trend, momentum, gap, volume | **Partial** | technicalIndicators (SMA, EMA, RSI, Bollinger, crossovers) |
| movingAverageSignal, supportZoneCheck, drawdownPercent, distanceFrom52WeekLow, momentumState, trendStrengthScore | **Partial** | technicalIndicators; not all functions |

---

## 12) Order planning logic

| Item | Status | Where |
|------|--------|--------|
| Full buy, staged buy, DCA, conviction/volatility/event-based scaling, partial exit ladder, profit-taking, stop-loss | **Partial** | Recovery plan ladders; PlannedTrade; no full tranche API |
| generateBuyTranches, generateSellTranches, computeAverageEntryAfterPlannedAdds, stagedExitPlan | **Done** | `services/orderPlanning.ts` |

---

## 13) Capital allocation logic

| Item | Status | Where |
|------|--------|--------|
| Surplus across emergency, debt, obligations, house goal, long-term invest, tactical, travel, buffer | **Done** | decisionEngine.rankCapitalUses; goalFundingRouter; goalWaterfall |
| allocateMonthlySurplus, rankFundingNeeds, rankInvestmentCandidates, rankDebtVsInvestChoice | **Partial** | rankCapitalUses; goalFundingRouter; debt/goal ordering in debtEngines and goalWaterfall |

---

## 14) Budgeting logic beyond simple budgets

| Item | Status | Where |
|------|--------|--------|
| Fixed, flexible, zero-based, envelope/bucket, lifestyle cap, budget drift | **Partial** | Budgets; enhancedBudgetEngine; householdBudgetEngine; no explicit drift detection |
| budgetVariance, normalizedBudgetComparison, detectLifestyleInflation, forecastBudgetPressure | **Partial** | financeMetrics; Dashboard variance; no lifestyle inflation/drift module |

---

## 15) Annualization and seasonality logic

| Item | Status | Where |
|------|--------|--------|
| Bonus months, tuition, rent cycles, travel, Ramadan/Eid, school fees, insurance renewal, annual maintenance | **Done** | `services/seasonalityEngine.ts` |
| seasonalityAdjustedExpense, annualExpenseMonthlyProvision, eventMonthStressCheck | **Partial** | normalizedMonthlyExpense in financeMetrics; no event-month or seasonality flags |

---

## 16) Provisioning logic

| Item | Status | Where |
|------|--------|--------|
| Education, travel, insurance, maintenance, family obligations, device replacement, medical, property | **Done** | `services/provisionEngine.ts` |
| monthlyProvisionNeeded, provisionFundingGap, reserveAdequacyCheck | **Done** | `services/provisionEngine.ts` |

---

## 17) Family and household logic

| Item | Status | Where |
|------|--------|--------|
| Household members, dependents, spouse allocation, personal allowance, shared expense, family obligations, education planning | **Partial** | Plan page; householdBudgetEngine; household_budget_profiles; no full family model |

---

## 18) Lifestyle guardrail logic

| Item | Status | Where |
|------|--------|--------|
| No discretionary upgrade if savings below threshold; no luxury travel if emergency incomplete; bonus not fully consumed; high-risk only from dedicated capital | **Partial** | tradingPolicy blocks buys on runway/cashflow; no explicit lifestyle guardrail module |
| discretionarySpendApproval, lifestyleGuardrailCheck, bonusUsePolicyCheck | **Done** | `services/lifestyleGuardrailEngine.ts` |

---

## 19) Goal conflict logic

| Item | Status | Where |
|------|--------|--------|
| Same cash funding too many goals; impossible target dates; low priority hurting high; house delayed by trading | **Partial** | goalWaterfall, goalMetrics; no detectGoalConflict |
| detectGoalConflict, goalFeasibilityCheck, reprioritizeConflictingGoals | **Partial** | goalMetrics (required contribution, completion date); goalWaterfall order; no conflict detection |

---

## 20) Retirement and long-term independence logic

| Item | Status | Where |
|------|--------|--------|
| Retirement corpus, inflation-adjusted need, safe withdrawal, gap, contribution path, pension input, cases | **Done** | `services/retirementEngine.ts` |
| retirementTargetValue, retirementFundingGap, retirementProjection, safeWithdrawalEstimate | **Done** | `services/retirementEngine.ts` |

---

## 21) Insurance and protection planning logic

| Item | Status | Where |
|------|--------|--------|
| Health, life, disability, property, car, emergency medical buffer; protection gap, premium schedule, renewal, adequacy | **Done** | `services/insuranceEngine.ts` |
| coverageGapCheck, insuranceRenewalAlert, emergencyProtectionAdequacy | **Done** | `services/insuranceEngine.ts` |

---

## 22) Tax, zakat, fee, and obligation logic

| Item | Status | Where |
|------|--------|--------|
| Transaction fees, broker fees, spread, withholding, zakat classification, annual due, fee drag | **Partial** | Zakat page; zakatTradeAdvisor; Settings.nisabAmount; no full fee/tax engine |
| estimateTransactionCost, annualFeeImpact, zakatEligibleBase, obligationSchedule | **Partial** | Zakat logic; no named fee/obligation APIs |

---

## 23) Market data quality logic

| Item | Status | Where |
|------|--------|--------|
| Stale price, suspicious move, corporate action, split adjustment, ex-date, missing symbol, market closed, fallback | **Partial** | dataQuality/marketDataStale; detectStaleMarketData; FX staleness; Notifications |
| detectStalePrice, validatePriceMove, adjustForStockSplit, handleMissingMarketData | **Partial** | marketDataStale; no corporate-action adjustment in codebase |

---

## 24) Corporate actions logic

| Item | Status | Where |
|------|--------|--------|
| Splits, reverse splits, stock/cash dividends, rights, spin-offs, symbol change, delistings, mergers | **Done** | `services/corporateActions.ts` (baseline) |
| applyCorporateAction, recalculateCostBasisAfterAction, detectDelistedAssetRisk | **Done** | `services/corporateActions.ts` (baseline) |

---

## 25) Reconciliation logic

| Item | Status | Where |
|------|--------|--------|
| Account balance vs ledger; holdings vs buy/sell; dividends vs cash; liability vs payments; snapshot vs live | **Partial** | dataQuality/accountReconciliation; reconcileCashAccounts; StatementProcessingContext; no full holdings/dividend/liability reconciliation |
| reconcileCashAccounts, reconcileHoldings, reconcileDividends, reconcileLiabilities, reconciliationExceptionReport | **Partial** | accountReconciliation; reconciliation context; not all functions |

---

## 26) Exception and error handling logic

| Item | Status | Where |
|------|--------|--------|
| Missing price, duplicate import, broken FX, deleted category, negative balance, unsupported type, invalid goal rule, inconsistent opening balance | **Partial** | dataQuality; Notifications; no central exceptionQueue or repairSuggestionEngine |
| validateSystemIntegrity, detectBrokenReferences, exceptionQueue, repairSuggestionEngine | **Partial** | transactionQuality validations; no unified exception/repair API |

---

## 27) Review cadence logic

| Item | Status | Where |
|------|--------|--------|
| Daily (cash, alerts, watchlist); weekly (spending, actions, portfolio); monthly (close, snapshot, budget, goal, allocation, NW trend); quarterly (rebalance, strategy, thesis, attribution); annual (target reset, rule revision, life-event, benchmark, allocation reset) | **Partial** | Notifications; snapshot on Dashboard; no structured daily/weekly/monthly/quarterly/annual workflows |
| dailyReviewChecklist, weeklyReviewChecklist, monthlyCloseProcess, quarterlyStrategyReview, annualResetWorkflow | **Done** | `services/reviewWorkflowEngine.ts` |

---

## 28) Next-best-action engine

| Item | Status | Where |
|------|--------|--------|
| Top actions: top up emergency, pause goal, trim position, avoid buy (liquidity), move idle cash, review thesis, reduce spending | **Done** | nextBestActionEngine.generateNextBestActions, rankUrgentFinancialActions |
| Wired to UI | **Done** | Dashboard “Suggested actions” block |
| generateNextBestActions, rankUrgentFinancialActions, actionPriorityScore | **Done** | services/nextBestActionEngine.ts |

---

## 29) Behavioral finance controls

| Item | Status | Where |
|------|--------|--------|
| Max trades per week, thesis note before buy, cooldown after loss, no doubling down after drawdown unless approved, no trade if month cashflow negative, no speculative buy from emergency/goal funds, no sell on noise without thesis break | **Partial** | tradingPolicy (runway, negative cashflow block); Record Trade override; no cooldown or trade-count limits |
| behavioralRiskCheck, enforceTradeCooldown, preventEmotionDrivenTrade | **Done** | `services/behavioralControlEngine.ts` |

---

## 30) Thesis and journal system

| Item | Status | Where |
|------|--------|--------|
| Buy thesis, expected upside, timeline, key risks, catalyst dates, invalidation point, review date, post-result reflection | **Partial** | Financial Journal page (local); PlannedTrade.notes; no structured thesis DB |
| createThesisRecord, thesisValidityCheck, journalOutcomeReview, thesisBreakAlert | **Partial** | Journal UI; sellScore reasons include thesis_broken; no full thesis API |

---

## 31) Decision scoring frameworks

| Item | Status | Where |
|------|--------|--------|
| Personal finance score (liquidity, savings, debt, goal progress, expense control) | **Partial** | disciplineScoreEngine; financeMetrics; salaryExpenseCoverage; liabilityMetrics |
| Investment score (quality, valuation, growth, financial strength, risk, timing, portfolio fit) | **Partial** | decisionEngine; advancedRiskScoring; sleeveAllocation |
| Trading score (setup quality, reward/risk, trend, catalyst, position sizing) | **Partial** | decisionEngine.buyScore, sellScore; tradingPolicy |
| personalFinanceHealthScore, investmentCompositeScore, tradingSetupScore | **Partial** | Scattered; no single composite scorecard API |

---

## 32) Strategy comparison engine

| Item | Status | Where |
|------|--------|--------|
| Invest vs hold cash; house first vs mixed; debt first vs invest; DCA vs buy zone; aggressive vs balanced | **Partial** | scenarioTimelineEngine; stressScenario; rankCapitalUses; no full compareStrategies UI |
| compareStrategies, compareAllocationModels, compareGoalPriorityRules | **Partial** | Logic in places; no dedicated comparison engine |

---

## 33) Monte Carlo / probabilistic planning

| Item | Status | Where |
|------|--------|--------|
| Goal completion window, cash shortage chance, retirement success, NW range, downside stress probability | **Done** | `services/probabilisticPlanningEngine.ts` |
| simulateGoalCompletionProbability, simulatePortfolioRange, simulateCashShortfallRisk | **Done** | `services/probabilisticPlanningEngine.ts` |

---

## 34) Sensitivity analysis engine

| Item | Status | Where |
|------|--------|--------|
| Goal vs return drop; NW vs salary rise; inflation vs house target; bonus removed | **Done** | `services/sensitivityEngine.ts` |
| sensitivityToReturn, sensitivityToIncome, sensitivityToInflation, sensitivityToExpenseGrowth | **Done** | `services/sensitivityEngine.ts` |

---

## 35) Planning assumptions engine

| Item | Status | Where |
|------|--------|--------|
| Expected return by asset class, inflation by goal, salary growth, FX, dividend growth, debt payoff, expense/contribution growth, emergency target months | **Partial** | InvestmentPlanSettings; Settings; goalMetrics; no single getPlanningAssumption store |
| getPlanningAssumption, validateAssumptionRanges, assumptionImpactSummary | **Done** | `services/planningAssumptionsEngine.ts` |

---

## 36) Explainability engine

| Item | Status | Where |
|------|--------|--------|
| “Do not buy because…” plain-language reasons; same for sell, goal delay, risk score | **Done** | explainabilityEngine.explainBuyDecision, explainSellDecision, explainGoalDelay, explainRiskScore |
| explainBuyDecision, explainSellDecision, explainGoalDelay, explainRiskScore | **Done** | services/explainabilityEngine.ts; trading policy reason shown in Record Trade modal |

---

## 37) AI assistant support layer

| Item | Status | Where |
|------|--------|--------|
| Monthly narrative, spending explanation, anomaly explanation, portfolio review, decision rationale, Q&A over system, suggested actions, missed risk | **Partial** | geminiService (executive summary, categorization); AI feed; next-best-action; AI not source of truth for balances/returns |
| summarizeMonthNarrative, answerPortfolioQuestion, explainAnomaly, draftReviewMemo | **Partial** | getAIExecutiveSummary; no full API set |

---

## 38) Reporting and export logic

| Item | Status | Where |
|------|--------|--------|
| Monthly wealth, cash flow, goal progress, investment performance, risk, annual summary, action report | **Partial** | No dedicated report generator; exports in places (e.g. CSV) |
| PDF summary, CSV extract, dashboard snapshot, tax/zakat summary, thesis log export | **Partial** | Data visualization export; Statement export; no PDF/tax export |
| generateMonthlyReport, generateAnnualWealthSummary, exportGoalStatus, exportPortfolioReview | **Done** | `services/reportingEngine.ts` |

---

## 39) Snapshot and version logic

| Item | Status | Where |
|------|--------|--------|
| Periodic snapshots: NW, allocation, holdings, goal progress, risk, returns, runway; rules/forecast snapshot; month-end lock | **Partial** | netWorthSnapshot (NW only); wealthUltraPerformance; no month-end lock or full snapshot schema |
| createMonthlySnapshot, restoreHistoricalView, compareSnapshots, lockMonthEnd | **Partial** | pushNetWorthSnapshot, listNetWorthSnapshots, attributeNetWorthWithFlows; no restore/lock |

---

## 40) Audit and governance logic

| Item | Status | Where |
|------|--------|--------|
| Who changed what, when, old vs new, why, impact on outputs | **Partial** | auditLog; status_change_log; Settings Activity log |
| logConfigChange, logRuleChangeImpact, auditSystemEdits | **Partial** | services/auditLog.ts; not every change type |

---

## 41) Security and protections

| Item | Status | Where |
|------|--------|--------|
| Protected formulas/config, access control by module, backup, restore, sensitive masking | **Partial** | PrivacyContext (mask balances); Settings backup copy; AuthContext roles; no restore or formula protection |
| protectCriticalFields, backupSystemData, restoreBackupVersion | **Partial** | Backup note in Settings; no restore flow |

---

## 42) UX and usability logic

| Item | Status | Where |
|------|--------|--------|
| Minimum manual entry, dropdowns, date standardization, color coding, hints/tooltips, clear errors, action buttons, status badges, priority flags | **Partial** | App-wide; no central fieldHintEngine or statusBadgeEngine |
| fieldHintEngine, statusBadgeEngine, userInputGuard, workflowShortcutMenu | **Done** | `services/uxGuardrailsEngine.ts` |

---

## 43) Minimal manual input philosophy

| Item | Status | Where |
|------|--------|--------|
| Manual: new income, one-time expense, updated target, new holding, thesis note, assumption adjustment; rest derived/scheduled/imported/rule-driven | **Partial** | Statement import; recurring; categorization; many flows still manual |

---

## 44) What the system should decide automatically

| Item | Status | Where |
|------|--------|--------|
| Investable surplus, minimum cash, goal off track, stock too large, new buy allowed, position needs review, spending drift, risky month, rebalance needed, weak liquidity | **Partial** | tradingPolicy; nextBestActionEngine; goal alerts; runway; no automatic “rebalance needed” or “spending drift” flags |

---

## 45) Full list of master modules

| Module | Status | Where |
|--------|--------|--------|
| Profile/Preferences, Config/Rules, Accounts, Transactions, Categories, Recurring Income/Expenses, Provisions, Cash Flow, Budgeting, Net Worth, Assets, Liabilities, Goals, Goal Allocation, Emergency Fund, Insurance, Portfolio Holdings, Orders/Execution Plan, Dividends, Watchlist, Research Profiles, Opportunity Ranking, Rebalancing, Trading Rules, Thesis/Journal, Performance Measurement, Attribution, Benchmark Comparison, FX, Risk Engine, Stress Testing, Strategy Comparison, Forecast/Planning, Assumptions, Alerts, Review Workflows, Action Center, Snapshots, Reports, Audit Log, Backup/Restore, AI Assistant, Dashboard | **Partial** | Most exist as pages or services; Provisions, Insurance, Retirement, full Reports, Restore, Review Workflows missing or partial |

---

## 46) Full list of engines

| Engine | Status | Where |
|--------|--------|--------|
| income, expense, cash flow, provision, budgeting, net worth, asset, liability, debt payoff, goal, goal priority/conflict, surplus allocation, liquidity, emergency fund, account sweep, transaction intelligence, reconciliation, FX, return, attribution, benchmark, sleeve allocation, portfolio, entry/exit decision, position sizing, order planning, watchlist ranking, research scoring, rebalancing, risk, stress testing, scenario comparison, sensitivity, forecasting, retirement, protection/insurance, fee/tax/zakat, market data quality, corporate actions, alert, workflow/review, next-best-action, behavioral control, thesis, explainability, reporting, snapshot/version, audit/governance, security, AI narrative | **Partial** | Many implemented (see services/); provision, retirement, insurance, corporate actions, sensitivity, Monte Carlo, full reporting, behavioral control, full workflow/review missing |

---

## 47) Full list of must-have functions

See [IMPLEMENTATION_COVERAGE.md](./IMPLEMENTATION_COVERAGE.md) and services. Key additions in this pass:

- **Finance/cash:** normalizedMonthlyExpense, cashRunwayMonths, netCashFlowForMonth ✓; investableSurplus, monthlyProvisionNeeded partial/missing.
- **NW/balance sheet:** netWorth, liquidNetWorth ✓; debtServiceRatio, liquidityRatio ✓ (liabilityMetrics).
- **Goals:** requiredMonthlyContribution, goalFundingGap, goalProgressPercent, projectedGoalCompletionDate ✓ (goalMetrics); detectGoalConflict, goalFeasibilityCheck partial.
- **Accounts/transactions:** classifyTransaction, detectDuplicateTransaction, reconcileCashAccounts, validateRequiredFields ✓; detectIdleCash, suggestCashSweep ✓ (cashAllocationEngine).
- **Debt:** effectiveDebtCost, debtPayoffPlan, prepaymentSavings, debtStressScore ✓ (debtEngines).
- **Portfolio:** MWRR, attribution ✓; TWRR, full benchmarkExcessReturn partial.
- **Watchlist/trading:** rankWatchlistIdeas, buyScore, sellScore ✓; generateBuyTranches/generateSellTranches missing.
- **Risk/forecasting:** stress scenarios ✓; simulateGoalCompletionProbability, sensitivityToReturn missing.
- **Alerts/action:** generateNextBestActions, rankUrgentFinancialActions ✓.
- **Journal/behavior:** thesisBreak in sell reasons ✓; behavioralRiskCheck, enforceTradeCooldown missing.
- **Quality/audit:** detectStaleMarketData ✓; applyCorporateAction missing; createMonthlySnapshot (push snapshot) ✓; audit log ✓.

---

## 48) Hidden principles

| Principle | Status |
|-----------|--------|
| Cash not all investable (operating, reserve, provision, goal, investable) | **Partial** — types and cashAllocationEngine; not all UI |
| Return with risk context (drawdown, concentration, liquidity, exposure) | **Partial** — risk and attribution in places |
| Explainable scores | **Done** — explainabilityEngine |
| Recommendations respect policy | **Done** — tradingPolicy, next-best-action |
| Historical snapshots matter | **Partial** — net worth snapshots; no full historical view |
| System manages behavior | **Partial** — policy blocks; no cooldown/guardrails |
| Editable assumptions | **Partial** — plan/settings; no central assumptions API |
| Investment and life logic connected | **Partial** — runway, salary coverage, goal alerts in buy/action logic |

---

## 49) Usually forgotten gaps

| Gap | Status |
|-----|--------|
| Internal transfers not treated as expenses | **Done** — transactionFilters |
| Provisions mixed with free cash | **Partial** — no provisioning module |
| Unrealized gains treated as spendable | **Partial** — liquidNetWorth and policy use liquid/cash |
| Bonus as recurring income | **Partial** — no bonus flag |
| FX ignored | **Partial** — fxEngine; plan FX |
| Fees ignored | **Partial** — no fee drag engine |
| Emergency fund protected | **Done** — trading policy + next-best-action |
| High-risk mixed with long-term | **Partial** — sleeves and policy |
| Goal contributions inflation adjusted | **Done** | `services/goalMetrics.ts` |
| Corporate actions not handled | **Done** | `services/corporateActions.ts` |
| Watchlist linked to portfolio fit | **Partial** — rankWatchlistIdeas |
| Thesis reviewed after buying | **Partial** — journal and sell reasons |
| Stale prices driving decisions | **Partial** — stale detection and alerts |
| Month-end lock / historical snapshots | **Partial** — snapshots yes; lock no |
| Action center | **Done** — next-best-action on Dashboard |
| Explanation layer | **Done** — explainabilityEngine |
| Behavioral controls | **Partial** — policy only |

---

## 50) Definition of a complete wealth system

The system today: records money, classifies (partially), reconciles (cash), protects liquidity, funds goals (routing/waterfall), measures wealth and progress, compares over time (snapshots/attribution), detects some risks, evaluates investments (scores/policy), guides trading (policy + explain), forecasts (scenario), ranks next actions, preserves some history, reduces some emotional mistakes. **Reporting, retirement, insurance, provisioning, full automation, and several advanced engines are still missing or partial.**

---

## 51) Build order (priority)

| Phase | Status |
|-------|--------|
| Phase 1 — Core truth (accounts, transactions, cash flow, net worth, goals, liabilities, reconciliation, snapshots) | **Done** / partial |
| Phase 2 — Intelligence (surplus allocation, emergency fund, goal priority, portfolio, allocation, risk, alerts) | **Done** / partial |
| Phase 3 — Decision support (watchlist, scoring, buy/sell, thesis journal, rebalancing, research) | **Partial** |
| Phase 4 — Advanced planning (forecast, scenario comparison, stress, retirement, sensitivity, Monte Carlo) | **Done** / partial |
| Phase 5 — Maturity (AI layer, reporting, audit, automation, behavioral controls, explainability) | **Partial** — explainability and next-best-action done; reporting and full automation missing |

---

*When implementing new items, update this file and [IMPLEMENTATION_COVERAGE.md](./IMPLEMENTATION_COVERAGE.md).*
