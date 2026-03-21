# Bug fixes log

Consolidated log of bugs fixed. Use for audits and to avoid regressions.

---

## Schema & field conventions

| Entity | Correct field | Wrong field | Notes |
|--------|---------------|------------|-------|
| Liability | `amount` | `balance` | Debts: `amount < 0`; receivables: `amount > 0` |
| Account | `balance` | — | — |

---

## Fixes ( chronological )

### 1. Weekly digest: liabilities use `amount` not `balance`
- **File:** `supabase/functions/send-weekly-digest/index.ts`
- **Issue:** Net worth used `l.balance` for liabilities; schema uses `amount`.
- **Fix:** Use `amount`; debt = `|amount|` when `amount < 0`; receivable = `amount` when `amount > 0`.

### 2. Balance validation during transaction deltas
- **File:** `services/dataQuality/validation.ts`, `context/DataContext.tsx`
- **Issue:** `validateAccount` rejected negative balances, blocking expense-driven deltas.
- **Fix:** Add `opts?: { allowNegativeBalance?: boolean }`. When `fromTransactionDelta`, pass `{ allowNegativeBalance: true }`.

### 3. AI category suggestion: case-insensitive match
- **File:** `services/geminiService.ts`
- **Issue:** Capitalized categories broke exact match; AI returned "Food" when user had "food".
- **Fix:** Try exact match first, then case-insensitive match; return user's exact string. Use `capitalizeCategoryName` only when no match.

### 4. Duplicate `calculateBudgetSummary` in digest
- **File:** `supabase/functions/send-weekly-digest/index.ts`
- **Issue:** `getAlerts` recalculated budget summary.
- **Fix:** Pass precomputed `budgetSummary` into `getAlerts`.

### 5. Budget period normalization in digest
- **File:** `supabase/functions/send-weekly-digest/index.ts`
- **Issue:** Weekly/daily/yearly budgets not converted to monthly equivalent.
- **Fix:** Add `monthlyEquivalentFromLimit` (yearly→`/12`, weekly→`*52/12`, daily→`*365/12`, monthly→unchanged).

### 6. MWRR currency mismatch
- **File:** `services/portfolioXirr.ts`, `pages/RiskTradingHub.tsx`, `pages/DividendTrackerView.tsx`
- **Issue:** Flows in USD, terminal value in SAR caused incorrect MWRR.
- **Fix:** Add `flowsFromInvestmentTransactionsInSAR`; convert flows with `toSAR()` so flows and terminal value are SAR.

### 7. `budgets.period` DB constraint
- **Files:** `supabase/UNIFIED_PRODUCTION_DB_SETUP.sql`, `supabase/budgets_period_weekly_daily.sql`
- **Issue:** CHECK only allowed `monthly`/`yearly`.
- **Fix:** Migration adds `weekly` and `daily` to constraint.

### 8. HTML injection in digest emails
- **File:** `supabase/functions/send-weekly-digest/index.ts`
- **Issue:** User-controlled text in HTML template.
- **Fix:** Add `escapeHtml()` for `userName`, `periodEnd`, `overCategories`, `alerts`.

### 9. `min_coverage_threshold` validation
- **File:** `services/dataQuality/validation.ts`
- **Issue:** Treated as 0–1 fraction; spec is analyst count (0–50).
- **Fix:** Use `Number.isInteger(coverage)` and range 0–50.

### 10. `validateLiability` rejecting debt amounts
- **File:** `services/dataQuality/validation.ts`
- **Issue:** Required positive amount; debt types must be negative.
- **Fix:** Debt types (Mortgage, Loan, etc.) require `amount < 0`; Receivable requires `amount > 0`.

### 11. Weekly digest net worth missing holdings/commodities
- **File:** `supabase/functions/send-weekly-digest/index.ts`
- **Issue:** Digest NW was accounts + assets − liabilities; dashboard included investments + commodities.
- **Fix:** Query holdings and commodities; include in `calculateNetWorth` with `holdingValueToSAR`.

### 12. Budget period validation
- **File:** `services/dataQuality/validation.ts`, `context/DataContext.tsx`
- **Issue:** `validateBudget` did not validate `period`; invalid values could reach DB.
- **Fix:** Add optional `period` validation; allow `monthly`, `yearly`, `weekly`, `daily`. Pass `period` from add/update Budget.

### 13. Backup restore: liability validation
- **File:** `services/dataQuality/validation.ts`
- **Issue:** `validateBackup` only sampled accounts and transactions; corrupt liabilities could be restored.
- **Fix:** Sample `liabilities` with `validateLiability`; use `amount ?? balance` for legacy backups.

---

## Pre-review checklist

Use before merging to catch common failure patterns:

1. **Schema alignment:** Any use of `liability.balance` → use `amount`. Debts negative, receivables positive.
2. **Currency consistency:** MWRR, NW, and conversions: same currency (SAR or USD) in same formula.
3. **Validation scope:** New entities → add to `validateBackup` when restore-able.
4. **Period support:** Budgets with `weekly`/`daily` → `monthlyEquivalentFromLimit` in summaries/reports.
5. **HTML output:** User-controlled strings in emails/HTML → escape.
6. **Balance validation:** Transaction-delta updates → `allowNegativeBalance: true` when appropriate.
7. **DB constraints:** New enum-ish values (e.g. `period`) → migration if DB has CHECK.

---

*Last updated: 2025-03.*
