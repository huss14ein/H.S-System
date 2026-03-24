-- Optional: denomination for Checking/Savings/Credit balances and transfer amounts (SAR vs USD).
-- App works without this column (defaults via investment plan / SAR).
alter table public.accounts
  add column if not exists currency text check (currency is null or currency in ('SAR', 'USD'));

comment on column public.accounts.currency is 'Balance/transfer denomination for cash & credit accounts';
