-- Backfill portfolio_id on legacy investment_transactions when the platform has exactly one portfolio.
-- Safe: does not invent a portfolio when multiple books share the same account.
-- Run after 20260715120000_investment_transactions_portfolio_id.sql.

update public.investment_transactions it
set portfolio_id = sole.id
from (
  select
    p.user_id,
    p.account_id,
    min(p.id::text)::uuid as id
  from public.investment_portfolios p
  group by p.user_id, p.account_id
  having count(*) = 1
) sole
where it.portfolio_id is null
  and it.user_id = sole.user_id
  and it.account_id = sole.account_id;
