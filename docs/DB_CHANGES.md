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
- Budget sharing migration now also installs `get_pending_transactions_for_admin()` so Admin can load awaiting-approval transactions via security-definer RPC even when direct `transactions` reads are constrained by RLS.
- After applying migrations, refresh PostgREST schema cache (or wait briefly) so RPCs are available to the app.

- Household budgeting engine v2 adds no DB schema changes; it is config-first and persisted client-side per user profile key.

- If `docs/household_budget_profiles.sql` is not applied, Plan household engine still works with localStorage-only persistence.
