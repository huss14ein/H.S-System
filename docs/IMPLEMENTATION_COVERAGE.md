# Implementation coverage (gap work)

Single reference for **what ships where**. Deeper matrix: [`GAP_MATRIX.md`](./GAP_MATRIX.md). Phased checklist: [`GAP_IMPLEMENTATION_TODOS.md`](./GAP_IMPLEMENTATION_TODOS.md). Release QA steps: [`QA_MANUAL_CHECKLIST.md`](./QA_MANUAL_CHECKLIST.md).

## Database

| Need | Migration / action |
|------|---------------------|
| Transaction memo & split storage | `supabase/migrations/add_transactions_note.sql` → adds `transactions.note`. Without it, app **falls back** to save without note and **alerts** (splits lost). |
| Statement history + extracted rows | `supabase/migrations/add_financial_statements_table.sql` → `financial_statements`, `extracted_transactions`. Used by **Statement Upload** (`commitParsedStatementFromUpload`) and **Statement History**. |
| Statement original file (Storage) | `add_financial_statements_storage.sql` + bucket setup `docs/supabase_storage_financial_statements.md`. |
| Budget routing / holding type | `add_optional_schema_extras.sql` → `destination_account_id`, `holding_type`. |
| Wealth Ultra numeric defaults from DB | Table `wealth_ultra_config` (from `full_schema_for_app.sql`); **DataContext** merges user row then global row into `data.wealthUltraConfig`. |

## Transaction intelligence

| Capability | Where |
|------------|--------|
| Exclude transfers from KPIs | `transactionFilters` + Dashboard, Summary, Notifications, etc. |
| Merchants, salary, subs, BNPL | **Analysis** — Spend intelligence |
| Salary × vs avg expense | **Analysis** — Salary vs expense coverage; **Notifications** (info) when &lt; 1× |
| Refund pairs | **Analysis** — Possible refund pairs |
| Split expense (2+ lines) | **Transactions** modal → `note` + `__FINOVA_SPLITS__` |

## Net worth & attribution

| Capability | Where |
|------------|--------|
| Liquid NW | **Summary** |
| NW snapshots (admin) | **Dashboard** → `netWorthSnapshot` |
| Flows vs residual (2 snapshots) | **Risk & Trading hub**, **Summary** (admin) |

## Portfolio

| Capability | Where |
|------------|--------|
| MWRR (heuristic) | **Dividend Tracker**, **Risk hub** |
| Yield on cost | **Dividend Tracker** top payers |
| Sell / buy policy | **Settings** trading policy; **Investments** Record Trade |

## Goals & cashflow

| Capability | Where |
|------------|--------|
| Waterfall order, bonus copy | **Goals** |
| Weak runway &lt; 2 mo | **Goals** banner; **Notifications** runway |
| Goal conflict & feasibility | **Goals** — SectionCard “Goal conflict & feasibility” (detectGoalConflict, goalFeasibilityCheck) |

## Security & privacy

| Capability | Where |
|------------|--------|
| Mask balances | **Settings**; Dashboard NW, cash strip; Summary NW + liquid rows; Accounts |

## Pages (nav)

Risk & Trading Hub · **Logic & Engines** (consolidated `services/*` wiring) · Financial Journal · Liquidation Planner (+ **Command palette** via `NAVIGATION_ITEMS`).

## Engine UX

New engine UIs: follow [`ENGINE_UX.md`](./ENGINE_UX.md) (`SectionCard` `infoHint`, personal data scope, client-side automation patterns).

## Logic & Engines hub

| Engines (examples) | `pages/LogicEnginesHub.tsx` |
|--------------------|-----------------------------|
| Returns / TWRR / attribution / benchmark | `returnMeasurementEngine`, `benchmarkService` |
| Strategy comparison | `strategyComparisonEngine` |
| Cash buckets, idle cash, sweeps, runway | `cashAllocationEngine`, `liquidityRunwayEngine` |
| FX | `fxEngine` |
| Seasonality / provisions | `seasonalityEngine`, `provisionEngine` |
| Retirement + sensitivity | `retirementEngine`, `sensitivityEngine` |
| Insurance baselines | `insuranceEngine` |
| Monte Carlo | `probabilisticPlanningEngine` |
| Assumptions validation | `planningAssumptionsEngine` |
| Behavioral + explainability | `behavioralControlEngine`, `explainabilityEngine` |
| Order ladders | `orderPlanning` |
| UX microcopy guards | `uxGuardrailsEngine` |
| Corporate actions demo | `corporateActions` |
| Risk lane | `riskLaneEngine` |
| Next-best actions | `nextBestActionEngine` |
| Shock drill + scenario timeline | `shockDrillEngine`, `scenarioTimelineEngine` |
| Cross-engine | `engineIntegration` |
| Lifestyle guardrails | `lifestyleGuardrailEngine` |

## AI

Grounding notes: [`AI_GROUNDING.md`](./AI_GROUNDING.md).

## Architecture & spec

- **Snapshots & review:** `createMonthlySnapshot`, `compareSnapshots`, `restoreHistoricalView`, `lockMonthEnd` (wired on **Risk & Trading hub**). Review cadence checklists (daily/weekly/monthly/quarterly/annual) from `reviewWorkflowEngine` (wired on **Risk & Trading hub**).
- **System layers:** [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md) — Data, Logic, Output, Automation.
- **Data model vs spec:** [`DATA_MODEL_SPEC.md`](./DATA_MODEL_SPEC.md) — entities and gaps.
- **51-point spec checklist:** [`GAP_SPEC_51.md`](./GAP_SPEC_51.md) — full status (done/partial/missing).

## New engines (logic layer)

| Engine | File | Purpose |
|--------|------|--------|
| Cash allocation | `services/cashAllocationEngine.ts` | allocateCashAcrossBuckets, detectIdleCash, suggestCashSweep, rankLiquiditySources |
| FX | `services/fxEngine.ts` | convertToBaseCurrency, realizedFXGain, unrealizedFXExposure, portfolioFXAllocation |
| Debt | `services/debtEngines.ts` | debtPayoffPlan, effectiveDebtCost, prepaymentSavings, debtStressScore |
| Next-best-action | `services/nextBestActionEngine.ts` | generateNextBestActions, rankUrgentFinancialActions (wired on Dashboard) |
| Explainability | `services/explainabilityEngine.ts` | explainBuyDecision, explainSellDecision, explainGoalDelay, explainRiskScore |
| Order planning | `services/orderPlanning.ts` | generateBuyTranches, generateSellTranches, stagedExitPlan, computeAverageEntryAfterPlannedAdds |
| Seasonality | `services/seasonalityEngine.ts` | seasonalityAdjustedExpense, annualExpenseMonthlyProvision, eventMonthStressCheck |
| Provisioning | `services/provisionEngine.ts` | monthlyProvisionNeeded, provisionFundingGap, reserveAdequacyCheck |
| Lifestyle guardrails | `services/lifestyleGuardrailEngine.ts` | discretionarySpendApproval, lifestyleGuardrailCheck, bonusUsePolicyCheck |
| Retirement | `services/retirementEngine.ts` | retirementTargetValue, retirementFundingGap, retirementProjection, safeWithdrawalEstimate |
| Insurance/protection | `services/insuranceEngine.ts` | coverageGapCheck, insuranceRenewalAlert, emergencyProtectionAdequacy |
| Corporate actions | `services/corporateActions.ts` | applyCorporateAction, recalculateCostBasisAfterAction, detectDelistedAssetRisk |
| Review workflows | `services/reviewWorkflowEngine.ts` | daily/weekly/monthly/quarterly/annual review checklists |
| Behavioral controls | `services/behavioralControlEngine.ts` | behavioralRiskCheck, enforceTradeCooldown, preventEmotionDrivenTrade |
| Probabilistic planning | `services/probabilisticPlanningEngine.ts` | simulateGoalCompletionProbability, simulatePortfolioRange, simulateCashShortfallRisk |
| Sensitivity analysis | `services/sensitivityEngine.ts` | sensitivityToReturn/Income/Inflation/ExpenseGrowth |
| Planning assumptions | `services/planningAssumptionsEngine.ts` | getPlanningAssumption, validateAssumptionRanges, assumptionImpactSummary |
| Reporting/export | `services/reportingEngine.ts` | generateMonthlyReport, generateAnnualWealthSummary, exportGoalStatus, exportPortfolioReview (wired in **Settings** Reports & export) |
| UX guardrails | `services/uxGuardrailsEngine.ts` | fieldHintEngine, statusBadgeEngine, userInputGuard, workflowShortcutMenu |
| Return measurement | `services/returnMeasurementEngine.ts` | simpleReturn, annualizedReturn, moneyWeightedReturn, timeWeightedReturn, benchmarkExcessReturn, totalReturnAttribution |
| Goal conflict | `services/goalConflictEngine.ts` | detectGoalConflict, goalFeasibilityCheck, reprioritizeConflictingGoals (wired on **Goals** page) |
| Reconciliation | `services/reconciliationEngine.ts` | reconcileHoldings, reconcileDividends, reconcileLiabilities, reconciliationExceptionReport (cash+holding wired to `SystemHealth`; report supports dividend/liability exceptions) |
| Exception handling | `services/exceptionHandlingEngine.ts` | validateSystemIntegrity, detectBrokenReferences, getExceptionQueue, repairSuggestionEngine (wired to `pages/SystemHealth.tsx`) |
| Fee/tax/obligation | — | Removed from product (no income-tax flows). Zakat remains on **Zakat** page only. |
| Strategy comparison | `services/strategyComparisonEngine.ts` | compareStrategies, compareAllocationModels, compareGoalPriorityRules |
| Thesis/journal | `services/thesisJournalEngine.ts` | createThesisRecord, thesisValidityCheck, journalOutcomeReview, thesisBreakAlert (wired to `pages/FinancialJournal.tsx`) |
| Decision scoring | `services/decisionScoringEngine.ts` | personalFinanceHealthScore, investmentCompositeScore, tradingSetupScore (personalFinanceHealthScore wired on **Dashboard**) |
| Debt intelligence | `services/debtEngines.ts` | debtPayoffPlan, debtStressScore (wired on **Liabilities** page) |

## Automated tests

| What | How |
|------|-----|
| Lint + TypeScript | `npm run test` (first stages) |
| Vitest unit tests | `npm run test` → `vitest run`; `tests/**/*.vitest.test.ts` (e.g. `normalizeFinnhubMarketSession`) |
| Engine integration (manual script) | `npx tsx tests/engineIntegration.test.ts` |

---

*When adding a feature, update this file and the phased TODO doc.*
