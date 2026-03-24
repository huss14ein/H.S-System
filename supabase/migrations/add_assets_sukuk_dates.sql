-- Sukuk and other dated instruments: full calendar dates for issue and maturity.
-- Run against your Supabase project if `assets` already exists.

alter table if exists public.assets
  add column if not exists issue_date date,
  add column if not exists maturity_date date;

comment on column public.assets.issue_date is 'Issue or subscription date (e.g. Sukuk), DATE.';
comment on column public.assets.maturity_date is 'Maturity date (e.g. Sukuk), DATE.';
