-- Scope investment ledger rows to a portfolio (Record Trade / CA replay / KPI attribution).
-- Safe on databases that already have the column.

alter table if exists public.investment_transactions
  add column if not exists portfolio_id uuid null
    references public.investment_portfolios(id) on delete set null;

comment on column public.investment_transactions.portfolio_id is
  'Optional investment_portfolios.id for the trade. NULL = legacy / account-level only.';

create index if not exists idx_investment_transactions_portfolio_id
  on public.investment_transactions(portfolio_id)
  where portfolio_id is not null;

create index if not exists idx_investment_transactions_user_portfolio
  on public.investment_transactions(user_id, portfolio_id)
  where portfolio_id is not null;
