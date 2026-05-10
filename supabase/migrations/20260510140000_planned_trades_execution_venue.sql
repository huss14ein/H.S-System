-- Optional execution venue: cash feasibility + Record Trade pre-select route to one platform/portfolio.
alter table if exists public.planned_trades
  add column if not exists portfolio_id uuid;

alter table if exists public.planned_trades
  add column if not exists account_id uuid;

comment on column public.planned_trades.portfolio_id is 'Optional investment portfolio to execute against (sizes buys to that platform''s deployable cash).';
comment on column public.planned_trades.account_id is 'Optional investment platform account id (alternative to portfolio_id).';
