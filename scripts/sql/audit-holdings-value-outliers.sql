-- Holdings value outlier audit (run in Supabase SQL editor).
-- Schema: public.holdings uses avg_cost, current_value, quantity (see rebuild_investments_tables_from_scratch.sql).
-- Flags rows where stored current_value is far from qty × avg_cost.

with priced as (
  select
    h.id,
    h.user_id,
    h.symbol,
    coalesce(h.quantity, 0)::numeric as quantity,
    coalesce(h.current_value, 0)::numeric as current_value,
    coalesce(h.avg_cost, 0)::numeric as avg_cost,
    coalesce(h.avg_cost, 0)::numeric * coalesce(h.quantity, 0)::numeric as cost_basis
  from public.holdings h
  where coalesce(h.quantity, 0) > 0
)
select
  id,
  user_id,
  symbol,
  quantity,
  current_value,
  cost_basis,
  avg_cost,
  case
    when cost_basis > 0 and current_value > cost_basis * 50 then 'value_vs_cost_50x'
    when cost_basis > 0 and current_value < cost_basis * 0.02 then 'value_vs_cost_2pct'
    when quantity > 0 and avg_cost > 0 and abs(current_value - quantity * avg_cost) > greatest(quantity * avg_cost * 5, 10000) then 'value_vs_qty_cost'
    else 'ok'
  end as outlier_reason
from priced
where
  (cost_basis > 0 and (current_value > cost_basis * 50 or current_value < cost_basis * 0.02))
  or (
    quantity > 0
    and avg_cost > 0
    and abs(current_value - quantity * avg_cost) > greatest(quantity * avg_cost * 5, 10000)
  )
order by current_value desc nulls last;
