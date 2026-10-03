-- Optional columns referenced by the app (DataContext / holdings). Idempotent.

-- SMS card last-4 persistence (also in 20261003170000_accounts_platform_details_card_last4.sql)
alter table if exists public.accounts
  add column if not exists platform_details jsonb;

comment on column public.accounts.platform_details is
  'JSON metadata for cash accounts (features, assetTypes, fees, cardLast4). cardLast4 mirrors Account.lastFourDigits for SMS auto-routing.';

-- Budget surplus/deficit routing (see docs/DB_CHANGES.md)
alter table if exists public.budgets
  add column if not exists destination_account_id uuid references public.accounts(id) on delete set null;

comment on column public.budgets.destination_account_id is 'Optional account to associate with budget routing / surplus targets';

-- Holding row type (ticker vs manual fund)
alter table if exists public.holdings
  add column if not exists holding_type text default 'ticker';

comment on column public.holdings.holding_type is 'ticker | manual_fund — matches app Holding.holdingType';

-- Goals: persist priority (same as add_goals_priority.sql — safe if both run)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'goals'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'goals' and column_name = 'priority'
  ) then
    alter table public.goals
      add column priority text not null default 'Medium'
        check (priority in ('High', 'Medium', 'Low'));
  end if;
end $$;

comment on column public.goals.priority is 'Funding priority for surplus routing (High | Medium | Low). Matches Goal.priority in the app.';
