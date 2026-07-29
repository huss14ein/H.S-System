# Database migrations reference

Apply these in order when setting up or updating the app database.

## Supabase SQL (run in SQL editor)

- **holdings_asset_class_check.sql** — Fixes the `holdings.asset_class` check constraint so it accepts all app values (e.g. Stock, ETF, Sukuk, Commodity, etc.). Resolves: `new row for relation "holdings" violates check constraint "holdings_asset_class_check"`.

- **Household budget profiles (cloud sync)** — Table used by the Plan page for syncing household budget engine profile per user. Script: `docs/household_budget_profiles.sql`. Creates `public.household_budget_profiles` with RLS so each user can only read/write their own row.

- **Salary investing settings** — Adds `public.settings.salary_investing_targets` JSONB for monthly salary-to-investment targets, allocation splits, attribution hints, and alert lag. Script: `supabase/migrations/20260728170500_settings_salary_investing_targets.sql`.

## Notes

- Other SQL files in `supabase/` (e.g. `run_these_for_app.sql`, `full_schema_for_app.sql`) may be used for initial setup or full schema; the items above are the migrations specifically referenced by the investment, salary-investing, and Plan features.
