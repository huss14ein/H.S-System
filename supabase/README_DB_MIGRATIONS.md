# Database migrations and enhancements

Run scripts in the **Supabase SQL editor** in the order below. All scripts are idempotent unless noted.

## One-shot production setup (recommended)

After your **base** tables exist (`accounts`, `transactions`, `budgets`, `settings`, etc.), run:

| File | Purpose |
|------|---------|
| **`UNIFIED_PRODUCTION_DB_SETUP.sql`** | Single script: full schema extensions (`investment_plan`, `execution_logs`, …), recurring transactions, `budget_category`, and **RLS** for all user-scoped tables. |

This replaces running `run_these_for_app.sql` → `full_schema_for_app.sql` → `add_recurring_*` → `ensure_transactions_budget_category.sql` → `rls_all_user_tables.sql` separately (content is merged and deduplicated).

---

## Required (core app) — granular order (if not using the unified file)

| Order | File | Purpose |
|-------|------|--------|
| 1 | `run_these_for_app.sql` | Settings columns (gold_price, risk_profile, etc.) and budgets `period` (monthly/yearly). |
| 2 | `full_schema_for_app.sql` | Investment plan, wealth_ultra_config, portfolio_universe, status_change_log, execution_logs, budgets tier, RLS (optional). |
| 3 | `add_recurring_transactions.sql` | Table `recurring_transactions` and `transactions.recurring_id`. |
| 4 | `add_recurring_add_manually.sql` | Recurring flag `add_manually` (do not auto-record on day). |
| 5 | `ensure_transactions_budget_category.sql` | Column `transactions.budget_category` for expense tracking. |
| 6 | `budgets_period_weekly_daily.sql` | Allow `weekly` and `daily` in `budgets.period` (run after budgets have period column). |

## Optional (features and fixes)

| File | Purpose |
|------|--------|
| `budgets_period_column.sql` | Same as period in run_these; use if you only need budgets period. |
| `add_investment_portfolio_currency.sql` | `investment_portfolios.currency` (USD/SAR). |
| `add_investment_transaction_currency.sql` | `investment_transactions.currency`. |
| `add_price_alert_currency.sql` | `price_alerts.currency`. |
| `add_deposit_withdrawal_transaction_types.sql` | Allow `deposit` and `withdrawal` in investment_transactions. |
| `fix_investment_account_fk.sql` | Backfill and FK for investment_transactions.account_id. |
| `rls_policies_optional.sql` | Row Level Security policies for investment_* tables (if using Supabase Auth). |
| `rls_all_user_tables.sql` | **Production:** RLS for all user-scoped tables (accounts, assets, transactions, budgets, goals, etc.). Run after base tables exist. |
| `multi_user_governance.sql` | Users, categories, permissions, budget_requests, transaction status/approval. |
| `all_db_changes_and_enhancements.sql` | Governance + optional planned_trades columns and trade_execution_audit. |
| `optional_investment_enhancements.sql` | planned_trades analytics columns (planned_entry_price, stop_loss, etc.). |
| `rebuild_investments_tables_from_scratch.sql` | **Destructive.** Recreates investment_portfolios, holdings, investment_transactions. |
| `migrations/add_transactions_note.sql` | **`transactions.note`** — memos + split-expense encoding (`__FINOVA_SPLITS__`). Recommended if you use split categories. |
| `migrations/add_financial_statements_table.sql` | Statement history metadata + `extracted_transactions`. |
| `migrations/add_financial_statements_storage.sql` | `financial_statements.storage_bucket` / `storage_path` for original files (see `docs/supabase_storage_financial_statements.md`). |
| `migrations/add_optional_schema_extras.sql` | `budgets.destination_account_id`, `holdings.holding_type`. |
| `migrations/add_investment_plan_fx_rate_updated_at.sql` | `investment_plan.fx_rate_updated_at`. |
| `migrations/add_owner_column_wealth_segmentation.sql` | `owner` on accounts, assets, liabilities, commodities, portfolios. |
| `add_timestamps_all_tables.sql` | Add `created_at` and `updated_at` to all app tables; backfill existing rows. |

## One-time “run all required” (minimal)

If you already have base tables (accounts, assets, transactions, etc.), run in this order:

1. `run_these_for_app.sql`
2. `full_schema_for_app.sql`
3. `add_recurring_transactions.sql`
4. `add_recurring_add_manually.sql`
5. `ensure_transactions_budget_category.sql`

Then add any optional scripts you need (currency columns, governance, etc.).

## App ↔ DB column names

- The app uses **camelCase** in TypeScript; the DB uses **snake_case**.
- Inserts/updates for `transactions` send `recurring_id` and `budget_category` (converted from `recurringId` and `budgetCategory` in DataContext).
- Select responses are normalized in the app from snake_case (e.g. `budget_category` → `budgetCategory`).

## Notes

- **wealth_ultra_config**: Table exists in schema; the app currently uses in-memory defaults from `getDefaultWealthUltraSystemConfig()` and does not read/write this table. You can use it later for per-user overrides.
- **Budgets period**: DB only supports `monthly` and `yearly`. The UI also offers Weekly/Daily; those are converted to a monthly-equivalent amount and stored as `period = 'monthly'`.
