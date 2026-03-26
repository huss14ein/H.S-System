# Household Budget Engine: Calculation Map

This document explains **how limits are calculated** and **where the formulas are defined**.

## Primary formula source

- File: `services/householdBudgetEngine.ts`
- Main generators:
  - `generateHouseholdBudgetCategories(...)` (bulk-add category limits)
  - `buildHouseholdBudgetPlan(...)` (month engine buckets/health/stress plan)
  - `computeBulkAddLimitsForSelection(...)` (reallocation when subset selected)

## Inputs used for category limits

- From `pages/Budgets.tsx`:
  - salary: `bulkAddSalary` (fallback: expected/suggested salary)
  - household size: `householdAdults`, `householdKids`
  - profile: `engineProfile`
  - target month: `bulkAddTargetMonth`

## Base monthly expense model

- `effectiveTemplateBaseExpense(monthlySalary, adults, kids)`
  - computes monthly base pool for template categories
  - uses `householdConsumptionScale(adults, kids)` to scale by household size

## Profile effects

- `tierProfileTilt(profile, tier)` and `tierAdjustedAmount(...)`
  - apply profile adjustment by tier (`Core`, `Supporting`, `Optional`)
- `groceryProfileSpendingMultiplier(profile)` + `groceryShareOfBaseExpense(...)`
  - special handling for grocery share behavior by profile/household size
- `deriveEngineProfileFromRiskProfile(current, riskProfileRaw)`
  - risk-profile auto sync in Budgets (default `Moderate` only; manual override preserved)

## Category definitions and percentages

Inside `generateHouseholdBudgetCategories(...)`:

- Monthly examples:
  - Utilities: `0.08 * baseExpense`
  - Telecommunications: `0.04 * baseExpense`
  - Transportation: `0.10 * baseExpense`
  - Savings & Investments: `0.15 * baseExpense` (with profile multiplier)
- Yearly examples:
  - Housing Rent: `0.30 * baseExpense * 12`
  - Iqama Renewal: `income * 0.02`
  - Zakat: `income * 0.025`
- Weekly examples:
  - Fresh Produce uses grocery/profile-adjusted logic and weekly conversion

All values are then passed through tier/profile adjustment helpers.

## Selection recalculation (deselect/select behavior)

- Function: `computeBulkAddLimitsForSelection(...)`
- Behavior:
  - all selected -> unchanged template values
  - subset selected -> reallocate **salary envelope** only across selected categories
  - none selected -> all limits become `0`
- Envelope definition:
  - `PROFILE_BULK_ENVELOPE_PCT` by profile
  - scaled by `householdConsumptionScale(adults, kids)`
  - capped with guardrails in function

## Month-engine override merge in Budgets UI

- File: `pages/Budgets.tsx`
- `bulkAddSuggestedCategories`:
  - starts from template via `generateHouseholdBudgetCategories(...)`
  - optionally merges current month engine buckets (`householdBudgetEngine.months[month].buckets`)
  - category mapping via `ENGINE_BUCKET_TO_CATEGORY`
  - period normalization via `ENGINE_BUCKET_TO_STORED_MULTIPLIER`
  - groceries guardrail keeps merged value from exceeding template cap

## Where totals shown in UI come from

- File: `pages/Budgets.tsx`
- `bulkAddDisplayCategories` = recalculated limits for current selection
- selected monthly total:
  - computed with `monthlyEquivalentFromBudgetLimit(...)` over selected rows
  - shown as “Selected: N categories · Monthly equivalent: X/mo”

## Regression tests

- File: `tests/householdBulkLimits.vitest.test.ts`
- Covers:
  - all-selected unchanged behavior
  - subset envelope allocation
  - aggressive vs conservative/growth envelope comparison
  - stale-name tolerance
  - none-selected zeros
  - profile mapping (`deriveEngineProfileFromRiskProfile`)
