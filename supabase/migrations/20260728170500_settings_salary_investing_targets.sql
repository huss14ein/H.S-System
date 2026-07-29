alter table if exists public.settings
  add column if not exists salary_investing_targets jsonb;

comment on column public.settings.salary_investing_targets is
  'Optional salary-to-investment preferences: monthly targets, allocation splits, attribution hints, and alert thresholds.';
