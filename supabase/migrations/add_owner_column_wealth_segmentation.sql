-- Add optional "owner" column for personal vs managed wealth segmentation.
-- Empty/null owner = personal (counts in "My" net worth). Non-empty (e.g. 'Father') = managed for someone else (excluded from "My" totals).
-- Safe to run multiple times (add column if not exists).

-- accounts
alter table if exists public.accounts
  add column if not exists owner text default null;
comment on column public.accounts.owner is 'Optional label for managed wealth (e.g. Father). Empty/null = personal; non-empty = excluded from My net worth.';

-- assets
alter table if exists public.assets
  add column if not exists owner text default null;
comment on column public.assets.owner is 'Optional label for managed wealth (e.g. Father). Empty/null = personal; non-empty = excluded from My net worth.';

-- liabilities
alter table if exists public.liabilities
  add column if not exists owner text default null;
comment on column public.liabilities.owner is 'Optional label for managed wealth (e.g. Father). Empty/null = personal; non-empty = excluded from My net worth.';

-- commodity_holdings
alter table if exists public.commodity_holdings
  add column if not exists owner text default null;
comment on column public.commodity_holdings.owner is 'Optional label for managed wealth (e.g. Father). Empty/null = personal; non-empty = excluded from My net worth.';

-- investment_portfolios (may already exist if rebuild_investments_tables_from_scratch.sql was used)
alter table if exists public.investment_portfolios
  add column if not exists owner text default null;
comment on column public.investment_portfolios.owner is 'Optional label for managed wealth (e.g. Father). Empty/null = personal; non-empty = excluded from My net worth.';
