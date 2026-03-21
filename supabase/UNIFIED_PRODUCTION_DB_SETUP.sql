-- =============================================================================
-- UNIFIED PRODUCTION DB SETUP (Finova / H.S-System)
-- =============================================================================
-- Run this ONCE in the Supabase SQL Editor after your base app tables exist
-- (accounts, transactions, budgets, settings, goals, liabilities, assets, etc.).
--
-- This file combines, in order:
--   1) Full app schema extensions (settings columns, investment_plan, execution_logs, …)
--   2) Recurring transactions + transaction links
--   3) transactions.budget_category
--   4) Row Level Security on all user-scoped tables (production)
--
-- Safe to re-run: uses IF NOT EXISTS / idempotent patterns where possible.
-- If a step fails (e.g. missing parent table), fix the prerequisite and re-run.
--
-- For optional extras (statements storage, governance, currency columns), see
-- supabase/README_DB_MIGRATIONS.md.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- PART A — Full schema extensions (from full_schema_for_app.sql)
-- -----------------------------------------------------------------------------

-- 1. Settings: ensure all columns exist (snake_case for DB; includes weekly email flag)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'settings' and column_name = 'gold_price') then
    alter table public.settings add column gold_price numeric default 275;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'settings' and column_name = 'risk_profile') then
    alter table public.settings add column risk_profile text default 'Moderate';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'settings' and column_name = 'budget_threshold') then
    alter table public.settings add column budget_threshold numeric default 90;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'settings' and column_name = 'drift_threshold') then
    alter table public.settings add column drift_threshold numeric default 5;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'settings' and column_name = 'enable_emails') then
    alter table public.settings add column enable_emails boolean default true;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'settings' and column_name = 'nisab_amount') then
    alter table public.settings add column nisab_amount numeric default null;
  end if;
end $$;

-- 2. Budgets: period and tier columns (weekly/daily match Budgets UI + householdBudgetEngine)
alter table if exists public.budgets
  add column if not exists period text default 'monthly';
alter table if exists public.budgets
  add column if not exists tier text default 'Optional' check (tier in ('Core', 'Supporting', 'Optional'));

alter table if exists public.budgets drop constraint if exists budgets_period_check;
alter table public.budgets add constraint budgets_period_check check (period in ('monthly', 'yearly', 'weekly', 'daily'));

-- 3. Investment plan (one row per user; upsert on user_id)
create table if not exists public.investment_plan (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_budget numeric not null default 6000,
  budget_currency text not null default 'SAR',
  execution_currency text not null default 'USD',
  fx_rate_source text default 'GoogleFinance:CURRENCY:SARUSD',
  core_allocation numeric not null default 0.7,
  upside_allocation numeric not null default 0.3,
  minimum_upside_percentage numeric not null default 25,
  stale_days integer not null default 30,
  min_coverage_threshold integer not null default 3,
  redirect_policy text not null default 'pro-rata' check (redirect_policy in ('priority', 'pro-rata')),
  target_provider text default 'Default',
  core_portfolio jsonb default '[]',
  upside_sleeve jsonb default '[]',
  broker_constraints jsonb default '{"allowFractionalShares":true,"minimumOrderSize":100,"roundingRule":"round","leftoverCashRule":"reinvest_core"}',
  sleeves jsonb default null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'investment_plan') then
    alter table public.investment_plan add column if not exists sleeves jsonb default null;
  end if;
end $$;

comment on column public.investment_plan.sleeves is 'General sleeve definitions: [{ "id": "core", "label": "Core", "targetPct": 70, "tickers": ["AAPL", ...] }, ...]. If null, derived from core_allocation/upside_allocation and core_portfolio/upside_sleeve.';

-- 3b. Wealth Ultra config
create table if not exists public.wealth_ultra_config (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  fx_rate numeric not null default 0.27,
  cash_reserve_pct numeric not null default 10,
  max_per_ticker_pct numeric not null default 20,
  risk_weight_low numeric not null default 1,
  risk_weight_med numeric not null default 1.25,
  risk_weight_high numeric not null default 1.5,
  risk_weight_spec numeric not null default 2,
  default_target_1_pct numeric not null default 15,
  default_target_2_pct numeric not null default 25,
  default_trailing_pct numeric not null default 10,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.wealth_ultra_config is 'System-wide (user_id null) or per-user Wealth Ultra defaults.';

create index if not exists idx_wealth_ultra_config_user on public.wealth_ultra_config(user_id);

insert into public.wealth_ultra_config (id, user_id, fx_rate, cash_reserve_pct, max_per_ticker_pct, risk_weight_low, risk_weight_med, risk_weight_high, risk_weight_spec, default_target_1_pct, default_target_2_pct, default_trailing_pct)
select gen_random_uuid(), null, 0.27, 10, 20, 1, 1.25, 1.5, 2, 15, 25, 10
where not exists (select 1 from public.wealth_ultra_config where user_id is null limit 1);

-- 4. Portfolio universe
create table if not exists public.portfolio_universe (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  name text not null default '',
  status text not null default 'Watchlist' check (status in ('Core', 'High-Upside', 'Watchlist', 'Quarantine', 'Speculative', 'Excluded')),
  monthly_weight numeric,
  max_position_weight numeric,
  min_upside_threshold_override numeric,
  min_coverage_override integer,
  created_at timestamptz default now(),
  unique(user_id, ticker)
);

create index if not exists idx_portfolio_universe_user on public.portfolio_universe(user_id);

-- 5. Status change log
create table if not exists public.status_change_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  timestamp timestamptz not null default now(),
  from_status text not null,
  to_status text not null,
  created_at timestamptz default now()
);

create index if not exists idx_status_change_log_user on public.status_change_log(user_id);

-- 6. Execution logs (investment plan runs; validated in app via validateExecutionLog)
create table if not exists public.execution_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date text,
  total_investment numeric,
  core_investment numeric,
  upside_investment numeric,
  speculative_investment numeric,
  redirected_investment numeric,
  unused_upside_funds numeric,
  trades jsonb default '[]',
  status text not null default 'success' check (status in ('success', 'failure')),
  log_details text,
  created_at timestamptz not null default now()
);

create index if not exists idx_execution_logs_user_created on public.execution_logs(user_id, created_at desc);

-- 7. Patch existing tables: add any missing columns
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'investment_plan') then
    alter table public.investment_plan add column if not exists monthly_budget numeric default 6000;
    alter table public.investment_plan add column if not exists budget_currency text default 'SAR';
    alter table public.investment_plan add column if not exists execution_currency text default 'USD';
    alter table public.investment_plan add column if not exists fx_rate_source text default 'GoogleFinance:CURRENCY:SARUSD';
    alter table public.investment_plan add column if not exists core_allocation numeric default 0.7;
    alter table public.investment_plan add column if not exists upside_allocation numeric default 0.3;
    alter table public.investment_plan add column if not exists minimum_upside_percentage numeric default 25;
    alter table public.investment_plan add column if not exists stale_days integer default 30;
    alter table public.investment_plan add column if not exists min_coverage_threshold integer default 3;
    alter table public.investment_plan add column if not exists redirect_policy text default 'pro-rata';
    alter table public.investment_plan add column if not exists target_provider text default 'Default';
    alter table public.investment_plan add column if not exists core_portfolio jsonb default '[]';
    alter table public.investment_plan add column if not exists upside_sleeve jsonb default '[]';
    alter table public.investment_plan add column if not exists broker_constraints jsonb default '{"allowFractionalShares":true,"minimumOrderSize":100,"roundingRule":"round","leftoverCashRule":"reinvest_core"}';
    alter table public.investment_plan add column if not exists sleeves jsonb default null;
    alter table public.investment_plan add column if not exists created_at timestamptz default now();
    alter table public.investment_plan add column if not exists updated_at timestamptz default now();
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'wealth_ultra_config') then
    alter table public.wealth_ultra_config add column if not exists fx_rate numeric default 0.27;
    alter table public.wealth_ultra_config add column if not exists cash_reserve_pct numeric default 10;
    alter table public.wealth_ultra_config add column if not exists max_per_ticker_pct numeric default 20;
    alter table public.wealth_ultra_config add column if not exists risk_weight_low numeric default 1;
    alter table public.wealth_ultra_config add column if not exists risk_weight_med numeric default 1.25;
    alter table public.wealth_ultra_config add column if not exists risk_weight_high numeric default 1.5;
    alter table public.wealth_ultra_config add column if not exists risk_weight_spec numeric default 2;
    alter table public.wealth_ultra_config add column if not exists default_target_1_pct numeric default 15;
    alter table public.wealth_ultra_config add column if not exists default_target_2_pct numeric default 25;
    alter table public.wealth_ultra_config add column if not exists default_trailing_pct numeric default 10;
    alter table public.wealth_ultra_config add column if not exists created_at timestamptz default now();
    alter table public.wealth_ultra_config add column if not exists updated_at timestamptz default now();
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'portfolio_universe') then
    alter table public.portfolio_universe add column if not exists ticker text;
    alter table public.portfolio_universe add column if not exists name text default '';
    alter table public.portfolio_universe add column if not exists status text default 'Watchlist';
    alter table public.portfolio_universe add column if not exists monthly_weight numeric;
    alter table public.portfolio_universe add column if not exists max_position_weight numeric;
    alter table public.portfolio_universe add column if not exists min_upside_threshold_override numeric;
    alter table public.portfolio_universe add column if not exists min_coverage_override integer;
    alter table public.portfolio_universe add column if not exists created_at timestamptz default now();
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'status_change_log') then
    alter table public.status_change_log add column if not exists ticker text;
    alter table public.status_change_log add column if not exists timestamp timestamptz default now();
    alter table public.status_change_log add column if not exists from_status text;
    alter table public.status_change_log add column if not exists to_status text;
    alter table public.status_change_log add column if not exists created_at timestamptz default now();
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'execution_logs') then
    alter table public.execution_logs add column if not exists date text;
    alter table public.execution_logs add column if not exists total_investment numeric;
    alter table public.execution_logs add column if not exists core_investment numeric;
    alter table public.execution_logs add column if not exists upside_investment numeric;
    alter table public.execution_logs add column if not exists speculative_investment numeric;
    alter table public.execution_logs add column if not exists redirected_investment numeric;
    alter table public.execution_logs add column if not exists unused_upside_funds numeric;
    alter table public.execution_logs add column if not exists trades jsonb default '[]';
    alter table public.execution_logs add column if not exists status text default 'success';
    alter table public.execution_logs add column if not exists log_details text;
    alter table public.execution_logs add column if not exists created_at timestamptz default now();
  end if;
end $$;

-- 8. Indexes (idempotent)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'portfolio_universe') then
    execute 'create index if not exists idx_portfolio_universe_user on public.portfolio_universe(user_id)';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'status_change_log') then
    execute 'create index if not exists idx_status_change_log_user on public.status_change_log(user_id)';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'execution_logs') then
    execute 'create index if not exists idx_execution_logs_user_created on public.execution_logs(user_id, created_at desc)';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- PART B — Recurring transactions (requires public.accounts)
-- -----------------------------------------------------------------------------

create table if not exists public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null,
  amount numeric not null check (amount > 0),
  type text not null check (type in ('income', 'expense')),
  account_id uuid not null references public.accounts(id) on delete cascade,
  budget_category text,
  category text not null,
  day_of_month integer not null default 1 check (day_of_month >= 1 and day_of_month <= 28),
  enabled boolean not null default true,
  created_at timestamptz default now()
);

create index if not exists idx_recurring_transactions_user on public.recurring_transactions(user_id);

alter table if exists public.transactions
  add column if not exists recurring_id uuid;

create index if not exists idx_transactions_recurring_id on public.transactions(recurring_id) where recurring_id is not null;

alter table public.recurring_transactions
  add column if not exists add_manually boolean not null default false;

comment on column public.recurring_transactions.add_manually is 'If true, do not auto-record on day; user applies manually. If false, system records on day_of_month.';


-- -----------------------------------------------------------------------------
-- PART C — transactions.budget_category
-- -----------------------------------------------------------------------------

alter table public.transactions
  add column if not exists budget_category text;

comment on column public.transactions.budget_category is 'Budget category for expense tracking. Used for spending reports and recurring rules.';


-- -----------------------------------------------------------------------------
-- PART D — Row Level Security (production)
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
  tables_with_user_id text[] := array[
    'accounts', 'assets', 'liabilities', 'goals', 'transactions', 'budgets',
    'recurring_transactions', 'investment_portfolios', 'holdings', 'investment_transactions',
    'watchlist', 'settings', 'zakat_payments', 'price_alerts', 'commodity_holdings',
    'planned_trades', 'investment_plan', 'portfolio_universe', 'status_change_log',
    'execution_logs', 'budget_requests'
  ];
begin
  foreach t in array tables_with_user_id
  loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists "Users can manage own %s" on public.%I', t, t);
      execute format('create policy "Users can manage own %s" on public.%I for all using (auth.uid() = user_id)', t, t);
    end if;
  end loop;
end $$;

-- =============================================================================
-- END — Verify app loads; optional migrations remain in README_DB_MIGRATIONS.md
-- =============================================================================
