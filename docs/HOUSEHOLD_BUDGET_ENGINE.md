# Household Budget Engine (Automated)

## What it does

The engine uses **your existing data** (transactions, accounts, goals) to project monthly cash flow and how much you can put toward goals. It is designed to be **fully automated with minimal manual entry**.

- **Income & expense**: Taken from transactions for the selected year (by month).
- **Liquid / reserve**: From Checking and Savings accounts.
- **Goals**: From your goals list; surplus is auto-routed to the highest-priority goal.
- **Salary for future months**: If a month has no income yet, the engine uses your optional "expected monthly salary" or the **average of actual income** so far.

You only need to set:

1. **Profile** – Conservative | Moderate | Growth (one click; controls safety vs growth).
2. **Household** – Adults and kids (defaults: 2 adults, 0 kids).
3. **Expected monthly salary** (optional) – For months with no data; leave empty to use actuals + average.

No manual buckets, no long tables. Advanced users can still open "Advanced: monthly overrides & scenarios" to tweak specific months or load example scenarios.

**Automation enhancements:**

- **Goal priority**: Sorted automatically by remaining amount (largest first); no manual priority list.
- **Obligations**: When using transaction-based input, the engine can infer obligation and reserve estimates from your expense history (`inferObligationsFromHistory`, on by default).
- **Profile suggestion**: If monthly income varies a lot (coefficient of variation > 0.25), the engine suggests the Conservative profile and adds a recommendation.
- **Richer recommendations**: Emergency-on-track message, goal-routing explanation, and variance-based profile hint.

## Profiles

| Profile       | Use when                         | Behavior |
|---------------|-----------------------------------|----------|
| **Conservative** | Income is variable; want more safety | Higher emergency & reserve; lower investing. |
| **Moderate**  | Default for most households       | Balanced safety and growth. |
| **Growth**    | Income is stable; want more growth | Higher investing and goal savings; lower reserve. |

## Where it runs

- **Budgets page** → "Household Engine" tab: main automated view (profile, optional salary, adults/kids, key metrics, recommendations). When the engine suggests Conservative due to income variance, a hint is shown.
- **Plan page**: Uses the same engine via `buildHouseholdEngineInputFromPlanData` (planned/actual from Plan rows). Profile, expected salary, adults, kids, and overrides are **shared** with Budgets via `household-profile:<user_id>`.

## Technical

- **Auto input (transactions)**: `buildHouseholdEngineInputFromData(transactions, accounts, goals, options)` — income/expense from transactions; optional `expectedMonthlySalary`, `adults`, `kids`, `profile`, `monthlyOverrides`, `inferObligationsFromHistory` (default true).
- **Auto input (Plan)**: `buildHouseholdEngineInputFromPlanData(monthlyIncomePlanned, monthlyIncomeActual, monthlyExpenseActual, accounts, goals, options)` — same options, for Plan page data.
- **Helpers**: `suggestProfileFromIncomeVariance(monthlyActualIncome)` returns `'Conservative'` when variance is high; `inferObligationsFromTransactions(transactions, year)` returns partial config for obligations/required expenses.
- **Presets**: `HOUSEHOLD_ENGINE_PROFILES` (Conservative, Moderate, Growth).
- **Persistence**: Profile, expected salary, adults, kids, and overrides in localStorage under `household-profile:<user_id>`. Budgets and Plan read/write the same key so choices stay in sync.

## Privacy

- Household profile is per-user in local storage (`household-profile:<user_id>`).
- Core financial data comes from DataContext (user-scoped).

## Optional DB sync

- `docs/household_budget_profiles.sql` adds a `household_budget_profiles` table for cloud sync of the profile. If not applied, the engine still works with localStorage only.
