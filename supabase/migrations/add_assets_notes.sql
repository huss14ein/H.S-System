-- Optional free-form notes on physical assets (location, references, insurance, etc.).
-- Apply in Supabase SQL editor if migrations are not auto-run.

alter table if exists public.assets
  add column if not exists notes text;

comment on column public.assets.notes is 'Optional user notes; details beyond name/type/value.';
