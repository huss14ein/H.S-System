-- Drop legacy asset_id FK on payout tables (Sukuk now lives in sukuk_positions only).
begin;

alter table if exists public.sukuk_payout_schedules
  drop constraint if exists sukuk_payout_schedules_asset_id_fkey;

alter table if exists public.sukuk_payout_events
  drop constraint if exists sukuk_payout_events_asset_id_fkey;

drop index if exists public.sukuk_payout_schedules_asset_idx;
drop index if exists public.sukuk_payout_events_asset_idx;

alter table if exists public.sukuk_payout_schedules drop column if exists asset_id;
alter table if exists public.sukuk_payout_events drop column if exists asset_id;

delete from public.sukuk_payout_events where sukuk_position_id is null;
delete from public.sukuk_payout_schedules where sukuk_position_id is null;

alter table if exists public.sukuk_payout_schedules
  alter column sukuk_position_id set not null;

alter table if exists public.sukuk_payout_events
  alter column sukuk_position_id set not null;

commit;
