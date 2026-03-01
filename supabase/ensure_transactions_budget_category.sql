-- Ensure transactions table has budget_category for linking expenses to budget categories.
-- App uses this for spending by category, recurring rules, and approval flows.
-- Safe to run multiple times (idempotent).

alter table public.transactions
  add column if not exists budget_category text;

comment on column public.transactions.budget_category is 'Budget category for expense tracking (e.g. Food, Housing). Used for spending reports and recurring transaction rules.';
