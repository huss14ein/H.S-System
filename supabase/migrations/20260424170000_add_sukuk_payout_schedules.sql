-- Sukuk payout schedules: handle monthly / quarterly / maturity-only / custom.
-- Payouts are posted into investment platform cash (investment_transactions) so they can be reinvested.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'sukuk_payout_cadence') then
    create type public.sukuk_payout_cadence as enum ('monthly', 'quarterly', 'maturity_only', 'custom');
  end if;
  if not exists (select 1 from pg_type where typname = 'sukuk_payout_kind') then
    create type public.sukuk_payout_kind as enum ('coupon', 'principal');
  end if;
end $$;

create table if not exists public.sukuk_payout_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  investment_account_id uuid not null references public.accounts(id) on delete cascade,
  currency text not null check (currency in ('SAR', 'USD')),
  cadence public.sukuk_payout_cadence not null,
  -- For monthly/quarterly: day-of-month (1-28 to avoid invalid dates)
  day_of_month integer null check (day_of_month is null or (day_of_month >= 1 and day_of_month <= 28)),
  -- Coupon amount per payout (in schedule currency)
  coupon_amount numeric null check (coupon_amount is null or coupon_amount >= 0),
  -- Principal amount to post at maturity (optional; if null, principal is not auto-posted)
  principal_amount numeric null check (principal_amount is null or principal_amount >= 0),
  start_date date null,
  end_date date null,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sukuk_payout_schedules_user_idx on public.sukuk_payout_schedules(user_id);
create index if not exists sukuk_payout_schedules_asset_idx on public.sukuk_payout_schedules(asset_id);
create index if not exists sukuk_payout_schedules_account_idx on public.sukuk_payout_schedules(investment_account_id);

create table if not exists public.sukuk_payout_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  schedule_id uuid not null references public.sukuk_payout_schedules(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  investment_account_id uuid not null references public.accounts(id) on delete cascade,
  kind public.sukuk_payout_kind not null,
  payout_date date not null,
  amount numeric not null check (amount >= 0),
  currency text not null check (currency in ('SAR', 'USD')),
  posted boolean not null default false,
  posted_at timestamptz null,
  posted_investment_transaction_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(schedule_id, kind, payout_date)
);

create index if not exists sukuk_payout_events_user_idx on public.sukuk_payout_events(user_id);
create index if not exists sukuk_payout_events_due_idx on public.sukuk_payout_events(user_id, posted, payout_date);
create index if not exists sukuk_payout_events_asset_idx on public.sukuk_payout_events(asset_id);

-- updated_at triggers
drop trigger if exists set_sukuk_payout_schedules_updated_at on public.sukuk_payout_schedules;
create trigger set_sukuk_payout_schedules_updated_at before update on public.sukuk_payout_schedules
for each row execute function public.set_updated_at();

-- RLS
alter table public.sukuk_payout_schedules enable row level security;
alter table public.sukuk_payout_events enable row level security;

drop policy if exists "Users can manage own sukuk_payout_schedules" on public.sukuk_payout_schedules;
create policy "Users can manage own sukuk_payout_schedules"
  on public.sukuk_payout_schedules
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own sukuk_payout_events" on public.sukuk_payout_events;
create policy "Users can manage own sukuk_payout_events"
  on public.sukuk_payout_events
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

commit;

