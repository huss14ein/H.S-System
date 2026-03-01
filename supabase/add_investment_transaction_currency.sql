-- Add optional currency to investment_transactions for record-keeping (USD / SAR).
-- Defaults to NULL for existing rows; new trades can store the currency they were recorded in.

alter table public.investment_transactions
  add column if not exists currency text check (currency is null or currency in ('USD', 'SAR'));

comment on column public.investment_transactions.currency is 'Currency the trade was recorded in (for display and reporting).';
