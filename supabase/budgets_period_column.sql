-- Add period column to budgets to support yearly budgets (e.g. housing).
-- When period = 'yearly', limit is the total per year; when 'monthly' or null, limit is per month.
alter table if exists public.budgets
  add column if not exists period text default 'monthly' check (period in ('monthly', 'yearly'));
