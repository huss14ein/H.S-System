-- Per-lot Zakat hawl: optional acquisition date on holdings and commodities.
-- Net worth snapshots: server-side history (one row per user per local calendar day).

alter table if exists public.holdings
  add column if not exists acquisition_date date;

comment on column public.holdings.acquisition_date is 'Optional. When set, Zakat uses lunar hawl (~354d) from this date for this lot. If null, inferred from earliest buy in investment_transactions when possible.';

alter table if exists public.commodity_holdings
  add column if not exists acquisition_date date;

comment on column public.commodity_holdings.acquisition_date is 'Optional lunar hawl start for metal/crypto lots; null uses created_at or purchase inference in app.';

create table if not exists public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  snapshot_day date not null,
  captured_at timestamptz not null default now(),
  net_worth numeric not null,
  buckets jsonb,
  sar_per_usd numeric,
  unique (user_id, snapshot_day)
);

create index if not exists net_worth_snapshots_user_captured_idx
  on public.net_worth_snapshots (user_id, captured_at desc);

comment on table public.net_worth_snapshots is 'Daily net worth history (SAR); merged with localStorage on client.';

alter table public.net_worth_snapshots enable row level security;

drop policy if exists "Users manage own net worth snapshots" on public.net_worth_snapshots;

create policy "Users manage own net worth snapshots"
  on public.net_worth_snapshots
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
