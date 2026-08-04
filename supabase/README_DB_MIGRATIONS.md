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

## Approve signups (Settings → admin pending users)

If **Settings** fails to load **pending signups** (HTTP 400, unknown column `approved`, or PostgREST cannot apply `approved=eq.false`), run **`migrations/add_user_approval.sql`** in the Supabase SQL editor. It:

- Adds **`approved boolean`** (and **`email`**) on **`public.users`**
- Enables **RLS** with policies so each user reads their own row and **Admins** can `select` all users and `update` approvals
- Defines **`is_admin_user()`**, **`approve_signup_user`**, **`reject_signup_user`**
- Adds an **`auth.users` → `public.users`** trigger so new signups start with **`approved = false`**

Then promote your admin once:

```sql
update public.users
set role = 'Admin', approved = true
where email = 'your-admin@example.com';
```

Run **`migrations/20260523140000_strict_user_data_isolation.sql`** so each user only reads their own financial rows (shared budgets/accounts still use the share RPCs). Run **`migrations/20260523120000_ensure_user_profile_bootstrap.sql`** if you see **Account Pending Approval** after login but you are the project owner (missing `public.users` row, `approved` is NULL, or no approved Admin exists yet). It backfills auth users, fixes NULL `approved`, and adds **`ensure_own_user_profile()`** (the app calls this on login when needed). Run **`migrations/20260531200000_approve_verified_email_users.sql`** after the bootstrap migration — auto-approves verified-email users stuck on `approved=false` and updates `ensure_own_user_profile()` (fixes mobile login when RPC/read returns a stale row). Run **`migrations/20260601180000_first_auth_user_owner_bootstrap.sql`** so the **first auth signup (project owner)** is always auto-approved and ghost admin rows no longer block access.

Optionally run **`migrations/add_users_approved_metadata.sql`** afterward for a column comment and a partial index on pending rows.

## Optional (features and fixes)

| File | Purpose |
|------|--------|
| `budgets_period_column.sql` | Same as period in run_these; use if you only need budgets period. |
| `add_investment_portfolio_currency.sql` | `investment_portfolios.currency` (USD/SAR). |
| `add_investment_transaction_currency.sql` | `investment_transactions.currency`. |
| `add_price_alert_currency.sql` | `price_alerts.currency`. |
| `add_deposit_withdrawal_transaction_types.sql` | Allow `deposit` and `withdrawal` in investment_transactions. |
| **`migrations/20260715120000_investment_transactions_portfolio_id.sql`** | **Required for Record Trade / CA / statement import:** nullable `investment_transactions.portfolio_id` + indexes. Keeps all existing rows (`NULL` until stamped by new trades). |
| **`migrations/20260715121000_investment_transactions_fee_vat_types.sql`** | Allow `fee` and `vat` on `investment_transactions` (statement import broker fees). |
| **`migrations/20260715122000_backfill_investment_transactions_portfolio_id.sql`** | Optional but recommended: stamp `portfolio_id` on legacy txs when the account has **exactly one** portfolio. |
| **`migrations/20260722120000_holdings_unique_per_portfolio_symbol.sql`** | **Required to stop ghost shares after Record Trade:** dedupe duplicate holdings (exact ledger-net match, else newest id — never sum), then unique index on `(user_id, portfolio_id, upper(symbol))`. |
| **`migrations/20260725120000_holdings_market_price_persistence.sql`** | **Required to persist trusted API marks:** adds `current_price` / `price_updated_at` and one scoped batch RPC that updates market fields only (never quantity or average cost). |
| **`migrations/20260804120000_holdings_unrealized_pnl_persistence.sql`** | **Required to persist unrealized P/L with marks:** adds `unrealized_pnl` and extends `update_holding_market_values` so P/L is stored like share price (still never quantity / avg cost / realized P/L). |
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
| `migrations/add_optional_schema_extras.sql` | `budgets.destination_account_id`, `holdings.holding_type`, **`goals.priority`** (`High` / `Medium` / `Low`). |
| `migrations/add_goals_priority.sql` | Same **`goals.priority`** column as above — dedicated migration if you do not re-run optional extras. Idempotent. |
| `migrations/add_investment_plan_fx_rate_updated_at.sql` | `investment_plan.fx_rate_updated_at`. |
| `migrations/add_owner_column_wealth_segmentation.sql` | `owner` on accounts, assets, liabilities, commodities, portfolios. |
| `migrations/add_user_approval.sql` | See **[Approve signups](#approve-signups-settings--admin-pending-users)** above. |
| `migrations/20260523120000_ensure_user_profile_bootstrap.sql` | Backfill `public.users` from `auth.users`; bootstrap first Admin when none approved. |
| `migrations/20260523140000_strict_user_data_isolation.sql` | Scope admin pending-tx RPCs to `auth.uid()`; RLS on journal/thesis/snapshots; own-row `budget_requests`. |
| `migrations/add_users_approved_metadata.sql` | Comment + index for `users.approved` (after `add_user_approval.sql`). |
| `migrations/add_assets_sukuk_dates.sql` | `assets.issue_date`, `assets.maturity_date` for Sukuk. |
| `add_timestamps_all_tables.sql` | Add `created_at` and `updated_at` to all app tables; backfill existing rows. |

## One-time “run all required” (minimal)

If you already have base tables (accounts, assets, transactions, etc.), run in this order:

1. `run_these_for_app.sql`
2. `full_schema_for_app.sql`
3. `add_recurring_transactions.sql`
4. `add_recurring_add_manually.sql`
5. `ensure_transactions_budget_category.sql`

Then add any optional scripts you need (currency columns, governance, etc.).

**Also required for Record Trade ghost-holdings lock** (if not already applied):

- `migrations/20260722120000_holdings_unique_per_portfolio_symbol.sql` — dedupe + unique `(user_id, portfolio_id, upper(symbol))`

## Live data: never rebuild investment tables

`rebuild_investments_tables_from_scratch.sql` **drops and recreates** `investment_portfolios`,
`holdings`, and `investment_transactions`. Never run it on a database with real data — it is only
for a clean/empty environment. Every investment fix ships as an **additive migration** instead, so
you never need it.

The required investment migrations are all safe on live data: they add nullable columns, indexes,
and RPCs. None drops a table, truncates, or removes a column.

| Migration | What it changes |
| --- | --- |
| `20260715120000_investment_transactions_portfolio_id.sql` | Adds nullable `portfolio_id` + indexes. Existing rows keep their data. |
| `20260715122000_backfill_investment_transactions_portfolio_id.sql` | Stamps `portfolio_id` on legacy rows only where the account has exactly one portfolio. |
| `20260722120000_holdings_unique_per_portfolio_symbol.sql` | Removes **duplicate** holdings rows for the same `(user, portfolio, symbol)`, then adds the unique index. Archives every removed row first (see below). |
| `20260725120000_holdings_market_price_persistence.sql` | Adds `current_price` / `price_updated_at` and a batch RPC that writes market fields only. |
| `20260804120000_holdings_unrealized_pnl_persistence.sql` | Adds `unrealized_pnl` and extends the market RPC so unrealized P/L is stored with each trusted mark. |
| `20260726120000_reconciliation_adjustment_engine.sql` | **Adjustment & Reconciliation Engine:** append-only `reconciliation_adjustments` / `reconciliation_runs` / `reconciliation_audit_events` / `net_worth_snapshot_revisions`, plus `preview`/`apply`/`reverse` cash reconcile RPCs. Additive only. |
| `20260726140000_corporate_action_stock_dividend.sql` | Widen `corporate_action_events.action_type` CHECK to include `stock_dividend` (bonus shares). Additive constraint widen only. |
| `20260726180000_rewards_domain.sql` | **Rewards / points / cashback ledger:** `rewards_accounts` / `rewards_transactions` / `rewards_tx_links` / `rewards_lots` with idempotency + RLS. Manual balances only (no live loyalty APIs). Additive only. |
| `20260726190000_household_members.sql` | **Household members:** `household_members` + `member_allocations` (per-member monthly allowance / education envelopes) with RLS. Additive only. |
| `20260726200000_period_locks_and_foundations.sql` | **Foundations:** `period_locks` (durable closed-month SOT), `vault_documents`, `subscriptions`, `pension_accounts`, `estate_beneficiaries` with RLS. Debt amortization is computed in-service (no table). Additive only. |
| `20260726210000_settings_rewards_and_emergency_fund.sql` | Adds `settings.include_rewards_in_net_worth` (default true) and `settings.emergency_fund_months_target` (default 6, 1–24) so the Rewards net-worth toggle and Available Liquidity floor survive a refresh. Additive only. |

Deploy Edge Function (optional replay worker): `supabase functions deploy reconciliation-replay`.

Deploy Edge Function (rewards expiry cron — schedule daily in dashboard after deploy): `supabase functions deploy rewards-expiry-scan`.
Set secret `REWARDS_EXPIRY_SCAN_SECRET` and pass header `x-rewards-expiry-secret: <secret>` (or `Authorization: Bearer <secret>`) on the cron invoke — the function rejects unauthenticated calls.

### The one delete, and how to undo it

The dedupe migration is the only script that removes rows, and it removes only ghost duplicates —
the extra rows that made quantities re-sum (LCID 500 + 1390 → 1890). Each removed row is copied into
`public.holdings_dedupe_backup` as JSON before deletion, so nothing is unrecoverable. Re-running the
file is harmless: once the unique index exists there is nothing left to remove.

Inspect what was removed:

```sql
select removed_at, row_data->>'symbol' as symbol, row_data->>'quantity' as quantity, row_data
from public.holdings_dedupe_backup
order by removed_at desc;
```

Restore one archived row (only if you are sure it is not a ghost — it will conflict with the unique
index if the symbol already has a row in that portfolio):

```sql
insert into public.holdings
select (jsonb_populate_record(null::public.holdings, row_data)).*
from public.holdings_dedupe_backup
where backup_id = '<backup_id>';
```

## App ↔ DB column names

- The app uses **camelCase** in TypeScript; the DB uses **snake_case**.
- Inserts/updates for `transactions` send `recurring_id` and `budget_category` (converted from `recurringId` and `budgetCategory` in DataContext).
- Select responses are normalized in the app from snake_case (e.g. `budget_category` → `budgetCategory`).

## Notes

- **wealth_ultra_config**: Table exists in schema; the app currently uses in-memory defaults from `getDefaultWealthUltraSystemConfig()` and does not read/write this table. You can use it later for per-user overrides.
- **Budgets period**: DB only supports `monthly` and `yearly`. The UI also offers Weekly/Daily; those are converted to a monthly-equivalent amount and stored as `period = 'monthly'`.
