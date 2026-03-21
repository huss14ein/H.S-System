-- =============================================================================
-- Add created_at and updated_at to all public tables
-- =============================================================================
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- Backfills existing rows with now() where timestamp columns are null.
-- =============================================================================

-- 1. Add columns to all user-scoped / app tables (only if missing)
do $$
declare
  t text;
  tbls text[] := array[
    'accounts', 'assets', 'liabilities', 'goals', 'transactions', 'budgets',
    'settings', 'recurring_transactions', 'investment_portfolios', 'holdings',
    'investment_transactions', 'watchlist', 'zakat_payments', 'price_alerts',
    'commodity_holdings', 'planned_trades', 'investment_plan', 'portfolio_universe',
    'status_change_log', 'execution_logs', 'budget_requests', 'wealth_ultra_config',
    'users', 'categories', 'permissions'
  ];
begin
  foreach t in array tbls
  loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('alter table public.%I add column if not exists created_at timestamptz default now()', t);
      execute format('alter table public.%I add column if not exists updated_at timestamptz default now()', t);
    end if;
  end loop;
end $$;

-- 2. Backfill existing rows (set timestamps where null)
do $$
declare
  t text;
  tbls text[] := array[
    'accounts', 'assets', 'liabilities', 'goals', 'transactions', 'budgets',
    'settings', 'recurring_transactions', 'investment_portfolios', 'holdings',
    'investment_transactions', 'watchlist', 'zakat_payments', 'price_alerts',
    'commodity_holdings', 'planned_trades', 'investment_plan', 'portfolio_universe',
    'status_change_log', 'execution_logs', 'budget_requests', 'wealth_ultra_config',
    'users', 'categories', 'permissions'
  ];
begin
  foreach t in array tbls
  loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('update public.%I set created_at = coalesce(created_at, now()), updated_at = coalesce(updated_at, now()) where created_at is null or updated_at is null', t);
    end if;
  end loop;
end $$;

-- 3. Trigger: auto-update updated_at on row change (optional — uncomment to use)
/*
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

do $$
declare
  t text;
  tbls text[] := array[
    'accounts', 'assets', 'liabilities', 'goals', 'transactions', 'budgets',
    'settings', 'recurring_transactions', 'investment_portfolios', 'holdings',
    'investment_transactions', 'watchlist', 'zakat_payments', 'price_alerts',
    'commodity_holdings', 'planned_trades', 'investment_plan', 'portfolio_universe',
    'status_change_log', 'execution_logs', 'budget_requests', 'wealth_ultra_config',
    'users', 'categories', 'permissions'
  ];
begin
  foreach t in array tbls
  loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'updated_at') then
      execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
      execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
    end if;
  end loop;
end $$;
*/

-- =============================================================================
-- Done. Verify with: select table_name, column_name from information_schema.columns where table_schema = 'public' and column_name in ('created_at','updated_at') order by table_name;
-- =============================================================================
