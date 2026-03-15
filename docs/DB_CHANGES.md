# Database changes to apply

This project includes SQL scripts for sharing features. Run them in Supabase SQL editor (or your migration pipeline) in this order:

1. `docs/budget_sharing_ready.sql`
   - Enables budget sharing and collaboration workflows.
2. `docs/account_sharing_ready.sql`
   - Creates `account_shares` table, RLS policies, and `get_shared_accounts_for_me()` RPC for account sharing.
3. `docs/household_budget_profiles.sql` *(optional but recommended)*
   - Adds per-user cloud-sync storage for Plan household engine profile (`household_budget_profiles`) with strict owner-only RLS.

## Notes
- `docs/budget_sharing.sql` is an older helper script. Prefer `docs/budget_sharing_ready.sql` for complete setup.
- Budget sharing migration now also installs `get_shared_budget_consumed_for_me()` so shared users can see consumed totals of shared budgets (owner + collaborator approved spending) without exposing unrelated private data.
- After applying migrations, refresh PostgREST schema cache (or wait briefly) so RPCs are available to the app.

- Household budgeting engine v2 adds no DB schema changes; it is config-first and persisted client-side per user profile key.

- If `docs/household_budget_profiles.sql` is not applied, Plan household engine still works with localStorage-only persistence.

## Optional columns (app-compatible)

If you use budget destination routing or investment holdings with manual funds, ensure:

- **budgets.destination_account_id** (uuid, nullable): Optional account ID to route surplus/deficit for a budget. Add if missing:
  ```sql
  alter table public.budgets add column if not exists destination_account_id uuid references public.accounts(id);
  ```
- **holdings.holding_type** (text): Used when persisting holdings (e.g. `'ticker'` | `'manual_fund'`). Add if your schema uses it:
  ```sql
  alter table public.holdings add column if not exists holding_type text default 'ticker';
  ```
- **budget_requests**: Table and RLS are defined in `supabase/multi_user_governance.sql` and `supabase/all_db_changes_and_enhancements.sql`. Run one of those for governance/request workflows.
