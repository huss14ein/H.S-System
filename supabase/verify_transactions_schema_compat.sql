-- Post-deploy verification for transactions schema compatibility and pending-RPC health.
-- Run in Supabase SQL editor after migrations.

-- 1) required columns present
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'transactions'
  and column_name in ('account_id', 'budget_category', 'recurring_id')
order by column_name;

-- 2) pending RPC callable and returns expected shape
select * from public.get_pending_transactions_for_admin() limit 5;

-- 3) quick counts (sanity)
select
  count(*) as total_transactions,
  count(*) filter (where recurring_id is not null) as recurring_linked,
  count(*) filter (where lower(coalesce(status, '')) = 'pending') as pending_count
from public.transactions;
