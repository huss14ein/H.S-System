-- Recurring (monthly) transaction templates: salary, rent, subscriptions, etc.
-- Apply via UI to create actual transactions for a given month.

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

-- Optional: link transactions to the recurring rule that created them (so we don't double-apply)
alter table if exists public.transactions
  add column if not exists recurring_id uuid;

create index if not exists idx_transactions_recurring_id on public.transactions(recurring_id) where recurring_id is not null;
