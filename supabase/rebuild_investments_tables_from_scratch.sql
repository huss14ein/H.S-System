-- DESTRUCTIVE: rebuild core investment tables from scratch.
-- Use this only if you want to wipe investment portfolios/holdings/transactions and recreate clean FKs.
-- It does NOT drop public.accounts (because that impacts the whole app).
--
-- Tables dropped/recreated:
-- - public.investment_transactions
-- - public.holdings
-- - public.investment_portfolios
--
-- Prereqs:
-- - public.accounts exists with primary key `id` (uuid)
-- - Supabase Auth exists (auth.users) or replace references accordingly

begin;

drop table if exists public.investment_transactions cascade;
drop table if exists public.holdings cascade;
drop table if exists public.investment_portfolios cascade;

create table public.investment_portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  account_id uuid not null references public.accounts(id) on delete restrict,
  goal_id uuid,
  owner text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_investment_portfolios_user on public.investment_portfolios(user_id);
create index idx_investment_portfolios_account on public.investment_portfolios(account_id);

create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  portfolio_id uuid not null references public.investment_portfolios(id) on delete cascade,
  symbol text not null,
  name text not null default '',
  quantity numeric not null default 0,
  avg_cost numeric not null default 0,
  current_value numeric not null default 0,
  realized_pnl numeric not null default 0,
  zakah_class text not null default 'Zakatable',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_holdings_user on public.holdings(user_id);
create index idx_holdings_portfolio on public.holdings(portfolio_id);
create index idx_holdings_symbol on public.holdings(symbol);

create table public.investment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  date text not null,
  type text not null check (type in ('buy', 'sell', 'dividend', 'deposit', 'withdrawal')),
  symbol text not null,
  quantity numeric not null default 0,
  price numeric not null default 0,
  total numeric not null default 0,
  created_at timestamptz default now()
);

create index idx_investment_transactions_user on public.investment_transactions(user_id);
create index idx_investment_transactions_account on public.investment_transactions(account_id);
create index idx_investment_transactions_symbol on public.investment_transactions(symbol);

commit;

