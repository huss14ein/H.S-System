-- =============================================================================
-- Full schema and migrations for H.S-System app (Supabase) — Option B.
-- Run this in the Supabase SQL editor. Safe to run multiple times (idempotent).
-- Use this when you already have tables: it adds missing columns and indexes.
-- If "create table" fails (e.g. auth.users missing), create tables without
-- "references auth.users(id)", then run this script again to add columns.
-- =============================================================================

-- 1. Settings: ensure all columns exist (snake_case for DB)
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

-- 2. Budgets: period and tier columns
alter table if exists public.budgets
  add column if not exists period text default 'monthly' check (period in ('monthly', 'yearly'));
alter table if exists public.budgets
  add column if not exists tier text default 'Optional' check (tier in ('Core', 'Supporting', 'Optional'));

-- 3. Investment plan (one row per user; upsert on user_id)
-- Note: If you use Supabase Auth, auth.users exists. If not, remove "references auth.users(id) on delete cascade".
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

-- Ensure sleeves column exists (for DBs where investment_plan was created before this column was added)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'investment_plan') then
    alter table public.investment_plan add column if not exists sleeves jsonb default null;
  end if;
end $$;

comment on column public.investment_plan.sleeves is 'General sleeve definitions: [{ "id": "core", "label": "Core", "targetPct": 70, "tickers": ["AAPL", ...] }, ...]. If null, derived from core_allocation/upside_allocation and core_portfolio/upside_sleeve.';

-- 3b. Wealth Ultra config (system-wide; general share/sleeve defaults, not code-specific)
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

comment on table public.wealth_ultra_config is 'System-wide (user_id null) or per-user Wealth Ultra defaults. General config for shares/sleeves; not hardcoded in app.';

create index if not exists idx_wealth_ultra_config_user on public.wealth_ultra_config(user_id);

insert into public.wealth_ultra_config (id, user_id, fx_rate, cash_reserve_pct, max_per_ticker_pct, risk_weight_low, risk_weight_med, risk_weight_high, risk_weight_spec, default_target_1_pct, default_target_2_pct, default_trailing_pct)
select gen_random_uuid(), null, 0.27, 10, 20, 1, 1.25, 1.5, 2, 15, 25, 10
where not exists (select 1 from public.wealth_ultra_config where user_id is null limit 1);

-- 4. Portfolio universe (tickers for investment plan)
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

-- 5. Status change log (ticker status history)
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

-- 6. Execution logs (investment plan runs)
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

-- 7. RLS (Row Level Security) – enable if you use Supabase Auth and want per-user isolation
-- Uncomment and run if your project uses RLS; adjust policy names to match your auth.
/*
alter table public.investment_plan enable row level security;
alter table public.portfolio_universe enable row level security;
alter table public.status_change_log enable row level security;
alter table public.execution_logs enable row level security;

create policy "Users can manage own investment_plan"
  on public.investment_plan for all using (auth.uid() = user_id);

create policy "Users can manage own portfolio_universe"
  on public.portfolio_universe for all using (auth.uid() = user_id);

create policy "Users can manage own status_change_log"
  on public.status_change_log for all using (auth.uid() = user_id);

create policy "Users can manage own execution_logs"
  on public.execution_logs for all using (auth.uid() = user_id);
*/

-- 8. Patch existing tables: add any missing columns (safe when you already have the tables)
do $$
begin
  -- investment_plan
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
    alter table public.investment_plan add column if not exists broker_constraints jsonb default '{}';
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

  -- portfolio_universe
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

  -- status_change_log
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'status_change_log') then
    alter table public.status_change_log add column if not exists ticker text;
    alter table public.status_change_log add column if not exists timestamp timestamptz default now();
    alter table public.status_change_log add column if not exists from_status text;
    alter table public.status_change_log add column if not exists to_status text;
    alter table public.status_change_log add column if not exists created_at timestamptz default now();
  end if;

  -- execution_logs
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

-- 9. Ensure indexes exist on existing tables (idempotent)
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
