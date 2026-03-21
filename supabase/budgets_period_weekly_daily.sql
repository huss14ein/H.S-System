-- Allow weekly and daily budget periods (Budgets page + householdBudgetEngine).
-- Safe to run on existing DBs that only allowed monthly/yearly.

alter table if exists public.budgets drop constraint if exists budgets_period_check;

alter table public.budgets add constraint budgets_period_check
  check (period in ('monthly', 'yearly', 'weekly', 'daily'));
