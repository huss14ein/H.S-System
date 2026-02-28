-- Run this in your Supabase SQL editor so the app works correctly.
-- 1. Settings: ensure gold_price exists for Zakat (and other preference columns in snake_case).
-- 2. Budgets: add period column for yearly budgets (e.g. housing).
--
-- For a full schema (including investment_plan, portfolio_universe, status_change_log, execution_logs),
-- run supabase/full_schema_for_app.sql instead.

-- Settings: add gold_price if your table uses snake_case columns
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'settings' and column_name = 'gold_price'
  ) then
    alter table public.settings add column gold_price numeric default 275;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'settings' and column_name = 'risk_profile'
  ) then
    alter table public.settings add column risk_profile text default 'Moderate';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'settings' and column_name = 'budget_threshold'
  ) then
    alter table public.settings add column budget_threshold numeric default 90;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'settings' and column_name = 'drift_threshold'
  ) then
    alter table public.settings add column drift_threshold numeric default 5;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'settings' and column_name = 'enable_emails'
  ) then
    alter table public.settings add column enable_emails boolean default true;
  end if;
end $$;

-- Budgets: add period for yearly budgets (e.g. housing)
alter table if exists public.budgets
  add column if not exists period text default 'monthly' check (period in ('monthly', 'yearly'));
