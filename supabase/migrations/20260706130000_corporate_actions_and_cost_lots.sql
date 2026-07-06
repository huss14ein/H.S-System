-- Corporate actions event store + investment_cost_lots (KSA P/L cost basis, not tax reporting).
-- Extends investment_transactions types for corporate-action ledger rows.

begin;

create table if not exists public.corporate_action_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  portfolio_id uuid not null references public.investment_portfolios(id) on delete cascade,
  action_type text not null check (action_type in (
    'stock_split', 'reverse_stock_split', 'cash_in_lieu',
    'spinoff', 'merger', 'dividend_cash', 'dividend_drip'
  )),
  symbol text not null,
  linked_symbol text null,
  execution_date date not null,
  ratio_numerator numeric(18,6) null,
  ratio_denominator numeric(18,6) null,
  cash_per_share numeric(18,4) null,
  cost_basis_allocation_pct numeric(8,4) null,
  quantity numeric(18,6) null,
  price_per_share numeric(18,4) null,
  idempotency_key text not null,
  status text not null default 'applied' check (status in ('applied', 'reversed')),
  reversed_by_event_id uuid null references public.corporate_action_events(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists corporate_action_events_user_idx on public.corporate_action_events(user_id);
create index if not exists corporate_action_events_portfolio_idx on public.corporate_action_events(portfolio_id, execution_date);

alter table public.corporate_action_events enable row level security;
drop policy if exists "Users manage own corporate_action_events" on public.corporate_action_events;
create policy "Users manage own corporate_action_events"
  on public.corporate_action_events for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.investment_cost_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  portfolio_id uuid not null references public.investment_portfolios(id) on delete cascade,
  symbol text not null,
  market text not null default 'Other' check (market in ('US', 'Tadawul', 'Other')),
  acquisition_date date not null,
  quantity_remaining numeric(18,6) not null check (quantity_remaining >= 0),
  cost_per_share numeric(18,4) not null check (cost_per_share >= 0),
  book_currency text not null default 'SAR' check (book_currency in ('SAR', 'USD')),
  source_transaction_id uuid null,
  source_corporate_action_id uuid null references public.corporate_action_events(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists investment_cost_lots_user_portfolio_idx
  on public.investment_cost_lots(user_id, portfolio_id, symbol);

alter table public.investment_cost_lots enable row level security;
drop policy if exists "Users manage own investment_cost_lots" on public.investment_cost_lots;
create policy "Users manage own investment_cost_lots"
  on public.investment_cost_lots for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table if exists public.investment_transactions
  add column if not exists idempotency_key text null;

create unique index if not exists investment_transactions_idempotency_unique
  on public.investment_transactions(user_id, idempotency_key)
  where idempotency_key is not null;

commit;
