-- Add linked_cash_account_id column to investment_transactions table

-- Add linked_cash_account_id column (UUID reference to accounts table)
alter table public.investment_transactions add column if not exists linked_cash_account_id uuid references public.accounts(id) on delete set null;

-- Add comment
comment on column public.investment_transactions.linked_cash_account_id is 'For deposit/withdrawal transactions: the cash account ID (Checking/Savings) that is the source (deposit) or destination (withdrawal) of the funds. Links investment platform cash flows to specific cash accounts.';

-- Add index for faster queries
create index if not exists idx_investment_transactions_linked_cash_account_id on public.investment_transactions(linked_cash_account_id) where linked_cash_account_id is not null;
