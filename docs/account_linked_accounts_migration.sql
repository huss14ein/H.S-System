-- Add linked_account_ids column to accounts table for Investment platform account mapping

-- Add linked_account_ids column (JSONB array of account IDs)
alter table public.accounts add column if not exists linked_account_ids jsonb default null;

-- Add comment
comment on column public.accounts.linked_account_ids is 'For Investment type accounts: array of cash account IDs (Checking/Savings) that can fund this platform. Used to restrict deposit/withdrawal source/destination accounts.';

-- Add index for faster queries
create index if not exists idx_accounts_linked_account_ids on public.accounts using gin (linked_account_ids) where linked_account_ids is not null;
