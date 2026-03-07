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
- After applying migrations, refresh PostgREST schema cache (or wait briefly) so RPCs are available to the app.

- Household budgeting engine v2 adds no DB schema changes; it is config-first and persisted client-side per user profile key.

- If `docs/household_budget_profiles.sql` is not applied, Plan household engine still works with localStorage-only persistence.
