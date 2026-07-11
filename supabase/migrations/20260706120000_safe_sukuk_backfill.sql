-- Safe Sukuk recovery: re-backfill from legacy assets without unconditional delete.
-- Run after 20260627120000 if positions were lost when backfill preconditions failed.

begin;

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
    (select s.investment_account_id from public.sukuk_payout_schedules s where s.sukuk_position_id = a.id limit 1),
    (select ac.id from public.accounts ac where ac.user_id = a.user_id and lower(coalesce(ac.type, '')) like '%investment%' order by ac.created_at nulls last limit 1),
    (select ac.id from public.accounts ac where ac.user_id = a.user_id order by ac.created_at nulls last limit 1)
  ) as investment_account_id,
  coalesce(
    (select s.currency from public.sukuk_payout_schedules s where s.sukuk_position_id = a.id limit 1),
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
  and exists (select 1 from public.accounts ac where ac.user_id = a.user_id)
  and coalesce(
    (select ac.id from public.accounts ac where ac.user_id = a.user_id limit 1),
    null
  ) is not null;

-- Only delete assets that were successfully migrated into sukuk_positions
delete from public.assets a
where a.type = 'Sukuk'
  and exists (select 1 from public.sukuk_positions sp where sp.id = a.id);

commit;
