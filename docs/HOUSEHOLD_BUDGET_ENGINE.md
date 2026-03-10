# Household Budgeting Engine (Config-First)

## Scope
This engine powers the Plan page automation for monthly salary budgeting with dynamic household composition and low manual entry.

## What it now supports
- Monthly salary planning with month-level adults/kids overrides.
- Fixed obligations + annual/semiannual obligations auto-converted into monthly reserve logic.
- General required-expense coverage built-in: annual reserve, semiannual reserve, and other monthly required expenses with enable/disable controls.
- Separate buckets for:
  - fixed obligations
  - household essentials
  - household operations
  - transport (single-driver model + optional ride-support)
  - personal support (spouse/personal allowance, config-gated)
  - reserve savings
  - emergency savings
  - goal savings
  - kids future savings
  - retirement savings
  - investing
- Goal auto-routing using configurable priority (e.g., House -> Car -> Travel).
- Affordability and pressure warnings with recommendation output.
- Planned-vs-actual yearly summary and monthly projection output.
- Read-only calculated outputs separated from editable inputs/config.

## Privacy model
- Household profile is persisted per-user in local storage using key:
  - `household-profile-plan:<user_id>`
- This prevents one signed-in user from seeing another user's locally persisted profile values on shared devices.
- Core financial data remains sourced from DataContext user-scoped queries.

## Integration notes
- Engine service: `services/householdBudgetEngine.ts`
- Plan page integration: `pages/Plan.tsx`
- Optional cloud sync storage: `docs/household_budget_profiles.sql` + `household_budget_profiles` table.
- Demo scenarios are built into the engine service via `HOUSEHOLD_ENGINE_SAMPLE_SCENARIOS` for end-to-end validation.

## Migration notes
- No database schema migration is required for this release.
- Profile state is persisted locally per user and can optionally sync to DB when the optional migration is applied.
