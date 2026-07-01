-- Direct Sukuk contracts: investments domain (not assets).
-- Migrates existing assets.type = 'Sukuk' and retargets payout FKs.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'sukuk_position_status') then
    create type public.sukuk_position_status as enum ('active', 'completed');
  end if;
end $$;

create table if not exists public.sukuk_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  investment_account_id uuid not null references public.accounts(id) on delete cascade,
  currency text not null check (currency in ('SAR', 'USD')),
  face_value numeric not null check (face_value >= 0),
  outstanding_principal numeric not null check (outstanding_principal >= 0),
  purchase_price numeric null check (purchase_price is null or purchase_price >= 0),
  issue_date date not null,
  maturity_date date not null,
  status public.sukuk_position_status not null default 'active',
  goal_id uuid null references public.goals(id) on delete set null,
  notes text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (maturity_date >= issue_date)
);

create index if not exists sukuk_positions_user_idx on public.sukuk_positions(user_id);
create index if not exists sukuk_positions_user_status_idx on public.sukuk_positions(user_id, status);
create index if not exists sukuk_positions_user_maturity_idx on public.sukuk_positions(user_id, maturity_date);
create index if not exists sukuk_positions_account_idx on public.sukuk_positions(investment_account_id);

drop trigger if exists set_sukuk_positions_updated_at on public.sukuk_positions;
create trigger set_sukuk_positions_updated_at before update on public.sukuk_positions
for each row execute function public.set_updated_at();

alter table public.sukuk_positions enable row level security;

drop policy if exists "Users can manage own sukuk_positions" on public.sukuk_positions;
create policy "Users can manage own sukuk_positions"
  on public.sukuk_positions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Backfill from assets.type = 'Sukuk' (requires a default investment account per user)
insert into public.sukuk_positions (
  id,
  user_id,
  name,
  investment_account_id,
  currency,
  face_value,
  outstanding_principal,
  purchase_price,
  issue_date,
  maturity_date,
  status,
  goal_id,
  notes,
  metadata
)
select
  a.id,
  a.user_id,
  a.name,
  coalesce(
    (select s.investment_account_id from public.sukuk_payout_schedules s where s.asset_id = a.id limit 1),
    (select ac.id from public.accounts ac where ac.user_id = a.user_id and lower(coalesce(ac.type, '')) like '%investment%' order by ac.created_at nulls last limit 1),
    (select ac.id from public.accounts ac where ac.user_id = a.user_id order by ac.created_at nulls last limit 1)
  ) as investment_account_id,
  coalesce(
    (select s.currency from public.sukuk_payout_schedules s where s.asset_id = a.id limit 1),
    'SAR'
  ) as currency,
  greatest(0, coalesce(a.value, 0)) as face_value,
  greatest(0, coalesce(a.value, 0)) as outstanding_principal,
  case when a.purchase_price is not null and a.purchase_price > 0 then a.purchase_price else null end,
  coalesce(a.issue_date, current_date) as issue_date,
  coalesce(a.maturity_date, current_date) as maturity_date,
  case
    when a.maturity_date is not null and a.maturity_date < current_date and coalesce(a.value, 0) <= 0
      then 'completed'::public.sukuk_position_status
    else 'active'::public.sukuk_position_status
  end as status,
  a.goal_id,
  a.notes,
  '{}'::jsonb
from public.assets a
where a.type = 'Sukuk'
  and not exists (select 1 from public.sukuk_positions sp where sp.id = a.id)
  and exists (
    select 1 from public.accounts ac where ac.user_id = a.user_id
  );

-- Retarget payout schedules / events
alter table if exists public.sukuk_payout_schedules
  add column if not exists sukuk_position_id uuid null references public.sukuk_positions(id) on delete cascade;

alter table if exists public.sukuk_payout_events
  add column if not exists sukuk_position_id uuid null references public.sukuk_positions(id) on delete cascade;

update public.sukuk_payout_schedules s
set sukuk_position_id = s.asset_id
where s.sukuk_position_id is null and s.asset_id is not null
  and exists (select 1 from public.sukuk_positions sp where sp.id = s.asset_id);

update public.sukuk_payout_events e
set sukuk_position_id = e.asset_id
where e.sukuk_position_id is null and e.asset_id is not null
  and exists (select 1 from public.sukuk_positions sp where sp.id = e.asset_id);

alter table if exists public.sukuk_payout_schedules
  add column if not exists principal_installment_amount numeric null check (principal_installment_amount is null or principal_installment_amount >= 0);

create index if not exists sukuk_payout_schedules_position_idx on public.sukuk_payout_schedules(sukuk_position_id);
create index if not exists sukuk_payout_events_position_idx on public.sukuk_payout_events(sukuk_position_id);

-- Remove migrated Sukuk rows from assets (data now in sukuk_positions)
delete from public.assets where type = 'Sukuk';

commit;
