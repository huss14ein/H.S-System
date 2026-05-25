# Per-user data isolation (E2E)

Finova is **multi-tenant**: each login sees only their own financial data unless they **explicitly share** a budget or account.

## Layers (all required in production)

| Layer | What it does |
|-------|----------------|
| **Supabase RLS** | `auth.uid() = user_id` on all financial tables — run `supabase/rls_all_user_tables.sql` plus `migrations/20260523140000_strict_user_data_isolation.sql`. |
| **DataContext** | Every fetch uses `.eq('user_id', auth.user.id)` and `filterOwnedRows`. |
| **Auth gate** | `App.tsx` blocks until `approved` (Admins bypass via `role = Admin`). Login calls `ensure_own_user_profile()`. |
| **Share RPCs only** | Cross-user reads go through `get_shared_budgets_for_me` / `get_shared_accounts_for_me` — never global `select *` on budgets/accounts. |

## Migrations to apply (SQL editor, in order)

1. `migrations/add_user_approval.sql` (if not applied)
2. `migrations/20260523120000_ensure_user_profile_bootstrap.sql`
3. `rls_all_user_tables.sql`
4. `migrations/20260522120000_enhancement_rollout.sql`
5. `migrations/20260523140000_strict_user_data_isolation.sql`
6. Sharing: `docs/budget_sharing_ready.sql` + `migrations/fix_shared_accounts_and_budgets_rpc_bypass_rls.sql` (if sharing is used)

## What “Admin” means

- **Admin** = extra capabilities on **your own** data (budget tools, signup approval in Settings).
- **Not** a super-user who can browse everyone’s accounts, budgets, or net worth.
- Pending signups in Settings still list other users’ **emails** (approval workflow only).

## Sharing

- Budgets / Accounts: enter recipient **email** → `find_user_by_email` (no user directory list).
- Recipient sees shared rows only via share RPCs; nothing else from the owner.

## App surfaces audited

- All pages load financial data through **DataContext** (user-scoped) or share RPCs.
- Transactions pending queue: own `user_id` only (+ scoped RPC).
- Notifications: own `budget_requests` and shared txs where you are **owner**.
- Thesis/journal: `services/investmentThesisStore.ts` filters by `user_id`.
- Statements: `financial_statements` — ensure RLS + `user_id` on inserts (StatementProcessingContext).

## Verify after deploy

1. Two test accounts A and B with data in each.
2. Log in as A — confirm B’s amounts never appear.
3. Share one budget from A → B; B sees only that budget via shared section, not A’s accounts.
4. Admin account: `approved = true`, reaches Dashboard without pending screen.
