-- Optional columns referenced by the app (DataContext / holdings). Idempotent.

-- Budget surplus/deficit routing (see docs/DB_CHANGES.md)
alter table if exists public.budgets
  add column if not exists destination_account_id uuid references public.accounts(id) on delete set null;

comment on column public.budgets.destination_account_id is 'Optional account to associate with budget routing / surplus targets';

-- Holding row type (ticker vs manual fund)
alter table if exists public.holdings
  add column if not exists holding_type text default 'ticker';

comment on column public.holdings.holding_type is 'ticker | manual_fund — matches app Holding.holdingType';
