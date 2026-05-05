-- Allow financial month start day up to 31; short months use the last calendar day (e.g. preference 31 → Feb 28/29).
-- Ensure column exists even if 20260427190000_add_month_start_day_setting.sql was never applied on this DB.

alter table if exists public.settings
  add column if not exists month_start_day integer not null default 1;

alter table if exists public.settings
  drop constraint if exists settings_month_start_day_check;

alter table if exists public.settings
  add constraint settings_month_start_day_check check (month_start_day >= 1 and month_start_day <= 31);
