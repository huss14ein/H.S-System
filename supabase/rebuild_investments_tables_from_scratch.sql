-- DESTRUCTIVE: rebuild core investment tables from scratch.
-- Use this only if you want to wipe investment portfolios/holdings/transactions and recreate clean FKs.
-- It does NOT drop public.accounts (because that impacts the whole app).
--
-- DO NOT run on production with live data — all rows in the three tables below are deleted.
-- For live DBs, use additive migrations instead (e.g. 20260715120000_investment_transactions_portfolio_id.sql).
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
  currency text null check (currency is null or currency in ('USD', 'SAR')),
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
  current_price numeric null,
  price_updated_at timestamptz null,
  realized_pnl numeric not null default 0,
  zakah_class text not null default 'Zakatable',
  holding_type text not null default 'ticker',
  asset_class text null,
  goal_id uuid null,
  acquisition_date text null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_holdings_user on public.holdings(user_id);
create index idx_holdings_portfolio on public.holdings(portfolio_id);
create index idx_holdings_symbol on public.holdings(symbol);
create unique index holdings_user_portfolio_symbol_uidx
  on public.holdings (user_id, portfolio_id, (upper(trim(symbol))));

create table public.investment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  portfolio_id uuid null references public.investment_portfolios(id) on delete set null,
  date text not null,
  type text not null check (type in ('buy', 'sell', 'dividend', 'deposit', 'withdrawal', 'fee', 'vat')),
  symbol text not null,
  quantity numeric not null default 0,
  price numeric not null default 0,
  total numeric not null default 0,
  currency text null check (currency is null or currency in ('USD', 'SAR')),
  linked_cash_account_id uuid null references public.accounts(id) on delete set null,
  idempotency_key text null,
  created_at timestamptz default now()
);

create index idx_investment_transactions_user on public.investment_transactions(user_id);
create index idx_investment_transactions_account on public.investment_transactions(account_id);
create index idx_investment_transactions_symbol on public.investment_transactions(symbol);
create index idx_investment_transactions_portfolio_id
  on public.investment_transactions(portfolio_id)
  where portfolio_id is not null;
create unique index investment_transactions_idempotency_unique
  on public.investment_transactions(user_id, idempotency_key)
  where idempotency_key is not null;

commit;
