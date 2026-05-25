-- Master enhancement rollout: watchlist research, liability fields, planned trade tranches, thesis/journal.

alter table if exists public.watchlist
  add column if not exists target_buy_low numeric,
  add column if not exists target_buy_high numeric,
  add column if not exists fair_value numeric,
  add column if not exists quality_score numeric,
  add column if not exists valuation_score numeric,
  add column if not exists catalyst text,
  add column if not exists thesis_status text,
  add column if not exists research_notes text;

alter table if exists public.liabilities
  add column if not exists apr numeric,
  add column if not exists min_payment numeric,
  add column if not exists maturity_date date,
  add column if not exists payoff_priority int;

alter table if exists public.accounts
  add column if not exists account_role text,
  add column if not exists bucket_type text;

alter table if exists public.planned_trades
  add column if not exists tranche_index int default 1,
  add column if not exists tranche_group_id uuid,
  add column if not exists filled_qty numeric default 0,
  add column if not exists target_qty numeric;

create table if not exists public.investment_thesis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  conviction int check (conviction between 1 and 5),
  review_date date,
  status text default 'active',
  body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, symbol)
);

create table if not exists public.investment_journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text,
  entry_type text default 'note',
  body text not null,
  tags text[],
  created_at timestamptz not null default now()
);

create index if not exists investment_journal_user_created_idx
  on public.investment_journal_entries (user_id, created_at desc);

alter table public.investment_thesis enable row level security;
alter table public.investment_journal_entries enable row level security;

drop policy if exists "Users manage own investment thesis" on public.investment_thesis;
create policy "Users manage own investment thesis"
  on public.investment_thesis for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage own investment journal" on public.investment_journal_entries;
create policy "Users manage own investment journal"
  on public.investment_journal_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
