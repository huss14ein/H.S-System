-- Default financial month start to day 28 (salary-cycle style). Existing rows keep their stored value.

alter table if exists public.settings
  alter column month_start_day set default 28;
