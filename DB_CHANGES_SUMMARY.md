# Database Changes Summary

This document lists all database schema changes referenced by the Accounts and Budgets pages.

## Accounts Page DB Changes

### Account Sharing Feature
**File:** `docs/account_sharing_ready.sql`

- **Table:** `public.account_shares`
  - Links account owners to recipients
  - Columns: `id`, `owner_user_id`, `shared_with_user_id`, `account_id`, `created_at`
  - Unique constraint on `(owner_user_id, shared_with_user_id, account_id)`
  - RLS policies for owner write and recipient read

- **Function:** `public.get_shared_accounts_for_me()`
  - Returns accounts shared with the current user
  - Includes owner email and account details

**File:** `docs/account_sharing_balance_visibility.sql`

- **Column:** `public.account_shares.show_balance`
  - Boolean column (default: true)
  - Controls whether shared account balance is visible to recipient
  - Updated `get_shared_accounts_for_me()` function to conditionally return balance

## Budgets Page DB Changes

### Budget Sharing Feature
**File:** `docs/budget_sharing_ready.sql`

- **Table:** `public.budget_shares`
  - Links budget owners to recipients
  - Columns: `id`, `owner_user_id`, `shared_with_user_id`, `owner_email`, `category` (nullable), `created_at`
  - Unique constraint on `(owner_user_id, shared_with_user_id, category)`
  - RLS policies for owner write and recipient read

- **Table:** `public.budget_shared_transactions`
  - Tracks transactions from contributors that affect shared budgets
  - Columns: `id`, `owner_user_id`, `contributor_user_id`, `contributor_email`, `source_transaction_id`, `budget_category`, `amount`, `transaction_date`, `description`, `status`, `created_at`
  - Unique constraint on `(owner_user_id, contributor_user_id, source_transaction_id)`
  - RLS policies for owner read and contributor read/write

- **Function:** `public.find_user_by_email(target_email text)`
  - Security definer function to find users by email
  - Returns: `id`, `email`
  - Used for budget sharing recipient lookup

- **Function:** `public.list_shareable_users()`
  - Returns list of users that can be shared with (Admin only)
  - Returns: `id`, `email`
  - Ordered by email

- **Function:** `public.get_shared_budgets_for_me()`
  - Returns budgets shared with the current user
  - Includes owner information and shared category details
  - Returns: `id`, `user_id`, `category`, `month`, `year`, `period`, `tier`, `limit`, `owner_user_id`, `owner_email`, `shared_category`, `shared_at`

- **Function:** `public.get_shared_budget_consumed_for_me()`
  - Returns consumed amounts for shared budgets
  - Aggregates spending from owner transactions and contributor transactions
  - Returns: `owner_user_id`, `category`, `consumed_amount`

### Household Budget Profiles
**File:** `docs/household_budget_profiles.sql`

- **Table:** `public.household_budget_profiles`
  - Stores household budget engine profiles per user
  - Columns: `user_id` (PK), `profile` (jsonb), `created_at`, `updated_at`
  - RLS policies for user's own data only
  - Used for cloud sync of household budget planning settings

### Multi-User Governance
**File:** `supabase/multi_user_governance.sql`

- **Table:** `public.users`
  - User roles: `Admin`, `Restricted`
  
- **Table:** `public.categories`
  - Budget categories with monthly limits and total spent tracking

- **Table:** `public.permissions`
  - Links restricted users to allowed categories

- **Table:** `public.budget_requests`
  - Request types: `NewCategory`, `IncreaseLimit`
  - Status: `Pending`, `Finalized`, `Rejected`

- **Transaction Status Columns:**
  - `public.transactions.status` (Pending/Approved/Rejected)
  - `public.transactions.category_id`
  - `public.transactions.rejection_reason`

- **Functions:**
  - `public.approve_pending_transaction(p_transaction_id uuid)`
  - `public.reject_pending_transaction(p_transaction_id uuid, p_reason text)`
  - `public.apply_approved_transaction_to_category(p_category_name text, p_amount numeric)`

## Recurring Transactions
**File:** `supabase/add_recurring_transactions.sql`

- **Table:** `public.recurring_transactions`
  - Template transactions that can be applied monthly
  - Columns: `id`, `user_id`, `description`, `amount`, `type`, `account_id`, `budget_category`, `category`, `day_of_month`, `enabled`, `created_at`

- **Column:** `public.transactions.recurring_id`
  - Optional UUID linking transactions to their recurring rule
  - Prevents double-application of recurring transactions

## Notes

- All RLS (Row Level Security) policies are enabled for multi-user security
- Functions use `security definer` for controlled access
- All changes are backward-compatible (use `if not exists`, `if exists` patterns)
- The application gracefully handles missing tables/functions with fallback behavior
