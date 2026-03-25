-- Per-portfolio investment plan slices (JSON on investment_plan) and universe rows scoped to investment_portfolios.

-- 1) Plan slices stored as JSON map: { "portfolio-uuid": { monthly_budget, core_allocation, ... } }
alter table public.investment_plan
  add column if not exists plans_by_portfolio_id jsonb default '{}'::jsonb;

comment on column public.investment_plan.plans_by_portfolio_id is 'Per investment_portfolios.id plan overrides (monthly budget, allocations, sleeves). Must not nest plans_by_portfolio_id inside values.';

-- 2) Universe: optional portfolio scope
alter table public.portfolio_universe
  add column if not exists portfolio_id uuid references public.investment_portfolios(id) on delete cascade;

comment on column public.portfolio_universe.portfolio_id is 'When set, this ticker row applies only to this investment portfolio. NULL = legacy global row.';

-- Replace single unique (user_id, ticker) with partial uniques so the same ticker can exist per portfolio.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'portfolio_universe_user_id_ticker_key'
      and conrelid = 'public.portfolio_universe'::regclass
  ) then
    alter table public.portfolio_universe drop constraint portfolio_universe_user_id_ticker_key;
  end if;
exception when undefined_object then
  null;
end $$;

create unique index if not exists portfolio_universe_user_ticker_legacy
  on public.portfolio_universe (user_id, ticker)
  where portfolio_id is null;

create unique index if not exists portfolio_universe_user_portfolio_ticker
  on public.portfolio_universe (user_id, portfolio_id, ticker)
  where portfolio_id is not null;

create index if not exists idx_portfolio_universe_portfolio_id on public.portfolio_universe (portfolio_id);
