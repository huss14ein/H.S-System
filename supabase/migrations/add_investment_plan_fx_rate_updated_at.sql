-- Optional: run in Supabase SQL editor if investment_plan save warns about fx_rate_updated_at.
alter table public.investment_plan
  add column if not exists fx_rate_updated_at timestamptz;

comment on column public.investment_plan.fx_rate_updated_at is
  'Last time the user saved their monthly investment plan (FX/plan confirmation for notifications).';
